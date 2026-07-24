import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
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
