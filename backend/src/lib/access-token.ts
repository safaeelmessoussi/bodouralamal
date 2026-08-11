import { rolesOf, type RoleScope } from '../policies/branch-scope.js';
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
 *   sub, roles[], role_scopes[], account_status, iat, exp
 *
 * `role_scopes[]` carries one entry per role with the branches that assignment
 * reaches (`branches: null` = all branches, §4.2 Revision 24). A flat
 * `branch_scopes[]` is deliberately absent: it cannot express "all branches",
 * and unioning scopes across roles extends one role's authority to another's.
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
  role_scopes: RoleScope[];
  /**
   * **R60 — the role this session is working as.** Absent means *every role
   * held*, which is both the pre-R60 behaviour and the honest answer for a
   * single-role account.
   *
   * When present, `roles[]` and `role_scopes[]` above are **already narrowed to
   * it**. Nothing downstream re-derives authority from this string: it is
   * carried so `/me`, the audit trail and the client can *name* the active role,
   * while the narrowing itself is done by the two arrays every authorization
   * check already reads.
   */
  active_role?: string;
  account_status: string;
  iat: number;
  exp: number;
}

export interface IssueParams {
  userId: string;
  /**
   * One entry per role held, with the branches that assignment reaches
   * (`branches: null` = all branches, §4.2 Revision 24). `roles[]` is derived
   * from this at issue time rather than passed in, so a caller cannot mint a
   * token whose roles and scopes disagree.
   */
  roleScopes: RoleScope[];
  /**
   * R60. **The caller must have already narrowed `roleScopes`** — pass the
   * output of `narrowToRole`. This function does not filter, deliberately: the
   * one place that decides *whether the role is held at all* is the one that
   * re-read the live rows, and doing it here as well would put that decision in
   * two places with only one of them able to refuse.
   */
  activeRole?: string;
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
    // Derived, so the two can never disagree (TD-12 Revision 24).
    roles: rolesOf(params.roleScopes),
    role_scopes: params.roleScopes,
    ...(params.activeRole !== undefined ? { active_role: params.activeRole } : {}),
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
