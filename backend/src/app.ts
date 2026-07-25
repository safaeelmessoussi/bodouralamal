import express, { type Express, type Request, type Response } from 'express';

import * as auth from './controllers/auth.controller.js';
import { healthController } from './controllers/health.controller.js';
import type { PrismaClient } from './generated/prisma/client.js';
import { verifyAccessToken } from './lib/access-token.js';
import type { AppConfig } from './lib/config.js';
import { AppError } from './lib/errors.js';
import {
  accessLog,
  errorHandler,
  notFound,
  requestContext,
} from './middleware/request-context.js';

/**
 * Express application (SRS §3.1, TD-3).
 *
 * Every route here appears in the TD-3 registry — §20 rule 16 forbids inventing
 * one, and the §19.2 CI check fails a generated OpenAPI document that disagrees
 * with TD-3 in either direction.
 */

/** `GET /me` (TD-3.1) — the only endpoint a Pending session may call (TD-1). */
function meController(prisma: PrismaClient, config: AppConfig) {
  return async (req: Request, res: Response): Promise<void> => {
    const header = req.header('authorization');
    // TD-12: the access token travels in the Authorization header ONLY.
    const bearer = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!bearer) throw new AppError('AUTH_REQUIRED', 'no bearer token');

    const verified = verifyAccessToken(bearer, config.JWT_SIGNING_KEY);
    if (!verified.valid) throw new AppError('AUTH_REQUIRED', verified.reason);

    const user = await prisma.user.findUnique({ where: { id: verified.claims.sub } });
    if (!user || user.deletedAt !== null) throw new AppError('AUTH_REQUIRED', 'account unavailable');

    const links = await prisma.familyLink.findMany({
      where: { parentId: user.id, status: 'approved', deletedAt: null },
      select: { studentId: true },
    });

    res.json({
      id: user.id,
      account_status: user.accountStatus,
      roles: verified.claims.roles,
      branch_scopes: verified.claims.branch_scopes,
      // §14.3 ChildContextSwitcher renders approved links only (§4.3).
      approved_child_links: links.map((link) => link.studentId),
    });
  };
}

export function createApp(prisma: PrismaClient, config: AppConfig): Express {
  const app = express();

  // Nginx terminates TLS and is the only thing in front of us (§3.1).
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(requestContext);
  app.use(accessLog);
  app.use(express.json({ limit: '2mb' }));

  // TD-14: public and unauthenticated, served at the origin root (§19.1 step 8).
  app.get('/healthz', healthController(prisma, config));

  const api = express.Router();
  api.get('/auth/google', auth.startOAuth(config));
  api.get('/auth/google/callback', auth.oauthCallback(prisma, config));
  api.post('/auth/refresh', auth.refresh(prisma, config));
  api.post('/auth/logout', auth.logout(prisma));
  api.get('/me', meController(prisma, config));
  app.use('/api/v1', api);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
