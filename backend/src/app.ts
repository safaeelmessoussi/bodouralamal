import express, { type Express, type Request, type Response } from 'express';

import * as auth from './controllers/auth.controller.js';
import * as approvals from './controllers/approval.controller.js';
import * as settings from './controllers/setting.controller.js';
import * as familyLinks from './controllers/family-link.controller.js';
import * as consents from './controllers/consent.controller.js';
import * as calendar from './controllers/calendar.controller.js';
import * as events from './controllers/event.controller.js';
import * as hijri from './controllers/hijri-calendar.controller.js';
import * as calendarBootstrap from './controllers/calendar-bootstrap.controller.js';
import * as publicBranches from './controllers/public-branch.controller.js';
import * as socialProfile from './controllers/social-profile.controller.js';
import * as users from './controllers/user.controller.js';
import * as branch from './controllers/branch.controller.js';
import * as administrativeGroups from './controllers/administrative-group.controller.js';
import * as teachingGroups from './controllers/teaching-group.controller.js';
import * as courseSchedules from './controllers/course-schedule.controller.js';
import * as sessionsCtl from './controllers/session.controller.js';
import * as libraryCtl from './controllers/library.controller.js';
import * as referenceData from './controllers/reference-data.controller.js';
import * as taxonomy from './controllers/taxonomy.controller.js';
import * as trash from './controllers/trash.controller.js';
import * as contentCtl from './controllers/content.controller.js';
import { createRegistration } from './controllers/registration.controller.js';
import { healthController } from './controllers/health.controller.js';
import type { PrismaClient } from './generated/prisma/client.js';
import { verifyAccessToken } from './lib/access-token.js';
import type { AppConfig } from './lib/config.js';
import { AppError } from './lib/errors.js';
import { createStorageClients } from './lib/storage.js';
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
  // TD-3.4: the §5.2 Session page. Public at the caller's tier, exactly like the
  // grid it is opened from — an anonymous visitor sees a public session's
  // details, never its private recordings.
  api.get('/calendar/sessions/:id', optionalAuthenticate(config), calendar.readSession(prisma));

  // TD-3.9 (Revision 35): the §5.1 landing-page branch list. Public and
  // anonymous, and mounted BEFORE the guarded router for that reason. No
  // optional authentication: there is no tier to resolve here, so a credential
  // could only ever be ignored.
  // TD-3.10 (Revision 36): the calendar screen's reference data in one read.
  // Public and cacheable; mounted before the guarded router for that reason.
  api.get('/calendar/bootstrap', calendarBootstrap.read(prisma));

  api.get('/branches', publicBranches.list(prisma));

  // TD-3.13 (Revision 43): the Educational Library is PUBLIC. Mounted before the
  // guarded router with OPTIONAL authentication, exactly as /calendar is — a
  // credential reorders the result (own branch → Global → other branches, §5.2)
  // and never unlocks anything. An invalid token is ignored rather than refused,
  // so this endpoint never answers 401.
  api.get('/library', optionalAuthenticate(config), libraryCtl.list(prisma));

  const guarded = express.Router();
  guarded.use(authenticate(config));
  // Approvals (§5.6, TD-3.2). TD-12 marks these high-risk, so the service
  // re-asserts the caller's live status against the database per request.
  // Platform settings (TD-3.11, §5.6, Revision 42). Super Admin only, asserted
  // in the service against live rows — the `/admin/` prefix is not the boundary.
  // §7/TD-5/BR-15 (R52) — soft-deleted records. Super Admin only, asserted in
  // the service. No permanent-delete route: BR-15's window is enforced by the
  // purge job, and a manual override is its own retention decision.
  guarded.get('/admin/trash', trash.list(prisma));
  guarded.post('/admin/trash/:id/restore', trash.restore(prisma));

  guarded.get('/admin/settings', settings.list(prisma));
  guarded.put('/admin/settings/:key', settings.update(prisma));

  guarded.get('/admin/approvals', approvals.list(prisma));
  guarded.post('/admin/approvals/:id/approve', approvals.approve(prisma));
  guarded.post('/admin/approvals/:id/reject', approvals.reject(prisma));
  guarded.post('/events', events.create(prisma));
  guarded.patch('/events/:id', events.update(prisma));

  // §5.7/TD-3.4 (Revisions 31–32) — recording the Ministry's official Hijri
  // announcements. Super Admin only, enforced in the service: the URL prefix is
  // not the boundary. No import route ships (§10.1).
  guarded.get('/admin/hijri-calendar', hijri.list(prisma));
  guarded.put('/admin/hijri-calendar/:year/:month', hijri.recordMonth(prisma));
  guarded.post('/admin/hijri-calendar/:year/publish', hijri.publish(prisma));
  guarded.get('/admin/hijri-calendar/:year/history', hijri.history(prisma));
  guarded.delete('/events/:id', events.remove(prisma));
  guarded.get('/admin/branches/:id/event-backfill', events.listBackfill(prisma));
  guarded.post('/admin/branches/:id/event-backfill', events.applyBackfill(prisma));
  guarded.get('/students/:id/consents', consents.read(prisma));
  guarded.post('/students/:id/consents', consents.record(prisma));
  guarded.get('/students/:id/social-profile', socialProfile.read(prisma));
  guarded.put('/students/:id/social-profile', socialProfile.write(prisma));
  guarded.get('/admin/users', users.list(prisma));
  guarded.post('/admin/users', users.create(prisma));
  // §5.6 "edit, deactivate, role/branch-scope assignment". Suspension is its own
  // verb rather than a field on the edit, because TD-4.15 requires it to revoke
  // every live session in the same transaction — an obligation a field
  // assignment cannot carry.
  guarded.patch('/admin/users/:id', users.update(prisma));
  guarded.post('/admin/users/:id/suspend', users.suspend(prisma));
  guarded.post('/admin/users/:id/reactivate', users.reactivate(prisma));
  guarded.put('/admin/users/:id/roles', users.setRoles(prisma));
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

  // Administrative Groups (§4.4c, TD-3.12, Revision 43) — the permanent
  // ORGANISATIONAL unit inside a Level. Operational data, so Admin within branch
  // scope or Super Admin, asserted in the service (TD-2): the `/admin/` prefix
  // authenticates, it does not authorise.
  guarded.get('/admin/administrative-groups', administrativeGroups.list(prisma));
  guarded.post('/admin/administrative-groups', administrativeGroups.create(prisma));
  guarded.patch('/admin/administrative-groups/:id', administrativeGroups.update(prisma));
  guarded.delete('/admin/administrative-groups/:id', administrativeGroups.remove(prisma));
  // The roster (§5.6). Enrolment reads the Level FROM the group and enqueues
  // consent re-evaluation per session in the same transaction (§4.1a, TD-7).
  guarded.get('/admin/administrative-groups/:id/roster', administrativeGroups.listRoster(prisma));
  guarded.post('/admin/administrative-groups/:id/roster', administrativeGroups.enrol(prisma));
  guarded.delete(
    '/admin/administrative-groups/:id/roster/:studentId',
    administrativeGroups.unenrol(prisma),
  );

  // Teaching Groups (§4.4c, BR-22, TD-3.12, Revision 43) — the SUBJECT-SPECIFIC
  // split inside a Level, which exists only where a Subject needs students
  // divided differently from the administrative roster.
  //
  // The collection is addressed by `(Level, Subject)` because that pair is what
  // a split IS. Authority is split with it (Revision 43.3): the group itself has
  // no branch to scope by, so its CRUD is Super Admin, while membership is Admin
  // scoped by the branch the STUDENT is enrolled at — both asserted in the
  // service, never here.
  guarded.get(
    '/admin/levels/:levelId/subjects/:subjectId/teaching-groups',
    teachingGroups.list(prisma),
  );
  guarded.post(
    '/admin/levels/:levelId/subjects/:subjectId/teaching-groups',
    teachingGroups.create(prisma),
  );
  guarded.patch('/admin/teaching-groups/:id', teachingGroups.update(prisma));
  guarded.delete('/admin/teaching-groups/:id', teachingGroups.remove(prisma));
  guarded.post('/admin/teaching-groups/:id/members', teachingGroups.addMember(prisma));
  guarded.delete(
    '/admin/teaching-groups/:id/members/:studentId',
    teachingGroups.removeMember(prisma),
  );

  // Recurring Course Schedules (§4.4, TD-3.12, Revision 43) — the unit of
  // DELIVERY. A write materializes Sessions and reports what it left alone
  // (§4.4, R43.6), so `materialization` travels with both write verbs.
  // Reference-data selectors (TD-3 extension, 2026-08-05). The canonical source
  // for every admin selector needing a Subject or an Academic Year — a screen
  // that needs either reads these rather than growing its own list.
  guarded.get('/admin/subjects', referenceData.subjects(prisma));
  guarded.get('/admin/academic-years', referenceData.academicYears(prisma));
  // Which Subjects a Level teaches (§4.4b). The join that gates Teaching Groups
  // had no write path at all, so `LevelSubject` was permanently empty and every
  // teaching-group creation answered SUBJECT_NOT_IN_LEVEL.
  guarded.get('/admin/levels/:levelId/subjects', referenceData.levelSubjects(prisma));
  guarded.put('/admin/levels/:levelId/subjects/:subjectId', referenceData.assignSubject(prisma));
  guarded.delete(
    '/admin/levels/:levelId/subjects/:subjectId',
    referenceData.unassignSubject(prisma),
  );

  // Curriculum taxonomy CRUD (§5.6 "Categories & Subjects" + "Levels", §14.1).
  // Admin reads, Super Admin writes (TD-2 R26) — enforced in the services, never
  // by the URL prefix. `POST /admin/levels` is TD-4.6b: it creates المجموعة 1 in
  // the same transaction, which is why it takes a `branch_id` the Level itself
  // does not store.
  guarded.get('/admin/categories', taxonomy.categories(prisma));
  guarded.post('/admin/categories', taxonomy.createCategoryHandler(prisma));
  guarded.patch('/admin/categories/:id', taxonomy.updateCategoryHandler(prisma));
  guarded.delete('/admin/categories/:id', taxonomy.deleteCategoryHandler(prisma));
  guarded.post('/admin/subjects', taxonomy.createSubjectHandler(prisma));
  guarded.patch('/admin/subjects/:id', taxonomy.updateSubjectHandler(prisma));
  guarded.delete('/admin/subjects/:id', taxonomy.deleteSubjectHandler(prisma));
  guarded.get('/admin/levels', taxonomy.levels(prisma));
  guarded.post('/admin/levels', taxonomy.createLevelHandler(prisma));
  guarded.patch('/admin/levels/:id', taxonomy.updateLevelHandler(prisma));
  guarded.delete('/admin/levels/:id', taxonomy.deleteLevelHandler(prisma));

  guarded.get('/admin/course-schedules', courseSchedules.list(prisma));
  guarded.post('/admin/course-schedules', courseSchedules.create(prisma));
  guarded.patch('/admin/course-schedules/:id', courseSchedules.update(prisma));
  guarded.delete('/admin/course-schedules/:id', courseSchedules.remove(prisma));
  // Conflicts are computed against MATERIALIZED sessions, never against
  // recurrence rules — comparing rules cannot see that a weekly and a
  // biweekly-alternating Tuesday 15:00 collide only on alternate weeks.
  guarded.get('/admin/course-schedules/:id/conflicts', courseSchedules.conflicts(prisma));
  guarded.get('/admin/course-schedules/:id/roster', courseSchedules.roster(prisma));
  // R50 — the occurrences the scope dialog is chosen from. A sibling of
  // `/conflicts` and `/roster`: all three answer a question about one schedule.
  guarded.get('/admin/course-schedules/:id/sessions', courseSchedules.sessions(prisma));

  // Sessions (§4.4, TD-1, TD-3.12) — the individual occurrence. NOT under
  // `/admin/`: TD-2 gives a Teacher write access to the sessions they staff, so
  // the path would misdescribe the audience. Scope is asserted in the service,
  // which is the only place that knows who staffs what.
  //
  // One verb per TD-1 transition. PATCH edits fields and always marks the
  // occurrence `overridden`; it never carries `status`, because a cancellation
  // must state a reason and a restore is refused after the date — obligations a
  // field assignment cannot carry.
  guarded.patch('/sessions/:id', sessionsCtl.override(prisma));
  guarded.post('/sessions/:id/cancel', sessionsCtl.cancel(prisma));
  guarded.post('/sessions/:id/restore', sessionsCtl.restore(prisma));
  guarded.post('/sessions/:id/content', sessionsCtl.linkContent(prisma));
  guarded.delete('/sessions/:id/content/:contentId', sessionsCtl.unlinkContent(prisma));

  // TD-3.5 storage. The browser PUTs straight to MinIO through a presigned URL,
  // so the file never passes through this process (§2.3) — these routes decide
  // and verify, they do not carry bytes. `:uploadId` is the signed ticket itself
  // (`lib/upload-token.ts`), which is why no pending-upload table exists.
  const storage = createStorageClients(config);
  guarded.post('/uploads/initiate', contentCtl.initiate(prisma, storage, config));
  guarded.post('/uploads/:uploadId/complete', contentCtl.complete(prisma, storage, config));
  guarded.post('/uploads/:uploadId/abort', contentCtl.abort(storage, config));
  // R53: replacement reuses the upload flow (`replaces_content_id`); deletion is
  // its own route because it moves no bytes in.
  guarded.delete('/content/:id', contentCtl.remove(prisma, storage));
  // TD-12: minting is one of the high-risk operations where an unexpired token
  // is not sufficient — the service re-asserts the caller against live rows.
  guarded.get('/content/:id/download-url', contentCtl.downloadUrl(prisma, storage));

  api.use(guarded);

  app.use('/api/v1', api);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
