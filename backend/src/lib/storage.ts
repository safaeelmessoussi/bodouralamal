import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type { AppConfig } from './config.js';

/**
 * MinIO / S3 access (SRS §3.1, TD-9, TD-12).
 *
 * Dual buckets: `public` holds only `visibility = public` objects and is served
 * through stable URLs; `private` holds everything else and is NEVER exposed via
 * a stable URL — every read is a short-lived presigned URL minted only after a
 * server-side permission check (§20 rule 4).
 */
export const BUCKETS = {
  public: 'public',
  private: 'private',
} as const;

export type BucketName = (typeof BUCKETS)[keyof typeof BUCKETS];

/** TD-12 presigned URL TTLs. */
export const PRESIGN_TTL_SECONDS = {
  /** Presigned GET (private bucket): 10 minutes. */
  get: 10 * 60,
  /** Presigned single-shot PUT: 1 hour. */
  put: 60 * 60,
} as const;

/**
 * The signing contract that makes presigned URLs survive the Nginx `/storage/`
 * proxy (§3.1), established empirically by the §18 round-trip acceptance test.
 *
 * SigV4 signs the canonical path and the `host` header. Nginx strips the
 * `/storage` prefix before forwarding to MinIO, so MinIO recomputes the
 * signature over the *stripped* path. The signature therefore must be computed
 * over the stripped path too, against the public host:
 *
 *   sign   →  https://platform.bodour.ma/<bucket>/<key>?X-Amz-...
 *   serve  →  https://platform.bodour.ma/storage/<bucket>/<key>?X-Amz-...
 *   nginx  →  http://minio:9000/<bucket>/<key>?X-Amz-...   (host preserved)
 *
 * Signing against the full `STORAGE_BASE_URL` including `/storage` instead
 * would bake that segment into the canonical path and produce
 * SignatureDoesNotMatch the moment Nginx strips it. The URL handed to the
 * browser is still rooted at STORAGE_BASE_URL, which is what §3.1 requires.
 */
function splitStorageBaseUrl(storageBaseUrl: string): { origin: string; prefix: string } {
  const url = new URL(storageBaseUrl);
  return {
    origin: url.origin,
    // "/storage/" -> "/storage"; "/" (no prefix) -> ""
    prefix: url.pathname.replace(/\/+$/, ''),
  };
}

export interface StorageClients {
  /** Internal client — server-side operations that never leave the network
   *  (ranged GET for magic bytes, HEAD for size, delete). */
  readonly internal: S3Client;
  /** Public-origin client — used ONLY to compute presigned URLs handed to
   *  browsers, so the signature matches what the proxy receives. */
  readonly publicOrigin: S3Client;
  readonly storagePrefix: string;
}

export function createStorageClients(config: AppConfig): StorageClients {
  const credentials = {
    accessKeyId: config.MINIO_ACCESS_KEY,
    secretAccessKey: config.MINIO_SECRET_KEY,
  };
  // MinIO speaks path-style addressing; virtual-host style would resolve
  // `<bucket>.<host>` and never reach the proxy.
  const common = { region: 'us-east-1', forcePathStyle: true, credentials } as const;
  const { origin, prefix } = splitStorageBaseUrl(config.STORAGE_BASE_URL);

  return {
    internal: new S3Client({ ...common, endpoint: config.MINIO_ENDPOINT }),
    publicOrigin: new S3Client({ ...common, endpoint: origin }),
    storagePrefix: prefix,
  };
}

/** Inserts the proxy prefix that Nginx will strip back off (see above). */
function toProxyUrl(signedUrl: string, storagePrefix: string): string {
  if (storagePrefix === '') return signedUrl;
  const url = new URL(signedUrl);
  url.pathname = `${storagePrefix}${url.pathname}`;
  return url.toString();
}

export async function presignPutUrl(
  clients: StorageClients,
  bucket: BucketName,
  key: string,
  expiresIn: number = PRESIGN_TTL_SECONDS.put,
): Promise<string> {
  const signed = await getSignedUrl(
    clients.publicOrigin,
    new PutObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn },
  );
  return toProxyUrl(signed, clients.storagePrefix);
}

export async function presignGetUrl(
  clients: StorageClients,
  bucket: BucketName,
  key: string,
  expiresIn: number = PRESIGN_TTL_SECONDS.get,
): Promise<string> {
  const signed = await getSignedUrl(
    clients.publicOrigin,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn },
  );
  return toProxyUrl(signed, clients.storagePrefix);
}

/* ── Server-side object operations (TD-9 / R99 C2) ──────────────────────── */

/**
 * **Everything below runs on the INTERNAL client and never moves bytes through
 * this process.**
 *
 * Upload finalization and R99 ingestion both move verified bytes out of staging
 * without giving a browser write authority over the canonical key. R99 can be
 * up to 500 MB (TD-9). The obvious implementation —
 * `GetObject` into a buffer, `PutObject` back out — would put half a gigabyte
 * through a container pinned at `--max-old-space-size=768` (TD-13) for every
 * concurrent ingestion, on a 4 GB VPS (§2.4). It is not a tuning problem; it is
 * the wrong mechanism.
 *
 * S3 and MinIO both perform `CopyObject` **inside the storage service**, so the
 * object never leaves it and this process exchanges two small HTTP messages.
 * Everything here is deliberately O(1) in the object's size: a HEAD, a 512-byte
 * ranged GET, a server-side copy, a delete.
 *
 * These live in `storage.ts` rather than beside the ingestion worker because
 * they are storage operations, not recording operations — `content.service.ts`
 * had already grown private copies of the first two, and a third copy beside a
 * worker is how a bucket-addressing rule ends up stated three times.
 */

/** What an object IS, without reading it. */
export interface ObjectStat {
  sizeBytes: number;
  /** What the store believes the type is. **A claim, never a fact** — the magic
   *  bytes are what turn it into one (TD-9). */
  contentType: string | null;
  /** Opaque storage version identifier used for conditional reads/copies. */
  etag: string | null;
}

/**
 * `HEAD` — size and declared type, or `null` when there is no object.
 *
 * `null` rather than a throw, because *the object is not there* is an ordinary
 * answer in both callers: an upload that never completed, and a provider that
 * reported a file it did not write.
 */
function objectStatOf(head: {
  ContentLength?: number | undefined;
  ContentType?: string | undefined;
  ETag?: string | undefined;
}): ObjectStat {
  return {
    sizeBytes: Number(head.ContentLength ?? 0),
    contentType: head.ContentType ?? null,
    etag: head.ETag ?? null,
  };
}

function isStorageNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as {
    name?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  return (
    candidate.$metadata?.httpStatusCode === 404 ||
    candidate.name === 'NotFound' ||
    candidate.name === 'NoSuchKey'
  );
}

/** Like `statObject`, but an unavailable store is an error rather than a
 * fabricated "missing" object. Publication code must never overwrite a key
 * merely because its safety HEAD failed. */
export async function statObjectStrict(
  clients: StorageClients,
  bucket: string,
  key: string,
): Promise<ObjectStat | null> {
  try {
    const head = await clients.internal.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
    );
    return objectStatOf(head);
  } catch (error) {
    if (isStorageNotFound(error)) return null;
    throw error;
  }
}

/** Compatibility-shaped best-effort HEAD for cleanup/inspection callers. */
export async function statObject(
  clients: StorageClients,
  bucket: string,
  key: string,
): Promise<ObjectStat | null> {
  try {
    return await statObjectStrict(clients, bucket, key);
  } catch {
    return null;
  }
}

/**
 * The first `length` bytes, for magic-byte verification (§4.9, Revision 8).
 *
 * **A ranged GET, never a full read.** Every TD-9 signature lives in the first
 * few bytes by construction — a format whose identity is only provable further
 * in cannot be validated this way and does not belong on the whitelist.
 */
export async function readObjectHead(
  clients: StorageClients,
  bucket: string,
  key: string,
  length = 512,
  ifMatch?: string,
): Promise<Buffer> {
  const ranged = await clients.internal.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      Range: `bytes=0-${String(length - 1)}`,
      ...(ifMatch === undefined ? {} : { IfMatch: ifMatch }),
    }),
  );
  return Buffer.from(await ranged.Body!.transformToByteArray());
}

/**
 * **Server-side copy — the object never enters this process.**
 *
 * `CopySource` is `/{bucket}/{key}` and **is URI-encoded**, which the private
 * copy this replaced was not: TD-9 keys carry a transliterated slug of a
 * filename a person chose, and a key containing anything the router reads as a
 * delimiter would address a different object or none at all.
 *
 * `contentType` **replaces** the destination's type when given, and the
 * destination inherits the source's when omitted. Ingestion gives it, because by
 * then the platform has **verified** what the bytes are and the copy is the
 * moment that verified type becomes the object's own — a provider's guess must
 * not survive into the content bucket. Quarantine omits it: moving an object out
 * of reach must not alter what it is.
 */
export async function copyObject(
  clients: StorageClients,
  source: { bucket: string; key: string },
  destination: { bucket: string; key: string },
  contentType?: string,
  options: { sourceIfMatch?: string } = {},
): Promise<void> {
  await clients.internal.send(
    new CopyObjectCommand({
      Bucket: destination.bucket,
      Key: destination.key,
      CopySource: encodeURI(`/${source.bucket}/${source.key}`),
      ...(options.sourceIfMatch === undefined
        ? {}
        : { CopySourceIfMatch: options.sourceIfMatch }),
      ...(contentType === undefined
        ? {}
        : { ContentType: contentType, MetadataDirective: 'REPLACE' as const }),
    }),
  );
}

/** AWS SDK errors are deliberately inspected without depending on a provider
 * class: MinIO and S3 use the same HTTP 412 for a failed conditional request. */
export function isStoragePreconditionFailed(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata?.httpStatusCode === 412
  );
}

/**
 * Deletes an object. **Best-effort by contract** — the caller decides whether a
 * failure matters.
 *
 * It matters differently in the two places it is used: deleting a staging object
 * after a successful ingestion is a tidy-up whose failure must never undo valid
 * content (R99.13), while deleting an object whose magic bytes did not match is
 * TD-9's delete-on-mismatch and is part of the refusal.
 */
export async function deleteObject(
  clients: StorageClients,
  bucket: string,
  key: string,
): Promise<void> {
  await clients.internal.send(
    new DeleteObjectCommand({ Bucket: bucket, Key: key }),
  );
}
