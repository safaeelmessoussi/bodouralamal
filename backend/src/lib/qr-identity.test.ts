import { describe, expect, it } from 'vitest';

import { QR_PREFIX, parseQrPayload, qrMatrixFor, qrPayload } from './qr-identity.js';

const REF = '9f3a2c7e-1b44-4d90-a6c2-7e5518d0b3a1';

/**
 * **R96 — the payload carries an identity and nothing else.**
 *
 * Every assertion here exists because the opposite is the failure mode: a
 * payload that names a person, states a role, or can be used as a credential.
 */
describe('the payload is opaque, versioned, and person-scoped', () => {
  it('is a versioned user payload, not a beneficiary one', () => {
    expect(qrPayload(REF)).toBe(`bodour:user:v1:${REF}`);
    // The scheme is `user` deliberately: a person is frequently more than one
    // thing at once (R79), so a beneficiary-scoped noun would be wrong on every
    // card already printed the day she joins the staff.
    expect(qrPayload(REF)).not.toContain('beneficiary');
  });

  it('carries no personal data and no role', () => {
    const payload = qrPayload(REF);
    for (const leak of [
      'ahmed', '@', 'example.com', '+212', 'female', 'male',
      'teacher', 'student', 'admin', 'super_admin', 'parent', 'assistant',
      'beneficiary', 'branch', 'level',
    ]) {
      expect(payload.toLowerCase()).not.toContain(leak);
    }
    // Everything after the version is the opaque reference and nothing else.
    expect(payload.slice(QR_PREFIX.length)).toBe(REF);
  });

  it('round-trips, and refuses anything that is not ours', () => {
    expect(parseQrPayload(qrPayload(REF))).toBe(REF);
    for (const bad of [
      '', REF, `bodour:user:v2:${REF}`, `bodour:beneficiary:v1:${REF}`,
      'bodour:user:v1:not-a-uuid', 'https://evil.example/bodour:user:v1:' + REF,
    ]) {
      expect(parseQrPayload(bad)).toBeNull();
    }
  });

  it('parsing yields a REFERENCE, never a user — resolution is the caller’s job', () => {
    // Keeping lookup out of the parser is what stops "parse" becoming
    // "look up and trust". The return type is a string, and that is the point.
    expect(typeof parseQrPayload(qrPayload(REF))).toBe('string');
  });
});

describe('the matrix is renderable and stable', () => {
  it('encodes to a square module matrix carrying the payload', async () => {
    const qr = await qrMatrixFor(REF);
    expect(qr.payload).toBe(qrPayload(REF));
    expect(qr.modules).toHaveLength(qr.size);
    for (const row of qr.modules) {
      expect(row).toHaveLength(qr.size);
      expect(row).toMatch(/^[01]+$/);
    }
    // A finder pattern occupies the top-left 7×7; an all-light corner would
    // mean nothing was encoded at all.
    expect(qr.modules[0]!.slice(0, 7)).toBe('1111111');
  });

  it('is deterministic — the same person always scans to the same square', async () => {
    const a = await qrMatrixFor(REF);
    const b = await qrMatrixFor(REF);
    expect(b.modules).toEqual(a.modules);
  });

  it('differs between people', async () => {
    const a = await qrMatrixFor(REF);
    const b = await qrMatrixFor('11111111-2222-4333-8444-555555555555');
    expect(b.modules).not.toEqual(a.modules);
  });
});
