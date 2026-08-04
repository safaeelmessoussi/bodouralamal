import type { Prisma, PrismaClient, TeachingMode } from '../generated/prisma/client.js';

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
 * | `entire_level`         | one `Level`           | that Level's students **whose group is at the schedule's branch** |
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
            administrativeGroup: { deletedAt: null, branchId: spec.branchId },
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
