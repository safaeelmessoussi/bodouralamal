import { describe, expect, it } from 'vitest';

import {
  ACCESS_TTL_SECONDS,
  issueAccessToken,
  verifyAccessToken,
} from './access-token.js';

const KEY = 'test-signing-key-not-a-real-secret';
const OTHER_KEY = 'a-different-signing-key';

const PARAMS = {
  userId: '11111111-1111-1111-1111-111111111111',
  roleScopes: ['teacher'].map((role) => ({ role, branches: null })),
  accountStatus: 'active',
};

describe('access token (TD-12)', () => {
  it('carries exactly the TD-12 claims and nothing else', () => {
    const { claims } = issueAccessToken(PARAMS, KEY);
    expect(Object.keys(claims).sort()).toEqual(
      ['account_status', 'role_scopes', 'exp', 'iat', 'roles', 'sub'].sort(),
    );
  });

  it('carries NO email and no active-child claim (TD-12, §4.3)', () => {
    const { token, claims } = issueAccessToken(PARAMS, KEY);
    // The active child is asserted per request via X-Active-Child-ID so that a
    // revoked FamilyLink takes effect immediately (§20 rule 6).
    expect(claims).not.toHaveProperty('email');
    expect(claims).not.toHaveProperty('child_id');
    expect(claims).not.toHaveProperty('active_child_id');
    const payload = Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8');
    expect(payload).not.toMatch(/@/);
  });

  it('expires one hour after issuance', () => {
    const { claims } = issueAccessToken(PARAMS, KEY);
    expect(claims.exp - claims.iat).toBe(ACCESS_TTL_SECONDS);
    expect(ACCESS_TTL_SECONDS).toBe(3600);
  });

  it('round-trips through verification', () => {
    const { token } = issueAccessToken(PARAMS, KEY);
    const result = verifyAccessToken(token, KEY);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.claims.sub).toBe(PARAMS.userId);
      expect(result.claims.roles).toEqual(['teacher']);
    }
  });

  it('rejects a token signed with a different key', () => {
    const { token } = issueAccessToken(PARAMS, KEY);
    const result = verifyAccessToken(token, OTHER_KEY);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('bad_signature');
  });

  it('rejects a tampered payload — privilege escalation must not verify', () => {
    const { token } = issueAccessToken(PARAMS, KEY);
    const [header, payload, signature] = token.split('.') as [string, string, string];
    const forged = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      roles: string[];
    };
    forged.roles = ['super_admin'];
    const tamperedPayload = Buffer.from(JSON.stringify(forged)).toString('base64url');

    const result = verifyAccessToken(`${header}.${tamperedPayload}.${signature}`, KEY);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('bad_signature');
  });

  it('rejects the alg:none confusion attack', () => {
    // An attacker re-declares the algorithm and drops the signature.
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ sub: 'x', roles: ['super_admin'], exp: 9999999999 }),
    ).toString('base64url');

    for (const candidate of [`${header}.${payload}.`, `${header}.${payload}.anything`]) {
      const result = verifyAccessToken(candidate, KEY);
      expect(result.valid).toBe(false);
    }
  });

  it('rejects an expired token', () => {
    const issuedLongAgo = new Date(Date.now() - (ACCESS_TTL_SECONDS + 60) * 1000);
    const { token } = issueAccessToken(PARAMS, KEY, issuedLongAgo);
    const result = verifyAccessToken(token, KEY);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('expired');
  });

  it('rejects malformed input rather than throwing', () => {
    for (const bad of ['', 'not-a-token', 'a.b', 'a.b.c.d', '...']) {
      expect(() => verifyAccessToken(bad, KEY)).not.toThrow();
      expect(verifyAccessToken(bad, KEY).valid).toBe(false);
    }
  });

  it('§4.2 R24: an all-branches assignment carries branches: null, not an empty list', () => {
    // The distinction is the whole point: an empty list reaches NO branches,
    // while null reaches ALL of them. Conflating them made an all-branches Admin
    // able to see nothing.
    const { claims } = issueAccessToken(
      { ...PARAMS, roleScopes: [{ role: 'admin', branches: null }] },
      KEY,
    );
    expect(claims.role_scopes).toEqual([{ role: 'admin', branches: null }]);
    expect(claims.roles).toEqual(['admin']);
  });

  it('roles[] is DERIVED, so it can never disagree with role_scopes[]', () => {
    const { claims } = issueAccessToken(
      {
        ...PARAMS,
        roleScopes: [
          { role: 'teacher', branches: ['b-casa'] },
          { role: 'admin', branches: ['b-marrakesh'] },
        ],
      },
      KEY,
    );
    // There is no way to pass a roles[] that contradicts the scopes, because
    // IssueParams does not accept one.
    expect(claims.roles.sort()).toEqual(['admin', 'teacher']);
    expect(claims.role_scopes).toHaveLength(2);
  });

  it('per-role scopes survive the round trip distinctly, never flattened', () => {
    const { token } = issueAccessToken(
      {
        ...PARAMS,
        roleScopes: [
          { role: 'teacher', branches: ['b-casa'] },
          { role: 'admin', branches: ['b-marrakesh'] },
        ],
      },
      KEY,
    );
    const verified = verifyAccessToken(token, KEY);
    expect(verified.valid).toBe(true);
    if (!verified.valid) return;
    // The teaching branch must not appear under the admin role: that flattening
    // is exactly what let a Teacher-in-Casablanca administer Casablanca.
    const admin = verified.claims.role_scopes.find((s) => s.role === 'admin');
    expect(admin?.branches).toEqual(['b-marrakesh']);
  });
});
