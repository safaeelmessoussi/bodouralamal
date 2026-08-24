/**
 * **Is the object in the bucket actually what it was claimed to be?** (TD-9,
 * §4.9 Revision 8, R99.8.)
 *
 * ## Why this module exists at all
 *
 * The check was written inside `content.service.ts` as `verifyObject(clients,
 * claims: UploadTicketClaims)` — correct, and coupled to the *upload ticket*
 * rather than to the *object*. R99's ingestion has to make exactly the same
 * assertions about an object no upload ticket describes: it came from a media
 * provider, not from a browser, and there is no ticket to pass.
 *
 * The two obvious ways out were both worse. Manufacturing a fake ticket for the
 * worker would make a signed authorization artefact a plumbing convenience.
 * Writing the checks a second time beside the worker would give the platform
 * **two implementations of TD-9's verification**, and on this project the copy
 * that drifts still passes its own tests.
 *
 * So the parameter became what the check is actually about — a bucket, a key, a
 * declared type and a cap — and `UploadTicketClaims` is now one of two callers
 * that build one.
 *
 * ## What is deliberately NOT shared
 *
 * **Which types each door admits.** `/uploads/*` refuses `video/*` and R99's
 * ingestion admits `video/mp4` up to 500 MB — that distinction is intentional
 * (R99.8) and lives in `file-types.ts` as two predicates over **one** list. This
 * module verifies whatever it is handed; it never decides what is admissible.
 *
 * ## Never trust the store's own metadata
 *
 * `HEAD` reports a `Content-Type` the uploader set, and a provider reports a
 * size in a webhook. Neither is evidence. The size is read from the object, and
 * the type is proven from the object's first 512 bytes — a declaration is a
 * claim, and this is the only thing that turns it into a fact. R99 uses the
 * bounded ranged verifier below; R103 browser finalization additionally reads
 * and hashes the complete accepted stream into server-controlled storage.
 */

import { createHash } from 'node:crypto';
import { PassThrough, Readable, Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import {
  magicBytesMatch,
  mimeEssence,
  type AcceptedMime,
} from './file-types.js';
import {
  deleteObject,
  isStoragePreconditionFailed,
  openObjectRead,
  putObjectStream,
  readObjectHead,
  statObjectStrict,
  type StorageClients,
} from './storage.js';

export interface ObjectVerificationRequest {
  bucket: string;
  key: string;
  /** What the object is claimed to be. Proven, never trusted. */
  mime: string;
  /**
   * The size the caller says it is, or `null` for *whatever is there, within
   * the cap*.
   *
   * An upload knows the number — the browser declared it at `/initiate` and a
   * mismatch means the object is not the one that was authorised. A recording
   * does **not**: the platform never declared a size, and demanding that the
   * provider's reported byte count match the object exactly would fail an
   * otherwise perfect recording over a provider's rounding.
   */
  declaredSize: number | null;
  /** The TD-9 cap for this type, from `sizeCapFor`. */
  cap: number;
}

export type ObjectVerification =
  | { ok: true; sizeBytes: number; etag: string }
  | {
      ok: false;
      /**
       * * `MISSING` — nothing at the key. Not a validation failure: the PUT
       *   never happened, or the provider reported a file it did not write.
       * * `EMPTY` — a zero-length object. **A passing lifecycle and a failed
       *   recording**, which is exactly what a size check alone lets through
       *   when no size was declared.
       * * `SIZE` — not the declared size, or over the cap.
       * * `MAGIC` — the bytes are not what the type claims.
       */
      reason: 'MISSING' | 'EMPTY' | 'SIZE' | 'MAGIC' | 'CHANGED';
      detail: Record<string, unknown>;
    };

interface InspectedObject {
  sizeBytes: number;
  etag: string;
}

async function inspectStoredObject(
  clients: StorageClients,
  request: ObjectVerificationRequest,
): Promise<InspectedObject | Exclude<ObjectVerification, { ok: true }>> {
  const stat = await statObjectStrict(clients, request.bucket, request.key);
  if (stat === null) {
    return { ok: false, reason: 'MISSING', detail: { key: request.key } };
  }

  if (stat.sizeBytes === 0) {
    return { ok: false, reason: 'EMPTY', detail: { key: request.key } };
  }

  if (
    stat.sizeBytes > request.cap ||
    (request.declaredSize !== null && stat.sizeBytes !== request.declaredSize)
  ) {
    return {
      ok: false,
      reason: 'SIZE',
      detail: {
        declared: request.declaredSize,
        actual: stat.sizeBytes,
        cap: request.cap,
      },
    };
  }

  if (stat.etag === null) {
    throw new Error(`storage returned no ETag for ${request.bucket}/${request.key}`);
  }
  return { sizeBytes: stat.sizeBytes, etag: stat.etag };
}

/**
 * **HEAD for the size, a 512-byte ranged GET for the type. Never a full read.**
 *
 * Nothing is deleted here. TD-9's delete-on-mismatch is the *caller's* act,
 * because the two callers own their objects differently: an upload's object is
 * the caller's to destroy immediately, while a recording's staging object must
 * survive a failed ingestion so the attempt can be retried once whatever was
 * wrong is put right (R99.14).
 */
export async function verifyStoredObject(
  clients: StorageClients,
  request: ObjectVerificationRequest,
): Promise<ObjectVerification> {
  const inspected = await inspectStoredObject(clients, request);
  if ('ok' in inspected) return inspected;

  let head: Buffer;
  try {
    // The ranged read must describe the same object version as the HEAD. A
    // retained presigned PUT can replace the key between those two operations.
    head = await readObjectHead(
      clients,
      request.bucket,
      request.key,
      512,
      inspected.etag,
    );
  } catch (error) {
    if (isStoragePreconditionFailed(error)) {
      return {
        ok: false,
        reason: 'CHANGED',
        detail: { reason: 'OBJECT_CHANGED_DURING_VERIFICATION' },
      };
    }
    throw error;
  }
  if (!magicBytesMatch(request.mime as AcceptedMime, head)) {
    return {
      ok: false,
      reason: 'MAGIC',
      detail: { declared: mimeEssence(request.mime) },
    };
  }

  return { ok: true, sizeBytes: inspected.sizeBytes, etag: inspected.etag };
}

class StreamValidationFailure extends Error {
  constructor(
    readonly reason: 'SIZE' | 'MAGIC' | 'CHANGED',
    readonly detail: Record<string, unknown>,
  ) {
    super(reason);
  }
}

class Sha256ValidationTransform extends Transform {
  private readonly hash = createHash('sha256');
  private total = 0;

  constructor(
    private readonly state: { sha256: string | null; sizeBytes: number },
  ) {
    super();
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.total += bytes.length;
    this.hash.update(bytes);
    callback(null, bytes);
  }

  override _flush(callback: TransformCallback): void {
    const sha256 = this.hash.digest('hex');
    this.state.sha256 = sha256;
    this.state.sizeBytes = this.total;
    callback();
  }
}

async function putHashedStream(
  clients: StorageClients,
  destination: { bucket: string; key: string },
  source: Readable,
  hashing: Sha256ValidationTransform,
  options: {
    contentLength?: number;
    contentType: string;
    sha256?: string;
  },
): Promise<{ etag: string | null }> {
  // The explicit pipeline owns error propagation and aborts the HTTP PUT when
  // the source or SHA/length transform fails before Content-Length is reached.
  const abort = new AbortController();
  const transport = new PassThrough();
  const stored = putObjectStream(clients, destination, transport, {
    ...options,
    abortSignal: abort.signal,
  });
  const pumped = pipeline(source, hashing, transport);
  try {
    const [, result] = await Promise.all([pumped, stored]);
    return result;
  } catch (error) {
    abort.abort();
    source.destroy();
    hashing.destroy();
    transport.destroy();
    await Promise.allSettled([pumped, stored]);
    throw error;
  }
}

function nextReadableChunk(source: Readable): Promise<Buffer | null> {
  const immediate = source.read() as Buffer | null;
  if (immediate !== null) return Promise.resolve(immediate);
  if (source.errored) return Promise.reject(source.errored);
  if (source.readableEnded) return Promise.resolve(null);

  return new Promise<Buffer | null>((resolve, reject) => {
    const cleanup = (): void => {
      source.off('readable', onReadable);
      source.off('end', onEnd);
      source.off('error', onError);
    };
    const onReadable = (): void => {
      cleanup();
      void nextReadableChunk(source).then(resolve, reject);
    };
    const onEnd = (): void => {
      cleanup();
      resolve(null);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    source.once('readable', onReadable);
    source.once('end', onEnd);
    source.once('error', onError);
  });
}

export type StreamedObjectVerification =
  | {
      ok: true;
      sizeBytes: number;
      sourceEtag: string;
      destinationEtag: string | null;
      sha256: string;
    }
  | Exclude<ObjectVerification, { ok: true }>;

/**
 * Reads one complete staging-object response into a server-only object while
 * validating the same bytes and calculating SHA-256. The prefix is held until
 * magic validation succeeds; after that, memory use remains bounded by the
 * storage client's stream chunk rather than the upload size.
 */
export async function streamVerifiedObjectToStorage(
  clients: StorageClients,
  request: ObjectVerificationRequest,
  destination: { bucket: string; key: string },
  hooks: { onMagicValidated?: () => Promise<void> } = {},
): Promise<StreamedObjectVerification> {
  const inspected = await inspectStoredObject(clients, request);
  if ('ok' in inspected) return inspected;

  let opened;
  try {
    opened = await openObjectRead(
      clients,
      request.bucket,
      request.key,
      inspected.etag,
    );
  } catch (error) {
    if (isStoragePreconditionFailed(error)) {
      return {
        ok: false,
        reason: 'CHANGED',
        detail: { reason: 'OBJECT_CHANGED_BEFORE_STREAM' },
      };
    }
    throw error;
  }

  const state = { sha256: null as string | null, sizeBytes: 0 };
  const prefixTarget = Math.min(512, inspected.sizeBytes);
  const prefetched: Buffer[] = [];
  let prefixLength = 0;
  try {
    while (prefixLength < prefixTarget) {
      const bytes = await nextReadableChunk(opened.body);
      if (bytes === null) break;
      prefetched.push(bytes);
      prefixLength += bytes.length;
    }
    const prefix = Buffer.concat(prefetched);
    if (prefix.length < prefixTarget) {
      opened.body.destroy();
      return {
        ok: false,
        reason: 'CHANGED',
        detail: { reason: 'OBJECT_CHANGED_DURING_STREAM' },
      };
    }
    if (prefix.length > inspected.sizeBytes) {
      opened.body.destroy();
      return {
        ok: false,
        reason: 'CHANGED',
        detail: { reason: 'OBJECT_CHANGED_DURING_STREAM' },
      };
    }
    if (!magicBytesMatch(request.mime as AcceptedMime, prefix.subarray(0, 512))) {
      opened.body.destroy();
      return {
        ok: false,
        reason: 'MAGIC',
        detail: { declared: mimeEssence(request.mime) },
      };
    }
    await hooks.onMagicValidated?.();
  } catch (error) {
    opened.body.destroy();
    throw error;
  }
  const hashing = new Sha256ValidationTransform(state);
  hashing.write(Buffer.concat(prefetched));

  try {
    const stored = await putHashedStream(clients, destination, opened.body, hashing, {
      contentLength: inspected.sizeBytes,
      contentType: mimeEssence(request.mime),
    });
    if (state.sha256 === null || state.sizeBytes !== inspected.sizeBytes) {
      await deleteObject(clients, destination.bucket, destination.key).catch(() => undefined);
      return {
        ok: false,
        reason: 'CHANGED',
        detail: {
          reason: 'OBJECT_CHANGED_DURING_STREAM',
          expected_size: inspected.sizeBytes,
          actual_size: state.sizeBytes,
        },
      };
    }
    return {
      ok: true,
      sizeBytes: inspected.sizeBytes,
      sourceEtag: inspected.etag,
      destinationEtag: stored.etag,
      sha256: state.sha256,
    };
  } catch (error) {
    opened.body.destroy();
    hashing.destroy();
    if (error instanceof StreamValidationFailure) {
      return { ok: false, reason: error.reason, detail: error.detail };
    }
    throw error;
  }
}

/** Writes a server-owned source to canonical storage and refuses completion if
 * the complete byte stream does not reproduce the accepted SHA-256. */
export async function streamObjectToStorageWithSha256(
  clients: StorageClients,
  source: { bucket: string; key: string; etag: string | null },
  destination: { bucket: string; key: string },
  expected: { sizeBytes: number; sha256: string; contentType: string },
): Promise<void> {
  const opened = await openObjectRead(
    clients,
    source.bucket,
    source.key,
    source.etag ?? undefined,
  );
  const state = { sha256: null as string | null, sizeBytes: 0 };
  const hashing = new Sha256ValidationTransform(state);
  try {
    await putHashedStream(clients, destination, opened.body, hashing, {
      contentLength: expected.sizeBytes,
      contentType: expected.contentType,
      sha256: expected.sha256,
    });
    if (state.sizeBytes !== expected.sizeBytes || state.sha256 !== expected.sha256) {
      await deleteObject(clients, destination.bucket, destination.key).catch(() => undefined);
      throw new StreamValidationFailure('CHANGED', {
        reason: 'SERVER_SOURCE_CHANGED',
        expected_size: expected.sizeBytes,
        actual_size: state.sizeBytes,
        expected_sha256: expected.sha256,
        actual_sha256: state.sha256,
      });
    }
  } catch (error) {
    opened.body.destroy();
    hashing.destroy();
    throw error;
  }
}

/** Full collision-resistant identity of an existing object. Used only for an
 * immutable canonical retry/collision check, never for R99's large-object path. */
export async function hashStoredObject(
  clients: StorageClients,
  bucket: string,
  key: string,
): Promise<{ sizeBytes: number; sha256: string } | null> {
  const stat = await statObjectStrict(clients, bucket, key);
  if (stat === null) return null;
  const opened = await openObjectRead(
    clients,
    bucket,
    key,
    stat.etag ?? undefined,
  );
  const hash = createHash('sha256');
  let sizeBytes = 0;
  for await (const value of opened.body) {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
    sizeBytes += bytes.length;
    hash.update(bytes);
  }
  return { sizeBytes, sha256: hash.digest('hex') };
}

/** TD-9's delete-on-mismatch, best-effort: the refusal is what matters, and a
 *  failure to tidy must not replace it. */
export async function discardObject(
  clients: StorageClients,
  bucket: string,
  key: string,
): Promise<void> {
  try {
    await deleteObject(clients, bucket, key);
  } catch {
    /* already gone, or the store is unwell — `upload.gc` (TD-7) sweeps it */
  }
}
