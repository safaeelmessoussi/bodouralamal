import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { RefreshRevokedReason } from '../generated/prisma/enums.js';
import { AppError } from '../lib/errors.js';
import * as audit from '../repositories/audit.repository.js';
import { assertFreshActive } from '../policies/freshness.policy.js';
import { revokeAllSessions } from './refresh-token.service.js';
import { ACCOUNT_PURGE_WINDOW_DAYS, snapshot } from '../repositories/trash.repository.js';

/**
 * **Deleting an account (R111, and the Owner's clarification of 2026-08-28).**
 *
 * ## The one idea everything here follows from
 *
 * Thirty-five foreign keys reference `"user"`, and **twenty-six of them must
 * outlive the account**: grades, Quran progress, enrolment, consent,
 * safeguarding applications, guardianship, staffing history, audit. Thirty-two
 * are `RESTRICT` and `CASCADE` is forbidden in terms, so the row **cannot** be
 * removed — and nulling those columns would destroy the link that makes the
 * surviving record mean anything. *A grade with no student* is corrupted, not
 * preserved.
 *
 * > **So deletion is the DE-IDENTIFICATION of a row that continues to exist.**
 *
 * That is why thirty-five separate decisions collapse onto the columns of `user`
 * itself plus a small set of satellites: everything else keeps pointing at a row
 * that is still there and no longer identifies anybody.
 *
 * ## Two steps, two windows
 *
 * **Soft delete** marks the account `deleted`, revokes every live session and
 * files a Trash row on a **three-day** window. The person is locked out at once
 * — `assertFreshActive` refuses any status that is not `active` — and can be
 * restored for three days.
 *
 * **Permanent delete** performs the de-identification now instead of after three
 * days. It is the same operation the window would eventually reach, not a
 * stronger one, and it never removes a row.
 *
 * BR-15's ninety-day Trash window is **untouched**. R111 adds a second, shorter
 * window for one entity type; the two answer different questions and merging
 * them would silently move one of them.
 */

/** Who may be asked to delete somebody else's account. */
const ACCOUNT_ADMIN_ROLES = ['super_admin'] as const;

/**
 * **The tombstone's name**, ratified by the Owner on 2026-08-27.
 *
 * One wording everywhere it appears, including on a preserved grade or an
 * attendance row a مؤطِّرة can still read. It says two true things at once: the
 * record survives, and the person's details were removed. A per-role variant
 * («مستفيدة سابقة» / «مؤطِّرة سابقة») was considered and rejected — it says what
 * somebody *was* rather than what happened to the account.
 */
export const DELETED_ACCOUNT_NAME = 'حساب محذوف';

/**
 * **R111 §3.3 — live responsibility blocks deletion, and says what to reassign.**
 *
 * Split by **time**, not by table. `SessionStaff`, `EventStaff` and `ExamStaff`
 * rows in the past are preserved history — R43.4 and R91 forbid rewriting who
 * actually delivered a class — while the same tables in the future describe an
 * obligation nobody would be holding.
 *
 * The sharpest case is a **responsible** principal on a hidden activity: R109
 * resolves `hidden` to *the responsible person + Super Admin*, so deleting her
 * would leave the item visible to **nobody at all**. It would not lose an owner;
 * it would disappear.
 *
 * The refusal **names what must move**. The Owner chose refuse-with-explanation
 * over reassign-in-the-same-action: the explanation is the feature, and
 * reassignment keeps its own authorization and its own audit.
 */
export async function assertNoLiveResponsibilities(
  tx: Prisma.TransactionClient,
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  /**
   * **Two steps per kind, rather than one query with a nested relation filter.**
   *
   * The nested form (`schedule: { deletedAt: null }`) is the obvious way to
   * write this and it is not what ships: under this Prisma/adapter version it
   * was rejected at runtime — `Unknown argument deletedAt` — inside the request
   * path, while the identical query succeeded from a script against the same
   * client in the same container. Rather than ship a construction whose
   * behaviour I could not explain, the check reads the staffing rows and then
   * asks about their parents by id.
   *
   * It is also plainly readable: *these are the things she staffs; which of them
   * are still live?* Two indexed queries against small sets, on a path that runs
   * once per deletion.
   */
  const liveCount = async (
    ids: string[],
    count: (ids: string[]) => Promise<number>,
  ): Promise<number> => (ids.length === 0 ? 0 : count(ids));

  const [scheduleRows, sessionRows, eventRows, examRows] = await Promise.all([
    tx.courseScheduleStaff.findMany({
      where: { userId, deletedAt: null },
      select: { scheduleId: true },
    }),
    tx.sessionStaff.findMany({
      where: { userId, deletedAt: null },
      select: { sessionId: true },
    }),
    // Only the RESPONSIBLE position blocks. R71's responsible/assistant
    // asymmetry is deliberate and is NOT §4.4c's operational parity rule — an
    // assistant on a future event leaves it owned, and visible.
    tx.eventStaff.findMany({
      where: { userId, deletedAt: null, position: 'responsible' },
      select: { eventId: true },
    }),
    tx.examStaff.findMany({
      where: { userId, deletedAt: null },
      select: { examId: true },
    }),
  ]);

  const [schedules, sessions, events, exams] = await Promise.all([
    // A recurring class she teaches. Bounded by the schedule's own life rather
    // than by a date: a live schedule with no end is precisely the blocking case.
    liveCount([...new Set(scheduleRows.map((r) => r.scheduleId))], (ids) =>
      tx.recurringCourseSchedule.count({ where: { id: { in: ids }, deletedAt: null } }),
    ),
    liveCount([...new Set(sessionRows.map((r) => r.sessionId))], (ids) =>
      tx.session.count({ where: { id: { in: ids }, deletedAt: null, date: { gte: today } } }),
    ),
    liveCount([...new Set(eventRows.map((r) => r.eventId))], (ids) =>
      tx.event.count({ where: { id: { in: ids }, deletedAt: null, date: { gte: today } } }),
    ),
    liveCount([...new Set(examRows.map((r) => r.examId))], (ids) =>
      tx.exam.count({ where: { id: { in: ids }, deletedAt: null, date: { gte: today } } }),
    ),
  ]);

  const blocking = [
    { label: 'course_schedules', count: schedules },
    { label: 'future_sessions', count: sessions },
    { label: 'responsible_for_events', count: events },
    { label: 'future_exams', count: exams },
  ].filter((entry) => entry.count > 0);

  if (blocking.length > 0) {
    // TD-5's shape: a refused deletion is a 409 naming its dependencies, never a
    // 403 and never a silent no-op.
    throw new AppError('STATE_CONFLICT', 'account holds live responsibilities', {
      reason: 'RESPONSIBILITIES_ASSIGNED',
      blocked_by: Object.fromEntries(blocking.map((entry) => [entry.label, entry.count])),
    });
  }
}

/**
 * **Refuses the removal of the last active Super Admin.**
 *
 * The platform's existing `LAST_SUPER_ADMIN` guard, applied to deletion rather
 * than rewritten: Revision 22's lockout recovery requires `DATABASE_URL` and a
 * manual seed run on the VPS, which is a sanctioned *recovery* and not something
 * a back-office control may produce with one click.
 */
async function assertNotLastActiveSuperAdmin(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  const isSuperAdmin = await tx.userBranchRole.count({
    where: { userId, deletedAt: null, role: { name: 'super_admin' } },
  });
  if (isSuperAdmin === 0) return;

  const remaining = await tx.user.count({
    where: {
      id: { not: userId },
      accountStatus: 'active',
      deletedAt: null,
      branchRoles: { some: { deletedAt: null, role: { name: 'super_admin' } } },
    },
  });
  if (remaining === 0) {
    throw new AppError('STATE_CONFLICT', 'this is the last active Super Admin', {
      reason: 'LAST_SUPER_ADMIN',
    });
  }
}

/** What the Trash row carries, so a restore has something to restore from. */
function tombstoneSnapshot(user: {
  nameArabic: string;
  nameFrench: string | null;
  nickname: string | null;
  phone: string | null;
  preProvisionedEmail: string | null;
  accountStatus: string;
}): object {
  return {
    name_arabic: user.nameArabic,
    name_french: user.nameFrench,
    nickname: user.nickname,
    phone: user.phone,
    pre_provisioned_email: user.preProvisionedEmail,
    account_status: user.accountStatus,
  };
}

async function softDelete(
  prisma: PrismaClient,
  targetId: string,
  actor: { userId: string; activeRole?: string | null },
  selfService: boolean,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findFirst({
      where: { id: targetId, deletedAt: null },
      select: {
        id: true,
        nameArabic: true,
        nameFrench: true,
        nickname: true,
        phone: true,
        preProvisionedEmail: true,
        accountStatus: true,
      },
    });
    if (!user) throw new AppError('NOT_FOUND', 'no such account');

    await assertNotLastActiveSuperAdmin(tx, targetId);
    await assertNoLiveResponsibilities(tx, targetId);

    const now = new Date();
    await tx.user.update({
      where: { id: targetId },
      /**
       * **`deleted_at`, and NOT a fifth `account_status` value.**
       *
       * The schema records this decision at the enum itself: *TD-1's `Deleted`
       * state is represented by `deleted_at IS NOT NULL` rather than a fifth
       * enum value, so a soft-deleted user has exactly one source of truth
       * instead of two that can disagree.* A `deleted` status was drafted here
       * and reverted — it would have created precisely the pair that can
       * disagree, and nothing needs it: `assertFreshActive` filters
       * `deletedAt: null`, `routeByStatus` tests it before it reads the status,
       * and every list already excludes soft-deleted rows.
       */
      data: { deletedAt: now, deletedById: actor.userId },
    });

    // **Three days, not ninety** — stated by the caller that owns the rule.
    await snapshot(
      tx,
      {
        targetEntity: 'User',
        targetId,
        snapshot: tombstoneSnapshot(user),
        deletedById: actor.userId,
      },
      now,
      ACCOUNT_PURGE_WINDOW_DAYS,
    );

    await audit.write(tx, {
      actorUserId: actor.userId,
      ...(actor.activeRole ? { activeRole: actor.activeRole } : {}),
      actionType: 'user.delete',
      targetEntity: 'User',
      targetId,
      // R106's precedent: the trail must distinguish an act somebody took on
      // themselves from one an administrator took on them.
      detail: { self_service: selfService, purge_after_days: ACCOUNT_PURGE_WINDOW_DAYS },
    });

    // TD-4.15's mechanism, in the same transaction: the account is unreachable
    // immediately, not when the purge runs three days later.
    await revokeAllSessions(tx, {
      userId: targetId,
      // The enum already had this value — R111 needed no new one, and adding a
      // synonym would have split one fact across two names.
      reason: RefreshRevokedReason.user_deleted,
      actorUserId: actor.userId,
      ...(actor.activeRole ? { activeRole: actor.activeRole } : {}),
    });
  });
}

/**
 * `DELETE /profile` — **anyone may delete their own account** (Owner,
 * 2026-08-28): Student, Teacher, Admin and Super Admin alike.
 *
 * No role gate, deliberately. The subject is the JWT `sub`, so there is nowhere
 * for a caller to name someone else, and holding a role has never been a reason
 * to be unable to leave. What a role can do is make the account **blocked** —
 * a مؤطِّرة with live classes, or the last active Super Admin — and both refusals
 * name what has to change first.
 */
export async function deleteOwnAccount(
  prisma: PrismaClient,
  caller: { userId: string; activeRole?: string | null },
): Promise<void> {
  await softDelete(prisma, caller.userId, caller, true);
}

/**
 * `DELETE /admin/users/{id}` — **Super Admin only** (Owner, 2026-08-28), on the
 * **same three-day window** as a self-deletion.
 *
 * One rule and one mechanism: the person is signed out immediately while the
 * account stays restorable, so a deletion clicked by mistake is recoverable —
 * which an immediate purge would not be.
 */
export async function deleteUserAccount(
  prisma: PrismaClient,
  caller: { userId: string; activeRole?: string | null },
  targetId: string,
): Promise<void> {
  await assertFreshActive(prisma, caller.userId, ACCOUNT_ADMIN_ROLES, caller.activeRole ?? undefined);
  await softDelete(prisma, targetId, caller, false);
}

/**
 * **The de-identification itself** — R111 §4's tombstone.
 *
 * The row survives with its structural columns intact and its identifying ones
 * cleared. Structural, and why each stays:
 *
 * * **`id`** — twenty-two relationships point at it;
 * * **`sex`** — §4.4b's Level restrictions are evaluated against it, so a
 *   preserved enrolment must still make sense;
 * * **`account_status`** — left as it was. `deleted_at` is TD-1's Deleted state
 *   (the schema says so at the enum), and a second field saying the same thing
 *   is a second field that can disagree;
 * * **`created_at`** — the record's own age;
 * * **`is_beneficiary`** — R79.7's durable fact about what this record *was*.
 *
 * **The TD-10 shadow columns look after themselves**, and that had to be
 * checked rather than assumed: leaving a populated `name_arabic_normalized`
 * behind a cleared `name_arabic` would keep the person findable by search — the
 * one place the omission would show on no screen. They are maintained by
 * `user_search_shadow_sync_trigger`, so they follow the columns they shadow and
 * now hold the normalized marker. The original is unreachable through them.
 *
 * **The satellites in R111 §3.1 are deleted**, and the normalized-email lock is
 * released: it exists to stop two accounts claiming one address, and holding it
 * against a purged account would silently refuse a genuine new registration,
 * which OD-07 permits.
 *
 * Idempotent by construction — every write is an assignment to a fixed value or
 * a delete of rows that may already be gone — because a de-identification that
 * half-ran is worse than one that has not run, and the purge job must be safe to
 * execute twice.
 */
export async function deIdentifyAccount(
  prisma: PrismaClient,
  actor: { userId: string; activeRole?: string | null },
  targetId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: targetId },
      select: { id: true, preProvisionedEmail: true, identities: { select: { email: true } } },
    });
    if (!user) throw new AppError('NOT_FOUND', 'no such account');

    // Every address this account ever claimed, so the lock is released for all
    // of them rather than for whichever one happened to be current.
    const addresses = [
      ...user.identities.map((i) => i.email),
      ...(user.preProvisionedEmail ? [user.preProvisionedEmail] : []),
    ].map((e) => e.toLowerCase());

    await tx.user.update({
      where: { id: targetId },
      data: {
        nameArabic: DELETED_ACCOUNT_NAME,
        nameFrench: null,
        nickname: null,
        publicDisplayName: null,
        phone: null,
        preProvisionedEmail: null,
        // **The TD-10 shadow columns are NOT set here, and that is deliberate.**
        // `user_search_shadow_sync_trigger` owns them: they track whatever the
        // columns they shadow contain, so writing them would be overwritten in
        // the same statement. Because the names above are now the marker, the
        // shadows hold the normalized marker — the original is gone from them,
        // which is the property that matters. Setting them explicitly would
        // look like the safeguard and be decoration.
      },
    });

    // R111 §3.1 — credentials and planning data. None of it carries
    // institutional meaning, and `user_identity` in particular must go or the
    // identity could never be registered again (OD-07).
    await tx.userIdentity.deleteMany({ where: { userId: targetId } });
    await tx.userBranchRole.deleteMany({ where: { userId: targetId } });
    await tx.teacherAvailability.deleteMany({ where: { userId: targetId } });
    await tx.teacherSubjectCapability.deleteMany({ where: { userId: targetId } });
    await tx.teacherCategoryCapability.deleteMany({ where: { userId: targetId } });
    await tx.studentSocialProfile.deleteMany({ where: { studentId: targetId } });
    await tx.notification.deleteMany({ where: { userId: targetId } });
    if (addresses.length > 0) {
      await tx.normalizedEmailLock.deleteMany({ where: { email: { in: addresses } } });
    }

    await audit.write(tx, {
      actorUserId: actor.userId,
      ...(actor.activeRole ? { activeRole: actor.activeRole } : {}),
      actionType: 'user.deidentify',
      targetEntity: 'User',
      targetId,
      // **Which fields, never their values** (§14, no PII in logs) — an audit row
      // recording what was cleared must not become the last copy of it.
      detail: { cleared: ['name', 'contact', 'identity', 'planning_data'] },
    });
  });
}

/**
 * `DELETE /admin/users/{id}?permanent=true` — **Super Admin only.**
 *
 * The de-identification the three-day window would eventually reach, performed
 * now. **Not a stronger operation**: it removes no row, and every preserved
 * relationship is preserved exactly as it would have been.
 *
 * The same two refusals apply — the last active Super Admin, and live staff
 * responsibilities — because *sooner* must not mean *with fewer checks*.
 */
export async function purgeUserAccount(
  prisma: PrismaClient,
  caller: { userId: string; activeRole?: string | null },
  targetId: string,
): Promise<void> {
  await assertFreshActive(
    prisma,
    caller.userId,
    ACCOUNT_ADMIN_ROLES,
    caller.activeRole ?? undefined,
  );

  await prisma.$transaction(async (tx) => {
    await assertNotLastActiveSuperAdmin(tx, targetId);
    await assertNoLiveResponsibilities(tx, targetId);
  });

  // Soft-delete first when the account is still live, so the sequence is the
  // same one the window produces and there is no second path to reason about.
  const live = await prisma.user.findFirst({
    where: { id: targetId, deletedAt: null },
    select: { id: true },
  });
  if (live) await softDelete(prisma, targetId, caller, false);

  await deIdentifyAccount(prisma, caller, targetId);
}
