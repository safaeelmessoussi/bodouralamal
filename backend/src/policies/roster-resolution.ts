import type { Prisma, PrismaClient, TeachingMode } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import * as scope from './branch-scope.js';

/**
 * **Roster resolution — the single definition of "which students is this for"
 * (SRS §4.4c, Revision 43).**
 *
 * §4.4c states this rule once and every other section cites it: the consent gate
 * (§4.9, BR-2), attendance when it ships (§4.7), teacher scope (TD-2), and every
 * "who is in this class" question anywhere in the platform. **This module is
 * that one place.** A second implementation of any arm below is a defect, not an
 * optimisation — the copy that drifts still passes its own tests (§16.4).
 *
 * A schedule names a **teaching mode** and **exactly one target** of the
 * matching kind, and the database refuses any other combination
 * (`course_schedule_mode_target_check`). The audience resolves as:
 *
 * | Mode                   | Target                | Audience                                              |
 * |------------------------|-----------------------|-------------------------------------------------------|
 * | `entire_level`         | one `Level`           | that Level's students **enrolled at the schedule's branch** (R66) |
 * | `administrative_group` | one `AdministrativeGroup` | that group's enrolled students                    |
 * | `teaching_group`       | one `TeachingGroup`   | that teaching group's members                          |
 *
 * **Entire-Level mode is branch-bound and that is not an optimisation.** A Level
 * spans branches; a room does not. Resolving an entire-level session to students
 * at other branches would put people on a roster for a class they cannot attend
 * — and, through BR-2, would gate a recording on the consent of someone who was
 * never in the room.
 *
 * **The audience is never stored** (§20 rule 22). It is resolved here, at read
 * time, from the schedule's mode and target. A snapshot on the `Session` row
 * would silently diverge from the group it came from the moment anyone was
 * enrolled or moved — which is the class of failure Revision 43 exists to
 * remove, reappearing one table over.
 */

/** The parts of a schedule that decide its audience. Deliberately structural: a
 *  `Session` inherits these from its schedule and never carries its own. */
export interface AudienceSpec {
  teachingMode: TeachingMode;
  levelId: string | null;
  administrativeGroupId: string | null;
  teachingGroupId: string | null;
  branchId: string;
}

/**
 * A Prisma `where` fragment over `User` selecting a schedule's audience.
 *
 * Returned as a fragment rather than a list of ids so callers compose it into
 * one query — the same reasoning `teacher-scope.ts` records. Materialising ids
 * first takes a **snapshot**: between resolving the set and using it, a student
 * can be enrolled, moved or removed, so the request would act on a roster that
 * is no longer true. TD-12's posture is that authorization and scope are
 * re-evaluated per request; one query evaluates both at a single instant.
 *
 * Every arm requires `deletedAt: null` on both the membership row **and** the
 * group it points at: an un-enrolled student, a soft-deleted group, and a
 * removed teaching-group seat each drop out of the audience on the very next
 * query, with nothing to invalidate.
 */
export function audienceWhere(spec: AudienceSpec): Prisma.UserWhereInput {
  switch (spec.teachingMode) {
    case 'entire_level': {
      if (spec.levelId === null) throw new Error(unreachable('entire_level', 'levelId'));
      return {
        deletedAt: null,
        levelEnrollments: {
          some: {
            deletedAt: null,
            levelId: spec.levelId,
            // Branch-bound: the Level spans branches, this class does not.
            // R66 — the enrolment's branch, not the group's. Same meaning
            // (*that Level's students at this schedule's branch*), and it now
            // includes students in a Level nobody has subdivided instead of
            // silently omitting them.
            branchId: spec.branchId,
          },
        },
      };
    }
    case 'administrative_group': {
      if (spec.administrativeGroupId === null) {
        throw new Error(unreachable('administrative_group', 'administrativeGroupId'));
      }
      return {
        deletedAt: null,
        levelEnrollments: {
          some: {
            deletedAt: null,
            administrativeGroupId: spec.administrativeGroupId,
            administrativeGroup: { deletedAt: null },
          },
        },
      };
      // No branch filter here, and none is wanted: the group IS at one branch
      // (§7), so the constraint is already carried by the target itself.
    }
    case 'teaching_group': {
      if (spec.teachingGroupId === null) {
        throw new Error(unreachable('teaching_group', 'teachingGroupId'));
      }
      return {
        deletedAt: null,
        teachingGroupSeats: {
          some: {
            deletedAt: null,
            teachingGroupId: spec.teachingGroupId,
            teachingGroup: { deletedAt: null },
          },
        },
      };
    }
  }
}

/**
 * The mode/target disagreement this throws on is refused by the database
 * (`course_schedule_mode_target_check`), so reaching it means a row bypassed the
 * constraint — a corrupted schema rather than bad input. It is deliberately an
 * `Error` and not an `AppError`: there is no user-facing remedy and no error
 * code in TD-3.8 that would honestly describe it.
 */
function unreachable(mode: string, field: string): string {
  return `Schedule has teaching_mode '${mode}' with a null ${field}. The database CHECK constraint course_schedule_mode_target_check should have made this impossible; the schema has been altered or bypassed.`;
}

/** Resolve a schedule's audience to actual student rows. */
export async function resolveAudience(
  prisma: PrismaClient,
  spec: AudienceSpec,
  select?: Prisma.UserSelect,
): Promise<{ id: string }[]> {
  return prisma.user.findMany({
    where: audienceWhere(spec),
    select: select ?? { id: true },
    orderBy: { nameArabic: 'asc' },
  }) as Promise<{ id: string }[]>;
}

/** How many students a schedule's audience resolves to. Used by the TD-8
 *  `session.cancel` audit row, where "how many people did this affect" becomes
 *  unanswerable later once the roster has moved on. */
export async function audienceSize(prisma: PrismaClient, spec: AudienceSpec): Promise<number> {
  return prisma.user.count({ where: audienceWhere(spec) });
}

/**
 * **Teacher scope (§4.4c, TD-2) — replaces `GroupTeacher` resolution.**
 *
 * A teacher's students are the union of the resolved audiences of the schedules
 * they staff. This is the derivation behind Quran logging on "their own
 * students" (§4.5), exam authoring (§4.6), sensitive social-data access (§4.10,
 * BR-16), Hidden-event visibility (§4.4), and content branch scope (§4.9).
 *
 * **Two of the three arms stay fully relational; one cannot.** The
 * administrative-group and teaching-group arms reach the staff table through
 * the target's own `schedules` back-relation, so they never leave the database.
 * The entire-level arm needs `enrollment.branchId` to equal `schedule.branchId`
 * (**`Enrollment.branch_id` since R66** — not the group's, which an ungrouped
 * student does not have), and Prisma cannot correlate two sibling relations
 * inside one `where` — so those schedules' `(levelId, branchId)` pairs are read
 * first.
 *
 * **What that costs, stated honestly:** the teacher's own *assignments* are read
 * at one instant rather than joined. The **student** side stays fully live in
 * every arm, so an enrolment change is reflected immediately; only a
 * simultaneous change to the teacher's own staffing could be a request stale,
 * and that is re-read on the next call. The alternative — dropping the branch
 * bound to keep it in one query — would silently widen a teacher's reach to
 * students at other branches, which is a correctness failure rather than a
 * performance one.
 */
export async function studentsTaughtBy(
  prisma: PrismaClient,
  teacherId: string,
  /**
   * **R73 — narrow to one Subject's teaching.** Absent, this is §4.4c's
   * subject-blind set, which is what content, exams and social data all use.
   * Supplied, it answers *"the students whose ⟨Subject⟩ she teaches"* — which
   * TD-2's Quran row now requires, because a مؤطرة teaching a مستفيدة only Fiqh
   * must not reach that مستفيدة's memorization.
   *
   * A **parameter on this resolver rather than a second one**: §4.4c is the
   * single definition of what a member of staff may reach, and a parallel
   * implementation is the drift its own wording warns about.
   */
  filter: { subjectId?: string } = {},
): Promise<Prisma.UserWhereInput> {
  const staffed = { some: { userId: teacherId, deletedAt: null } };
  const subject = filter.subjectId === undefined ? {} : { subjectId: filter.subjectId };

  const entireLevel = await prisma.recurringCourseSchedule.findMany({
    where: {
      deletedAt: null,
      teachingMode: 'entire_level',
      staff: staffed,
      ...subject,
    },
    select: { levelId: true, branchId: true },
  });

  const arms: Prisma.UserWhereInput[] = [
    {
      levelEnrollments: {
        some: {
          deletedAt: null,
          administrativeGroup: {
            deletedAt: null,
            schedules: {
              some: {
                deletedAt: null,
                teachingMode: 'administrative_group',
                staff: staffed,
                ...subject,
              },
            },
          },
        },
      },
    },
    {
      teachingGroupSeats: {
        some: {
          deletedAt: null,
          teachingGroup: {
            deletedAt: null,
            schedules: {
              some: { deletedAt: null, teachingMode: 'teaching_group', staff: staffed, ...subject },
            },
          },
        },
      },
    },
    // **R66 correction (R70.5).** This bound the branch through
    // `administrativeGroup.branchId`, which was the only answer while every
    // enrolment had a group. R66 moved the branch onto `Enrollment` and made
    // the group optional — so this arm silently excluded **every student
    // enrolled directly in an unsubdivided Level**, making them invisible to
    // their own teacher. The branch is read where R66 put it.
    ...entireLevel
      .filter((s): s is { levelId: string; branchId: string } => s.levelId !== null)
      .map((s) => ({
        levelEnrollments: {
          some: { deletedAt: null, levelId: s.levelId, branchId: s.branchId },
        },
      })),
  ];

  return { deletedAt: null, OR: arms };
}

/**
 * A teacher's branch scope — **stated directly by the schedules they staff**,
 * where the retired `GroupTeacher → Group → Branch` inferred it through two
 * hops (§4.4c). This is the one place the new model is simply better rather
 * than merely different.
 */
export async function teacherBranchIds(
  prisma: PrismaClient,
  teacherId: string,
): Promise<string[]> {
  const rows = await prisma.recurringCourseSchedule.findMany({
    where: { deletedAt: null, staff: { some: { userId: teacherId, deletedAt: null } } },
    select: { branchId: true },
  });
  return [...new Set(rows.map((r) => r.branchId))];
}

/** Whether a teacher staffs a specific session — the TD-2 predicate behind
 *  "Teacher: only sessions they staff". Co-teachers and assistants both count;
 *  §4.4c gives them one table and one rule. */
export async function staffsSession(
  prisma: PrismaClient,
  teacherId: string,
  sessionId: string,
): Promise<boolean> {
  const found = await prisma.session.findFirst({
    where: {
      id: sessionId,
      deletedAt: null,
      schedule: { deletedAt: null, staff: { some: { userId: teacherId, deletedAt: null } } },
    },
    select: { id: true },
  });
  return found !== null;
}

/**
 * **A teacher's scope for Hidden-event visibility (§4.4, Revision 43).**
 *
 * §4.4: a Teacher sees Hidden events *"whose scope intersects their own teaching
 * scope — an event scoped to one of their Administrative Groups, or to the
 * level, category or branch of anything they teach, or a global event"*.
 *
 * Replaces `teacherGroupIds` + a `Group` lookup. Each dimension is derived from
 * the schedules they staff (§4.4c), which is why this lives beside the rest of
 * that derivation rather than in the calendar service:
 *
 * - **branches** — stated directly by `schedule.branch_id`.
 * - **levels** — the target's level, whichever mode the schedule uses.
 * - **administrative groups** — those they teach directly, **plus** the groups
 *   the students of their Teaching Groups are organised into. A teacher of
 *   Quran Group 2 must see an event scoped to those students' administrative
 *   group; §4.4c's whole point is that the two groupings differ.
 */
export async function teacherEventScope(
  prisma: PrismaClient,
  teacherId: string,
): Promise<{
  branchIds: string[];
  levelIds: string[];
  categoryIds: string[];
  administrativeGroupIds: string[];
}> {
  const schedules = await prisma.recurringCourseSchedule.findMany({
    where: { deletedAt: null, staff: { some: { userId: teacherId, deletedAt: null } } },
    select: {
      branchId: true,
      levelId: true,
      administrativeGroupId: true,
      teachingGroupId: true,
      level: { select: { id: true, categoryId: true } },
      administrativeGroup: { select: { levelId: true, level: { select: { categoryId: true } } } },
      teachingGroup: { select: { levelId: true, level: { select: { categoryId: true } } } },
    },
  });

  const branchIds = new Set<string>();
  const levelIds = new Set<string>();
  const categoryIds = new Set<string>();
  const groupIds = new Set<string>();
  const teachingGroupIds: string[] = [];

  for (const s of schedules) {
    branchIds.add(s.branchId);
    if (s.administrativeGroupId) groupIds.add(s.administrativeGroupId);
    if (s.teachingGroupId) teachingGroupIds.push(s.teachingGroupId);

    const level = s.level ?? s.administrativeGroup?.level ?? s.teachingGroup?.level ?? null;
    const levelId = s.levelId ?? s.administrativeGroup?.levelId ?? s.teachingGroup?.levelId ?? null;
    if (levelId) levelIds.add(levelId);
    if (level) categoryIds.add(level.categoryId);
  }

  // The administrative groups behind a subject-specific split. Without this a
  // teacher of a Teaching Group would miss an event scoped to the very students
  // they teach, because those students are organised elsewhere (§4.4c).
  if (teachingGroupIds.length > 0) {
    const seats = await prisma.studentTeachingGroup.findMany({
      where: { teachingGroupId: { in: teachingGroupIds }, deletedAt: null },
      select: {
        student: {
          select: {
            levelEnrollments: {
              where: { deletedAt: null },
              select: { administrativeGroupId: true },
            },
          },
        },
      },
    });
    for (const seat of seats) {
      // R66 — a student in an unsubdivided Level has no group to add. Skipping
      // the null is correct rather than defensive: there is no administrative
      // group behind them, so no event scoped to one can concern them.
      for (const e of seat.student.levelEnrollments) {
        if (e.administrativeGroupId) groupIds.add(e.administrativeGroupId);
      }
    }
  }

  return {
    branchIds: [...branchIds],
    levelIds: [...levelIds],
    categoryIds: [...categoryIds],
    administrativeGroupIds: [...groupIds],
  };
}

/**
 * **The events a مؤطرة answers for (§4.4, SRS Revision 71.2).**
 *
 * Event scope is a **union**, and this is the arm the audit found missing:
 *
 * ```
 * events she may reach = events she staffs through EventStaff       ← here
 *                      ∪ events her §4.4c teaching scope reaches    ← teacherEventScope
 * ```
 *
 * Before R71 only the second arm existed, so a مؤطرة responsible for a
 * celebration who taught nothing had **empty event scope and could manage
 * nothing** — the association's own way of running an event was unrepresentable.
 *
 * **It lives here, beside the teaching derivation, deliberately.** §4.4c is the
 * single definition of what a member of staff may reach; a second resolver in
 * the event service would be the parallel authorization system R71 forbids.
 *
 * Returns the ids and the position held, because R71.3 makes position
 * authorization-bearing for events — unlike `CourseScheduleStaff`, where a
 * co-teacher and an assistant deliver the same class and R43 gave them one rule.
 */
export async function eventsStaffedBy(
  prisma: PrismaClient,
  userId: string,
): Promise<Map<string, 'responsible' | 'assistant'>> {
  const rows = await prisma.eventStaff.findMany({
    where: { userId, deletedAt: null, event: { deletedAt: null } },
    select: { eventId: true, position: true },
  });
  return new Map(rows.map((r) => [r.eventId, r.position]));
}

/**
 * Whether this مؤطرة is **responsible** for the event — the position R71.3
 * makes answerable, and therefore the one that carries the right to edit.
 *
 * An `assistant` deliberately returns `false`: they see the event, including a
 * Hidden one, and do not change it.
 */
export async function isResponsibleForEvent(
  prisma: PrismaClient,
  userId: string,
  eventId: string,
): Promise<boolean> {
  const row = await prisma.eventStaff.findFirst({
    where: { userId, eventId, position: 'responsible', deletedAt: null },
    select: { id: true },
  });
  return row !== null;
}

/**
 * **The Subject whose teaching authorises Quran progress (§4.5, R73.4).**
 *
 * `null` when no Subject is marked, which is a real state: the association may
 * not have configured it yet, and the honest consequence is that **no مؤطرة has
 * Quran scope** rather than that every مؤطرة does. Failing open here would
 * reinstate exactly the behaviour R73.3 was written to stop.
 */
export async function quranSubjectId(prisma: PrismaClient): Promise<string | null> {
  const row = await prisma.subject.findFirst({
    where: { tracksQuranProgress: true, deletedAt: null },
    select: { id: true },
  });
  return row?.id ?? null;
}

/**
 * **May this caller act on this مستفيدة's Quran progress?** (§4.5, TD-2 as
 * qualified by R73.3.)
 *
 * The three roles resolve the way TD-2 qualifies each, and only the مؤطرة's arm
 * differs from `assertCanAccessStudent`:
 *
 * - **Super Admin** — unscoped (§2.1).
 * - **Admin** — their branches, via `Enrollment.branch_id` (R66). **Unchanged
 *   by R73**: TD-2 grants them the row unqualified.
 * - **مؤطرة** — she must staff a **live** schedule whose Subject carries
 *   `tracks_quran_progress` **and whose audience contains this مستفيدة**, in any
 *   of §4.4c's three modes. **Teaching and assisting count equally** — R43 gave
 *   them one table and one rule, and `position` is not consulted here either.
 *
 * **Out of scope answers `404`, never `403`** (§20 rule 17): a response must
 * never be usable to discover that a minor's record exists.
 */
export async function assertCanManageQuranProgress(
  prisma: PrismaClient,
  actor: ScopedActor,
  studentId: string,
): Promise<void> {
  if (scope.isSuperAdmin(actor.roleScopes)) return;

  if (scope.hasRole(actor.roleScopes, 'admin')) {
    const managed = scope.branchesForRole(actor.roleScopes, 'admin');
    if (managed === null) return;
    const inScope = await prisma.enrollment.findFirst({
      where: { studentId, deletedAt: null, branchId: { in: managed } },
      select: { id: true },
    });
    if (inScope) return;
    // Falls through deliberately: an Admin who also teaches Quran may still
    // reach the student that way, checked below.
  }

  if (scope.hasRole(actor.roleScopes, 'teacher')) {
    const subjectId = await quranSubjectId(prisma);
    if (subjectId !== null) {
      const where = await studentsTaughtBy(prisma, actor.userId, { subjectId });
      const found = await prisma.user.findFirst({
        where: { ...where, id: studentId, deletedAt: null },
        select: { id: true },
      });
      if (found) return;
    }
  }

  throw new AppError('NOT_FOUND', 'no such student');
}

/** What an exam names, for the §4.4c scope test (R58's shape). */
export interface ExamScopeSpec {
  branchId: string;
  levelId: string;
  subjectId: string;
  /** `null` is **the whole Level** (R58), never "no target". */
  administrativeGroupId: string | null;
}

/**
 * **Whether a Teacher may organise this exam sitting (§4.4c, TD-2 as split by
 * R70.4).**
 *
 * §4.5 says *"teachers create exams manually"* and §2.1 that a Teacher
 * *"schedules/grades exams"*; R70.4 states the scope those grants carry. It is
 * §4.4c's existing derivation and nothing new — **the schedules they staff** —
 * applied to the four things an exam names:
 *
 * | Named by the exam | Must be |
 * |---|---|
 * | branch | a branch they staff |
 * | (level, subject) | taught together on a schedule they staff **at that branch** |
 * | a named group | a group they staff, or one whose students they teach |
 * | **no group — the whole Level** | a schedule they staff for that Level in `entire_level` mode |
 *
 * **The last row is the one worth stating.** A teacher of one group setting a
 * paper for the entire Level would be examining students they do not teach, so
 * the whole-Level target is granted only to somebody who already teaches the
 * whole Level. `administrative_group_id = NULL` means *everyone*, and authority
 * over everyone has to be held rather than inferred from authority over some.
 *
 * Admins and Super Admins never reach this: their scope is the branch, checked
 * by `branch-scope.ts` as it is everywhere else.
 */
export async function assertExamInTeacherScope(
  prisma: PrismaClient,
  teacherId: string,
  spec: ExamScopeSpec,
): Promise<void> {
  const schedules = await prisma.recurringCourseSchedule.findMany({
    where: {
      deletedAt: null,
      branchId: spec.branchId,
      subjectId: spec.subjectId,
      staff: { some: { userId: teacherId, deletedAt: null } },
    },
    select: {
      teachingMode: true,
      levelId: true,
      administrativeGroupId: true,
      administrativeGroup: { select: { levelId: true } },
      teachingGroup: { select: { levelId: true } },
    },
  });

  const forThisLevel = schedules.filter(
    (s) =>
      (s.levelId ?? s.administrativeGroup?.levelId ?? s.teachingGroup?.levelId ?? null) ===
      spec.levelId,
  );

  if (forThisLevel.length === 0) {
    throw new AppError('FORBIDDEN', 'this level and subject are outside your teaching scope', {
      reason: 'EXAM_OUT_OF_SCOPE',
    });
  }

  if (spec.administrativeGroupId === null) {
    // The whole Level — held, never inferred. See the docstring.
    if (!forThisLevel.some((s) => s.teachingMode === 'entire_level')) {
      throw new AppError('FORBIDDEN', 'you do not teach this whole level', {
        reason: 'WHOLE_LEVEL_OUT_OF_SCOPE',
      });
    }
    return;
  }

  // A named group: one they staff directly, or one whose students they teach
  // through a Teaching Group — the same union `teacherEventScope` resolves,
  // reused rather than restated.
  const reachable = await teacherEventScope(prisma, teacherId);
  if (!reachable.administrativeGroupIds.includes(spec.administrativeGroupId)) {
    throw new AppError('FORBIDDEN', 'that group is outside your teaching scope', {
      reason: 'GROUP_OUT_OF_SCOPE',
    });
  }
}

/**
 * **Whether a teacher may act on this student (§4.4c, TD-2, BR-16).**
 *
 * Replaces `teachesStudent`, which resolved through `GroupTeacher`. One query
 * via the composable predicate, so scope and subject are evaluated together and
 * there is no window in which the staffing could change between them.
 */
export async function teachesStudent(
  prisma: PrismaClient,
  teacherId: string,
  studentId: string,
): Promise<boolean> {
  const where = await studentsTaughtBy(prisma, teacherId);
  const found = await prisma.user.findFirst({
    where: { ...where, id: studentId },
    select: { id: true },
  });
  return found !== null;
}

/** The caller as the freshness policy resolves them (§4.2 Revision 24). */
export interface ScopedActor {
  userId: string;
  roleScopes: { role: string; branches: string[] | null }[];
}

/**
 * Asserts the caller may act on a student's record (§4.10, BR-16, TD-2).
 *
 * Replaces `teacher-scope.assertCanAccessStudent`. Each role is resolved the way
 * TD-2 qualifies it:
 *
 * - **Super Admin** — unscoped by role (§2.1).
 * - **Admin** — constrained to their branch scope. **A student's branch is now
 *   `Enrollment → AdministrativeGroup.branch_id`** (§4.4c), not the retired
 *   `StudentGroup → Group`. An all-branches Admin reaches every student.
 * - **Teacher** — only the students of the courses they staff.
 *
 * **Out of scope answers `404`, never `403`** (§20 rule 17), so a response can
 * never be used to discover that a minor's record exists.
 */
export async function assertCanAccessStudent(
  prisma: PrismaClient,
  actor: ScopedActor,
  studentId: string,
): Promise<void> {
  if (scope.isSuperAdmin(actor.roleScopes)) return;

  if (scope.hasRole(actor.roleScopes, 'admin')) {
    const managed = scope.branchesForRole(actor.roleScopes, 'admin');
    if (managed === null) return; // all-branches Admin

    // R66 (R70.5) — `Enrollment.branch_id` is the single answer to *where is
    // this student*. Resolving it through the group meant a branch-scoped Admin
    // could not reach an ungrouped student at their own branch.
    const inScope = await prisma.enrollment.findFirst({
      where: { studentId, deletedAt: null, branchId: { in: managed } },
      select: { id: true },
    });
    if (inScope) return;
    // Deliberately falls through: an Admin who also teaches may still reach the
    // student through their own courses, checked below.
  }

  if (
    scope.hasRole(actor.roleScopes, 'teacher') &&
    (await teachesStudent(prisma, actor.userId, studentId))
  ) {
    return;
  }

  throw new AppError('NOT_FOUND', 'no such student in scope');
}
