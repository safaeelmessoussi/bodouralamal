import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { page, pageWindow, type Page, type PageParams } from '../lib/pagination.js';
import * as scope from '../policies/branch-scope.js';
import * as audit from '../repositories/audit.repository.js';
import * as trash from '../repositories/trash.repository.js';
import { enqueue, JOB_QUEUES } from '../repositories/jobs.repository.js';
import type { Actor } from '../policies/actor.js';

/**
 * Enrollment — a student's membership of a Level **through one Administrative
 * Group** (SRS §4.4c, BR-21, TD-4.6, TD-5, Revision 43).
 *
 * Replaces `roster.service.ts`, which enrolled into the retired schedule-bearing
 * `Group`. Both are live during the expand phase (TD-6b) by design.
 *
 * **Three rules carry this file, and each is enforced somewhere it cannot be
 * skipped:**
 *
 * 1. **Exactly one Administrative Group per enrolled Level** — a partial
 *    `UNIQUE (student_id, level_id)` index. Not a service check: a service check
 *    can be raced, and this one is a hard invariant.
 * 2. **`level_id` must agree with the group's own Level** — the composite FK
 *    `(administrative_group_id, level_id) → AdministrativeGroup(id, level_id)`.
 *    This file passes `level_id` from the *group it just read*, never from the
 *    caller, so the FK is a backstop rather than the primary defence — but it is
 *    what makes the denormalized column a constraint instead of a copy.
 * 3. **No capacity check exists** (BR-23). The retired `Group.max_students` was
 *    the only roster-side check-then-write invariant; removing it removed its
 *    `SELECT … FOR UPDATE` (TD-15.2). That is safe **only because the invariant
 *    went with it** — reintroducing capacity means reintroducing the lock.
 *
 * **Gender restriction is enforced here** (§4.4b, Revision 27): `Level.gender_
 * restriction` pairs with `User.sex`, and a **null `sex` is not eligible** for a
 * restricted Level rather than a wildcard — the person-side half is what makes
 * the restriction enforceable at all.
 */

/** TD-2: enrolment is operational data — Admin within branch scope, or Super Admin. */
const MANAGING_ROLE = 'admin';

const isSuperAdmin = (actor: Actor): boolean => scope.isSuperAdmin(actor.roleScopes);

function assertCanManage(actor: Actor): void {
  if (!(scope.hasRole(actor.roleScopes, MANAGING_ROLE) || isSuperAdmin(actor))) {
    throw new AppError('FORBIDDEN', 'enrolment requires admin');
  }
}

/**
 * Enqueues consent re-evaluation for every **session** whose audience contains
 * this student (§4.1a, BR-2, TD-7).
 *
 * **The payload is `{ session_id }` (Revision 43), not `{ group_id }`.** BR-2's
 * subject is now the session's *resolved audience*, because once a session can
 * be for a Teaching Group or an entire Level, "the group's consent state" has no
 * referent.
 *
 * **Two things a reader will otherwise trip over:**
 *
 * - **The retiring `roster.service.ts` still enqueues `{ group_id }`.** Both
 *   shapes therefore sit in the queue during the expand phase. Nothing breaks,
 *   because `consent.reevaluate` has **no consumer yet** — the handler arrives
 *   with M6 — and the contract migration removes the old producer before it
 *   does. A handler written before then must accept both or the old rows must
 *   be drained.
 * - **This currently enqueues nothing, and that is correct.** Course schedules
 *   and sessions are not built yet (M3b, later), so no session's audience
 *   contains anybody. A student in no session enqueues no jobs, exactly as a
 *   student in no group did before — a normal outcome, not a silent failure.
 */
export async function enqueueConsentReevaluationForStudent(
  tx: Prisma.TransactionClient,
  studentId: string,
): Promise<string[]> {
  // The inverse of §4.4c's roster resolution: which schedules cover this
  // student? Expressed as one query over the three teaching modes rather than
  // three round trips, and deliberately NOT importing `audienceWhere` — that
  // resolves students *for a schedule*, and this asks the opposite question.
  const schedules = await tx.recurringCourseSchedule.findMany({
    where: {
      deletedAt: null,
      OR: [
        {
          teachingMode: 'administrative_group',
          administrativeGroup: {
            deletedAt: null,
            enrollments: { some: { studentId, deletedAt: null } },
          },
        },
        {
          teachingMode: 'teaching_group',
          teachingGroup: {
            deletedAt: null,
            members: { some: { studentId, deletedAt: null } },
          },
        },
        {
          teachingMode: 'entire_level',
          level: {
            enrollments: {
              some: {
                studentId,
                deletedAt: null,
                administrativeGroup: { deletedAt: null },
              },
            },
          },
        },
      ],
    },
    select: { id: true, teachingMode: true, branchId: true, levelId: true },
  });
  if (schedules.length === 0) return [];

  // An entire-level schedule only covers the student if their group is at that
  // schedule's branch (§4.4c, the branch bound). Prisma cannot correlate the
  // two sibling relations in the query above, so the check lands here — the
  // same compromise, and the same reason, as `studentsTaughtBy`.
  const groupBranches = new Set(
    (
      await tx.enrollment.findMany({
        where: { studentId, deletedAt: null },
        select: { levelId: true, administrativeGroup: { select: { branchId: true } } },
      })
    ).map((e) => `${e.levelId}:${e.administrativeGroup.branchId}`),
  );
  const covering = schedules.filter(
    (s) =>
      s.teachingMode !== 'entire_level' ||
      (s.levelId !== null && groupBranches.has(`${s.levelId}:${s.branchId}`)),
  );
  if (covering.length === 0) return [];

  const sessions = await tx.session.findMany({
    where: { deletedAt: null, scheduleId: { in: covering.map((s) => s.id) } },
    select: { id: true },
  });

  for (const s of sessions) {
    // Singleton per session (TD-7): several changes affecting one session
    // collapse into one pending job, which is safe because the handler is a
    // full idempotent recompute rather than a delta.
    await enqueue(tx, JOB_QUEUES.consentReevaluate, { session_id: s.id }, s.id);
  }
  return sessions.map((s) => s.id);
}

/**
 * §4.4b / Revision 27 — a restricted Level admits only a matching `User.sex`,
 * and a **null sex is not eligible**. Without the person-side half the
 * restriction is unenforceable, which is exactly why sex is captured at
 * registration rather than added later.
 */
function assertSexEligible(
  genderRestriction: 'any' | 'girls_only' | 'boys_only',
  sex: 'female' | 'male' | null,
): void {
  if (genderRestriction === 'any') return;
  const required = genderRestriction === 'girls_only' ? 'female' : 'male';
  if (sex !== required) {
    throw new AppError('VALIDATION_FAILED', 'level is restricted by sex', {
      reason: 'GENDER_RESTRICTION',
      gender_restriction: genderRestriction,
      // The student's own sex is deliberately not echoed: this response may be
      // read by staff who have no business with a beneficiary's record beyond
      // the placement decision (§4.10, BR-16).
      required_sex: required,
    });
  }
}

export interface EnrollmentRow {
  id: string;
  studentId: string;
  levelId: string;
  administrativeGroupId: string;
  enrolledAt: Date;
}

export async function listGroupRoster(
  prisma: PrismaClient,
  actor: Actor,
  administrativeGroupId: string,
  params: PageParams = {},
): Promise<Page<{ id: string; studentId: string; nameArabic: string | null; enrolledAt: Date }>> {
  assertCanManage(actor);

  const group = await prisma.administrativeGroup.findFirst({
    where: { id: administrativeGroupId, deletedAt: null },
    select: { branchId: true },
  });
  if (!group) throw new AppError('NOT_FOUND', 'no such group');
  scope.assertCanActOnBranch(actor.roleScopes, MANAGING_ROLE, group.branchId, 'no such group');

  const where: Prisma.EnrollmentWhereInput = {
    administrativeGroupId,
    deletedAt: null,
    student: { deletedAt: null },
  };
  const window = pageWindow(params);
  const [rows, total] = await Promise.all([
    prisma.enrollment.findMany({
      where,
      skip: window.skip,
      take: window.take,
      // BR-19: the natively collated name column orders Arabic correctly with
      // no per-query COLLATE (§20 rule 13).
      orderBy: { student: { nameArabic: 'asc' } },
      select: {
        id: true,
        studentId: true,
        enrolledAt: true,
        student: { select: { nameArabic: true } },
      },
    }),
    prisma.enrollment.count({ where }),
  ]);

  return page(
    rows.map((r) => ({
      id: r.id,
      studentId: r.studentId,
      nameArabic: r.student.nameArabic,
      enrolledAt: r.enrolledAt,
    })),
    window,
    total,
  );
}

/**
 * Enrols a student into an Administrative Group, and thereby into its Level.
 *
 * **`levelId` is read from the group, never taken from the caller.** Accepting
 * it would make the composite FK the only thing standing between a typo and a
 * mis-filed student, and would surface as an opaque constraint error rather
 * than a decision this service made.
 */
/**
 * **The one implementation of *enrol this student in this group*.**
 *
 * Extracted so §4.1's approval can create enrolments **inside its own
 * transaction** — Revision 43 requires the activation and every resulting
 * `Enrollment` to commit together, because *"an approved account with no
 * enrollment is a person the platform admitted and then lost"* — without a
 * second copy of the branch-scope check, the §4.4b sex restriction, BR-21 and
 * the consent re-evaluation enqueue. A copied placement rule is one that drifts
 * while both copies keep passing their own tests.
 *
 * `source` reaches the TD-8 detail unchanged, so the audit trail distinguishes a
 * placement made at approval from one made later on the roster screen. They are
 * different administrative acts and an auditor asking *how did this student get
 * here* needs them to read differently.
 */
export async function enrolInGroup(
  tx: Prisma.TransactionClient,
  actor: Actor,
  administrativeGroupId: string,
  studentId: string,
  source: 'roster_edit' | 'approval',
): Promise<EnrollmentRow> {
  assertCanManage(actor);

  {
    const group = await tx.administrativeGroup.findFirst({
      where: { id: administrativeGroupId, deletedAt: null },
      select: {
        id: true,
        branchId: true,
        levelId: true,
        level: { select: { id: true, genderRestriction: true, deletedAt: true } },
      },
    });
    if (!group || group.level.deletedAt !== null) throw new AppError('NOT_FOUND', 'no such group');
    scope.assertCanActOnBranch(actor.roleScopes, MANAGING_ROLE, group.branchId, 'no such group');

    const student = await tx.user.findFirst({
      where: { id: studentId, deletedAt: null },
      select: { id: true, sex: true },
    });
    if (!student) throw new AppError('NOT_FOUND', 'no such student');

    assertSexEligible(group.level.genderRestriction, student.sex);

    // BR-21 is enforced by a partial unique index, but reaching it as a raw
    // constraint violation would tell an administrator nothing useful. This
    // read turns it into an explained refusal that names the group the student
    // is already in — which is the information needed to decide whether to
    // MOVE them instead.
    const already = await tx.enrollment.findFirst({
      where: { studentId, levelId: group.levelId, deletedAt: null },
      select: { id: true, administrativeGroupId: true },
    });
    if (already) {
      if (already.administrativeGroupId === administrativeGroupId) {
        throw new AppError('DUPLICATE', 'student is already enrolled in this group');
      }
      throw new AppError('STATE_CONFLICT', 'student is already in another group of this level', {
        reason: 'ALREADY_ENROLLED_IN_LEVEL',
        level_id: group.levelId,
        current_administrative_group_id: already.administrativeGroupId,
      });
    }

    const row = await tx.enrollment.create({
      data: {
        studentId,
        administrativeGroupId,
        // From the group, not the caller — see the note above.
        levelId: group.levelId,
      },
      select: {
        id: true,
        studentId: true,
        levelId: true,
        administrativeGroupId: true,
        enrolledAt: true,
      },
    });

    await enqueueConsentReevaluationForStudent(tx, studentId);

    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'enrollment.create',
      targetEntity: 'Enrollment',
      targetId: row.id,
      detail: {
        student_id: studentId,
        level_id: group.levelId,
        administrative_group_id: administrativeGroupId,
        branch_id: group.branchId,
        source,
      },
    });
    return row;
  }
}

/**
 * `POST /admin/administrative-groups/{id}/roster` — one placement, one
 * transaction of its own.
 */
export async function enrolStudent(
  prisma: PrismaClient,
  actor: Actor,
  administrativeGroupId: string,
  studentId: string,
): Promise<EnrollmentRow> {
  return prisma.$transaction((tx) =>
    enrolInGroup(tx, actor, administrativeGroupId, studentId, 'roster_edit'),
  );
}

/**
 * Un-enrols a student — a soft-delete of the enrolment row **only** (TD-5).
 *
 * **Grades, exam submissions and Quran logs are never touched.** They are the
 * historical academic record and survive a student leaving, so a re-enrolled or
 * transferred student rejoins a Level that still knows what they did.
 *
 * **Their Teaching Group seats for that Level ARE removed** (TD-5, Revision 43):
 * a place in a subject split inside a Level the student has left is a roster
 * entry for a class they no longer attend.
 */
/** `اسم الطالبة — اسم المجموعة`, so the Trash entry is readable. */
async function labelFor(
  tx: Prisma.TransactionClient,
  studentId: string,
  administrativeGroupId: string,
): Promise<string | null> {
  const [student, group] = await Promise.all([
    tx.user.findUnique({ where: { id: studentId }, select: { nameArabic: true } }),
    tx.administrativeGroup.findUnique({
      where: { id: administrativeGroupId },
      select: { name: true },
    }),
  ]);
  if (!student && !group) return null;
  return `${student?.nameArabic ?? '—'} — ${group?.name ?? '—'}`;
}

export async function unenrolStudent(
  prisma: PrismaClient,
  actor: Actor,
  administrativeGroupId: string,
  studentId: string,
): Promise<void> {
  assertCanManage(actor);

  await prisma.$transaction(async (tx) => {
    const group = await tx.administrativeGroup.findFirst({
      where: { id: administrativeGroupId, deletedAt: null },
      select: { id: true, branchId: true, levelId: true },
    });
    if (!group) throw new AppError('NOT_FOUND', 'no such group');
    scope.assertCanActOnBranch(actor.roleScopes, MANAGING_ROLE, group.branchId, 'no such group');

    const row = await tx.enrollment.findFirst({
      where: { administrativeGroupId, studentId, deletedAt: null },
    });
    if (!row) throw new AppError('NOT_FOUND', 'student is not enrolled in this group');

    // Enqueued BEFORE the write, while the student is still in the audience:
    // afterwards this schedule no longer covers them, so a derived lookup would
    // skip the very sessions whose gate just changed. The same reasoning the
    // retiring roster service records for naming its group explicitly.
    const sessions = await enqueueConsentReevaluationForStudent(tx, studentId);

    const now = new Date();
    await tx.enrollment.update({
      where: { id: row.id },
      data: { deletedAt: now, deletedById: actor.userId },
    });

    // Removed BECAUSE the enrolment was, so they are read before the write and
    // carried inside the enrolment's snapshot rather than given tombstones of
    // their own: R59 gives an entry to the deletion a person performed, and
    // describes its consequences in that entry (§7's reinstatement list).
    const seatRows = await tx.studentTeachingGroup.findMany({
      where: { studentId, levelId: group.levelId, deletedAt: null },
    });
    const seats = await tx.studentTeachingGroup.updateMany({
      where: { studentId, levelId: group.levelId, deletedAt: null },
      data: { deletedAt: now, deletedById: actor.userId },
    });

    // R59.2 — un-enrolling is a deliberate act by an Admin, so it reaches the
    // one screen that answers *what was deleted and by whom*. It was audited and
    // invisible there, which is precisely the row §7's runbook has to reinstate.
    await trash.snapshot(tx, {
      targetEntity: 'Enrollment',
      targetId: row.id,
      // **A join row has no name**, so the label is composed here from the two
      // things it joins. Without it these entries are a page of UUIDs, which is
      // the failure `labelOf` exists to prevent.
      snapshot: JSON.parse(
        JSON.stringify({ ...row, teachingGroupSeats: seatRows, label: await labelFor(tx, studentId, administrativeGroupId) }),
      ) as object,
      deletedById: actor.userId,
    });

    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'enrollment.delete',
      targetEntity: 'Enrollment',
      targetId: row.id,
      detail: {
        student_id: studentId,
        level_id: group.levelId,
        administrative_group_id: administrativeGroupId,
        teaching_group_seats_removed: seats.count,
        sessions_requeued: sessions.length,
      },
    });
  });
}

/**
 * Moves a student between two groups **of the same Level**, as a single action
 * (§5.6).
 *
 * **Why this is not un-enrol + enrol by the caller.** Those are two
 * transactions: between them the student is in no group, so the §4.9 consent
 * gate and every roster query see a person who has left the school. Doing it in
 * one transaction means the invariant `UNIQUE (student_id, level_id)` is never
 * observed broken and no window exists where the student is nowhere.
 *
 * **Restricted to one Level deliberately.** Moving to a group in a *different*
 * Level is not a move, it is an un-enrolment plus an enrolment — two decisions
 * about a student's curriculum, and collapsing them into one action would hide
 * the second.
 */
export async function moveStudent(
  prisma: PrismaClient,
  actor: Actor,
  studentId: string,
  fromGroupId: string,
  toGroupId: string,
): Promise<EnrollmentRow> {
  assertCanManage(actor);
  if (fromGroupId === toGroupId) {
    throw new AppError('VALIDATION_FAILED', 'source and destination are the same group', {
      reason: 'SAME_GROUP',
    });
  }

  return prisma.$transaction(async (tx) => {
    const groups = await tx.administrativeGroup.findMany({
      where: { id: { in: [fromGroupId, toGroupId] }, deletedAt: null },
      select: { id: true, branchId: true, levelId: true },
    });
    const from = groups.find((g) => g.id === fromGroupId);
    const to = groups.find((g) => g.id === toGroupId);
    if (!from || !to) throw new AppError('NOT_FOUND', 'no such group');

    // Both ends must be in scope: a move is a write to each, and checking only
    // the destination would let an Admin pull a student out of a branch they do
    // not manage.
    scope.assertCanActOnBranch(actor.roleScopes, MANAGING_ROLE, from.branchId, 'no such group');
    scope.assertCanActOnBranch(actor.roleScopes, MANAGING_ROLE, to.branchId, 'no such group');

    if (from.levelId !== to.levelId) {
      throw new AppError('STATE_CONFLICT', 'a move must stay within one level', {
        reason: 'CROSS_LEVEL_MOVE',
        from_level_id: from.levelId,
        to_level_id: to.levelId,
      });
    }

    const row = await tx.enrollment.findFirst({
      where: { administrativeGroupId: fromGroupId, studentId, deletedAt: null },
      select: { id: true },
    });
    if (!row) throw new AppError('NOT_FOUND', 'student is not enrolled in the source group');

    // Re-pointed in place rather than soft-deleted and re-created: the
    // enrolment is the same fact about the same person, and a new row would
    // reset `enrolled_at` — losing how long they have been in this Level, which
    // is the question the column exists to answer.
    const moved = await tx.enrollment.update({
      where: { id: row.id },
      data: { administrativeGroupId: toGroupId },
      select: {
        id: true,
        studentId: true,
        levelId: true,
        administrativeGroupId: true,
        enrolledAt: true,
      },
    });

    // Teaching Group seats SURVIVE a move within a Level: the splits belong to
    // the (Subject, Level), not to the administrative group (§4.4c), so a
    // student moved between administrative groups keeps their Quran group.
    await enqueueConsentReevaluationForStudent(tx, studentId);

    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'enrollment.move',
      targetEntity: 'Enrollment',
      targetId: moved.id,
      detail: {
        student_id: studentId,
        level_id: from.levelId,
        from_administrative_group_id: fromGroupId,
        to_administrative_group_id: toGroupId,
        from_branch_id: from.branchId,
        to_branch_id: to.branchId,
      },
    });
    return moved;
  });
}

/** Every Level a student is enrolled in, with the group that places them there.
 *  This is the ONLY way level membership is answered (§4.4c) — nothing stores
 *  it separately, and the withdrawn `StudentLevel` proposal is why. */
export async function levelsForStudent(
  prisma: PrismaClient,
  studentId: string,
): Promise<{ levelId: string; administrativeGroupId: string; branchId: string }[]> {
  const rows = await prisma.enrollment.findMany({
    where: { studentId, deletedAt: null, administrativeGroup: { deletedAt: null } },
    select: {
      levelId: true,
      administrativeGroupId: true,
      administrativeGroup: { select: { branchId: true } },
    },
  });
  return rows.map((r) => ({
    levelId: r.levelId,
    administrativeGroupId: r.administrativeGroupId,
    branchId: r.administrativeGroup.branchId,
  }));
}
