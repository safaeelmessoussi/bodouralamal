import type { NextFunction, Request, Response } from 'express';

import { verifyAccessToken } from '../lib/access-token.js';
import type { AppConfig } from '../lib/config.js';
import { AppError } from '../lib/errors.js';
import type { Actor } from '../services/branch.service.js';

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
      roles: verified.claims.roles,
      roleScopes: verified.claims.role_scopes,
      accountStatus: verified.claims.account_status,
    };
    next();
  };
}

/**
 * Optional authentication, for the **public** endpoints §4.4 defines — currently
 * `GET /calendar`, which serves an anonymous visitor the public tier.
 *
 * Three cases, deliberately distinguished:
 *
 *   - **No token** → anonymous. The handler sees `req.actor` undefined and
 *     applies the public tier.
 *   - **A token that does not verify** → `401`. It is *not* silently downgraded
 *     to anonymous: a logged-in user whose token expired would otherwise watch
 *     their calendar quietly shrink, with nothing telling the client to refresh.
 *   - **A valid token for a non-active account** → passed through **with** its
 *     status, because §4.4 gives a `Pending` user the public tier rather than a
 *     refusal. The guarded router still rejects them everywhere else.
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
      next(new AppError('AUTH_REQUIRED', verified.reason));
      return;
    }

    req.actor = {
      userId: verified.claims.sub,
      roles: verified.claims.roles,
      roleScopes: verified.claims.role_scopes,
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
