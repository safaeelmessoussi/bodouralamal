import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

/**
 * Onboarding token (SRS §4.1b step 4c–5, TD-12).
 *
 * Carries the **verified** Google `email` and `provider_subject_id` from the
 * OAuth callback to the registration submission, so the client can never
 * substitute a different identity — §4.1b step 5 and §20 rule 9 require the
 * server to read those fields from this payload ONLY, and the registration
 * endpoint's Zod schema must not even accept them from the body.
 *
 * Signed with `ONBOARDING_TOKEN_KEY`, which TD-13 keeps **distinct from**
 * `JWT_SIGNING_KEY`: an onboarding token must never be interchangeable with an
 * access token.
 *
 * This token is NOT a session. At step 4c no `User` row exists at all, and
 * step 6 requires that abandoning the form persists nothing.
 */

/** TD-12: 10-minute TTL. */
export const ONBOARDING_TTL_SECONDS = 10 * 60;

export interface OnboardingClaims {
  email: string;
  provider_subject_id: string;
  /** Unique per token; consumed into `ConsumedToken` inside the registration
   *  transaction, which is what makes single-use mechanical (§4.1b, TD-6). */
  jti: string;
  iat: number;
  exp: number;
}

function b64url(value: string): string {
  return Buffer.from(value).toString('base64url');
}

function sign(payload: string, key: string): string {
  return createHmac('sha256', key).update(payload).digest('base64url');
}

export function issueOnboardingToken(
  identity: { email: string; providerSubjectId: string },
  key: string,
  now: Date = new Date(),
): { token: string; claims: OnboardingClaims } {
  const iat = Math.floor(now.getTime() / 1000);
  const claims: OnboardingClaims = {
    // Lowercased on issue as well as on lookup (TD-12) — the address that
    // reaches the registration transaction is already normalized.
    email: identity.email.toLowerCase(),
    provider_subject_id: identity.providerSubjectId,
    jti: randomUUID(),
    iat,
    exp: iat + ONBOARDING_TTL_SECONDS,
  };
  const payload = b64url(JSON.stringify(claims));
  return { token: `${payload}.${sign(payload, key)}`, claims };
}

export type OnboardingVerification =
  | { valid: true; claims: OnboardingClaims }
  | { valid: false; reason: 'malformed' | 'bad_signature' | 'expired' };

export function verifyOnboardingToken(
  token: string,
  key: string,
  now: Date = new Date(),
): OnboardingVerification {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return { valid: false, reason: 'malformed' };

  const expected = sign(payload, key);
  const given = Buffer.from(signature);
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    return { valid: false, reason: 'bad_signature' };
  }

  let claims: OnboardingClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as OnboardingClaims;
  } catch {
    return { valid: false, reason: 'malformed' };
  }

  if (
    typeof claims.email !== 'string' ||
    typeof claims.provider_subject_id !== 'string' ||
    typeof claims.jti !== 'string' ||
    typeof claims.exp !== 'number'
  ) {
    return { valid: false, reason: 'malformed' };
  }
  if (claims.exp * 1000 <= now.getTime()) return { valid: false, reason: 'expired' };

  return { valid: true, claims };
}
