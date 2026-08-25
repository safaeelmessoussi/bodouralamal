import type {
  Prisma,
  PrismaClient,
  TeachingMode,
} from "../generated/prisma/client.js";
import { AppError } from "../lib/errors.js";
import * as scope from "./branch-scope.js";
import { calendarDay, effectiveOn } from "./effective-staffing.js";

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
  /**
   * **R92 — one occurrence's own audience branches**, when it has them.
   *
   * `undefined`/`null` is the ordinary case: the audience is the schedule's, at
   * `branchId`. A non-empty list **replaces** that branch for this occurrence,
   * so *Targa + the second branch* is two entries — the semantics are
   * replacement rather than addition, because an additive reading leaves nobody
   * able to say whether the schedule's own branch is still included.
   *
   * **`entire_level` only.** In the other two modes the branch is carried by the
   * target itself (§7: a group IS at one branch), so a branch list has no
   * meaning there and is ignored rather than half-applied — see the note in
   * `audienceWhere`.
   */
  audienceBranchIds?: string[] | null;
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
    case "entire_level": {
      if (spec.levelId === null)
        throw new Error(unreachable("entire_level", "levelId"));
      /**
       * **R92 — the branches this audience is drawn from.**
       *
       * Ordinarily the one branch the schedule meets at. For a combined
       * occurrence it is the list that occurrence carries, which **replaces**
       * the schedule's branch rather than adding to it.
       *
       * The `Level` is unchanged either way: two branches running the same
       * Level is exactly the case, and combining them is a statement about
       * *where the people come from*, never about what is being taught.
       */
      const branches =
        spec.audienceBranchIds && spec.audienceBranchIds.length > 0
          ? spec.audienceBranchIds
          : [spec.branchId];
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
            branchId: { in: branches },
          },
        },
      };
    }
    case "administrative_group": {
      if (spec.administrativeGroupId === null) {
        throw new Error(
          unreachable("administrative_group", "administrativeGroupId"),
        );
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
      //
      // **R92's override is therefore not applied in this mode**, deliberately.
      // Combining two Administrative Groups across branches is a different
      // business question — whether the *other* group's members attend, not
      // whether another branch's Level population does — and R92 §B6 says to
      // implement the whole-Level case and report the rest rather than invent
      // semantics nobody asked for. `audienceForSession` refuses to write an
      // override on a non-`entire_level` schedule, so this arm can never be
      // reached with one stored.
    }
    case "teaching_group": {
      if (spec.teachingGroupId === null) {
        throw new Error(unreachable("teaching_group", "teachingGroupId"));
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

/**
 * **`audienceForSession` — the ONE answer to *who is expected at this
 * occurrence*** (R92 §B7).
 *
 * Every consumer composes this: the beneficiary's calendar, the session roster,
 * cancellation and reschedule notifications, the audit row's `audience_size`,
 * and the Quran occurrence arm. **Nobody adds a cross-branch `OR` of their
 * own** — the failure R92 exists to avoid is notifications honouring an
 * override while the calendar quietly does not, which would leave a beneficiary
 * told about a class she cannot see.
 *
 * `null` when the session or its schedule is gone, so a caller decides what a
 * missing occurrence means rather than being handed an empty audience that
 * looks like *nobody is expected*.
 */
export async function audienceForSession(
  prisma: Prisma.TransactionClient | PrismaClient,
  sessionId: string,
): Promise<AudienceSpec | null> {
  const session = await prisma.session.findFirst({
    where: { id: sessionId, deletedAt: null },
    select: {
      audienceBranches: { select: { branchId: true } },
      schedule: {
        select: {
          teachingMode: true,
          levelId: true,
          administrativeGroupId: true,
          teachingGroupId: true,
          branchId: true,
        },
      },
    },
  });
  if (!session?.schedule) return null;

  const override = session.audienceBranches.map((b) => b.branchId);
  return {
    ...session.schedule,
    // Empty means INHERIT — the ordinary case, and every occurrence but the
    // rare combined one.
    audienceBranchIds: override.length > 0 ? override : null,
  };
}

/**
 * **The branches an occurrence draws its audience from, for display.**
 *
 * Returns the inherited single branch when there is no override, so a roster or
 * a dialog can say *who is expected* without knowing whether an override exists
 * — and can say *where it happens* separately, which is a different fact
 * (R92 §B2).
 */
export async function audienceBranchesForSession(
  prisma: PrismaClient,
  sessionId: string,
): Promise<{ branchIds: string[]; overridden: boolean } | null> {
  const spec = await audienceForSession(prisma, sessionId);
  if (spec === null) return null;
  return spec.audienceBranchIds && spec.audienceBranchIds.length > 0
    ? { branchIds: spec.audienceBranchIds, overridden: true }
    : { branchIds: [spec.branchId], overridden: false };
}

/** Resolve a schedule's audience to actual student rows. */
export async function resolveAudience(
  prisma: PrismaClient | Prisma.TransactionClient,
  spec: AudienceSpec,
  select?: Prisma.UserSelect,
): Promise<{ id: string }[]> {
  return prisma.user.findMany({
    where: audienceWhere(spec),
    select: select ?? { id: true },
    orderBy: { nameArabic: "asc" },
  }) as Promise<{ id: string }[]>;
}

/** How many students a schedule's audience resolves to. Used by the TD-8
 *  `session.cancel` audit row, where "how many people did this affect" becomes
 *  unanswerable later once the roster has moved on. */
export async function audienceSize(
  prisma: PrismaClient,
  spec: AudienceSpec,
): Promise<number> {
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
  /**
   * **R91 — which day's assignments count.**
   *
   * `on` defaults to **today**, because every existing caller was asking *whom
   * do I teach now* and reading a time-blind row as the answer. The parameter
   * exists so a caller with a different date in hand — an occurrence being
   * graded, a class being planned — says so rather than being silently answered
   * about today. Each caller's meaning is documented at its call site and in
   * `docs/development/teaching-authority.md`.
   *
   * **A past occurrence is NOT this function's question.** Who actually took a
   * class is `SessionStaff` (R43.4), and resolving it through the schedule is
   * precisely what would let a staffing change rewrite history.
   */
  filter: { subjectId?: string; on?: Date } = {},
): Promise<Prisma.UserWhereInput> {
  const on = filter.on ?? new Date();
  const staffed = { some: { userId: teacherId, ...effectiveOn(on) } };

  /**
   * **The occurrence arm** (R91, §11/§27).
   *
   * A مؤطِّرة may be assigned to ONE Session and to no schedule at all — a cover
   * for a single lesson, which lives in R43.4's snapshot. She must reach that
   * occurrence's students on its day, and reach nobody through it on any other.
   *
   * Without this arm the platform had a menu with no roster behind it: R87 §J
   * opened «إدخال الحفظ» for a one-off cover while this resolver, which knew
   * only about schedules, handed her an empty list. Rule **P** inverted.
   */
  const subject =
    filter.subjectId === undefined ? {} : { subjectId: filter.subjectId };

  /**
   * **The OCCURRENCE arm** (R91 §11/§27, corrected for R92 on 2026-08-20).
   *
   * Two things happen on a given day that the schedule alone cannot express,
   * and both are answered here because both are facts about *one occurrence*:
   *
   * 1. **A one-off cover.** A مؤطِّرة may be assigned to ONE Session and to no
   *    schedule at all — R43.4's snapshot. She must reach that occurrence's
   *    students on its day, and reach nobody through it on any other. Without
   *    this the platform had a menu with no roster behind it: R87 §J opened
   *    «إدخال الحفظ» for a cover while this resolver, which knew only about
   *    schedules, handed her an empty list — rule **P** inverted.
   *
   * 2. **A combined audience.** When two branches' classes meet together for
   *    one occurrence (R92), whoever teaches it must reach everybody actually
   *    expected at it — including the visiting branch.
   *
   * **This arm previously read `audienceWhere(session.schedule)`**, which is the
   * schedule's *inherited* audience and therefore silently ignored the
   * occurrence's own `SessionAudienceBranch` rows. `audienceForSession`'s own
   * docstring already named "the Quran occurrence arm" among its consumers — the
   * consumer had simply never been connected, so a مؤطِّرة teaching a combined
   * Quran lesson could not log the visiting branch's memorisation. It composes
   * the canonical resolver now; **no second cross-branch `OR` is written here**.
   *
   * **And it does not widen anything permanently.** The query is bound to `on`,
   * so the next ordinary occurrence — which carries no override — resolves to
   * the schedule's own branch again and the visitors disappear. That is the
   * property R92 §B9 requires, and it follows from the date rather than from a
   * rule anybody has to remember.
   */
  const occurrences = await prisma.session.findMany({
    where: {
      deletedAt: null,
      date: calendarDay(on),
      schedule: { deletedAt: null, ...subject },
      OR: [
        // She took this one specifically — a cover, or the snapshot
        // materialization wrote for her.
        { staff: { some: { userId: teacherId, deletedAt: null } } },
        // Or she staffs the schedule it came from, effective on that day. This
        // half is what carries R92 to a teacher who is NOT a cover: without it
        // the combined audience would reach a substitute and not the regular
        // مؤطِّرة.
        { schedule: { staff: staffed } },
      ],
    },
    select: { id: true },
  });

  const occurrenceArms: Prisma.UserWhereInput[] = [];
  for (const occurrence of occurrences) {
    // The ONE resolver (R92 §B7): the schedule's audience, unless this
    // occurrence states its own branches.
    const spec = await audienceForSession(prisma, occurrence.id);
    if (spec !== null) occurrenceArms.push(audienceWhere(spec));
  }


  const entireLevel = await prisma.recurringCourseSchedule.findMany({
    where: {
      deletedAt: null,
      teachingMode: "entire_level",
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
                teachingMode: "administrative_group",
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
              some: {
                deletedAt: null,
                teachingMode: "teaching_group",
                staff: staffed,
                ...subject,
              },
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
      .filter(
        (s): s is { levelId: string; branchId: string } => s.levelId !== null,
      )
      .map((s) => ({
        levelEnrollments: {
          some: { deletedAt: null, levelId: s.levelId, branchId: s.branchId },
        },
      })),
    // Each occurrence's own audience, resolved through the SAME canonical
    // `audienceForSession` every other reader uses (R92 §B7) — never a fourth
    // arm written by hand here.
    ...occurrenceArms,
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
  /** R91 — the day whose assignments decide her branches. Today by default:
   *  uploading content and listing branches are things somebody does *now*. */
  on: Date = new Date(),
): Promise<string[]> {
  const rows = await prisma.recurringCourseSchedule.findMany({
    where: {
      deletedAt: null,
      staff: { some: { userId: teacherId, ...effectiveOn(on) } },
    },
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
  /**
   * **R91 — the OCCURRENCE's own staffing decides, then the schedule as it
   * stands on that occurrence's date.**
   *
   * This asked only *does she staff the schedule*, time-blind, which after R91
   * would give a replacement authority over occurrences outside her period and
   * would strip the previous teacher of the ones she actually took.
   *
   * The two arms are the two truths, in precedence order:
   *
   * 1. `SessionStaff` — R43.4's snapshot, and an occurrence-specific override
   *    (a one-off cover) lives here and nowhere else. It is *who took this
   *    class*, and for a past date it is the only honest answer.
   * 2. The schedule's assignments **effective on that occurrence's date** — for
   *    a future occurrence not yet re-snapshotted, and for one whose snapshot
   *    is being written.
   */
  const session = await prisma.session.findFirst({
    where: { id: sessionId, deletedAt: null },
    select: { id: true, date: true, scheduleId: true },
  });
  if (!session) return false;

  const snapshot = await prisma.sessionStaff.count({
    where: { sessionId: session.id, userId: teacherId, deletedAt: null },
  });
  if (snapshot > 0) return true;

  const assigned = await prisma.courseScheduleStaff.count({
    where: {
      scheduleId: session.scheduleId,
      userId: teacherId,
      ...effectiveOn(session.date),
      schedule: { deletedAt: null },
    },
  });
  return assigned > 0;
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
  /** R91 — hidden-event visibility is a *now* question: what she is teaching
   *  today decides what she may see today. */
  on: Date = new Date(),
): Promise<{
  branchIds: string[];
  levelIds: string[];
  categoryIds: string[];
  administrativeGroupIds: string[];
}> {
  const schedules = await prisma.recurringCourseSchedule.findMany({
    where: {
      deletedAt: null,
      staff: { some: { userId: teacherId, ...effectiveOn(on) } },
    },
    select: {
      branchId: true,
      levelId: true,
      administrativeGroupId: true,
      teachingGroupId: true,
      level: { select: { id: true, categoryId: true } },
      administrativeGroup: {
        select: { levelId: true, level: { select: { categoryId: true } } },
      },
      teachingGroup: {
        select: { levelId: true, level: { select: { categoryId: true } } },
      },
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

    const level =
      s.level ?? s.administrativeGroup?.level ?? s.teachingGroup?.level ?? null;
    const levelId =
      s.levelId ??
      s.administrativeGroup?.levelId ??
      s.teachingGroup?.levelId ??
      null;
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
): Promise<Map<string, "responsible" | "assistant">> {
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
    where: { userId, eventId, position: "responsible", deletedAt: null },
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
/**
 * **Does this person staff a Quran class at all?** (R87 §M.)
 *
 * The teaching menu shows «إدخال الحفظ» only to somebody who actually teaches
 * the Subject, and the Owner named exactly what that may NOT be derived from:
 * the teacher role, a declared capability, the Subject's Arabic name, or
 * hard-coded text. It is derived from **staffing a schedule whose Subject
 * carries R73's `tracks_quran_progress` marker** — the same structural fact the
 * student list already narrows by, asked as a yes/no.
 *
 * **Position-blind**, like every other teaching predicate here: an assistant on
 * a Quran class teaches Quran (R87 §G).
 */
export async function teachesQuran(
  prisma: PrismaClient,
  userId: string,
  /** R91 — «إدخال الحفظ» answers *do I teach Quran now*, so the marker is about
   *  today and about what is still ahead. */
  on: Date = new Date(),
): Promise<boolean> {
  const subjectId = await quranSubjectId(prisma);
  if (subjectId === null) return false;

  // **R91 — an assignment that ENDED must not keep the menu open.** This
  // counted any live staffing row, so a مؤطِّرة whose Quran period finished in
  // November still saw «إدخال الحفظ» in March and, worse, still resolved a
  // roster through `studentsTaughtBy`. The period is now part of the question.
  const staffed = await prisma.recurringCourseSchedule.count({
    where: {
      deletedAt: null,
      subjectId,
      staff: { some: { userId, ...effectiveOn(on) } },
    },
  });
  if (staffed > 0) return true;

  /**
   * **A one-off occurrence counts — on ITS OWN DAY** (R87 §J, narrowed by R91).
   *
   * R87 opened the screen for a مؤطرة assigned to a single Quran session,
   * because hiding it would hide the only thing she was asked to do. R91 makes
   * *which day* part of the question, and the day is **this one**:
   *
   * * `{ gte: today }` would open the menu for a cover a month away while
   *   `studentsTaughtBy` — which answers about today — handed her an empty
   *   roster. **A menu that opens an empty screen is rule P inverted**, and it
   *   is worse than a hidden one because it looks like a defect in the data.
   * * A cover taken last term is history, not a current assignment.
   *
   * The marker and the roster now ask the same question of the same day, which
   * is the property that makes them agree.
   */
  const occurrence = await prisma.session.count({
    where: {
      deletedAt: null,
      date: calendarDay(on),
      schedule: { subjectId, deletedAt: null },
      staff: { some: { userId, deletedAt: null } },
    },
  });
  return occurrence > 0;
}

export async function quranSubjectId(
  prisma: PrismaClient,
): Promise<string | null> {
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

  if (scope.hasRole(actor.roleScopes, "admin")) {
    const managed = scope.branchesForRole(actor.roleScopes, "admin");
    if (managed === null) return;
    const inScope = await prisma.enrollment.findFirst({
      where: { studentId, deletedAt: null, branchId: { in: managed } },
      select: { id: true },
    });
    if (inScope) return;
    // Falls through deliberately: an Admin who also teaches Quran may still
    // reach the student that way, checked below.
  }

  if (scope.hasRole(actor.roleScopes, "teacher")) {
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

  throw new AppError("NOT_FOUND", "no such student");
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
  /**
   * **R91 — the date the exam's authority is judged on.**
   *
   * The exam's own date when it has one, so a مؤطِّرة authoring a paper for a
   * sitting inside her replacement period is authorised for it, and one whose
   * assignment ended before the sitting is not. Falls back to today for the
   * grade-sheet reads that carry no date of their own.
   */
  on: Date = new Date(),
): Promise<void> {
  const schedules = await prisma.recurringCourseSchedule.findMany({
    where: {
      deletedAt: null,
      branchId: spec.branchId,
      subjectId: spec.subjectId,
      staff: { some: { userId: teacherId, ...effectiveOn(on) } },
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
      (s.levelId ??
        s.administrativeGroup?.levelId ??
        s.teachingGroup?.levelId ??
        null) === spec.levelId,
  );

  if (forThisLevel.length === 0) {
    throw new AppError(
      "FORBIDDEN",
      "this level and subject are outside your teaching scope",
      {
        reason: "EXAM_OUT_OF_SCOPE",
      },
    );
  }

  if (spec.administrativeGroupId === null) {
    // The whole Level — held, never inferred. See the docstring.
    if (!forThisLevel.some((s) => s.teachingMode === "entire_level")) {
      throw new AppError("FORBIDDEN", "you do not teach this whole level", {
        reason: "WHOLE_LEVEL_OUT_OF_SCOPE",
      });
    }
    return;
  }

  // A named group: one they staff directly, or one whose students they teach
  // through a Teaching Group — the same union `teacherEventScope` resolves,
  // reused rather than restated.
  const reachable = await teacherEventScope(prisma, teacherId);
  if (!reachable.administrativeGroupIds.includes(spec.administrativeGroupId)) {
    throw new AppError(
      "FORBIDDEN",
      "that group is outside your teaching scope",
      {
        reason: "GROUP_OUT_OF_SCOPE",
      },
    );
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

  if (scope.hasRole(actor.roleScopes, "admin")) {
    const managed = scope.branchesForRole(actor.roleScopes, "admin");
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
    scope.hasRole(actor.roleScopes, "teacher") &&
    (await teachesStudent(prisma, actor.userId, studentId))
  ) {
    return;
  }

  throw new AppError("NOT_FOUND", "no such student in scope");
}

/* ── Event audiences (R82) ────────────────────────────────────────────────── */

/**
 * **Who an Event concerns**, resolved from the scope rows it was addressed to.
 *
 * An Event's scope is not a schedule's: it has no `teaching_mode` and no single
 * target, but any combination of Branch, Category, Level and Administrative
 * Group rows (§7). So this is a second *predicate* over the same `User` table
 * rather than a second audience *system* — it composes the same enrolment
 * relations `audienceWhere` uses, and both are read at request time so neither
 * takes a snapshot of a roster that can move underneath it.
 *
 * ## The rules, and why each is what it is
 *
 * | Scope | Audience |
 * |---|---|
 * | **Branch** | everyone enrolled at that branch |
 * | **Category** | everyone enrolled in a Level of that Category, **across branches** |
 * | **Level** | everyone enrolled in that Level |
 * | **Administrative Group** | its members |
 * | **Branch + Category** | the **intersection** — enrolled in that Category's Levels *at* that branch |
 *
 * Scopes of *different* kinds intersect and scopes of the *same* kind union: an
 * event addressed to two branches concerns both, while an event addressed to a
 * branch and a category concerns the people in both at once. That is what the
 * scope rows say — naming a Category alongside a Branch narrows the Branch, it
 * does not add a second, unrelated population.
 *
 * ## A global Event notifies nobody
 *
 * An Event with **no scope rows at all** is global (§7, BR-20). This returns a
 * predicate matching nobody rather than everybody, and R82 states the reason:
 * *everyone in the platform* is not an audience the association has asked for,
 * and a notification sent to it cannot be recalled. It still appears on the
 * public calendar, which is how a global event reaches people.
 *
 * **Teaching Circles are absent because the model has none**: there is no
 * `EventTeachingGroup` join, so an event cannot be addressed to a circle. A
 * *Session* can, through its schedule's `teaching_mode`, which `audienceWhere`
 * already resolves. Inventing the join here would be inventing a domain
 * relationship the SRS does not define (§20 rule 16).
 */
export interface EventScopeRows {
  branchIds: string[];
  categoryIds: string[];
  levelIds: string[];
  administrativeGroupIds: string[];
}

export function eventAudienceWhere(
  scopes: EventScopeRows,
): Prisma.UserWhereInput | null {
  const { branchIds, categoryIds, levelIds, administrativeGroupIds } = scopes;
  if (
    branchIds.length === 0 &&
    categoryIds.length === 0 &&
    levelIds.length === 0 &&
    administrativeGroupIds.length === 0
  ) {
    // Global: see the note above. `null` rather than an empty `where`, because
    // an empty `where` matches EVERY user and would be the exact accident this
    // returns early to prevent.
    return null;
  }

  /**
   * One enrolment must satisfy **all** the named kinds at once.
   *
   * Written as a single `some` rather than one `some` per kind: separate ones
   * would be satisfied by *different* enrolments, so a student enrolled in
   * Category A at Branch 1 and Category B at Branch 2 would match an event for
   * "Category A at Branch 2" — which describes nobody.
   */
  const enrolment: Prisma.EnrollmentWhereInput = { deletedAt: null };
  if (branchIds.length > 0) enrolment.branchId = { in: branchIds };
  if (levelIds.length > 0) enrolment.levelId = { in: levelIds };
  if (categoryIds.length > 0)
    enrolment.level = { categoryId: { in: categoryIds } };
  if (administrativeGroupIds.length > 0) {
    enrolment.administrativeGroupId = { in: administrativeGroupIds };
    enrolment.administrativeGroup = { deletedAt: null };
  }

  return { deletedAt: null, levelEnrollments: { some: enrolment } };
}
