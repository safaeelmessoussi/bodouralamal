import type { Request, Response } from 'express';

import type { PrismaClient } from '../generated/prisma/client.js';
import { issueAccessToken } from '../lib/access-token.js';
import { clearCookie, parseCookies, serializeCookie } from '../lib/cookies.js';
import type { AppConfig } from '../lib/config.js';
import { toRoleScopes } from '../policies/branch-scope.js';
import { AppError } from '../lib/errors.js';
import {
  buildAuthorizationUrl,
  codeChallengeFor,
  createFlowState,
  exchangeCode,
  FLOW_STATE_COOKIE,
  FLOW_STATE_TTL_SECONDS,
  openFlowState,
  sealFlowState,
} from '../lib/oauth.js';
import { issueOnboardingToken } from '../lib/onboarding-token.js';
import { resolveLogin } from '../services/auth.service.js';
import {
  hashToken,
  issueNewSession,
  logout as logoutSession,
  REFRESH_TTL_MS,
  rotate,
} from '../services/refresh-token.service.js';
import * as tokens from '../repositories/refresh-token.repository.js';

/**
 * Auth endpoints (SRS TD-3.1, §4.1b, TD-12).
 *
 * Controllers hold no business logic (§16.2): they validate, call one service,
 * and map the result. The OAuth entry and callback are **browser redirect
 * flows** — their failures redirect to `/login?error=<key>` and never emit the
 * TD-3.8 envelope (§4.1b step 7). `/auth/refresh`, `/auth/logout` and `/me` are
 * ordinary JSON API routes and do use the envelope.
 */

const REFRESH_COOKIE = 'bodour_refresh';
/** TD-12: the refresh cookie is confined to the one route that reads it. */
const REFRESH_COOKIE_PATH = '/api/v1/auth/refresh';
const FLOW_COOKIE_PATH = '/api/v1/auth/google';

function redirectUri(config: AppConfig): string {
  return `${config.PUBLIC_BASE_URL}/api/v1/auth/google/callback`;
}

function loginError(config: AppConfig, key: string): string {
  return `${config.PUBLIC_BASE_URL}/login?error=${key}`;
}

function setRefreshCookie(res: Response, rawToken: string): void {
  res.append(
    'Set-Cookie',
    serializeCookie(REFRESH_COOKIE, rawToken, {
      maxAgeSeconds: Math.floor(REFRESH_TTL_MS / 1000),
      path: REFRESH_COOKIE_PATH,
    }),
  );
}

/** `GET /auth/google` — begins the flow (§4.1b steps 1–2). */
export function startOAuth(config: AppConfig) {
  return (_req: Request, res: Response): void => {
    const flow = createFlowState();
    // The verifier must survive the round trip to Google. It lives in a signed,
    // short-lived HttpOnly cookie scoped to this flow — transient flow state,
    // not authentication, so it is no exception to TD-12's cookie rule (R16 F5).
    res.append(
      'Set-Cookie',
      serializeCookie(FLOW_STATE_COOKIE, sealFlowState(flow, config.JWT_SIGNING_KEY), {
        maxAgeSeconds: FLOW_STATE_TTL_SECONDS,
        path: FLOW_COOKIE_PATH,
      }),
    );
    res.redirect(
      302,
      buildAuthorizationUrl({
        clientId: config.GOOGLE_CLIENT_ID,
        redirectUri: redirectUri(config),
        state: flow.state,
        codeChallenge: codeChallengeFor(flow.codeVerifier),
      }),
    );
  };
}

/**
 * `GET /auth/google/callback` — §4.1b steps 2–4 and 7.
 *
 * Every failure is a redirect with one of the four defined keys; no partial
 * state is ever persisted on a failure path.
 */
export function oauthCallback(prisma: PrismaClient, config: AppConfig) {
  return async (req: Request, res: Response): Promise<void> => {
    // The flow cookie is single-use whatever happens next.
    res.append('Set-Cookie', clearCookie(FLOW_STATE_COOKIE, FLOW_COOKIE_PATH));

    if (typeof req.query['error'] === 'string') {
      // The visitor refused consent at Google.
      res.redirect(302, loginError(config, 'user_denied'));
      return;
    }

    const flow = openFlowState(
      parseCookies(req.header('cookie'))[FLOW_STATE_COOKIE],
      config.JWT_SIGNING_KEY,
    );
    const state = req.query['state'];
    const code = req.query['code'];

    // A missing/forged cookie, a mismatched state, or a missing code are all
    // state_mismatch — also logged as a security event (§4.1b step 7).
    if (!flow || typeof state !== 'string' || state !== flow.state || typeof code !== 'string') {
      process.stderr.write(
        `${JSON.stringify({
          time: new Date().toISOString(),
          request_id: req.requestId,
          level: 'warn',
          event: 'oauth.state_mismatch',
        })}\n`,
      );
      res.redirect(302, loginError(config, 'state_mismatch'));
      return;
    }

    const exchange = await exchangeCode({
      code,
      codeVerifier: flow.codeVerifier,
      clientId: config.GOOGLE_CLIENT_ID,
      clientSecret: config.GOOGLE_CLIENT_SECRET,
      redirectUri: redirectUri(config),
    });
    if (!exchange.ok) {
      res.redirect(302, loginError(config, exchange.reason));
      return;
    }

    const route = await resolveLogin(prisma, exchange.identity);

    if (route.kind === 'onboarding') {
      // ── §4.1b step 4c — brand-new person. NO session is created and NO user
      // row exists: step 6 requires that abandoning the form persists nothing,
      // so there is deliberately no access token and no refresh cookie here.
      //
      // The only credential issued is the short-lived, single-use onboarding
      // token carrying the VERIFIED email + provider_subject_id, so the client
      // cannot substitute a different identity at submission (§20 rule 9).
      // It rides in the URL fragment, which browsers never send to a server —
      // keeping it out of access logs and the Referer header — and TD-12
      // requires the client to hold it in memory only, never in storage.
      const { token: onboardingToken } = issueOnboardingToken(
        exchange.identity,
        config.ONBOARDING_TOKEN_KEY,
      );
      res.redirect(
        302,
        `${config.PUBLIC_BASE_URL}/register#onboarding_token=${onboardingToken}`,
      );
      return;
    }
    if (route.kind === 'deactivated') {
      res.redirect(302, `${config.PUBLIC_BASE_URL}/login?error=account_deactivated`);
      return;
    }

    const { token } = issueAccessToken(
      {
        userId: route.account.user.id,
        roleScopes: route.account.roleScopes,
        accountStatus: route.account.user.accountStatus,
      },
      config.JWT_SIGNING_KEY,
    );
    const session = await issueNewSession(prisma, route.account.user.id);
    setRefreshCookie(res, session.rawToken);

    // A Pending user is hard-redirected to the status screen (TD-1); the access
    // token still exists so `GET /me` works, and nothing else will serve them.
    const destination = route.kind === 'pending' ? '/pending-approval' : '/dashboard';
    // The access token is delivered in the fragment so it never reaches a
    // server log or the Referer header; the client stores it in memory and
    // sends it as `Authorization: Bearer` thereafter (TD-12).
    res.redirect(302, `${config.PUBLIC_BASE_URL}${destination}#access_token=${token}`);
  };
}

/** `POST /auth/refresh` — TD-12's sole cookie-authenticated route. */
export function refresh(prisma: PrismaClient, config: AppConfig) {
  return async (req: Request, res: Response): Promise<void> => {
    // CSRF posture (TD-12): a custom header a cross-site form cannot set, plus
    // an Origin that must match our own. SameSite=Lax is the third leg.
    if (req.header('x-requested-with') !== 'XMLHttpRequest') {
      throw new AppError('AUTH_REQUIRED', 'missing X-Requested-With');
    }
    const origin = req.header('origin');
    if (origin && origin !== config.PUBLIC_BASE_URL) {
      throw new AppError('AUTH_REQUIRED', 'origin mismatch');
    }

    const presented = parseCookies(req.header('cookie'))[REFRESH_COOKIE];
    if (!presented) throw new AppError('AUTH_REQUIRED', 'no refresh cookie');

    const outcome = await rotate(prisma, presented);
    // Every refusal is 401 AUTH_REQUIRED and they are deliberately
    // indistinguishable: telling a stolen cookie why it failed confirms it was
    // once real (TD-12, Revision 16).
    if (outcome.kind === 'rejected' || outcome.kind === 'reuse_detected') {
      res.append('Set-Cookie', clearCookie(REFRESH_COOKIE, REFRESH_COOKIE_PATH));
      throw new AppError('AUTH_REQUIRED', `refresh refused: ${outcome.kind}`);
    }

    const account = await prisma.user.findUnique({ where: { id: outcome.userId } });
    if (!account || account.deletedAt !== null) throw new AppError('AUTH_REQUIRED', 'account gone');

    const assignments = await prisma.userBranchRole.findMany({
      where: { userId: outcome.userId, deletedAt: null },
      include: { role: true },
    });
    const { token, expiresAt } = issueAccessToken(
      {
        userId: account.id,
        roleScopes: toRoleScopes(assignments),
        accountStatus: account.accountStatus,
      },
      config.JWT_SIGNING_KEY,
    );

    // On `grace` no new refresh token exists — the caller keeps the successor it
    // already holds, so the cookie is deliberately left untouched (T3).
    if (outcome.kind === 'rotated') setRefreshCookie(res, outcome.rawToken);

    res.json({ access_token: token, expires_at: expiresAt.toISOString() });
  };
}

/** `POST /auth/logout` — revokes the CURRENT session only (TD-4.14). */
export function logout(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const presented = parseCookies(req.header('cookie'))[REFRESH_COOKIE];
    res.append('Set-Cookie', clearCookie(REFRESH_COOKIE, REFRESH_COOKIE_PATH));

    if (presented) {
      const row = await tokens.findByHash(prisma, hashToken(presented));
      if (row) {
        await logoutSession(prisma, {
          userId: row.userId,
          sessionId: row.sessionId,
          actorUserId: row.userId,
        });
      }
    }
    // Idempotent by design: logging out twice, or with no cookie at all, is a
    // success. There is nothing to leak and nothing to fail.
    res.status(204).end();
  };
}
