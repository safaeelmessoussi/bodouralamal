import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emailLockDigest } from './email-lock.js';

const KEY = 'isolated-email-lock-unit-key-at-least-32-bytes';
afterEach(() => vi.unstubAllEnvs());

describe('ratified keyed email-lock coordinate', () => {
  it('uses the exact domain-separated HMAC and canonical normalization', () => {
    const digest = emailLockDigest('  Foo@Example.COM ', KEY);
    expect(digest).toBe(createHmac('sha256', KEY).update('bodour.email-lock.v1|foo@example.com').digest('hex'));
    expect(digest).toBe(emailLockDigest('foo@example.com', KEY));
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toContain('@');
  });
  it('does not collapse different addresses, plus tags, or keys', () => {
    const digest = emailLockDigest('foo@example.com', KEY);
    expect(emailLockDigest('bar@example.com', KEY)).not.toBe(digest);
    expect(emailLockDigest('foo+tag@example.com', KEY)).not.toBe(digest);
    expect(emailLockDigest('foo@example.com', `${KEY}-rotated`)).not.toBe(digest);
  });
  it.each([undefined, '', ' ', 'short'])('fails closed without a usable key (%s)', (key) => {
    vi.stubEnv('EMAIL_LOCK_KEY', key);
    expect(() => emailLockDigest('private@example.com')).toThrow(/EMAIL_LOCK_KEY/);
    try { emailLockDigest('private@example.com'); } catch (error) {
      expect(String(error)).not.toContain('private@example.com');
    }
  });
});
