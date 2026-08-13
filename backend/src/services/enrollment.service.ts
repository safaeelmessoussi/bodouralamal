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

  // An entire-level schedule only covers the student if they are ENROLLED at
  // that schedule's branch (§4.4c, the branch bound). R66 — this used to reach
  // through the Administrative Group, which meant a student in an unsubdivided
  // Level matched nothing at all.
  const enrolmentBranches = new Set(
    (
      await tx.enrollment.findMany({
        where: { studentId, deletedAt: null },
        select: { levelId: true, branchId: true },
      })
    ).map((e) => `${e.levelId}:${e.branchId}`),
  );
  const covering = schedules.filter(
    (s) =>
      s.teachingMode !== 'entire_level' ||
      (s.levelId !== null && enrolmentBranches.has(`${s.levelId}:${s.branchId}`)),
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
  /** R66 — `null` when the Level needs no subdivision. */
  administrativeGroupId: string | null;
  /** R66 — always present: the single answer to *where is this student*. */
  branchId: string;
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
        // Both from the group, not the caller — see the note above. R66 makes
        // the branch a column on the enrolment, and taking it from the group
        // here is what the composite FK `(administrative_group_id, branch_id)`
        // then proves rather than trusts.
        levelId: group.levelId,
        branchId: group.branchId,
      },
      select: {
        id: true,
        studentId: true,
        levelId: true,
        administrativeGroupId: true,
        branchId: true,
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
 * **Where a student is being placed — a group, or a Level and a branch (R66.5).**
 *
 * Exactly one of the two, and the type says so rather than a validator saying
 * it later: a shape carrying both would have to decide which wins, and a shape
 * carrying neither is the missing placement §4.1 refuses.
 *
 * The two are not interchangeable spellings of one thing. Naming a **group**
 * says *this Level is subdivided and the student goes in this subdivision*, and
 * the Level and branch are read from it — which the composite FK then proves.
 * Naming a **Level and a branch** says *this Level is not subdivided*, and both
 * are the caller's checked choice.
 */
export type PlacementInput =
  | { administrativeGroupId: string }
  | { levelId: string; branchId: string };

/**
 * Places a student, whichever way the caller expressed it.
 *
 * **One entry point for both approval paths.** `decide()` and
 * `decideChildApplication` both place students, and this project has paid
 * repeatedly for one rule with two implementations — so the dispatch lives here
 * and both callers hand it a `PlacementInput` rather than branching themselves.
 */
export async function enrolAtPlacement(
  tx: Prisma.TransactionClient,
  actor: Actor,
  placement: PlacementInput,
  studentId: string,
  source: 'roster_edit' | 'approval',
): Promise<EnrollmentRow> {
  return 'administrativeGroupId' in placement
    ? enrolInGroup(tx, actor, placement.administrativeGroupId, studentId, source)
    : enrolInLevel(tx, actor, placement.levelId, placement.branchId, studentId, source);
}

/**
 * **Enrols a student DIRECTLY in a Level (Revision 66).**
 *
 * The counterpart of `enrolInGroup`, for a Level nobody has subdivided. It is a
 * separate function rather than a nullable parameter on the other one because
 * the two validate genuinely different things: `enrolInGroup` starts from a
 * group and takes the Level and the branch **from it**, which is what the
 * composite FK then proves; this one is given a Level and a branch and must
 * check both itself.
 *
 * Everything they share is shared: the sex eligibility rule (§4.4b), BR-21's
 * one-place-per-Level refusal, the consent re-evaluation, and the audit row.
 *
 * **The branch is checked live and for scope.** An Admin may only enrol into
 * branches they hold — the same boundary `enrolInGroup` gets from the group,
 * asserted here against the branch the caller named.
 */
export async function enrolInLevel(
  tx: Prisma.TransactionClient,
  actor: Actor,
  levelId: string,
  branchId: string,
  studentId: string,
  source: 'roster_edit' | 'approval',
): Promise<EnrollmentRow> {
  assertCanManage(actor);

  const level = await tx.level.findFirst({
    where: { id: levelId, deletedAt: null },
    select: { id: true, genderRestriction: true },
  });
  if (!level) throw new AppError('NOT_FOUND', 'no such level');

  const branch = await tx.branch.findFirst({
    where: { id: branchId, deletedAt: null },
    select: { id: true },
  });
  if (!branch) throw new AppError('NOT_FOUND', 'no such branch');
  scope.assertCanActOnBranch(actor.roleScopes, MANAGING_ROLE, branchId, 'no such branch');

  const student = await tx.user.findFirst({
    where: { id: studentId, deletedAt: null },
    select: { id: true, sex: true },
  });
  if (!student) throw new AppError('NOT_FOUND', 'no such student');

  assertSexEligible(level.genderRestriction, student.sex);

  // BR-21, and the same explained refusal `enrolInGroup` gives: the partial
  // unique index would catch it, but a raw constraint violation tells an
  // administrator nothing about what to do instead.
  const already = await tx.enrollment.findFirst({
    where: { studentId, levelId, deletedAt: null },
    select: { id: true, administrativeGroupId: true },
  });
  if (already) {
    throw new AppError('STATE_CONFLICT', 'student is already enrolled in this level', {
      reason: 'ALREADY_ENROLLED_IN_LEVEL',
      level_id: levelId,
      current_administrative_group_id: already.administrativeGroupId,
    });
  }

  const row = await tx.enrollment.create({
    // No group: this Level has no subdivision. The composite FK is not enforced
    // when `administrative_group_id` is NULL, so the branch stands alone here
    // and is the caller's checked choice.
    data: { studentId, levelId, branchId },
    select: {
      id: true,
      studentId: true,
      levelId: true,
      administrativeGroupId: true,
      branchId: true,
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
      level_id: levelId,
      // Named explicitly so the trail distinguishes a direct enrolment from one
      // whose group happens to be missing from a projection.
      administrative_group_id: null,
      branch_id: branchId,
      source,
    },
  });
  return row;
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
  /** `null` since R66 — an enrolment may have no group, and the label says so
   *  rather than failing to compose. */
  administrativeGroupId: string | null,
): Promise<string | null> {
  const [student, group] = await Promise.all([
    tx.user.findUnique({ where: { id: studentId }, select: { nameArabic: true } }),
    administrativeGroupId === null
      ? Promise.resolve(null)
      : tx.administrativeGroup.findUnique({
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

    await releaseEnrollment(tx, actor, row);
  });
}

/**
 * `DELETE /admin/enrollments/{id}` — end an enrolment **by the enrolment**
 * (R74 follow-up).
 *
 * **The group-keyed path above could not end a group-less enrolment**, because
 * it identifies the row through an Administrative Group — and R66 made that
 * optional. This resolves the row directly and hands it to the same routine, so
 * the two entry points cannot drift: consent re-evaluation, circle-seat release,
 * the Trash snapshot and the audit row are written once, in one place.
 *
 * Branch scope is asserted from **`Enrollment.branch_id`** (R66), which is the
 * single answer to *where is this student* and exists whether or not a group
 * does.
 */
export async function unenrolById(
  prisma: PrismaClient,
  actor: Actor,
  enrollmentId: string,
): Promise<void> {
  assertCanManage(actor);

  await prisma.$transaction(async (tx) => {
    const row = await tx.enrollment.findFirst({ where: { id: enrollmentId, deletedAt: null } });
    if (!row) throw new AppError('NOT_FOUND', 'no such enrolment');
    scope.assertCanActOnBranch(actor.roleScopes, MANAGING_ROLE, row.branchId, 'no such enrolment');

    await releaseEnrollment(tx, actor, row);
  });
}

/**
 * Everything ending an enrolment entails, written once.
 *
 * Extracted rather than copied when `unenrolById` arrived: the consent
 * re-evaluation must be enqueued **while the student is still in the audience**,
 * the circle seats must go **because** the enrolment did, and R59 requires the
 * deliberate deletion to reach the Trash carrying the rows its cascade removed.
 * A second implementation would have got one of those three subtly wrong.
 */
async function releaseEnrollment(
  tx: Prisma.TransactionClient,
  actor: Actor,
  row: { id: string; studentId: string; levelId: string; administrativeGroupId: string | null },
): Promise<void> {
  // Enqueued BEFORE the write, while the student is still in the audience:
  // afterwards this schedule no longer covers them, so a derived lookup would
  // skip the very sessions whose gate just changed.
  const sessions = await enqueueConsentReevaluationForStudent(tx, row.studentId);

  const now = new Date();
  await tx.enrollment.update({
    where: { id: row.id },
    data: { deletedAt: now, deletedById: actor.userId },
  });

  // Removed BECAUSE the enrolment was, so they are read before the write and
  // carried inside the enrolment's snapshot rather than given tombstones of
  // their own (R59, §7's reinstatement list).
  const seatRows = await tx.studentTeachingGroup.findMany({
    where: { studentId: row.studentId, levelId: row.levelId, deletedAt: null },
  });
  const seats = await tx.studentTeachingGroup.updateMany({
    where: { studentId: row.studentId, levelId: row.levelId, deletedAt: null },
    data: { deletedAt: now, deletedById: actor.userId },
  });

  await trash.snapshot(tx, {
    targetEntity: 'Enrollment',
    targetId: row.id,
    snapshot: JSON.parse(
      JSON.stringify({
        ...row,
        teachingGroupSeats: seatRows,
        label: await labelFor(tx, row.studentId, row.administrativeGroupId),
      }),
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
      student_id: row.studentId,
      level_id: row.levelId,
      administrative_group_id: row.administrativeGroupId,
      teaching_group_seats_removed: seats.count,
      sessions_requeued: sessions.length,
    },
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
      // R66 — the branch moves WITH the group. Leaving it behind would break
      // the composite FK immediately, which is the constraint doing exactly
      // what it exists for: the two can never be updated apart.
      data: { administrativeGroupId: toGroupId, branchId: to.branchId },
      select: {
        id: true,
        studentId: true,
        levelId: true,
        administrativeGroupId: true,
        branchId: true,
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

/**
 * Every Level a student is enrolled in, with the branch they are enrolled at and
 * the group placing them there **where one exists** (R66).
 *
 * The enrolment row is level membership (§4.4c); the withdrawn `StudentLevel`
 * proposal is why nothing stores it separately.
 *
 * **The group filter is now `OR null`.** It used to require a live group, so a
 * student in an unsubdivided Level was absent from their own level list — which
 * is the bug the optional group would otherwise have introduced everywhere this
 * function is read.
 */
export interface EnrollmentRowView {
  id: string;
  student_id: string;
  student_name: string;
  level_id: string;
  level_name: string;
  category_name: string;
  branch_id: string;
  branch_name: string;
  administrative_group_id: string | null;
  administrative_group_name: string | null;
  /** Read-only context: the circles she sits in **within this Level**. Circle
   *  membership is managed on حلقات المواد and is independent of the group
   *  (§4.4c — "nothing aligns them and nothing should try to"); it is shown
   *  here only so مستفيدة → مستوى → مجموعة → مادة → حلقة is legible in one
   *  place. */
  circles: { subject_name: string; circle_name: string }[];
}

/**
 * `GET /admin/enrollments` — **the Level view of the enrolment rows** (§7 R66,
 * §14.1 R74).
 *
 * **Not a second roster.** `listGroupRoster` is the per-group view of these very
 * same rows; this is the per-Level one, which R66 made the primary fact — a
 * student is enrolled in a **Level**, and a Group is an optional subdivision of
 * it. Two readings of one table, never two tables.
 *
 * **Branch-scoped exactly as everything else is**: `Enrollment.branch_id` (R66),
 * so an Admin sees their branches and a Super Admin sees all — the same
 * predicate `assertCanAccessStudent` uses, expressed as a list.
 *
 * The screen shows its data on load, so this takes filters that **narrow** and
 * never gate: absent, it answers with everything the caller may see.
 */
export async function listEnrollments(
  prisma: PrismaClient,
  actor: Actor,
  filters: { levelId?: string; branchId?: string } = {},
): Promise<EnrollmentRowView[]> {
  assertCanManage(actor);

  const reachable = scope.reachableBranches(actor.roleScopes, [MANAGING_ROLE]);
  const rows = await prisma.enrollment.findMany({
    where: {
      deletedAt: null,
      ...(filters.levelId ? { levelId: filters.levelId } : {}),
      // Applied last so an explicit filter NARROWS a scoped caller and never
      // widens one — the discipline `listEvents` and `listCourseSchedules` use.
      ...(filters.branchId ? { branchId: filters.branchId } : {}),
      ...(reachable === null ? {} : { branchId: { in: reachable } }),
      student: { deletedAt: null },
    },
    select: {
      id: true,
      studentId: true,
      levelId: true,
      branchId: true,
      administrativeGroupId: true,
      student: {
        select: {
          nameArabic: true,
          // The circles she sits in — read in the same query rather than one
          // per row, which at 500 enrolments would be the N+1 §4.5 names.
          teachingGroupSeats: {
            where: { deletedAt: null, teachingGroup: { deletedAt: null } },
            select: {
              levelId: true,
              teachingGroup: {
                select: { name: true, subject: { select: { name: true } } },
              },
            },
          },
        },
      },
      level: { select: { name: true, category: { select: { name: true } } } },
      branch: { select: { name: true } },
      administrativeGroup: { select: { name: true } },
    },
    orderBy: [{ level: { name: 'asc' } }, { student: { nameArabic: 'asc' } }],
    take: 500,
  });

  return rows.map((r) => ({
    id: r.id,
    student_id: r.studentId,
    student_name: r.student.nameArabic,
    level_id: r.levelId,
    level_name: r.level.name,
    category_name: r.level.category.name,
    branch_id: r.branchId,
    branch_name: r.branch.name,
    administrative_group_id: r.administrativeGroupId,
    administrative_group_name: r.administrativeGroup?.name ?? null,
    // Only the seats inside THIS Level: a circle is scoped to (Subject, Level),
    // so another Level's seats describe a different enrolment entirely.
    circles: r.student.teachingGroupSeats
      .filter((seat) => seat.levelId === r.levelId)
      .map((seat) => ({
        subject_name: seat.teachingGroup.subject.name,
        circle_name: seat.teachingGroup.name,
      })),
  }));
}

/**
 * `POST /admin/enrollments` — enrol a مستفيدة at a placement (§7 R66, R74).
 *
 * **The whole function is a call to `enrolAtPlacement`**, which is the point:
 * the approval path calls the same one, so a placement made here and a placement
 * made at approval cannot diverge. Every rule lives there — the role gate, the
 * **branch** assertion, R27's sex eligibility, BR-21's one-enrolment-per-Level
 * refusal, and the Group's membership of the chosen Level and branch.
 */
export async function enrolAtLevel(
  prisma: PrismaClient,
  actor: Actor,
  input: { studentId: string; levelId: string; branchId: string; administrativeGroupId?: string | null },
): Promise<EnrollmentRow> {
  return prisma.$transaction((tx) =>
    enrolAtPlacement(
      tx,
      actor,
      input.administrativeGroupId
        ? { administrativeGroupId: input.administrativeGroupId }
        : { levelId: input.levelId, branchId: input.branchId },
      input.studentId,
      'roster_edit',
    ),
  );
}

/**
 * `PATCH /admin/enrollments/{id}` — change a placement **within its Level**.
 *
 * **The Level is not editable, and that is the model rather than a limitation.**
 * BR-21 makes `(student_id, level_id)` unique, so an `Enrollment` *is* the pair:
 * moving a مستفيدة to another Level ends one enrolment and begins another, which
 * the existing unenrol and enrol paths already express. Silently rewriting
 * `level_id` would keep the row's history and circle seats attached to a Level
 * she no longer studies.
 *
 * **What IS editable is the placement inside it**: the optional Administrative
 * Group and the branch — including moving **into** a group, **out of** one, and
 * between them, which `moveStudent` could not do because it took two group ids.
 *
 * **Circle seats are released when the group changes**, for the reason
 * `releaseEnrollment` gives: a seat is a placement within this Level, and the
 * student's subdivision has just changed. Seats survive a pure branch change,
 * which moves nobody between subdivisions.
 */
export async function updateEnrollmentPlacement(
  prisma: PrismaClient,
  actor: Actor,
  enrollmentId: string,
  patch: { administrativeGroupId?: string | null; branchId?: string },
): Promise<EnrollmentRow> {
  assertCanManage(actor);

  return prisma.$transaction(async (tx) => {
    const row = await tx.enrollment.findFirst({ where: { id: enrollmentId, deletedAt: null } });
    if (!row) throw new AppError('NOT_FOUND', 'no such enrolment');
    // Authority over where she IS, before authority over where she is going.
    scope.assertCanActOnBranch(actor.roleScopes, MANAGING_ROLE, row.branchId, 'no such enrolment');

    const branchId = patch.branchId ?? row.branchId;
    if (branchId !== row.branchId) {
      const branch = await tx.branch.findFirst({
        where: { id: branchId, deletedAt: null },
        select: { id: true },
      });
      if (!branch) throw new AppError('NOT_FOUND', 'no such branch');
      scope.assertCanActOnBranch(actor.roleScopes, MANAGING_ROLE, branchId, 'no such branch');
    }

    const groupId =
      patch.administrativeGroupId === undefined ? row.administrativeGroupId : patch.administrativeGroupId;

    if (groupId !== null) {
      const group = await tx.administrativeGroup.findFirst({
        where: { id: groupId, deletedAt: null },
        select: { levelId: true, branchId: true },
      });
      if (!group) throw new AppError('NOT_FOUND', 'no such group');
      // The composite FK guarantees the pair; refusing it here first is what
      // gives an administrator something to act on (§7, R66).
      if (group.levelId !== row.levelId) {
        throw new AppError('VALIDATION_FAILED', 'that group belongs to another level', {
          reason: 'GROUP_LEVEL_MISMATCH',
        });
      }
      if (group.branchId !== branchId) {
        throw new AppError('VALIDATION_FAILED', 'that group is at another branch', {
          reason: 'GROUP_BRANCH_MISMATCH',
        });
      }
    }

    const groupChanged = groupId !== row.administrativeGroupId;
    if (groupChanged) {
      // The subdivision changed, so seats within this Level no longer describe
      // where she sits — the same reasoning un-enrolment uses.
      await tx.studentTeachingGroup.updateMany({
        where: { studentId: row.studentId, levelId: row.levelId, deletedAt: null },
        data: { deletedAt: new Date(), deletedById: actor.userId },
      });
    }

    const updated = await tx.enrollment.update({
      where: { id: row.id },
      data: { administrativeGroupId: groupId, branchId },
    });

    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'enrollment.update',
      targetEntity: 'Enrollment',
      targetId: row.id,
      detail: {
        student_id: row.studentId,
        level_id: row.levelId,
        from: { administrative_group_id: row.administrativeGroupId, branch_id: row.branchId },
        to: { administrative_group_id: groupId, branch_id: branchId },
        teaching_group_seats_released: groupChanged,
      },
    });

    return updated;
  });
}

export async function levelsForStudent(
  prisma: PrismaClient,
  studentId: string,
): Promise<{ levelId: string; administrativeGroupId: string | null; branchId: string }[]> {
  const rows = await prisma.enrollment.findMany({
    where: {
      studentId,
      deletedAt: null,
      OR: [{ administrativeGroupId: null }, { administrativeGroup: { deletedAt: null } }],
    },
    select: { levelId: true, administrativeGroupId: true, branchId: true },
  });
  return rows.map((r) => ({
    levelId: r.levelId,
    administrativeGroupId: r.administrativeGroupId,
    branchId: r.branchId,
  }));
}
