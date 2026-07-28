import express, { type Express, type Request, type Response } from 'express';

import * as auth from './controllers/auth.controller.js';
import * as approvals from './controllers/approval.controller.js';
import * as familyLinks from './controllers/family-link.controller.js';
import * as consents from './controllers/consent.controller.js';
import * as calendar from './controllers/calendar.controller.js';
import * as events from './controllers/event.controller.js';
import * as groups from './controllers/group.controller.js';
import * as socialProfile from './controllers/social-profile.controller.js';
import * as users from './controllers/user.controller.js';
import * as branch from './controllers/branch.controller.js';
import { createRegistration } from './controllers/registration.controller.js';
import { healthController } from './controllers/health.controller.js';
import type { PrismaClient } from './generated/prisma/client.js';
import { verifyAccessToken } from './lib/access-token.js';
import type { AppConfig } from './lib/config.js';
import { AppError } from './lib/errors.js';
import { authenticate, optionalAuthenticate } from './middleware/authenticate.js';
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
      role_scopes: verified.claims.role_scopes,
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
  // Public, gated by the signed onboarding token — no session exists yet
  // (§4.1b step 4c, TD-3.2).
  api.post('/registrations', createRegistration(prisma, config));

  // Branches & Rooms (§5.6, §14.2). Everything below requires a live Active
  // session; role and branch-scope checks live in the service (TD-2).
  // §4.4/TD-3.4: the calendar is PUBLIC — an anonymous visitor sees the public
  // tier. It therefore mounts BEFORE the guarded router, with optional
  // authentication, and the service resolves the tier from the live actor.
  api.get('/calendar', optionalAuthenticate(config), calendar.read(prisma));

  const guarded = express.Router();
  guarded.use(authenticate(config));
  // Approvals (§5.6, TD-3.2). TD-12 marks these high-risk, so the service
  // re-asserts the caller's live status against the database per request.
  guarded.get('/admin/approvals', approvals.list(prisma));
  guarded.post('/admin/approvals/:id/approve', approvals.approve(prisma));
  guarded.post('/admin/approvals/:id/reject', approvals.reject(prisma));
  guarded.post('/events', events.create(prisma));
  guarded.delete('/events/:id', events.remove(prisma));
  guarded.get('/admin/branches/:id/event-backfill', events.listBackfill(prisma));
  guarded.post('/admin/branches/:id/event-backfill', events.applyBackfill(prisma));
  guarded.get('/admin/groups', groups.list(prisma));
  guarded.post('/admin/groups', groups.create(prisma));
  guarded.patch('/admin/groups/:id', groups.update(prisma));
  guarded.delete('/admin/groups/:id', groups.remove(prisma));
  guarded.get('/admin/groups/:id/roster', groups.roster(prisma));
  guarded.post('/admin/groups/:id/roster', groups.enrol(prisma));
  guarded.delete('/admin/groups/:id/roster/:studentId', groups.unenrol(prisma));
  guarded.post('/admin/groups/:id/instructors', groups.addInstructor(prisma));
  guarded.delete('/admin/groups/:id/instructors/:teacherId', groups.removeInstructor(prisma));
  guarded.get('/students/:id/consents', consents.read(prisma));
  guarded.post('/students/:id/consents', consents.record(prisma));
  guarded.get('/students/:id/social-profile', socialProfile.read(prisma));
  guarded.put('/students/:id/social-profile', socialProfile.write(prisma));
  guarded.get('/admin/users', users.list(prisma));
  guarded.post('/admin/users', users.create(prisma));
  guarded.post('/family-links', familyLinks.create(prisma));
  guarded.delete('/admin/family-links/:id', familyLinks.revoke(prisma));
  guarded.get('/admin/branches', branch.listBranches(prisma));
  guarded.post('/admin/branches', branch.createBranch(prisma));
  guarded.patch('/admin/branches/:id', branch.updateBranch(prisma));
  guarded.delete('/admin/branches/:id', branch.deleteBranch(prisma));
  guarded.get('/admin/branches/:id/rooms', branch.listRooms(prisma));
  guarded.post('/admin/branches/:id/rooms', branch.createRoom(prisma));
  guarded.patch('/admin/rooms/:id', branch.updateRoom(prisma));
  guarded.delete('/admin/rooms/:id', branch.deleteRoom(prisma));
  api.use(guarded);

  app.use('/api/v1', api);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
