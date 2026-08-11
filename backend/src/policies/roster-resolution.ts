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
 * The entire-level arm needs `enrollment.administrativeGroup.branchId` to equal
 * `schedule.branchId`, and Prisma cannot correlate two sibling relations inside
 * one `where` — so those schedules' `(levelId, branchId)` pairs are read first.
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
): Promise<Prisma.UserWhereInput> {
  const staffed = { some: { userId: teacherId, deletedAt: null } };

  const entireLevel = await prisma.recurringCourseSchedule.findMany({
    where: {
      deletedAt: null,
      teachingMode: 'entire_level',
      staff: staffed,
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
            schedules: { some: { deletedAt: null, teachingMode: 'administrative_group', staff: staffed } },
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
            schedules: { some: { deletedAt: null, teachingMode: 'teaching_group', staff: staffed } },
          },
        },
      },
    },
    ...entireLevel
      .filter((s): s is { levelId: string; branchId: string } => s.levelId !== null)
      .map((s) => ({
        levelEnrollments: {
          some: {
            deletedAt: null,
            levelId: s.levelId,
            administrativeGroup: { deletedAt: null, branchId: s.branchId },
          },
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

    const inScope = await prisma.enrollment.findFirst({
      where: {
        studentId,
        deletedAt: null,
        administrativeGroup: { deletedAt: null, branchId: { in: managed } },
      },
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
