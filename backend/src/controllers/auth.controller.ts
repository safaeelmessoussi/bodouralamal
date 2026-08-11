import type { Request, Response } from 'express';

import type { PrismaClient } from '../generated/prisma/client.js';
import { issueAccessToken } from '../lib/access-token.js';
import { postLoginDestination } from '../lib/role-home.js';
import { clearCookie, parseCookies, serializeCookie } from '../lib/cookies.js';
import type { AppConfig } from '../lib/config.js';
import { narrowToRole, toRoleScopes } from '../policies/branch-scope.js';
import { requireActor } from '../middleware/authenticate.js';
import * as audit from '../repositories/audit.repository.js';
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
    //
    // Everyone else goes to their ROLE HOME (§4.1b step 4a's "role-based
    // dashboard redirect", §14.1). This was a literal `/dashboard` — a node the
    // sitemap does not define — so signing in as a Super Admin landed on a page
    // that does not exist. One authoritative policy now lives in
    // `lib/role-home.ts`, and it never names a path the client cannot serve.
    const destination =
      route.kind === 'pending'
        ? '/pending-approval'
        : postLoginDestination(route.account.roleScopes.map((scope) => scope.role));
    // The access token is delivered in the fragment so it never reaches a
    // server log or the Referer header; the client stores it in memory and
    // sends it as `Authorization: Bearer` thereafter (TD-12).
    res.redirect(302, `${config.PUBLIC_BASE_URL}${destination}#access_token=${token}`);
  };
}

/**
 * The role the client is asking to work as, from the request body.
 *
 * A body rather than a header: this is a POST that already carries CSRF
 * protection, and a header would be a second convention for one idea.
 */
function requestedRole(req: Request): string | undefined {
  const body = req.body as { active_role?: unknown } | undefined;
  return typeof body?.active_role === 'string' && body.active_role !== ''
    ? body.active_role
    : undefined;
}

/**
 * **Fail safe, never fail open** (§60.4, Document Owner decision).
 *
 * Three cases, and the middle one is the decision that matters:
 *
 *   * **No role requested** → `null`, an un-narrowed token. The honest reading
 *     of *"the client did not ask to be narrowed"*, and the pre-R60 behaviour.
 *   * **Requested role still assigned** → that role.
 *   * **Requested role revoked** → **the most privileged role still held**, not
 *     an un-narrowed token. Silently restoring full multi-role authority because
 *     one role disappeared is the failure mode this rule exists to prevent: the
 *     caller asked to be limited, and losing the limit is not a safe default.
 *     Returning `null` here would do exactly that.
 *
 * Precedence matches the login default and the client's switcher ordering, so
 * *"most privileged"* means the same thing everywhere.
 */
const ROLE_PRECEDENCE = ['super_admin', 'admin', 'teacher', 'parent', 'student'] as const;

export function resolveActiveRole(
  liveScopes: readonly { role: string }[],
  requested: string | undefined,
): string | null {
  if (requested === undefined) return null;
  const held = new Set(liveScopes.map((s) => s.role));
  if (held.has(requested)) return requested;

  const fallback = ROLE_PRECEDENCE.find((role) => held.has(role));
  // An account with no assignments at all: nothing to fall back to, and an
  // un-narrowed token of no roles is the same thing.
  return fallback ?? null;
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
    // **R60 — refresh is what makes an active role persist.** The client holds
    // the access token in memory only, and a role switch navigates by full page
    // load, so the token is discarded and re-acquired here on the very next
    // page. This endpoint, not `/auth/switch-role`, is the load-bearing one.
    const liveScopes = toRoleScopes(assignments);
    const active = resolveActiveRole(liveScopes, requestedRole(req));

    const { token, expiresAt } = issueAccessToken(
      {
        userId: account.id,
        roleScopes: active === null ? liveScopes : narrowToRole(liveScopes, active) ?? liveScopes,
        ...(active !== null ? { activeRole: active } : {}),
        accountStatus: account.accountStatus,
      },
      config.JWT_SIGNING_KEY,
    );

    // On `grace` no new refresh token exists — the caller keeps the successor it
    // already holds, so the cookie is deliberately left untouched (T3).
    if (outcome.kind === 'rotated') setRefreshCookie(res, outcome.rawToken);

    // **Returned explicitly** (§60.4): the client must never have to guess what
    // authority it holds, and when a requested role has been revoked this is how
    // it learns which role it fell back to.
    res.json({
      access_token: token,
      expires_at: expiresAt.toISOString(),
      active_role: active,
    });
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

/**
 * `POST /auth/switch-role` — work as a different one of your own roles (R60.3).
 *
 * **One indexed query and one signature.** No logout, no new session, no
 * refresh-cookie change: the refresh chain is about *who is signed in*, and this
 * changes only *in what capacity*.
 *
 * **Not the load-bearing path**, despite appearances. The client holds the
 * access token in memory, and switching navigates by full page load, so the
 * token minted here is discarded almost immediately and re-acquired from
 * `/auth/refresh`. What this endpoint adds is worth having anyway: an immediate,
 * coded refusal for a role the caller does not hold, and an audit row recording
 * the switch as the deliberate act it is.
 *
 * **Live rows, not the token.** The caller's current token may itself already be
 * narrowed — switching from مؤطِّرة back to Super Admin must work — so the
 * decision is made against `UserBranchRole`, never against what the presented
 * token claims. Reading the token here would make the first switch a one-way
 * door.
 */
export function switchRole(prisma: PrismaClient, config: AppConfig) {
  return async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const body = req.body as { role?: unknown } | undefined;
    const role = typeof body?.role === 'string' ? body.role.trim() : '';
    if (role === '') throw new AppError('VALIDATION_FAILED', 'role is required');

    const assignments = await prisma.userBranchRole.findMany({
      where: { userId: actor.userId, deletedAt: null },
      include: { role: true },
    });
    const liveScopes = toRoleScopes(assignments);
    const narrowed = narrowToRole(liveScopes, role);

    // §60.2's invariant, enforced where the token is minted: a role the live
    // rows do not carry cannot become a claim. 403 rather than 404 — the caller
    // is authenticated and the roles are their own, so there is nothing to hide.
    if (!narrowed) {
      throw new AppError('FORBIDDEN', 'that role is not assigned to this account', {
        reason: 'ROLE_NOT_ASSIGNED',
        role,
      });
    }

    const { token, expiresAt } = issueAccessToken(
      {
        userId: actor.userId,
        roleScopes: narrowed,
        activeRole: role,
        accountStatus: actor.accountStatus ?? 'active',
      },
      config.JWT_SIGNING_KEY,
    );

    await audit.write(prisma, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'auth.role_switch',
      targetEntity: 'User',
      targetId: actor.userId,
      // Both ends of the move: "which capacity did they leave" is as much of the
      // story as which they entered.
      detail: { from: actor.activeRole ?? null, to: role },
    });

    res.json({
      access_token: token,
      expires_at: expiresAt.toISOString(),
      active_role: role,
    });
  };
}
