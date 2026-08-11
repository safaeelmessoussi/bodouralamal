import type { NextFunction, Request, Response } from 'express';

import { verifyAccessToken } from '../lib/access-token.js';
import type { AppConfig } from '../lib/config.js';
import { AppError } from '../lib/errors.js';
import type { Actor } from '../policies/actor.js';

/**
 * Bearer authentication (SRS TD-12).
 *
 * The access token is carried **exclusively in the `Authorization` header** —
 * never a cookie — which is what makes ordinary API mutations structurally
 * immune to CSRF: a cross-site attacker cannot set that header.
 */

declare module 'express-serve-static-core' {
  interface Request {
    actor?: Actor;
  }
}

export function authenticate(config: AppConfig) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const header = req.header('authorization');
    const bearer = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!bearer) {
      next(new AppError('AUTH_REQUIRED', 'no bearer token'));
      return;
    }

    const verified = verifyAccessToken(bearer, config.JWT_SIGNING_KEY);
    if (!verified.valid) {
      next(new AppError('AUTH_REQUIRED', verified.reason));
      return;
    }

    // TD-1: a Pending session reaches no endpoint but `GET /me` and logout, so
    // it is refused here rather than at each route — one gate, not many.
    if (verified.claims.account_status !== 'active') {
      next(new AppError('FORBIDDEN', `account_status is ${verified.claims.account_status}`));
      return;
    }

    req.actor = {
      userId: verified.claims.sub,
      // R60: already narrowed at issue when an active role is set, so nothing
      // here filters — the middleware carries what the token says.
      roles: verified.claims.roles,
      roleScopes: verified.claims.role_scopes,
      ...(verified.claims.active_role !== undefined
        ? { activeRole: verified.claims.active_role }
        : {}),
      accountStatus: verified.claims.account_status,
    };
    next();
  };
}

/**
 * Optional authentication, for the **public** endpoints §4.4 defines — currently
 * `GET /calendar`, which serves an anonymous visitor the public tier.
 *
 * **A public endpoint never returns `401`** (Revision 34). Three cases:
 *
 *   - **No token** → anonymous. The handler sees `req.actor` undefined and
 *     applies the public tier.
 *   - **A token that does not verify** — malformed, expired, wrong signature →
 *     **ignored, and the request proceeds as anonymous.** A credential that
 *     fails verification carries no identity to act on, so the only honest
 *     reading is that the caller is anonymous. Refusing instead would mean a
 *     returning visitor whose token expired while the tab sat open is served an
 *     error on the **landing page** (§5.1), which has no login requirement at
 *     all — and a client treating `401` as *redirect to login* would login-wall
 *     a public page. The client learns its session state from `POST
 *     /auth/refresh` and `GET /me`, never from a public read.
 *   - **A valid token for a non-active account** → passed through **with** its
 *     status, because §4.4 gives a `Pending` user the public tier rather than a
 *     refusal. The guarded router still rejects them everywhere else. This case
 *     is unchanged by Revision 34, which concerns only credentials that fail
 *     verification.
 */
export function optionalAuthenticate(config: AppConfig) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const header = req.header('authorization');
    const bearer = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!bearer) {
      next();
      return;
    }

    const verified = verifyAccessToken(bearer, config.JWT_SIGNING_KEY);
    if (!verified.valid) {
      // Revision 34: ignored, not refused. `req.actor` stays undefined, which
      // is exactly the state a caller with no token at all produces.
      next();
      return;
    }

    req.actor = {
      userId: verified.claims.sub,
      roles: verified.claims.roles,
      roleScopes: verified.claims.role_scopes,
      ...(verified.claims.active_role !== undefined
        ? { activeRole: verified.claims.active_role }
        : {}),
      accountStatus: verified.claims.account_status,
    };
    next();
  };
}

/** Narrows `req.actor` for handlers mounted behind `authenticate`. */
export function requireActor(req: Request): Actor {
  if (!req.actor) throw new AppError('AUTH_REQUIRED', 'unauthenticated');
  return req.actor;
}
