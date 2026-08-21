import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { OAuth2Client, type LoginTicket } from 'google-auth-library';

/**
 * Google OAuth with `state` + PKCE (SRS TD-12, §4.1b).
 *
 * Only the configured client ID is accepted and the email must be verified by
 * Google; both are enforced in `exchangeCode` / `verifyGoogleIdToken` below.
 */

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_ID_TOKEN_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

/** TD-16: every outbound call carries an explicit timeout, and no automatic
 *  in-request retries beyond one — retry belongs to the user action. */
export const OUTBOUND_TIMEOUT_MS = 5000;

/**
 * One process-wide client lets the supported Google library honour the cache
 * headers on Google's signing certificates instead of fetching them on every
 * login. The issuer list is deliberately narrower than the library default:
 * these are the two issuer values in Google's OpenID Connect contract.
 */
const googleIdTokenClient = new OAuth2Client({
  issuers: GOOGLE_ID_TOKEN_ISSUERS,
  transporterOptions: {
    timeout: OUTBOUND_TIMEOUT_MS,
    // The library otherwise retries certificate retrieval automatically. The
    // callback is synchronous user work, so TD-16 leaves retry to the user.
    retryConfig: { retry: 0, noResponseRetries: 0 },
  },
});

/** The flow-state cookie is short-lived: it only spans the redirect to Google
 *  and back (§4.1b, TD-12 Revision 16). */
export const FLOW_STATE_TTL_SECONDS = 10 * 60;
export const FLOW_STATE_COOKIE = 'bodour_oauth_flow';

/**
 * Purpose-separated signing key derived from `JWT_SIGNING_KEY` (TD-13 defines
 * no third secret, and inventing an env var would break the inventory's
 * lockstep). Deriving rather than reusing keeps the flow-state signature from
 * ever being confused with an access-token signature.
 */
function flowStateKey(jwtSigningKey: string): string {
  return createHmac('sha256', jwtSigningKey).update('oauth-flow-state:v1').digest('base64url');
}

export interface FlowState {
  state: string;
  codeVerifier: string;
}

export function createFlowState(): FlowState {
  return {
    state: randomBytes(32).toString('base64url'),
    codeVerifier: randomBytes(32).toString('base64url'),
  };
}

/** PKCE S256 challenge. */
export function codeChallengeFor(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier).digest('base64url');
}

/** Signed, tamper-evident payload for the flow cookie: `<payload>.<sig>`. */
export function sealFlowState(flow: FlowState, jwtSigningKey: string): string {
  const payload = Buffer.from(JSON.stringify(flow)).toString('base64url');
  const sig = createHmac('sha256', flowStateKey(jwtSigningKey)).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function openFlowState(sealed: string | undefined, jwtSigningKey: string): FlowState | null {
  if (!sealed) return null;
  const [payload, sig] = sealed.split('.');
  if (!payload || !sig) return null;

  const expected = createHmac('sha256', flowStateKey(jwtSigningKey))
    .update(payload)
    .digest('base64url');
  const given = Buffer.from(sig);
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as FlowState;
    if (typeof parsed.state !== 'string' || typeof parsed.codeVerifier !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function buildAuthorizationUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', params.state);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  // Force the account chooser so a shared family device does not silently
  // reuse whichever Google account happens to be signed in.
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

export interface VerifiedIdentity {
  /** Always lowercased before it leaves this module (TD-12). */
  email: string;
  providerSubjectId: string;
}

export type ExchangeResult =
  | { ok: true; identity: VerifiedIdentity }
  /** §4.1b step 7 failure keys, each a redirect — never a JSON envelope. */
  | { ok: false; reason: 'oauth_unavailable' | 'email_unverified' };

export interface GoogleIdTokenClient {
  verifyIdToken(options: { idToken: string; audience: string }): Promise<LoginTicket>;
}

export type GoogleIdTokenVerifier = (
  idToken: string,
  audience: string,
) => Promise<ExchangeResult>;

export interface OAuthExchangeDependencies {
  fetchImpl?: typeof fetch;
  verifyIdToken?: GoogleIdTokenVerifier;
}

/**
 * Validates a Google `id_token` as a signed identity assertion. Exchanging an
 * authorization code over TLS protects that exchange; it does not establish
 * the JWT's signature or claims. Google's supported verifier fetches and caches
 * the provider keys and checks signature, key id, audience and token lifetime.
 * This wrapper additionally pins Google's documented issuer values and the
 * expected RS256 protected header before any identity claim is consumed.
 */
export async function verifyGoogleIdToken(
  idToken: string,
  audience: string,
  client: GoogleIdTokenClient = googleIdTokenClient,
): Promise<ExchangeResult> {
  try {
    const segments = idToken.split('.');
    if (segments.length !== 3 || segments.some((segment) => segment === '')) {
      return { ok: false, reason: 'oauth_unavailable' };
    }

    const header = JSON.parse(Buffer.from(segments[0]!, 'base64url').toString('utf8')) as {
      alg?: unknown;
      kid?: unknown;
    };
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid.trim() === '') {
      return { ok: false, reason: 'oauth_unavailable' };
    }

    const ticket = await client.verifyIdToken({ idToken, audience });
    const claims = ticket.getPayload();
    if (!claims || !GOOGLE_ID_TOKEN_ISSUERS.includes(claims.iss)) {
      return { ok: false, reason: 'oauth_unavailable' };
    }
    if (
      typeof claims.sub !== 'string' ||
      claims.sub.trim() === '' ||
      typeof claims.email !== 'string' ||
      claims.email.trim() === ''
    ) {
      return { ok: false, reason: 'oauth_unavailable' };
    }
    // Hard stop, no account touched (§4.1b step 7).
    if (claims.email_verified !== true) return { ok: false, reason: 'email_unverified' };

    return {
      ok: true,
      identity: {
        email: claims.email.trim().toLowerCase(),
        providerSubjectId: claims.sub,
      },
    };
  } catch {
    // Bad signature/key, wrong audience/issuer, expiry, malformed claims and a
    // certificate/JWKS outage all fail closed without leaking provider detail.
    return { ok: false, reason: 'oauth_unavailable' };
  }
}

/**
 * Exchanges the authorization code. A timeout, a network failure, or any non-2xx
 * from Google surfaces as `oauth_unavailable`, which the callback renders as the
 * `/login?error=oauth_unavailable` redirect (§4.1b step 7); server-side this is
 * the `OAUTH_EXCHANGE_FAILED` condition of TD-3.8.
 */
export async function exchangeCode(params: {
  code: string;
  codeVerifier: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
} & OAuthExchangeDependencies): Promise<ExchangeResult> {
  const body = new URLSearchParams({
    code: params.code,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    redirect_uri: params.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: params.codeVerifier,
  });

  const doFetch = params.fetchImpl ?? fetch;
  try {
    const response = await doFetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, reason: 'oauth_unavailable' };

    const payload = (await response.json()) as { id_token?: unknown };
    if (typeof payload.id_token !== 'string') return { ok: false, reason: 'oauth_unavailable' };
    const verifyIdToken = params.verifyIdToken ?? verifyGoogleIdToken;
    return await verifyIdToken(payload.id_token, params.clientId);
  } catch {
    // Timeout, DNS failure, TLS failure, malformed JSON — all the same to the
    // user, and none of them may leak upstream detail (TD-3.8).
    return { ok: false, reason: 'oauth_unavailable' };
  }
}
