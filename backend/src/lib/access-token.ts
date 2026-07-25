import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Access-token issuance and verification (SRS TD-12).
 *
 * Deliberately dependency-free: a signed JWT is an HMAC over two base64url
 * segments, and Node's crypto covers it. Adding a JWT library would be a new
 * dependency under the §3.1a Phase-1 rule (which permits patch updates, not new
 * components) for no capability we lack.
 *
 * Claims are exactly what TD-12 allows and nothing more:
 *   sub, roles[], branch_scopes[], account_status, iat, exp
 * **No PII beyond these — in particular no email** (TD-12), and **never the
 * active child**, which is asserted per request via `X-Active-Child-ID` and
 * verified against an Approved FamilyLink so a revoked link takes effect
 * immediately (§4.3, §20 rule 6).
 */

/** TD-12: access token TTL 1 hour. */
export const ACCESS_TTL_SECONDS = 60 * 60;

const ALG = 'HS256';

export interface AccessTokenClaims {
  sub: string;
  roles: string[];
  branch_scopes: string[];
  account_status: string;
  iat: number;
  exp: number;
}

export interface IssueParams {
  userId: string;
  roles: string[];
  /** Branch ids the caller is scoped to; empty for an unscoped Super Admin. */
  branchScopes: string[];
  accountStatus: string;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(signingInput: string, key: string): string {
  return createHmac('sha256', key).update(signingInput).digest('base64url');
}

export function issueAccessToken(
  params: IssueParams,
  signingKey: string,
  now: Date = new Date(),
): { token: string; claims: AccessTokenClaims; expiresAt: Date } {
  const iat = Math.floor(now.getTime() / 1000);
  const exp = iat + ACCESS_TTL_SECONDS;

  const claims: AccessTokenClaims = {
    sub: params.userId,
    roles: params.roles,
    branch_scopes: params.branchScopes,
    account_status: params.accountStatus,
    iat,
    exp,
  };

  const signingInput = `${b64url(JSON.stringify({ alg: ALG, typ: 'JWT' }))}.${b64url(
    JSON.stringify(claims),
  )}`;
  return {
    token: `${signingInput}.${sign(signingInput, signingKey)}`,
    claims,
    expiresAt: new Date(exp * 1000),
  };
}

export type VerifyResult =
  | { valid: true; claims: AccessTokenClaims }
  | { valid: false; reason: 'malformed' | 'bad_signature' | 'expired' };

export function verifyAccessToken(
  token: string,
  signingKey: string,
  now: Date = new Date(),
): VerifyResult {
  const parts = token.split('.');
  if (parts.length !== 3) return { valid: false, reason: 'malformed' };
  const [header, payload, signature] = parts as [string, string, string];

  // Signature is checked BEFORE the payload is trusted for anything, and the
  // declared algorithm must match ours — accepting the token's own `alg` is the
  // classic JWT confusion bug (an attacker sending alg:none).
  let decodedHeader: { alg?: unknown };
  try {
    decodedHeader = JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as {
      alg?: unknown;
    };
  } catch {
    return { valid: false, reason: 'malformed' };
  }
  if (decodedHeader.alg !== ALG) return { valid: false, reason: 'bad_signature' };

  const expected = sign(`${header}.${payload}`, signingKey);
  const given = Buffer.from(signature);
  const want = Buffer.from(expected);
  // Constant-time compare; length must match first or timingSafeEqual throws.
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    return { valid: false, reason: 'bad_signature' };
  }

  let claims: AccessTokenClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AccessTokenClaims;
  } catch {
    return { valid: false, reason: 'malformed' };
  }

  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now.getTime()) {
    return { valid: false, reason: 'expired' };
  }
  return { valid: true, claims };
}
