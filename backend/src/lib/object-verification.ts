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
 * claim, and this is the only thing that turns it into a fact.
 */

import {
  magicBytesMatch,
  mimeEssence,
  type AcceptedMime,
} from './file-types.js';
import {
  deleteObject,
  readObjectHead,
  statObject,
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
  | { ok: true; sizeBytes: number }
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
      reason: 'MISSING' | 'EMPTY' | 'SIZE' | 'MAGIC';
      detail: Record<string, unknown>;
    };

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
  const stat = await statObject(clients, request.bucket, request.key);
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

  const head = await readObjectHead(clients, request.bucket, request.key);
  if (!magicBytesMatch(request.mime as AcceptedMime, head)) {
    return {
      ok: false,
      reason: 'MAGIC',
      detail: { declared: mimeEssence(request.mime) },
    };
  }

  return { ok: true, sizeBytes: stat.sizeBytes };
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
