import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

/**
 * The upload ticket — what `POST /uploads/initiate` returns as `upload_id`
 * (SRS TD-3.5, §4.9, TD-9).
 *
 * ## Why a signed token and not a table
 *
 * TD-3.5 is a two-phase flow: `/initiate` mints a presigned PUT, the browser
 * uploads straight to a staging key, and `/complete` verifies and promotes the
 * object before creating the `EducationalContent` row. Something has to carry
 * the decisions taken at phase one into phase two.
 *
 * **§7 defines no pending-upload entity**, and inventing one would be a schema
 * decision the specification has not taken — plus a table that can disagree with
 * the bucket, and a reconciliation problem where there was none. A signed token
 * carries the same state with nothing to reconcile: `upload.gc` (TD-7) then
 * reaps *objects* older than 48 h that no content row claims, which is the
 * thing that actually needs collecting.
 *
 * ## What the token binds, and what it does not
 *
 * **Everything an authorization decision depends on** — the caller, the staging
 * key and bucket, the finalization identity, the declared size and MIME type,
 * and the §4.9 scope fields
 * (level, subject, academic year, branch, visibility). All of those are checked
 * at `/initiate`, so a `/complete` that could restate them would let a Teacher
 * initiate inside their branch and complete into the Global scope — re-running
 * the check at phase two would merely make the first one decorative.
 *
 * **Title and description are NOT bound**, and travel in the `/complete` body.
 * They are free text no authorization turns on, and keeping them out holds the
 * ticket to a few hundred bytes — it is a URL path segment, and a description
 * capped at TD-9's 2,000 characters would have made it a few kilobytes.
 *
 * ## Key derivation
 *
 * Derived from `JWT_SIGNING_KEY` via HKDF under a distinct label, so an upload
 * ticket and an access token can never be exchanged for one another — the
 * separation TD-13 requires between token classes, obtained without adding a
 * configuration knob TD-13 does not list.
 */

/** Long enough for a slow mobile upload of a 100 MB file (§2.3 connectivity),
 *  short enough that a leaked ticket is not a standing grant. */
export const UPLOAD_TICKET_TTL_SECONDS = 2 * 60 * 60;

export interface UploadTicketClaims {
  /** The caller who initiated. `/complete` and `/abort` accept nobody else. */
  sub: string;
  /** The `EducationalContent.id` this upload will become — decided at initiate
   *  because TD-9's key structure embeds it. */
  cid: string;
  bucket: string;
  /** Browser-writable staging key. It is never stored on EducationalContent. */
  key: string;
  /**
   * Stable identity of one finalization grant. The canonical key is derived
   * from this value and the full accepted stream's SHA-256. Optional only for
   * tickets minted before B-03; those receive a deterministic legacy identity
   * at completion.
   */
  finalization_id?: string;
  filename: string;
  mime: string;
  size: number;
  level_id: string;
  subject_id: string;
  academic_year_id: string;
  /** `null` is the Global scope (§4.9), which is a value, not an absence. */
  branch_id: string | null;
  visibility: string;
  /**
   * **R99.12 — what the uploaded thing IS**, `uploaded` or `session_recording`.
   *
   * Bound here rather than accepted at `/complete` for the same reason the scope
   * fields are: «التسجيلات» is decided by this value (R99.10), so a client that
   * could restate it at phase two would be classifying content after the
   * authorization decision was taken. Optional in the type only so a ticket
   * minted before this revision still verifies; absent means `uploaded`.
   */
  origin?: 'uploaded' | 'session_recording';
  /** Set when this upload replaces the file on an existing content record
   *  (TD-9: a new key, the old object quarantined, never an overwrite). */
  replaces?: string;
  /** Version observed when a replacement grant was minted (TD-15/B-03 CAS). */
  replaces_version?: number;
  iat: number;
  exp: number;
}

function deriveKey(signingKey: string): Buffer {
  return Buffer.from(
    hkdfSync('sha256', signingKey, 'bodour/upload-ticket', 'upload-ticket/v1', 32),
  );
}

function sign(payload: string, signingKey: string): string {
  return createHmac('sha256', deriveKey(signingKey)).update(payload).digest('base64url');
}

export function issueUploadTicket(
  claims: Omit<UploadTicketClaims, 'iat' | 'exp'>,
  signingKey: string,
  now: Date = new Date(),
): { token: string; claims: UploadTicketClaims } {
  const iat = Math.floor(now.getTime() / 1000);
  const full: UploadTicketClaims = { ...claims, iat, exp: iat + UPLOAD_TICKET_TTL_SECONDS };
  const payload = Buffer.from(JSON.stringify(full)).toString('base64url');
  return { token: `${payload}.${sign(payload, signingKey)}`, claims: full };
}

export type UploadTicketVerification =
  | { valid: true; claims: UploadTicketClaims }
  | { valid: false; reason: 'malformed' | 'bad_signature' | 'expired' };

export function verifyUploadTicket(
  token: string,
  signingKey: string,
  now: Date = new Date(),
): UploadTicketVerification {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return { valid: false, reason: 'malformed' };

  const given = Buffer.from(signature);
  const want = Buffer.from(sign(payload, signingKey));
  // Length is compared first because `timingSafeEqual` throws on a mismatch —
  // and a thrown error would be a 500 where a tampered ticket must be a refusal.
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    return { valid: false, reason: 'bad_signature' };
  }

  let claims: UploadTicketClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as UploadTicketClaims;
  } catch {
    return { valid: false, reason: 'malformed' };
  }

  // A valid signature over a payload missing a field would otherwise surface
  // deep inside the completion transaction as `undefined` in a storage key.
  if (
    typeof claims.sub !== 'string' ||
    typeof claims.cid !== 'string' ||
    typeof claims.key !== 'string' ||
    typeof claims.bucket !== 'string' ||
    typeof claims.mime !== 'string' ||
    typeof claims.size !== 'number' ||
    (claims.finalization_id !== undefined && typeof claims.finalization_id !== 'string') ||
    (claims.replaces_version !== undefined && typeof claims.replaces_version !== 'number') ||
    typeof claims.exp !== 'number'
  ) {
    return { valid: false, reason: 'malformed' };
  }
  if (claims.exp * 1000 <= now.getTime()) return { valid: false, reason: 'expired' };

  return { valid: true, claims };
}
