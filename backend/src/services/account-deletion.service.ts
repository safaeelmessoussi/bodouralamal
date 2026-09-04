import { randomUUID } from 'node:crypto';

import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { accountPurposes } from '../policies/guardian-purpose.js';
import { RefreshRevokedReason } from '../generated/prisma/enums.js';
import { AppError } from '../lib/errors.js';
import * as audit from '../repositories/audit.repository.js';
import * as users from '../repositories/user.repository.js';
import { assertFreshActive } from '../policies/freshness.policy.js';
import { revokeAllSessions } from './refresh-token.service.js';
import { ACCOUNT_PURGE_WINDOW_DAYS, snapshot } from '../repositories/trash.repository.js';
import { lockAndAssertNotPlatformOwner } from './platform-owner.service.js';

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
      where: {
        userId,
        deletedAt: null,
        OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: today } }],
      },
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
      tx.recurringCourseSchedule.count({
        where: {
          id: { in: ids },
          deletedAt: null,
          OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: today } }],
        },
      }),
    ),
    liveCount([...new Set(sessionRows.map((r) => r.sessionId))], (ids) =>
      tx.session.count({ where: { id: { in: ids }, deletedAt: null, date: { gte: today } } }),
    ),
    liveCount([...new Set(eventRows.map((r) => r.eventId))], (ids) =>
      tx.event.count({
        where: {
          id: { in: ids },
          deletedAt: null,
          // One-off and multi-day activities end at `end_date` (or their
          // start when no end is present); recurring activities remain live
          // through `recurrence_end_date`. Event has no `date` column.
          OR: [
            { endDate: { gte: today } },
            { endDate: null, startDate: { gte: today } },
            { recurrenceEndDate: { gte: today } },
          ],
        },
      }),
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

  // The User caller is already locked. The shared Role row serializes this
  // platform-wide invariant against deletion, suspension and role removal of a
  // different administrator.
  if (!(await users.lockRole(tx, 'super_admin'))) {
    throw new Error('super_admin role is not configured');
  }

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
  /**
   * **An extra refusal, evaluated under the SAME row lock as the deletion.**
   *
   * The guardian-only closure needs to know that the account has no remaining
   * purpose, and *knowing it a moment earlier is not the same thing*: between a
   * separate check and this transaction, any staffing writer could give the
   * account a purpose, and every one of them contends on exactly the lock taken
   * below. Passing the check in here is what makes the two atomic, and it costs
   * one optional parameter rather than a second closure path.
   */
  precondition?: (tx: Prisma.TransactionClient) => Promise<void>,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockAndAssertNotPlatformOwner(tx, targetId);
    // Shared with every staffing writer and with new-session issuance. If a
    // concurrent assignment wins, the responsibility query below sees it and
    // refuses deletion; if deletion wins, the assignment re-reads this User as
    // unavailable and refuses instead.
    if (!(await users.lockUser(tx, targetId))) {
      throw new AppError('NOT_FOUND', 'no such account');
    }
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
    /**
     * **After the existence check, deliberately.** Run before it, a repeat
     * against an already-closed account reports *«still has a purpose»* carrying
     * an EMPTY purpose list — the guard's own early return for a soft-deleted
     * row — which is both untrue and unactionable. That the account is already
     * gone is the more specific answer, and the one a caller can act on.
     */
    if (precondition) await precondition(tx);

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
 *   preserved enrolment must still make sense. **`birth_date` is NOT in this
 *   list and is cleared** (Owner, 2026-09-04): nothing in the archive reads
 *   one, which is exactly the test this list applies;
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
 * **The satellites in R111 §3.1 are deleted**, and normalized-email ownership
 * is released: the stable lock row owns nothing and remains to serialize the
 * next claimant, while both authoritative ownership channels are cleared so a
 * purged account cannot refuse the genuine new registration OD-07 permits.
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
    // Read only the email coordinates first because the global authentication
    // hierarchy is Email -> User. The complete row is re-read only after both
    // governing locks are held; using this optimistic read for the mutation
    // would let a concurrent Trash restore revive the account in between.
    const locator = await tx.user.findUnique({
      where: { id: targetId },
      select: {
        id: true,
        preProvisionedEmail: true,
        identities: { select: { email: true } },
      },
    });
    if (!locator) throw new AppError('NOT_FOUND', 'no such account');

    // Every address this account currently claims. Acquire the SAME stable
    // cross-table locks as registration, provisioning and binding before
    // clearing those claims. Deleting a lock row is not "releasing" an email:
    // the row deliberately carries no owner. Deleting it while another writer
    // waits can instead make that writer wake up to no row and fail. Ownership
    // is released by clearing the two authoritative channels below; the stable
    // lock row remains available to serialize the next claimant.
    const addresses = [...new Set([
      ...locator.identities.map((i) => i.email),
      ...(locator.preProvisionedEmail ? [locator.preProvisionedEmail] : []),
    ].map((e) => e.toLowerCase()))].sort();
    for (const address of addresses) {
      await users.lockNormalizedEmail(tx, address);
    }

    // Global lock order for lifecycle mutations is PlatformOwner -> User. This
    // follows the email locks here because transfer never takes an email lock,
    // while identity binding does not take the ownership lock.
    await lockAndAssertNotPlatformOwner(tx, targetId);

    // Authentication binds in Email -> User order, so permanent
    // de-identification does the same. The account is already soft-deleted,
    // which prevents any staffing writer from naming it while this waits.
    if (!(await users.lockUser(tx, targetId))) {
      throw new AppError('NOT_FOUND', 'no such account');
    }

    const user = await tx.user.findUnique({
      where: { id: targetId },
      select: {
        nameArabic: true,
        firstNameArabic: true,
        lastNameArabic: true,
        nameFrench: true,
        firstNameFrench: true,
        lastNameFrench: true,
        nickname: true,
        publicDisplayName: true,
        phone: true,
        birthDate: true,
        referenceCode: true,
        schoolingStage: true,
        intendedBranchId: true,
        intendedCategoryId: true,
        requestedRole: true,
        preProvisionedEmail: true,
        deletedAt: true,
        identities: { select: { id: true } },
      },
    });
    if (!user) throw new AppError('NOT_FOUND', 'no such account');
    if (user.deletedAt === null) {
      // Most importantly, a purge that lost a race with restoration must not
      // erase the newly restored live account. Manual permanent deletion also
      // passes through softDelete first, so every legitimate caller arrives
      // here with a tombstone.
      throw new AppError('STATE_CONFLICT', 'the account is not deleted', {
        reason: 'NOT_DELETED',
      });
    }

    const trashBefore = await tx.trash.count({
      where: { targetEntity: 'User', targetId },
    });
    const hadIdentitySurface =
      user.nameArabic !== DELETED_ACCOUNT_NAME ||
      [
        user.firstNameArabic,
        user.lastNameArabic,
        user.nameFrench,
        user.firstNameFrench,
        user.lastNameFrench,
        user.nickname,
        user.publicDisplayName,
        user.phone,
        // **`birth_date` IS counted** (Owner decision, 2026-09-04), for the
        // mirror of the reason `referenceCode` is not: this operation clears
        // it, and the predicate must name exactly the fields it clears. A
        // cleared field missing from here makes the retry look like a no-op
        // when it was not; an uncleared field present here makes every retry
        // look like fresh work.
        user.birthDate,
        // **`referenceCode` is deliberately ABSENT here** (Revision 131). It is
        // no longer cleared, so counting it would make this predicate
        // permanently true — and every retry would then rotate `qr_ref` again
        // and write a second `user.deidentify` row, turning an idempotent job
        // into one that looks like repeated human decisions. The predicate must
        // only name fields this operation actually clears.
        user.schoolingStage,
        user.intendedBranchId,
        user.intendedCategoryId,
        user.requestedRole,
        user.preProvisionedEmail,
      ].some((value) => value !== null) ||
      user.identities.length > 0;

    await tx.user.update({
      where: { id: targetId },
      data: {
        nameArabic: DELETED_ACCOUNT_NAME,
        firstNameArabic: null,
        lastNameArabic: null,
        nameFrench: null,
        firstNameFrench: null,
        lastNameFrench: null,
        nickname: null,
        publicDisplayName: null,
        phone: null,
        /**
         * **`birth_date` IS cleared** (Owner decision, 2026-09-04).
         *
         * R130 made it required for every beneficiary, which left open whether
         * it belonged to the account or to the preserved educational archive.
         * The Owner's answer is the account: **the retained archive does not
         * technically depend on it**, and `referenceCode` is already the
         * protected pseudonymous locator that reconnects a returning person
         * with her history — a date of birth adds nothing the archive needs and
         * is one of the most identifying fields the row holds.
         *
         * **Removed, never transformed.** No year-only truncation, no age
         * snapshot, no derived band: each of those is a new fact about the
         * person invented at the moment of erasure, and R130's own rule is that
         * a birth date is recorded or absent, never approximated.
         *
         * Note the asymmetry with `sex`, which stays: §4.4b evaluates Level
         * restrictions against it, so a preserved enrolment stops making sense
         * without it. Nothing in the archive reads a birth date.
         */
        birthDate: null,
        /**
         * **`referenceCode` SURVIVES — it is not cleared** (Revision 131,
         * resolving the R111 ↔ R122 contradiction).
         *
         * R122 committed the association to answering *«كنت أدرس عندكم وأريد
         * شهادة تثبت المستوى الذي وصلت إليه»* years later; R111 cleared every
         * field that could match a returning person to her preserved record,
         * including this one, and neither cited the other. The Owner's
         * resolution: **Option A keeps the code**, as part of the protected
         * minimal educational archive, because it is what reconnects a former
         * beneficiary with her own history. **Option B deletes it** — and
         * Option B is not implemented.
         *
         * **It is not anonymous.** The archive is pseudonymous, not anonymous,
         * merely because the login is gone, and the code is protected as
         * personal data.
         *
         * **It grants nothing** (R62.5, R132). It is a LOCATOR: it is not
         * authentication, not proof of identity, not authorization and not
         * account recovery. Two clauses already make that structural rather
         * than a promise, and both are asserted by test — a self-managed claim
         * resolves a beneficiary only `WHERE deleted_at IS NULL`, and a closed
         * account is by definition soft-deleted, so quoting the code of a
         * closed account finds nothing and answers the same uniform refusal as
         * a code that never existed.
         *
         * **It is never reissued**: `allocateReferenceCode` counts rows
         * regardless of `deleted_at`, so a preserved code stays taken and no
         * future beneficiary can be given it.
         */
        schoolingStage: null,
        intendedBranchId: null,
        intendedCategoryId: null,
        requestedRole: null,
        preProvisionedEmail: null,
        // A printed QR is an external correlate of the person even though the
        // UUID is not secret and grants no authority. Rotate it on the first
        // de-identification so an old card no longer resolves the tombstone;
        // retain the rotated value on retries to keep the operation idempotent.
        // The Trash row distinguishes a first de-identification from an
        // idempotent retry even when somebody's legitimate recorded name was
        // already exactly «حساب محذوف» and every optional field was empty.
        ...(trashBefore > 0 || hadIdentitySurface ? { qrRef: randomUUID() } : {}),
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
    const removed = [
      await tx.userIdentity.deleteMany({ where: { userId: targetId } }),
      await tx.framingPreferenceBranch.deleteMany({ where: { userId: targetId } }),
      await tx.framingPreference.deleteMany({ where: { userId: targetId } }),
      await tx.userBranchRole.deleteMany({ where: { userId: targetId } }),
      await tx.refreshToken.deleteMany({ where: { userId: targetId } }),
      await tx.refreshSession.deleteMany({ where: { userId: targetId } }),
      await tx.rateLimitCounter.deleteMany({ where: { userId: targetId } }),
      await tx.teacherAvailability.deleteMany({ where: { userId: targetId } }),
      await tx.teacherSubjectCapability.deleteMany({ where: { userId: targetId } }),
      await tx.teacherCategoryCapability.deleteMany({ where: { userId: targetId } }),
      await tx.notification.deleteMany({ where: { userId: targetId } }),
    ];

    // The recoverable Trash snapshot necessarily contains the fields needed to
    // undo a soft delete. Once de-identification is final it must disappear in
    // the SAME transaction, or the supposedly-erased name, phone and email live
    // on indefinitely in JSONB and the Trash still offers a false restoration.
    const removedTrash = await tx.trash.deleteMany({
      where: { targetEntity: 'User', targetId },
    });

    // A retry after full convergence writes no second audit fact. Duplicate
    // "deidentified" entries would make an idempotent job look like two human
    // decisions; satellite residue from an older/partial implementation still
    // counts as work and therefore remains auditable.
    if (
      hadIdentitySurface ||
      removedTrash.count > 0 ||
      removed.some((result) => result.count > 0)
    ) {
      await audit.write(tx, {
        actorUserId: actor.userId,
        ...(actor.activeRole ? { activeRole: actor.activeRole } : {}),
        actionType: 'user.deidentify',
        targetEntity: 'User',
        targetId,
        // **Which fields, never their values** (§14, no PII in logs) — an audit row
        // recording what was cleared must not become the last copy of it.
        // `birth_date` is named as a FIELD, never valued (Owner, 2026-09-04).
        detail: { cleared: ['name', 'contact', 'identity', 'birth_date', 'planning_data'] },
      });
    }
  });
}

/**
 * **Guardian-only cleanup** — `POST /admin/users/{id}/close-guardian-only`,
 * **Super Admin only** (Owner decision, 2026-09-04).
 *
 * §4.3 says a guardian-only account is closed through the established machinery
 * once its last child-management purpose is deliberately removed and no other
 * purpose remains. **Which event triggers that was the open question**, and the
 * Owner's answer for the MVP is: none of them. Revoking the last approved link,
 * a Trash row expiring and deleting the last child are materially different
 * events, and attaching an irreversible consequence to whichever one somebody
 * happened to pick is how an account gets closed by accident. It is an explicit
 * decision a Super Admin takes, and the guard refuses it if the account still
 * has any reason to exist.
 *
 * **No new closure path.** This is `purgeUserAccount` with one extra refusal —
 * the same soft delete, the same de-identification, the same audit, the same
 * idempotence. A second implementation of account closure is exactly the thing
 * that would eventually disagree with the first about what "closed" means.
 *
 * **The guard runs under the deletion's own row lock**, not before it. Every
 * writer that could give this account a purpose contends on that lock, so a
 * check performed a moment earlier would be a check of a state that may no
 * longer hold. `softDelete`'s `precondition` is what makes them one operation.
 *
 * **No scheduling and no grace period** beyond the ordinary three-day window
 * this reuses, and **no child record is touched**: the purposes are read, never
 * removed. An account with a purpose is refused, not emptied until it qualifies.
 */
export async function closeGuardianOnlyAccount(
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

  await softDelete(prisma, targetId, caller, false, async (tx) => {
    const report = await accountPurposes(tx, targetId);
    if (!report.closable) {
      /**
       * **The purposes are named to the caller**, unlike most refusals on this
       * platform. §20 rule 17's uniform-404 rule exists to stop an outsider
       * learning whether a record exists; this caller is a Super Admin who is
       * already looking at the account, and *«which purpose is stopping me»* is
       * the only thing that tells them what to do next. Withholding it here
       * would protect nobody and produce a dead end.
       *
       * **On `blocked_by`, which is the channel the UI already reads.** A
       * remaining purpose IS a dependency blocking a deletion, which is exactly
       * the question `BlockedNotice` answers everywhere else — so it arrives in
       * that shape and gets the translated labels and the label guard for free.
       * It emitted a bespoke `purposes` array first, and the browser run found
       * what that costs: the refusal rendered as a generic failure, the dead end
       * this comment exists to forbid. The counts are `1` because a purpose is a
       * fact rather than a quantity; the label carries the meaning.
       */
      throw new AppError('STATE_CONFLICT', 'the account still has a purpose', {
        reason: 'ACCOUNT_HAS_PURPOSE',
        blocked_by: Object.fromEntries(report.purposes.map((p) => [p, 1])),
      });
    }
  });

  await deIdentifyAccount(prisma, caller, targetId);

  await audit.write(prisma, {
    actorUserId: caller.userId,
    ...(caller.activeRole ? { activeRole: caller.activeRole } : {}),
    // A distinct action because it is a distinct DECISION: an administrator
    // judged that this account had no remaining reason to exist. The `user.delete`
    // and `user.deidentify` rows beside it record the mechanism.
    actionType: 'user.close_guardian_only',
    targetEntity: 'User',
    targetId,
    // The refusal path is the one that names purposes, and it names them in the
    // error. A success has none by definition, so there is nothing to record.
    detail: { guard: 'no_remaining_purpose' },
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
    await lockAndAssertNotPlatformOwner(tx, targetId);
    if (!(await users.lockUser(tx, targetId))) {
      throw new AppError('NOT_FOUND', 'no such account');
    }
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
