import express, { type Express, type Request, type Response } from 'express';
import * as notifications from './controllers/notification.controller.js';

import * as auth from './controllers/auth.controller.js';
import * as approvals from './controllers/approval.controller.js';
import * as settings from './controllers/setting.controller.js';
import * as teachingProfile from './controllers/teaching-profile.controller.js';
import * as familyLinks from './controllers/family-link.controller.js';
import * as consents from './controllers/consent.controller.js';
import * as calendar from './controllers/calendar.controller.js';
import * as events from './controllers/event.controller.js';
import * as hijri from './controllers/hijri-calendar.controller.js';
import * as calendarBootstrap from './controllers/calendar-bootstrap.controller.js';
import * as partners from './controllers/partner.controller.js';
import * as publicBranches from './controllers/public-branch.controller.js';
import * as socialProfile from './controllers/social-profile.controller.js';
import * as users from './controllers/user.controller.js';
import * as branch from './controllers/branch.controller.js';
import * as administrativeGroups from './controllers/administrative-group.controller.js';
import * as teachingGroups from './controllers/teaching-group.controller.js';
import * as courseSchedules from './controllers/course-schedule.controller.js';
import * as sessionsCtl from './controllers/session.controller.js';
import * as onlineClassCtl from './controllers/online-class.controller.js';
import * as recordingCtl from './controllers/session-recording.controller.js';
import * as libraryCtl from './controllers/library.controller.js';
import * as referenceData from './controllers/reference-data.controller.js';
import * as taxonomy from './controllers/taxonomy.controller.js';
import * as schedulingTypes from './controllers/scheduling-type.controller.js';
import * as scopeOptions from './controllers/scope-options.controller.js';
import * as trash from './controllers/trash.controller.js';
import * as contentCtl from './controllers/content.controller.js';
import * as enrollments from './controllers/enrollment.controller.js';
import * as exams from './controllers/exam.controller.js';
import * as grades from './controllers/grade.controller.js';
import * as quran from './controllers/quran.controller.js';
import * as childApplications from './controllers/child-application.controller.js';
import * as students from './controllers/student.controller.js';
import * as profile from './controllers/profile.controller.js';
import { createRegistration } from './controllers/registration.controller.js';
import { healthController } from './controllers/health.controller.js';
import type { PrismaClient } from './generated/prisma/client.js';
import type { JobRunnerReadiness } from './jobs/readiness.js';
import { verifyAccessToken } from './lib/access-token.js';
import type { AppConfig } from './lib/config.js';
import { AppError } from './lib/errors.js';
import { teachesQuran } from './policies/roster-resolution.js';
import { toRoleScopes } from './policies/branch-scope.js';
import { createStorageClients } from './lib/storage.js';
import { createOnlineClassProvider } from './lib/online-class-provider.js';
import { publicObjectIsReadable } from './services/consent-reevaluation.service.js';
import { authenticate, optionalAuthenticate } from './middleware/authenticate.js';
import { childContext } from './middleware/child-context.js';
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

    // **R60.9 — LIVE roles, not the token's.** Under an active role the token
    // carries exactly one, and reading it here would leave the switcher with a
    // menu of one: the person could narrow themselves and never widen again.
    //
    // This endpoint and authorization deliberately read different things.
    // `/me` answers *what may this person become*; authorization answers *what
    // is this person now*. One indexed query, on a request that already makes
    // two.
    const [links, assignments, platformOwner] = await Promise.all([
      prisma.familyLink.findMany({
        where: {
          parentId: user.id,
          status: 'approved',
          deletedAt: null,
          // A link to a soft-deleted child is not a child the switcher may
          // offer: `resolveActingStudent` refuses it on the very next request,
          // so listing it would render an option that always answers 404.
          student: { deletedAt: null },
        },
        select: { student: { select: { id: true, nameArabic: true } } },
        // §2.2 — the switcher is a list of people and is ordered like every
        // other one. `ar-x-icu` collation makes this correct without a COLLATE.
        orderBy: { student: { nameArabic: 'asc' } },
      }),
      prisma.userBranchRole.findMany({
        where: { userId: user.id, deletedAt: null },
        include: { role: true },
      }),
      prisma.platformOwner.findUnique({
        where: { singletonKey: 'platform' },
        select: { ownerUserId: true },
      }),
    ]);
    const liveScopes = toRoleScopes(assignments);

    res.json({
      id: user.id,
      account_status: user.accountStatus,
      roles: liveScopes.map((scope) => scope.role),
      role_scopes: liveScopes,
      /**
       * R60 — which of those the session is currently working as. `null` for an
       * un-narrowed session, which is a real answer rather than a missing one.
       */
      active_role: verified.claims.active_role ?? null,
      is_platform_owner: platformOwner?.ownerUserId === user.id,
      /**
       * **R87 §M — does this person actually teach Quran?**
       *
       * The teaching menu shows «إدخال الحفظ» only to somebody who does, and
       * the Owner named what it may NOT be derived from: the teacher role, a
       * declared capability, the Subject's name, or hard-coded text. It is a
       * **structural** answer — staffing a schedule (or a single occurrence)
       * whose Subject carries R73's `tracks_quran_progress` marker — computed
       * on the server, because a client deriving it would need the whole
       * staffing graph to do so.
       *
       * `false` for everybody who is not staff, at no cost: the predicate
       * short-circuits on the marker before touching the staffing tables.
       */
      teaches_quran: await teachesQuran(prisma, user.id),
      /**
       * §14.3 ChildContextSwitcher renders approved links only (§4.3).
       *
       * **R62 — each link now carries the child's name.** It used to be a bare
       * id array, so the switcher had nothing to label an option with and the
       * client fabricated «ابني ١», «ابني ٢» from the array index: a parent of
       * three could not tell which child they were about to act for, and the
       * numbering shifted the moment a link was revoked. R62.9 makes the group
       * expand into the children themselves, which needs the name.
       *
       * **The name and nothing else.** This is the least the switcher can be
       * labelled with; the reference code, Category, Level and branch belong to
       * the identity block on the dashboard, not to every authenticated
       * request. Widening `/me` is the cheap habit that turns a session probe
       * into a profile endpoint.
       *
       * The parent already knows these names — they submitted them — so no
       * display-identity resolution applies here: `public_display_name` (§7)
       * governs PUBLIC surfaces, and this one is visible to exactly the adult
       * whose approved `FamilyLink` produced the row.
       */
      approved_child_links: links.map((link) => ({
        id: link.student.id,
        display_name: link.student.nameArabic,
      })),
    });
  };
}

export function createApp(
  prisma: PrismaClient,
  config: AppConfig,
  jobReadiness: Pick<JobRunnerReadiness, 'snapshot'>,
): Express {
  const app = express();

  // Nginx terminates TLS and is the only thing in front of us (§3.1).
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(requestContext);

  /**
   * Internal Nginx auth subrequest; it is not exposed by the public routing
   * table and is not a client API. GET/HEAD against the anonymous MinIO bucket
   * is admitted only while the database still names the exact public key.
   * Writes keep using their signed MinIO capability unchanged.
   */
  app.get('/internal/storage/public-authorize', async (req, res) => {
    const originalUri = req.header('x-original-uri');
    if (!originalUri) {
      throw new AppError('FORBIDDEN', 'storage authorization URI is missing');
    }
    const pathname = new URL(originalUri, 'http://storage.internal').pathname;
    const prefix = '/storage/public/';
    if (!pathname.startsWith(prefix)) {
      throw new AppError('FORBIDDEN', 'storage authorization path is outside public storage');
    }
    const storageKey = decodeURIComponent(pathname.slice(prefix.length));
    const allowed = storageKey.length > 0 && await publicObjectIsReadable(prisma, storageKey);
    if (!allowed) {
      throw new AppError('FORBIDDEN', 'public storage coordinate is not currently readable');
    }
    res.sendStatus(204);
  });

  // Internal storage authorization is intentionally excluded from the ordinary
  // request log: canonical keys are high-volume infrastructure coordinates,
  // not user actions. Public/API requests below retain the existing access log.
  app.use(accessLog);
  /**
   * **R99 — the provider callback needs its RAW bytes, so it is mounted before
   * the JSON parser and only for its own path.**
   *
   * The signature covers exactly what the provider sent. `express.json` would
   * consume the stream and hand the handler an object; re-serialising that
   * object produces different bytes, so every genuine callback would fail
   * verification. Scoped to the one route — everything else keeps the JSON
   * parser it has always had.
   */
  app.use(
    '/api/v1/integrations/online-class/callback',
    express.raw({ type: '*/*', limit: '1mb' }),
  );
  app.use(express.json({ limit: '2mb' }));

  const storage = createStorageClients(config);

  // TD-14: public and unauthenticated, served at the origin root (§19.1 step 8).
  // The probe uses this same authenticated S3 client rather than a vendor-only
  // liveness path, so it verifies all three required buckets and real authority.
  app.get('/healthz', healthController(prisma, config, storage, jobReadiness));

  // R98 — `null` when the association runs no online classes, which is a
  // complete configuration; the join route then answers `503` naming the
  // settings rather than failing at boot for a capability nobody uses.
  // Created before the router because R99's provider callback is a PUBLIC route
  // and is registered further up than the guarded ones.
  const onlineClass = createOnlineClassProvider(config);

  const api = express.Router();
  api.get('/auth/google', auth.startOAuth(config));
  api.get('/auth/google/callback', auth.oauthCallback(prisma, config));
  api.post('/auth/refresh', auth.refresh(prisma, config));
  /**
   * **R99 — the recording provider reports completion here.**
   *
   * Outside `guarded` because the caller is a machine with no Bodour session,
   * and **authenticated by the provider's own signature over the raw body** —
   * which only a holder of the API secret can produce. It can create no
   * educational content and can touch only a recording this platform started
   * (R99.15); an unverifiable request is discarded silently with `204`.
   */
  api.post(
    '/integrations/online-class/callback',
    recordingCtl.callback(prisma, onlineClass),
  );
  api.post('/auth/logout', auth.logout(prisma, config));
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
  // NEW N — §5.1's partners section. Public and unauthenticated, exactly as the
  // branch directory is: the landing page renders what the table holds.
  api.get('/partners', partners.listPublic(prisma));

  // TD-3.13 (Revision 43): the Educational Library is PUBLIC. Mounted before the
  // guarded router with OPTIONAL authentication, exactly as /calendar is — a
  // credential reorders the result (own branch → Global → other branches, §5.2)
  // and never unlocks anything. An invalid token is ignored rather than refused,
  // so this endpoint never answers 401.
  api.get('/library', optionalAuthenticate(config), libraryCtl.list(prisma));
  // `SessionContent` read backwards: which class sessions reference this item
  // (2026-08-17). §4.9 says content is *referenced, never owned* — this is the
  // other half of that sentence, and it adds no relationship. Public at the
  // caller's tier, like the library list and the session page beside it.
  api.get(
    '/library/:id/sessions',
    optionalAuthenticate(config),
    calendar.contentSessions(prisma),
  );

  const guarded = express.Router();
  guarded.use(authenticate(config));
  // R60.3 — work as a different one of your OWN roles. Guarded, because it acts
  // on the caller's identity; the roles it will accept come from live rows, not
  // from the presented token, so switching back out of a narrowed session works.
  guarded.post('/auth/switch-role', auth.switchRole(prisma, config));
  // Approvals (§5.6, TD-3.2). TD-12 marks these high-risk, so the service
  // re-asserts the caller's live status against the database per request.
  // Platform settings (TD-3.11, §5.6, Revision 42). Super Admin only, asserted
  // in the service against live rows — the `/admin/` prefix is not the boundary.
  // Created before the Trash routes because a permanent delete of content must
  // reap its object as well as its row (R59.1) — the upload routes below use the
  // same clients.
  // §7/TD-5/BR-15 (R52, R59) — soft-deleted records. Super Admin only, asserted
  // in the SERVICE against live role rows: the `/admin/` prefix is a URL, not a
  // boundary, and both write verbs here are irreversible or nearly so.
  guarded.get('/admin/trash', trash.list(prisma));
  guarded.post('/admin/trash/:id/restore', trash.restore(prisma));
  // R59.1 — the permanent delete Revision 52 forbade until a revision existed.
  guarded.delete('/admin/trash/:id', trash.purge(prisma));

  // R88 — the teaching profile: what a مؤطِّرة can teach and when. **Planning
  // data**, owned by the administration, granting no operational authority.
  guarded.get('/admin/users/:id/teaching-profile', teachingProfile.read(prisma));
  guarded.put('/admin/users/:id/teaching-profile', teachingProfile.replace(prisma));
  // R106 — «متى أنا متاحة». The same TeacherAvailability model the two routes
  // above manage; a mؤطِّرة replaces HER OWN ranges and nothing else, and what
  // she may teach stays the administration's (R88.2).
  guarded.get('/me/teaching-profile', teachingProfile.readMine(prisma));
  guarded.put('/me/teaching-profile/availability', teachingProfile.replaceMyAvailability(prisma));
  guarded.put('/me/teaching-profile/capabilities', teachingProfile.replaceMyCapabilities(prisma));
  // R90 — who would SUIT a class being planned, and why she might not. A read
  // that returns warnings and never a filtered list: shortening it would be the
  // one refusal an administrator could not override.
  guarded.get('/admin/teaching-candidates', teachingProfile.candidates(prisma));
  guarded.get('/admin/settings', settings.list(prisma));
  guarded.put('/admin/settings/:key', settings.update(prisma));

  // R62 — child applications. One request holds several children; each is
  // decided alone, and the parent role appears on the first approval.
  //
  // The submit route is GUARDED because it serves an already-signed-in adult —
  // a student registering their children, or a parent adding another. The
  // registration flow reaches the SAME service through `POST /registrations`,
  // where the caller is established by the signed onboarding token instead.
  guarded.post('/child-applications', childApplications.submit(prisma));
  guarded.get('/child-applications/mine', childApplications.mine(prisma));
  guarded.get('/admin/child-applications/:id/matches', childApplications.matches(prisma));
  guarded.post('/admin/child-applications/:id/decide', childApplications.decide(prisma));

  /**
   * TD-3.3 / R63 — the FIRST route to mount `childContext`, which until now was
   * §4.3's resolution written down with no caller.
   *
   * Registered before any `/students/:id` route would be: Express matches in
   * order, and `me` is not a UUID, so a later parameterised sibling cannot
   * swallow it.
   */
  /**
   * R65 — the personal section. **No role gate and no id**: §5.2 places
   * `/profile` under *Shared / Cross-Role*, and the subject is the JWT `sub`.
   */
  guarded.get('/profile', profile.read(prisma));
  guarded.patch('/profile', profile.update(prisma));
  // R111 — anyone may delete their own account. No role gate: the subject is the
  // JWT `sub`, so a caller cannot name somebody else. A role can BLOCK it (live
  // teaching responsibilities, the last active Super Admin), never forbid it.
  guarded.delete('/profile', profile.remove(prisma));

  guarded.get('/students/me', childContext(prisma), students.me(prisma));

  // R77 — the caller's OWN notifications. No `childContext`: a notification is
  // addressed to a user, and a parent acting for a child reads the child's
  // calendar, not the child's mailbox (§4.3, R77.3).
  // R82.8 — the caller's OWN calendar: the same projection, narrowed to what
  // concerns her. `GET /calendar` stays the public, visibility-tier read.
  guarded.get('/me/calendar', calendar.readMine(prisma));
  guarded.get('/notifications', notifications.list(prisma));
  guarded.post('/notifications/:id/read', notifications.read(prisma));
  // R82.5 — the OPTIONAL send, after an event change is already saved. A
  // separate request against the saved row, so declining sends nothing and a
  // failure here can never roll back a change that succeeded.
  guarded.post('/events/:id/notify', notifications.notifyEventHandler(prisma));
  // R83.3 — the same decision for one occurrence: cancelling or moving a class
  // commits alone, and this is where the person chooses to tell anybody.
  guarded.post('/sessions/:id/notify', notifications.notifySessionHandler(prisma));

  guarded.get('/admin/approvals', approvals.list(prisma));
  guarded.post('/admin/approvals/:id/approve', approvals.approve(prisma));
  guarded.post('/admin/approvals/:id/reject', approvals.reject(prisma));
  // R56 — the stored event DEFINITIONS for the unified Scheduling list. `GET
  // /calendar` returns their expansion and remains the calendar's read.
  guarded.get('/events', events.list(prisma));
  guarded.post('/events', events.create(prisma));
  guarded.patch('/events/:id', events.update(prisma));

  // §5.7/TD-3.4 (Revisions 31–32) — recording the Ministry's official Hijri
  // announcements. Super Admin only, enforced in the service: the URL prefix is
  // not the boundary. No import route ships (§10.1).
  guarded.get('/admin/hijri-calendar', hijri.list(prisma));
  guarded.put('/admin/hijri-calendar/:year/:month', hijri.recordMonth(prisma));
  guarded.post('/admin/hijri-calendar/:year/publish', hijri.publish(prisma));
  guarded.post('/admin/hijri-calendar/:year/import', hijri.importYear(prisma));
  // R59.5 — the one Super-Admin-creatable entity that had no deletion at all.
  guarded.delete('/admin/hijri-calendar/:year/:month', hijri.deleteMonth(prisma));
  guarded.get('/admin/hijri-calendar/:year/history', hijri.history(prisma));
  // R71 — who answers for an event. Its own route because assigning staff is
  // its own capability (TD-2) and its own audit action, not an attribute edit.
  // **Before** the parameterised route, or `staff-options` is read as an id.
  guarded.get('/me/event-staff-options', events.staffOptions(prisma));
  guarded.get('/me/event-scope-options', events.scopeOptions(prisma));
  /**
   * NEW D — the caller's own filter/compose vocabulary. Beside
   * `/me/event-scope-options` because it is the same idea: ask the smaller
   * question rather than widen an admin read.
   */
  guarded.get('/me/scope-options', scopeOptions.read(prisma));
  guarded.put('/events/:id/staff', events.setStaff(prisma));
  guarded.delete('/events/:id', events.remove(prisma));
  guarded.get('/admin/branches/:id/event-backfill', events.listBackfill(prisma));
  guarded.post('/admin/branches/:id/event-backfill', events.applyBackfill(prisma));
  guarded.get('/students/:id/consents', consents.read(prisma));
  guarded.post('/students/:id/consents', consents.record(prisma));
  guarded.get('/students/:id/social-profile', socialProfile.read(prisma));
  guarded.put('/students/:id/social-profile', socialProfile.write(prisma));
  // **Two surfaces, two authorizations** (Owner clarification, 2026-08-28).
  //
  // `/admin/users` is global ACCOUNT administration — Super Admin only, asserted
  // in the service so every caller meets it. `/admin/directory` is the
  // operational people-picker an Admin needs to staff a class or fill a roster,
  // and it answers a deliberately smaller projection.
  guarded.get('/admin/directory', users.directory(prisma));
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
  guarded.post('/admin/platform-owner/transfer', users.transferOwner(prisma));
  // R111 — Super Admin only, on the same 3-day window as a self-deletion.
  // `?permanent=true` performs the de-identification now instead.
  guarded.delete('/admin/users/:id', users.remove(prisma));
  // NEW N — Super Admin only (OD-01's sub-decision), asserted in the service.
  guarded.get('/admin/partners', partners.list(prisma));
  guarded.post('/admin/partners', partners.create(prisma));
  guarded.patch('/admin/partners/:id', partners.update(prisma));
  guarded.delete('/admin/partners/:id', partners.remove(prisma));
  guarded.post('/family-links', familyLinks.create(prisma));
  guarded.delete('/admin/family-links/:id', familyLinks.revoke(prisma));
  guarded.get('/admin/branches', branch.listBranches(prisma));
  guarded.post('/admin/branches', branch.createBranch(prisma));
  // R76 — manual ordering as a contract. Declared BEFORE `/:id` so the literal
  // `order` segment cannot be captured as a branch id.
  guarded.patch('/admin/branches/order', branch.reorderBranches(prisma));
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
  guarded.patch('/admin/administrative-groups/order', administrativeGroups.reorderGroups(prisma));
  guarded.patch('/admin/administrative-groups/:id', administrativeGroups.update(prisma));
  guarded.delete('/admin/administrative-groups/:id', administrativeGroups.remove(prisma));
  // R74 — enrolment as the Level fact it is. NOT a second roster: the group
  // roster below is the per-group view of these same rows, and both place a
  // student through `enrolAtPlacement`.
  guarded.get('/admin/enrollments', enrollments.list(prisma));
  guarded.post('/admin/enrollments', enrollments.create(prisma));
  guarded.patch('/admin/enrollments/:id', enrollments.update(prisma));
  guarded.delete('/admin/enrollments/:id', enrollments.remove(prisma));

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
  //
  // **The FLAT read is a sibling of the nested one, not a replacement.** The
  // pair-addressed collection carries BR-22's unassigned alarm and cannot be
  // paginated; this one answers *what circles exist* across Levels and Subjects
  // so `حلقات المواد` can show its data before anything is chosen, and is
  // paginated because that question has no natural bound. Same rows, same
  // `assertCanManageMembership` gate, every parameter a narrowing filter.
  // Declared BEFORE the parameterised paths so no `:levelId` can shadow it.
  guarded.get('/admin/teaching-groups', teachingGroups.listAll(prisma));
  guarded.get(
    '/admin/levels/:levelId/subjects/:subjectId/teaching-groups',
    teachingGroups.list(prisma),
  );
  guarded.post(
    '/admin/levels/:levelId/subjects/:subjectId/teaching-groups',
    teachingGroups.create(prisma),
  );
  // Declared BEFORE `/:id`, like every other order route: Express matches in
  // declaration order and the literal would otherwise arrive as a parameter.
  guarded.patch('/admin/teaching-groups/order', teachingGroups.reorderGroups(prisma));
  guarded.patch('/admin/teaching-groups/:id', teachingGroups.update(prisma));
  guarded.delete('/admin/teaching-groups/:id', teachingGroups.remove(prisma));
  // The roster read completes a collection whose POST and DELETE were already
  // specified (TD-3.12) — its absence is why the DELETE below had no caller.
  guarded.get('/admin/teaching-groups/:id/members', teachingGroups.listMembers(prisma));
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
  // M4c — the Quran-side curriculum join (§4.5, §7, BR-11). Beside the Subject
  // one because it is the same kind of fact: Super Admin writes, Admin reads.
  guarded.get('/admin/quran-surahs', referenceData.quranSurahs(prisma));
  guarded.get('/admin/levels/:levelId/surahs', referenceData.levelSurahs(prisma));
  guarded.put('/admin/levels/:levelId/surahs/:surahId', referenceData.assignSurah(prisma));
  guarded.delete('/admin/levels/:levelId/surahs/:surahId', referenceData.unassignSurah(prisma));
  guarded.get('/admin/levels/:levelId/completion', quran.completion(prisma));

  guarded.get('/admin/levels/:levelId/subjects', referenceData.levelSubjects(prisma));
  guarded.put('/admin/levels/:levelId/subjects/:subjectId', referenceData.assignSubject(prisma));
  guarded.delete(
    '/admin/levels/:levelId/subjects/:subjectId',
    referenceData.unassignSubject(prisma),
  );

  /**
   * **R110 — the scheduling-type catalogue** (NEW H).
   *
   * `/order` is declared BEFORE `/:id`, or Express matches the literal path
   * against the parameter route and a reorder arrives as an update to a
   * schedule type whose id is the word "order" — the ordering every other
   * reorder route on this app already observes.
   */
  guarded.get('/admin/scheduling-types', schedulingTypes.list(prisma));
  guarded.post('/admin/scheduling-types', schedulingTypes.create(prisma));
  guarded.patch('/admin/scheduling-types/order', schedulingTypes.reorder(prisma));
  guarded.patch('/admin/scheduling-types/:id', schedulingTypes.update(prisma));
  guarded.delete('/admin/scheduling-types/:id', schedulingTypes.remove(prisma));

  // Curriculum taxonomy CRUD (§5.6 "Categories & Subjects" + "Levels", §14.1).
  // Admin reads, Super Admin writes (TD-2 R26) — enforced in the services, never
  // by the URL prefix. `POST /admin/levels` is TD-4.6b: it creates المجموعة 1 in
  // the same transaction, which is why it takes a `branch_id` the Level itself
  // does not store.
  guarded.get('/admin/categories', taxonomy.categories(prisma));
  guarded.post('/admin/categories', taxonomy.createCategoryHandler(prisma));
  guarded.patch('/admin/categories/order', taxonomy.reorderCategoriesHandler(prisma));
  guarded.patch('/admin/categories/:id', taxonomy.updateCategoryHandler(prisma));
  guarded.delete('/admin/categories/:id', taxonomy.deleteCategoryHandler(prisma));
  guarded.post('/admin/subjects', taxonomy.createSubjectHandler(prisma));
  guarded.patch('/admin/subjects/order', referenceData.reorderSubjectsHandler(prisma));
  guarded.patch('/admin/subjects/:id', taxonomy.updateSubjectHandler(prisma));
  guarded.delete('/admin/subjects/:id', taxonomy.deleteSubjectHandler(prisma));
  guarded.get('/admin/levels', taxonomy.levels(prisma));
  guarded.post('/admin/levels', taxonomy.createLevelHandler(prisma));
  guarded.patch('/admin/levels/order', taxonomy.reorderLevelsHandler(prisma));
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
  // R92 — one occurrence's audience, when two branches meet together. The
  // roster reports the venue and the audience as SEPARATE facts, because they
  // coincide for every occurrence but the combined one.
  guarded.get('/sessions/:id/roster', sessionsCtl.roster(prisma));
  guarded.put('/sessions/:id/audience-branches', sessionsCtl.setAudience(prisma));
  /**
   * **R98 — the door into an online class.**
   *
   * Not under `/admin/` and not under a portal prefix, for the reason the
   * sibling routes above give: a مستفيدة, a guardian acting for her child, a
   * مؤطِّرة and an administrator all reach the same occurrence, and the service
   * is the only place that knows which of them is asking.
   *
   * `childContext` is NOT mounted (see the controller): staff would be asked
   * for a header they have no reason to send. The §4.3 resolver is called
   * inside the service, for exactly the callers it governs.
   */
  guarded.post('/sessions/:id/online-join', onlineClassCtl.join(prisma, onlineClass));
  /**
   * **R99 — recording is OPTIONAL and EXPLICIT.**
   *
   * Separate routes from the join, deliberately: `دخول الحصة` must never start
   * a recording, and a flag on the join would be exactly the coupling R99.2
   * forbids. Starting and stopping require teaching authority; **reading the
   * state does not**, because every participant must see «جاري التسجيل»
   * including a beneficiary who arrived after it began (R99.5).
   */
  guarded.post('/sessions/:id/recording', recordingCtl.start(prisma, onlineClass));
  guarded.post('/sessions/:id/recording/stop', recordingCtl.stop(prisma, onlineClass));
  guarded.get('/sessions/:id/recording', recordingCtl.state(prisma));
  guarded.post('/sessions/:id/content', sessionsCtl.linkContent(prisma));
  guarded.delete('/sessions/:id/content/:contentId', sessionsCtl.unlinkContent(prisma));

  // TD-3.5 storage. The browser PUTs straight to MinIO through a presigned URL,
  // so the file never passes through this process (§2.3) — these routes decide
  // and verify, they do not carry bytes. `:uploadId` is the signed ticket itself
  // (`lib/upload-token.ts`), which is why no pending-upload table exists.
  guarded.post('/uploads/initiate', contentCtl.initiate(prisma, storage, config));
  guarded.post('/uploads/:uploadId/complete', contentCtl.complete(prisma, storage, config));
  guarded.post('/uploads/:uploadId/abort', contentCtl.abort(prisma, storage, config));
  // R53: replacement reuses the upload flow (`replaces_content_id`); deletion is
  // its own route because it moves no bytes in.
  guarded.patch('/content/:id', contentCtl.update(prisma, storage));
  guarded.delete('/content/:id', contentCtl.remove(prisma, storage));
  // TD-12: minting is one of the high-risk operations where an unexpired token
  // is not sufficient — the service re-asserts the caller against live rows.
  guarded.get('/content/:id/download-url', contentCtl.downloadUrl(prisma, storage));

  // TD-3.6 (R58) — exams as SCHEDULED SITTINGS. Only `physical` exists; the
  // online mode is refused with a coded reason rather than given an endpoint
  // that does nothing, because a route with nothing behind it appears in the
  // contract as a capability that exists.
  guarded.get('/exams', exams.list(prisma));
  guarded.post('/exams', exams.create(prisma));
  guarded.patch('/exams/:id', exams.update(prisma));
  guarded.delete('/exams/:id', exams.remove(prisma));

  // §4.6 grading (M5a, R70). Nested under the exam because a grade cannot exist
  // without one — `Grade.exam_id` is NOT NULL with `ON DELETE RESTRICT`, and the
  // path says so. Entering and publishing are separate routes because R70.4
  // made them separate capabilities.
  guarded.get('/exams/:id/grades', grades.sheet(prisma));
  guarded.put('/exams/:id/grades', grades.save(prisma));
  guarded.post('/exams/:id/grades/publish', grades.publish(prisma));

  // §5.3 — **the student's own published grades.** TD-3.3 already names *grades*
  // among the student-context reads resolved per §4.3, and `/students/me/quran`
  // below ships under the same clause: `childContext` resolves the subject and
  // the path carries no id, which is what stops a caller naming another student
  // (TD-12, the property R63.3 argued for). PUBLISHED only — a draft is a
  // مؤطرة's working note (BR-8) and is absent from the query, not filtered out
  // of its result.
  guarded.get('/students/me/grades', childContext(prisma), grades.myGrades(prisma));

  // §4.5 Quran memorization (M4a, R73). The coverage read hangs off the student
  // because that is what it is about; the logs are their own collection because
  // a correction names one log, not a student.
  // M4b — the student's own read. `childContext` resolves the subject; the
  // path carries no id, which is what stops a caller naming another student.
  guarded.get('/students/me/quran', childContext(prisma), quran.myCoverage(prisma));
  guarded.get('/quran-students', quran.students(prisma));
  guarded.get('/students/:id/quran', quran.coverage(prisma));
  guarded.post('/quran-logs', quran.create(prisma));
  guarded.patch('/quran-logs/:id', quran.update(prisma));
  guarded.delete('/quran-logs/:id', quran.remove(prisma));

  api.use(guarded);

  app.use('/api/v1', api);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
