import { createHmac } from 'node:crypto';

import { InvalidEnvValueError, MissingRequiredEnvError } from './config.js';

/** Ratified email-lock keying: one key space, no plaintext or unkeyed fallback. */
export function emailLockDigest(email: string, key = process.env['EMAIL_LOCK_KEY']): string {
  if (!key?.trim()) throw new MissingRequiredEnvError(['EMAIL_LOCK_KEY']);
  if (Buffer.byteLength(key) < 32) {
    throw new InvalidEnvValueError(['EMAIL_LOCK_KEY must contain at least 32 bytes']);
  }
  return createHmac('sha256', key)
    .update(`bodour.email-lock.v1|${email.trim().toLowerCase()}`)
    .digest('hex');
}
