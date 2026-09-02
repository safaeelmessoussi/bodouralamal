import type {
  Prisma,
  PrismaClient,
  RecurringCourseSchedule,
  TeachingMode,
  Visibility,
} from "../generated/prisma/client.js";
import { AppError } from "../lib/errors.js";
import { assertTypeOfKind } from "./scheduling-type.service.js";
import {
  intervalsOverlap,
  withinScheduleLife,
  type Interval,
} from "../policies/effective-staffing.js";
import {
  page,
  pageWindow,
  type Page,
  type PageParams,
} from "../lib/pagination.js";
import {
  addDays,
  atMidnightUtc,
  expandSchedule,
  timesOverlap,
} from "../lib/recurrence.js";
import * as scope from "../policies/branch-scope.js";
import { assertSubjectTaughtAtLevel } from "../policies/curriculum.js";
import {
  resolveDelivery,
  type Delivery,
} from "../policies/delivery.js";
import { resolveAudience } from "../policies/roster-resolution.js";
import * as audit from "../repositories/audit.repository.js";
import * as trash from "../repositories/trash.repository.js";
import { enqueue, JOB_QUEUES } from "../repositories/jobs.repository.js";
import { updateWithVersion } from "../repositories/optimistic-lock.js";
import type { Actor } from "../policies/actor.js";
import {
  protectionReasons,
  SELECT_PROTECTABLE,
} from "../policies/session-protection.js";
import {
  horizonFor,
  loadSchedule,
  materializeSchedule,
  type MaterializeResult,
} from "./session-materialize.service.js";
import { assertStaffAccountsAvailable } from "./staffing-integrity.service.js";

/**
 * Recurring Course Schedules — the unit of **delivery** (SRS §4.4, §4.4c,
 * TD-4.6c, TD-15.2, Revision 43).
 *
 * A schedule carries the Subject, a **teaching mode with exactly one target**,
 * the branch, the room, its staff, the times, and a recurrence rule. The
 * database refuses any other mode/target combination
 * (`course_schedule_mode_target_check`), so this service treats that constraint
 * as a backstop and states the same rule in terms an administrator can act on.
 *
 * **Conflict detection runs against materialized Sessions, never against
 * recurrence rules** (§4.4). That is the whole reason materialization is eager:
 * comparing rules cannot see that a weekly and a biweekly-alternating Tuesday
 * 15:00 collide only on alternate weeks. Room, teacher **and assistant** are
 * each checked — a person cannot be in two rooms at once any more than a room
 * can hold two classes.
 *
 * **TD-4.6c is a check-then-write invariant**, so the governing rows are taken
 * `FOR UPDATE` before the check (TD-15.2): two administrators booking one room
 * at one instant must not both succeed.
 *
 * The `/admin/course-schedules` endpoints were mounted in the TD-3.12 HTTP
 * slice; `listCourseSchedules` and `resolveScheduleRoster` at the foot of this
 * file were written then, because nothing had needed them before.
 */

const MANAGING_ROLE = "admin";

const isSuperAdmin = (actor: Actor): boolean =>
  scope.isSuperAdmin(actor.roleScopes);

function assertCanManage(actor: Actor): void {
  if (!(
    scope.hasRole(actor.roleScopes, MANAGING_ROLE) || isSuperAdmin(actor)
  )) {
    throw new AppError(
      "FORBIDDEN",
      "course schedule management requires admin",
    );
  }
}

/** Whether this caller manages schedules — creates, edits, deletes them. */
const isManager = (actor: Actor): boolean =>
  scope.hasRole(actor.roleScopes, MANAGING_ROLE) || isSuperAdmin(actor);

/**
 * **Reading a schedule is not managing one** (Document Owner decision,
 * 2026-08-05).
 *
 * §14.1 gives a Teacher a *My Teaching* screen listing the schedules they staff,
 * and §5.6 line 753 grants them roster access to its resolved audience — while
 * being explicit that they **do not create or edit schedules**. That is a
 * difference in *scope*, not in *resource*: the representation a teacher needs
 * is byte-identical to an administrator's, so it is served by the same endpoint
 * with role-scoped data rather than by a second route returning the same shape.
 *
 * **`/admin/` is a routing namespace, not an authorization boundary** — a
 * sentence this codebase already repeats everywhere the prefix appears, now
 * applied to who may read as well as to which branch they may reach.
 */
function assertCanRead(actor: Actor): void {
  if (!(isManager(actor) || scope.hasRole(actor.roleScopes, "teacher"))) {
    throw new AppError(
      "FORBIDDEN",
      "reading course schedules requires admin or teaching staff",
    );
  }
}

/**
 * The `where` fragment that limits a reader to what they may see.
 *
 * **A manager is scoped by branch; a teacher by the schedules they staff**
 * (§4.4c — `CourseScheduleStaff` is the single teacher-scope resolution, stated
 * once there and pointed at everywhere else). A caller holding both roles is
 * scoped as a manager: the wider reach is the one their administrative role
 * grants, and intersecting the two would hide a colleague's schedule from an
 * administrator merely because they also teach.
 */
function readableScope(actor: Actor): Prisma.RecurringCourseScheduleWhereInput {
  if (isManager(actor)) {
    const branches = scope.branchesForRole(actor.roleScopes, MANAGING_ROLE);
    // `null` means all-branches (§7, R24) — not "no branches".
    return branches === null ? {} : { branchId: { in: branches } };
  }
  /**
   * **Period-blind, deliberately** (R91).
   *
   * Every *operational* consumer became date-aware — whom she may act on, whose
   * memorisation she may enter, whose calendar she appears on. This is not one
   * of them: it decides which class DEFINITIONS a مؤطِّرة may read, and hiding a
   * class she taught last term would hide her own history from her while
   * granting nobody anything. She may read it; `studentsTaughtBy` decides what
   * she may do about its students, and that is the check that moved.
   */
  return { staff: { some: { userId: actor.userId, deletedAt: null } } };
}

export interface ScheduleStaffInput {
  userId: string;
  position: "teacher" | "assistant";
  /**
   * **R91 — the assignment's inclusive calendar bounds.** `null`/absent at
   * either end is open-ended there: *from the schedule's beginning* and
   * *through the schedule's end*. Absent on both is what every pre-R91 row
   * means, which is why the migration needed no backfill.
   */
  effectiveFrom?: Date | null;
  effectiveUntil?: Date | null;
}

/**
 * **The interval invariants, enforced under a row lock** (R91 §6, §7, §28).
 *
 * Two rules, and neither is a unique index:
 *
 * 1. **At most one main مؤطِّرة active on any date.** Two overlapping
 *    `teacher` rows mean the class has two people in charge on the overlapping
 *    days, and every consumer would then have to pick one arbitrarily.
 * 2. **No overlapping intervals for the SAME person on one schedule** — of any
 *    position. Two overlapping rows for Safa are two answers to *is she
 *    assigned on the 5th*, and being both main teacher and assistant on one day
 *    is not a thing the association can mean.
 *
 * **Assistants are not subject to rule 1**, deliberately: any number of them may
 * be active at once, which is the whole point of the position existing.
 *
 * **The lock is why this is safe against two administrators at once.** Validating
 * against a read and then writing would let both pass — the classic
 * check-then-act race — so the schedule's staffing rows are locked `FOR UPDATE`
 * first, exactly as TD-15.2 prescribes for the room-conflict check, and the
 * second transaction blocks until the first commits and then sees its rows.
 *
 * The alternative — a PostgreSQL `EXCLUDE USING gist` constraint — needs the
 * `btree_gist` extension, which §3.1's deployment does not install and TD-13
 * does not list. §28 says not to make migrations fragile for a declarative
 * invariant; this is that trade, taken deliberately and recorded.
 */
async function assertStaffIntervals(
  tx: Prisma.TransactionClient,
  scheduleId: string,
  staff: ScheduleStaffInput[],
  schedule: { anchorDate: Date | null; effectiveUntil: Date | null },
): Promise<void> {
  // TD-15.2 — lock the governing rows BEFORE the check.
  await tx.$queryRaw`
    SELECT id FROM "course_schedule_staff"
    WHERE schedule_id = ${scheduleId}::uuid AND deleted_at IS NULL
    FOR UPDATE`;

  const asInterval = (s: ScheduleStaffInput): Interval => ({
    from: s.effectiveFrom ?? null,
    until: s.effectiveUntil ?? null,
  });

  for (const s of staff) {
    // §5 — a period entirely outside the schedule's own life is meaningless,
    // and REFUSED rather than clipped: silently rewriting a date an
    // administrator typed leaves her believing she recorded something she did
    // not, and the boundary she got wrong is the one she needs told about.
    if (!withinScheduleLife(asInterval(s), schedule)) {
      throw new AppError(
        "VALIDATION_FAILED",
        "staffing period falls outside the schedule",
        {
          reason: "STAFF_PERIOD_OUTSIDE_SCHEDULE",
          user_id: s.userId,
        },
      );
    }
  }

  const clash = (a: ScheduleStaffInput, b: ScheduleStaffInput): boolean =>
    intervalsOverlap(asInterval(a), asInterval(b));

  for (let i = 0; i < staff.length; i += 1) {
    for (let j = i + 1; j < staff.length; j += 1) {
      const a = staff[i]!;
      const b = staff[j]!;
      if (!clash(a, b)) continue;

      if (a.userId === b.userId) {
        throw new AppError(
          "VALIDATION_FAILED",
          "overlapping assignments for one person",
          {
            reason: "OVERLAPPING_ASSIGNMENT",
            user_id: a.userId,
          },
        );
      }
      if (a.position === "teacher" && b.position === "teacher") {
        throw new AppError(
          "VALIDATION_FAILED",
          "two main teachers on overlapping dates",
          {
            reason: "OVERLAPPING_MAIN_TEACHER",
            user_ids: [a.userId, b.userId],
          },
        );
      }
    }
  }
}

export interface CourseScheduleInput {
  title: string;
  description?: string | null;
  subjectId: string;
  teachingMode: TeachingMode;
  /** Exactly one entity, of the kind the mode names (§4.4c). */
  targetId: string;
  branchId: string;
  roomId?: string | null;
  /** R97 — the DEFAULT delivery for every Session this schedule materializes.
   *  Absent is `in_person`, which is the column's default and what every class
   *  scheduled before this revision actually was. */
  deliveryMode?: Delivery["deliveryMode"] | undefined;
  onlineMediaMode?: Delivery["onlineMediaMode"] | undefined;
  /**
   * **R109 — the DEFAULT tier for every Session this schedule materializes.**
   * Absent is `public`, which is the column's default and what every class the
   * association has ever scheduled actually was.
   */
  visibility?: Visibility | undefined;
  startTime: Date;
  endTime: Date;
  recurrence: string;
  weekdays?: string[];
  dayOfMonth?: number | null;
  monthOfYear?: number | null;
  anchorDate?: Date | null;
  effectiveUntil?: Date | null;
  /**
   * **Which catalogue row this is** (R110, Owner 2026-09-02) — separate from
   * `structural_kind`, which stays the answer to *which entity delivers it*.
   * Refused unless it names a live type of kind `class`. Null for every row
   * predating the catalogue; see the migration for why none was backfilled.
   */
  schedulingTypeId?: string | null;
  academicYearId: string;
  staff?: ScheduleStaffInput[];
}

/** One overlap the administrator has to resolve. */
export interface ScheduleConflict {
  kind: "room" | "teacher" | "assistant";
  date: string;
  sessionId: string;
  scheduleId: string;
  /** The person or room both classes want. */
  resourceId: string;
}

/**
 * Resolves the mode's single target and returns the columns to write.
 *
 * Validated here rather than left to the CHECK constraint so a mismatch is an
 * explained refusal naming the mode and the kind of target it needs — a raw
 * constraint violation tells an administrator nothing they can act on.
 */
async function resolveTarget(
  tx: Prisma.TransactionClient,
  mode: TeachingMode,
  targetId: string,
  branchId: string,
): Promise<{
  levelId: string | null;
  administrativeGroupId: string | null;
  teachingGroupId: string | null;
  /**
   * **The Level this schedule actually delivers to**, whichever of the three
   * modes named the target (§4.4c).
   *
   * Distinct from `levelId` above, which is the *column* and is populated only
   * in `entire_level` mode. The curriculum check needs the Level in all three
   * modes, and deriving it here — beside the resolution that already knows it —
   * is what keeps the derivation from being repeated by every caller that asks.
   */
  effectiveLevelId: string;
}> {
  switch (mode) {
    case "entire_level": {
      const level = await tx.level.findFirst({
        where: { id: targetId, deletedAt: null },
        select: { id: true },
      });
      if (!level) throw new AppError("NOT_FOUND", "no such level");
      return {
        levelId: targetId,
        administrativeGroupId: null,
        teachingGroupId: null,
        effectiveLevelId: targetId,
      };
    }
    case "administrative_group": {
      const group = await tx.administrativeGroup.findFirst({
        where: { id: targetId, deletedAt: null },
        select: { id: true, branchId: true, levelId: true },
      });
      if (!group)
        throw new AppError("NOT_FOUND", "no such administrative group");
      // §4.4: "The schedule's branch must match its target's branch wherever the
      // target is branch-bound." A room belongs to a branch, so a mismatch would
      // book a room the students cannot reach.
      if (group.branchId !== branchId) {
        throw new AppError(
          "VALIDATION_FAILED",
          "group is at a different branch",
          {
            reason: "BRANCH_MISMATCH",
            target_branch_id: group.branchId,
            schedule_branch_id: branchId,
          },
        );
      }
      return {
        levelId: null,
        administrativeGroupId: targetId,
        teachingGroupId: null,
        effectiveLevelId: group.levelId,
      };
    }
    case "teaching_group": {
      const group = await tx.teachingGroup.findFirst({
        where: { id: targetId, deletedAt: null },
        select: { id: true, levelId: true },
      });
      if (!group) throw new AppError("NOT_FOUND", "no such teaching group");
      // A Teaching Group has no branch (§4.4c, R43.3), so there is nothing to
      // match here — the branch is the schedule's own statement of where it
      // meets.
      return {
        levelId: null,
        administrativeGroupId: null,
        teachingGroupId: targetId,
        effectiveLevelId: group.levelId,
      };
    }
  }
}

/**
 * **The TD-4.6c conflict check, against materialized Sessions.**
 *
 * Takes the candidate dates from the recurrence rule, then asks the *sessions*
 * table what already occupies the room and the people on those exact dates.
 * `excludeScheduleId` lets an edit ignore its own existing sessions, which
 * otherwise conflict with themselves.
 */
export async function findConflicts(
  tx: Prisma.TransactionClient,
  candidate: {
    branchId: string;
    roomId: string | null;
    startTime: Date;
    endTime: Date;
    recurrence: string;
    weekdays: string[];
    dayOfMonth: number | null;
    monthOfYear: number | null;
    anchorDate: Date | null;
    /** R50 — the conflict check must respect the bound, or a schedule that ends
     *  in December would be reported as clashing with one that starts in
     *  January. `expandSchedule` applies it and nothing else does. */
    effectiveUntil?: Date | null;
    staff: ScheduleStaffInput[];
  },
  from: Date,
  to: Date,
  excludeScheduleId?: string,
): Promise<ScheduleConflict[]> {
  const dates = expandSchedule(candidate, from, to);
  if (dates.length === 0) return [];

  const staffIds = candidate.staff.map((s) => s.userId);
  const positionOf = new Map(
    candidate.staff.map((s) => [s.userId, s.position]),
  );

  // TD-15.2: lock the governing rows BEFORE the check. Without it two
  // administrators booking the same room at the same instant both see it free.
  // Locking the SESSIONS (not the schedules) is what matches the invariant —
  // the conflict is about occupancy of a room on a date, and that is what a
  // session row states.
  if (candidate.roomId !== null) {
    await tx.$queryRaw`
      SELECT id FROM "session"
      WHERE room_id = ${candidate.roomId}::uuid
        AND date = ANY(${dates}::date[])
        AND deleted_at IS NULL
      FOR UPDATE`;
  }

  const clashes = await tx.session.findMany({
    where: {
      deletedAt: null,
      date: { in: dates },
      // A cancelled class frees its room: TD-1 keeps the row so the
      // cancellation is visible, but it no longer occupies anything.
      status: { not: "cancelled" },
      ...(excludeScheduleId ? { scheduleId: { not: excludeScheduleId } } : {}),
      OR: [
        ...(candidate.roomId !== null ? [{ roomId: candidate.roomId }] : []),
        // Revision 43.4: the occurrence's OWN staffing snapshot is the truth
        // about who is committed on that date. Asking the schedule instead
        // would miss a session whose staff were individually changed — exactly
        // the case the snapshot exists for.
        /**
         * **One arm per person, bounded by HER period** (R91).
         *
         * This asked *is any of these people busy on any of these dates*, which
         * after R91 is the wrong question: Safa assigned September–November and
         * Amina December–June are both `candidate.staff`, and a December
         * occurrence clashing with something of Safa's is not a clash at all —
         * she is not teaching this class in December. One flat `in` produced
         * exactly that false refusal, and a false 409 on a save is worse than a
         * warning: there is nothing for the administrator to override.
         */
        ...candidate.staff.map((s) => ({
          date: {
            ...(s.effectiveFrom ? { gte: s.effectiveFrom } : {}),
            ...(s.effectiveUntil ? { lte: s.effectiveUntil } : {}),
          },
          staff: { some: { userId: s.userId, deletedAt: null } },
        })),
      ],
    },
    select: {
      id: true,
      date: true,
      scheduleId: true,
      roomId: true,
      startTime: true,
      endTime: true,
      staff: { where: { deletedAt: null }, select: { userId: true } },
    },
  });

  const out: ScheduleConflict[] = [];
  for (const s of clashes) {
    if (
      !timesOverlap(
        candidate.startTime,
        candidate.endTime,
        s.startTime,
        s.endTime,
      )
    )
      continue;
    const date = s.date.toISOString().slice(0, 10);

    if (candidate.roomId !== null && s.roomId === candidate.roomId) {
      out.push({
        kind: "room",
        date,
        sessionId: s.id,
        scheduleId: s.scheduleId,
        resourceId: candidate.roomId,
      });
    }
    const busy = new Set<string>(s.staff.map((t) => t.userId));
    for (const userId of staffIds) {
      if (!busy.has(userId)) continue;
      out.push({
        // Assistants are reported under their own kind: an administrator
        // resolving a clash needs to know whether the person is the teacher or
        // a helper, because the remedies differ.
        kind: positionOf.get(userId) === "assistant" ? "assistant" : "teacher",
        date,
        sessionId: s.id,
        scheduleId: s.scheduleId,
        resourceId: userId,
      });
    }
  }
  return out;
}

/** TD-3.8: conflicts are a coded 409 naming what clashed, never a 500. */
function assertNoConflicts(conflicts: ScheduleConflict[]): void {
  if (conflicts.length === 0) return;
  throw new AppError(
    "SCHEDULE_CONFLICT",
    "the room or a member of staff is already committed",
    {
      reason: "OVERLAPPING_SESSIONS",
      conflicts: conflicts.slice(0, 20),
      total: conflicts.length,
    },
  );
}

export async function createCourseSchedule(
  prisma: PrismaClient,
  actor: Actor,
  input: CourseScheduleInput,
  now: Date = new Date(),
): Promise<{ id: string; materialized: MaterializeResult }> {
  assertCanManage(actor);
  scope.assertCanActOnBranch(
    actor.roleScopes,
    MANAGING_ROLE,
    input.branchId,
    "no such branch",
  );

  const horizon = await horizonFor(prisma, now);

  return prisma.$transaction(async (tx) => {
    const subject = await tx.subject.findFirst({
      where: { id: input.subjectId, deletedAt: null },
      select: { id: true },
    });
    if (!subject) throw new AppError("NOT_FOUND", "no such subject");

    const target = await resolveTarget(
      tx,
      input.teachingMode,
      input.targetId,
      input.branchId,
    );

    // **The rule this surface was missing entirely.** Teaching Groups and
    // content both refused a Subject the Level does not teach; scheduling did
    // not, which is how the live database came to hold three schedules while
    // `level_subject` held none — classes delivering a Subject their Level
    // officially does not offer, and to which no content could then be attached.
    // One policy, all three surfaces (`policies/curriculum.ts`).
    await assertSubjectTaughtAtLevel(
      tx,
      target.effectiveLevelId,
      input.subjectId,
    );

    // **`effectiveLevelId` is derived, not a column.** Separated here because
    // the row below is built by spreading `target`, and a derived field carried
    // into a `create` is an invalid-argument error rather than anything the type
    // system catches through a spread.
    const { effectiveLevelId: _derived, ...targetColumns } = target;
    void _derived;

    if (input.roomId) {
      const room = await tx.room.findFirst({
        where: { id: input.roomId, deletedAt: null },
        select: { branchId: true },
      });
      if (!room) throw new AppError("NOT_FOUND", "no such room");
      if (room.branchId !== input.branchId) {
        throw new AppError(
          "VALIDATION_FAILED",
          "room is at a different branch",
          {
            reason: "ROOM_BRANCH_MISMATCH",
          },
        );
      }
      // BR-23: the room's capacity is NOT consulted. It informs planning and
      // refuses nothing — re-adding a check here would resurrect the invariant
      // whose removal justified dropping the roster lock.
    }

    /**
     * **R97 — the three delivery columns are resolved together** (one home:
     * `policies/delivery.ts`). An online class is written with `room_id = NULL`
     * whatever the caller sent, so the CHECK is never the thing that reports it
     * and no stale venue reaches a reader.
     */
    const delivery = resolveDelivery(
      { deliveryMode: "in_person", onlineMediaMode: null, roomId: null },
      {
        ...(input.deliveryMode === undefined
          ? {}
          : { deliveryMode: input.deliveryMode }),
        ...(input.onlineMediaMode === undefined
          ? {}
          : { onlineMediaMode: input.onlineMediaMode }),
        roomId: input.roomId ?? null,
      },
    );

    /**
     * **The type must be a live catalogue row of THIS kind** (R110, Owner
     * 2026-09-02). Typing a class «عطلة» would produce a row the calendar
     * renders as a class and the catalogue claims is a holiday — the two
     * answers to *what is this* that storing the kind exists to prevent.
     */
    if (input.schedulingTypeId) {
      await assertTypeOfKind(tx, input.schedulingTypeId, ['class'] as const);
    }
    const staff = input.staff ?? [];
    await assertStaffAccountsAvailable(tx, staff.map((person) => person.userId));
    const conflicts = await findConflicts(
      tx,
      {
        branchId: input.branchId,
        roomId: delivery.roomId,
        startTime: input.startTime,
        endTime: input.endTime,
        recurrence: input.recurrence,
        weekdays: input.weekdays ?? [],
        dayOfMonth: input.dayOfMonth ?? null,
        monthOfYear: input.monthOfYear ?? null,
        anchorDate: input.anchorDate ?? null,
        effectiveUntil: input.effectiveUntil ?? null,
        staff,
      },
      now,
      horizon,
    );
    assertNoConflicts(conflicts);

    const schedule = await tx.recurringCourseSchedule.create({
      data: {
        title: input.title,
        description: input.description ?? null,
        subjectId: input.subjectId,
        teachingMode: input.teachingMode,
        ...targetColumns,
        branchId: input.branchId,
        roomId: delivery.roomId,
        deliveryMode: delivery.deliveryMode,
        onlineMediaMode: delivery.onlineMediaMode,
        // R109 — absent is the column's default, so the key is omitted rather
        // than written as a literal: one place decides what "unchosen" means.
        ...(input.visibility === undefined
          ? {}
          : { visibility: input.visibility }),
        startTime: input.startTime,
        endTime: input.endTime,
        recurrence: input.recurrence as never,
        weekdays: (input.weekdays ?? []) as never,
        dayOfMonth: input.dayOfMonth ?? null,
        monthOfYear: input.monthOfYear ?? null,
        anchorDate: input.anchorDate ?? null,
        effectiveUntil: input.effectiveUntil ?? null,
        academicYearId: input.academicYearId,
        schedulingTypeId: input.schedulingTypeId ?? null,
      },
      select: { id: true },
    });

    await assertStaffIntervals(tx, schedule.id, staff, {
      anchorDate: input.anchorDate ?? null,
      effectiveUntil: input.effectiveUntil ?? null,
    });
    for (const s of staff) {
      await tx.courseScheduleStaff.create({
        data: {
          scheduleId: schedule.id,
          userId: s.userId,
          position: s.position,
          // R91 — absent is open-ended at that end, which is what every row
          // written before this revision means.
          effectiveFrom: s.effectiveFrom ?? null,
          effectiveUntil: s.effectiveUntil ?? null,
        },
      });
    }

    // TD-4.6c: materialization joins THIS transaction. A schedule that commits
    // without its sessions would be invisible on the calendar until a nightly
    // job noticed, and the conflict check just performed would have been
    // against a state that never existed.
    //
    // Ordering matters (Revision 43.4): the `CourseScheduleStaff` rows are
    // written ABOVE, so `loadSchedule` sees them and every session materializes
    // with its staffing snapshot already in place.
    const loaded = await loadSchedule(tx, schedule.id);
    if (!loaded)
      throw new AppError("INTERNAL", "schedule vanished mid-transaction");
    const materialized = await materializeSchedule(tx, loaded, now, horizon);

    // The pg-boss row is enqueued too, so the nightly horizon extension has a
    // record to work from even though the sessions already exist (§16.2: same
    // transaction, via the repository, never `boss.send()`).
    await enqueue(
      tx,
      JOB_QUEUES.sessionMaterialize,
      { schedule_id: schedule.id },
      schedule.id,
    );

    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: "courseschedule.create",
      targetEntity: "RecurringCourseSchedule",
      targetId: schedule.id,
      detail: {
        subject_id: input.subjectId,
        teaching_mode: input.teachingMode,
        target_id: input.targetId,
        branch_id: input.branchId,
        room_id: delivery.roomId,
        delivery_mode: delivery.deliveryMode,
        online_media_mode: delivery.onlineMediaMode,
        // R109 — who may see this class is an access decision, so the record has
        // to be able to answer *when did it become hidden, and on whose word*.
        visibility: input.visibility ?? "public",
        recurrence: input.recurrence,
        staff: staff.map((s) => ({ user_id: s.userId, position: s.position })),
        sessions_created: materialized.created,
      },
    });

    return { id: schedule.id, materialized };
  });
}

/**
 * Edits a schedule and re-materializes its future sessions.
 *
 * **Reports what it rewrote AND what it left alone** (§4.4). An overridden
 * session, or one carrying work, keeps its values — and the administrator is
 * told, because a silent skip and a silent overwrite are equally bad answers to
 * "what did my edit just do".
 */
export async function updateCourseSchedule(
  prisma: PrismaClient,
  actor: Actor,
  id: string,
  data: {
    title?: string;
    description?: string | null;
    roomId?: string | null;
    startTime?: Date;
    endTime?: Date;
    recurrence?: string;
    weekdays?: string[];
    dayOfMonth?: number | null;
    monthOfYear?: number | null;
    anchorDate?: Date | null;
    effectiveUntil?: Date | null;
    /**
     * **Which catalogue row this is** (R110, Owner 2026-09-02) — separate from
     * `structural_kind`, which stays the answer to *which entity delivers it*.
     * Refused unless it names a live type of kind `class`. Null for every row
     * predating the catalogue; see the migration for why none was backfilled.
       */
    schedulingTypeId?: string | null;
    version: number;
    /**
     * **SRS Revision 50 — which occurrences this edit applies to.**
     *
     * `all_sessions` (the default, and the behaviour that predates R50) rewrites
     * future un-overridden Sessions of this schedule. `this_and_future` **splits
     * the schedule**: see `splitCourseSchedule`.
     */
    scope?: "all_sessions" | "this_and_future";
    /**
     * **Who staffs it now** (R90) — replaced whole, or left alone when absent.
     *
     * This was accepted on CREATE and refused on UPDATE while the form rendered
     * the controls on both, so reassigning a class was a `400` an administrator
     * could not act on.
     *
     * **History is not rewritten.** The rows here are the *schedule's*;
     * materialization then resyncs only FUTURE, un-overridden, still-scheduled
     * occurrences (§4.4, R43.4), so whoever actually delivered a past class
     * stays recorded against it.
     */
    staff?: ScheduleStaffInput[];
    /** R97 — delivery moves as a unit; `policies/delivery.ts` resolves it. */
    deliveryMode?: Delivery["deliveryMode"] | undefined;
    onlineMediaMode?: Delivery["onlineMediaMode"] | undefined;
    /**
     * **R109 — editable, and it rewrites the FUTURE un-protected occurrences**
     * through the ordinary resync, exactly as `deliveryMode` does. The past
     * keeps the tier it was materialized with: publishing a class in June must
     * not retroactively claim March's occurrences were public.
     */
    visibility?: Visibility | undefined;
    /** Required by `this_and_future` — the occurrence the split begins at. */
    fromDate?: Date;
  },
  now: Date = new Date(),
): Promise<{
  id: string;
  successorId?: string;
  materialized: MaterializeResult;
}> {
  assertCanManage(actor);

  if (data.scope === "this_and_future") {
    if (!data.fromDate) {
      throw new AppError(
        "VALIDATION_FAILED",
        "this_and_future requires from_date (§4.4, R50)",
        {
          reason: "FROM_DATE_REQUIRED",
        },
      );
    }
    return splitCourseSchedule(prisma, actor, id, data.fromDate, data, now);
  }

  const existing = await prisma.recurringCourseSchedule.findFirst({
    where: { id, deletedAt: null },
    select: {
      branchId: true,
      roomId: true,
      // R97 — read so a partial edit resolves against what the class IS, not
      // against a default. Patching only `online_media_mode` on a class that is
      // already online must not silently make it in-person.
      deliveryMode: true,
      onlineMediaMode: true,
      // R109 — read so the audit row can say what the tier moved FROM. A
      // visibility change is an access decision and *«it was public until
      // Tuesday»* has to be answerable afterwards.
      visibility: true,
      startTime: true,
      endTime: true,
      recurrence: true,
      weekdays: true,
      dayOfMonth: true,
      monthOfYear: true,
      anchorDate: true,
      effectiveUntil: true,
      // R91 — the periods travel with the assignment, or the conflict check
      // below would treat every stored row as open-ended and refuse a save on a
      // clash that belongs to a period nobody is editing.
      staff: {
        where: { deletedAt: null },
        select: {
          userId: true,
          position: true,
          effectiveFrom: true,
          effectiveUntil: true,
        },
      },
    },
  });
  if (!existing) throw new AppError("NOT_FOUND", "no such schedule");
  scope.assertCanActOnBranch(
    actor.roleScopes,
    MANAGING_ROLE,
    existing.branchId,
    "no such schedule",
  );

  const horizon = await horizonFor(prisma, now);

  return prisma.$transaction(async (tx) => {
    /**
     * **The type must be a live catalogue row of THIS kind** (R110, Owner
     * 2026-09-02). Typing a class «عطلة» would produce a row the calendar
     * renders as a class and the catalogue claims is a holiday — the two
     * answers to *what is this* that storing the kind exists to prevent.
     */
    if (data.schedulingTypeId) {
      await assertTypeOfKind(tx, data.schedulingTypeId, ['class'] as const);
    }

    const merged = {
      branchId: existing.branchId,
      roomId: data.roomId === undefined ? existing.roomId : data.roomId,
      startTime: data.startTime ?? existing.startTime,
      endTime: data.endTime ?? existing.endTime,
      recurrence: data.recurrence ?? existing.recurrence,
      weekdays: data.weekdays ?? existing.weekdays,
      dayOfMonth:
        data.dayOfMonth === undefined ? existing.dayOfMonth : data.dayOfMonth,
      monthOfYear:
        data.monthOfYear === undefined
          ? existing.monthOfYear
          : data.monthOfYear,
      anchorDate:
        data.anchorDate === undefined ? existing.anchorDate : data.anchorDate,
      // **The proposed staffing, not the stored one.** Checking the old names
      // would clear a reassignment that double-books the new مؤطِّرة, which is
      // the one conflict a staffing edit is most likely to introduce.
      staff:
        data.staff ??
        existing.staff.map((s) => ({
          userId: s.userId,
          position: s.position,
          effectiveFrom: s.effectiveFrom,
          effectiveUntil: s.effectiveUntil,
        })),
    };

    // R97 — resolved BEFORE the conflict check, so an edit that takes a class
    // online stops competing for the room it is leaving.
    const delivery = resolveDelivery(existing, {
      ...(data.deliveryMode === undefined
        ? {}
        : { deliveryMode: data.deliveryMode }),
      ...(data.onlineMediaMode === undefined
        ? {}
        : { onlineMediaMode: data.onlineMediaMode }),
      ...(data.roomId === undefined ? {} : { roomId: data.roomId }),
    });

    // Its own sessions are excluded, or the schedule would conflict with itself.
    const conflicts = await findConflicts(
      tx,
      { ...merged, roomId: delivery.roomId },
      now,
      horizon,
      id,
    );
    assertNoConflicts(conflicts);

    await updateWithVersion({
      delegate: tx.recurringCourseSchedule,
      id,
      expectedVersion: data.version,
      requireNotDeleted: true,
      // **Every editable field is listed here or it is silently dropped.** The
      // validator accepting a key and this block omitting it produces the worst
      // possible outcome: `200 OK`, a bumped version, and nothing changed —
      // which is exactly what `effective_until` did from R55 until R57 found it,
      // because that revision was only ever tested through the CREATE path.
      data: {
        ...(data.title === undefined ? {} : { title: data.title }),
        ...(data.description === undefined
          ? {}
          : { description: data.description }),
        // **R97 — all three, unconditionally.** Writing one of them alone is
        // exactly what produces a row the CHECK refuses, and `resolveDelivery`
        // has already returned the state that is consistent whether or not this
        // edit mentioned delivery at all.
        roomId: delivery.roomId,
        deliveryMode: delivery.deliveryMode,
        onlineMediaMode: delivery.onlineMediaMode,
        // R109 — absent means *leave the tier as it is*, never *reset it to the
        // default*. That distinction is exactly the one NEW B §A found broken on
        // the Event form, where the wrong value and the intended default were
        // the same string and the widening was therefore invisible.
        ...(data.visibility === undefined
          ? {}
          : { visibility: data.visibility }),
        ...(data.startTime === undefined ? {} : { startTime: data.startTime }),
        ...(data.endTime === undefined ? {} : { endTime: data.endTime }),
        ...(data.recurrence === undefined
          ? {}
          : { recurrence: data.recurrence }),
        ...(data.weekdays === undefined ? {} : { weekdays: data.weekdays }),
        ...(data.dayOfMonth === undefined
          ? {}
          : { dayOfMonth: data.dayOfMonth }),
        ...(data.monthOfYear === undefined
          ? {}
          : { monthOfYear: data.monthOfYear }),
        ...(data.anchorDate === undefined
          ? {}
          : { anchorDate: data.anchorDate }),
        ...(data.effectiveUntil === undefined
          ? {}
          : { effectiveUntil: data.effectiveUntil }),
        ...(data.schedulingTypeId === undefined
          ? {}
          : { schedulingTypeId: data.schedulingTypeId }),
      },
    });

    /**
     * **Replaced whole, and written BEFORE materialization** (R90).
     *
     * Ordering is the whole of it: `loadSchedule` below reads these rows, and
     * `materializeSchedule` snapshots them onto every future un-overridden
     * occurrence (R43.4). Writing them afterwards would update the schedule and
     * leave every session still naming the previous مؤطِّرة — the same silent
     * half-change the create path's ordering comment warns about.
     *
     * Soft-deleted rather than removed, so a name that was on this class stays
     * visible in the record.
     */
    if (data.staff !== undefined) {
      await assertStaffAccountsAvailable(
        tx,
        data.staff.map((person) => person.userId),
      );
      await assertStaffIntervals(tx, id, data.staff, {
        anchorDate: merged.anchorDate,
        effectiveUntil:
          data.effectiveUntil === undefined
            ? existing.effectiveUntil
            : data.effectiveUntil,
      });

      /**
       * **Withdrawn and rewritten, not matched by user** (R91).
       *
       * The pre-R91 version keyed on `(schedule, user)` because the database
       * did — one row per person. Effective dating retires that: **Safa may
       * legitimately hold two rows** on one schedule, September–November and
       * January onward, with Amina's replacement between them. Matching by user
       * would collapse her two periods into whichever arrived first.
       *
       * So the live set is soft-deleted whole and the submitted set written
       * fresh. Soft, not hard: a name that was on this class stays in the
       * record, and R43.4's session snapshots — which are the historical truth —
       * are untouched by any of it.
       */
      await tx.courseScheduleStaff.updateMany({
        where: { scheduleId: id, deletedAt: null },
        data: { deletedAt: new Date(), deletedById: actor.userId },
      });
      for (const s of data.staff) {
        await tx.courseScheduleStaff.create({
          data: {
            scheduleId: id,
            userId: s.userId,
            position: s.position,
            effectiveFrom: s.effectiveFrom ?? null,
            effectiveUntil: s.effectiveUntil ?? null,
          },
        });
      }
    }

    const loaded = await loadSchedule(tx, id);
    if (!loaded)
      throw new AppError("INTERNAL", "schedule vanished mid-transaction");
    const materialized = await materializeSchedule(tx, loaded, now, horizon);

    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: "courseschedule.update",
      targetEntity: "RecurringCourseSchedule",
      targetId: id,
      detail: {
        sessions_created: materialized.created,
        // Both numbers, because §4.4 makes reporting the untouched ones part of
        // the behaviour rather than a nicety.
        sessions_left_alone: materialized.protectedSessions.length,
        protected_reasons: materialized.protectedSessions.flatMap(
          (p) => p.reasons,
        ),
        // R97 — how it is delivered from now on. The past occurrences keep what
        // they were delivered as, and this row is the record of when that
        // changed.
        delivery_mode: delivery.deliveryMode,
        online_media_mode: delivery.onlineMediaMode,
        room_id: delivery.roomId,
        // R109 — old→new, and only when it actually moved. A row that records
        // the tier on every edit would bury the one edit that changed it.
        ...(data.visibility !== undefined &&
        data.visibility !== existing.visibility
          ? {
              visibility_from: existing.visibility,
              visibility_to: data.visibility,
            }
          : {}),
      },
    });

    return { id, materialized };
  });
}

/**
 * Soft-deletes a schedule (TD-5).
 *
 * **Future sessions go with it; past and `held` sessions are RETAINED** — they
 * record what happened, and discontinuing a schedule does not un-teach them.
 * Sessions carrying work are retained regardless of date and reported.
 */
/**
 * **SRS Revision 50 — "this session and all future sessions", by SPLITTING the
 * schedule.**
 *
 * The current schedule is closed the day before `fromDate`, and a **successor**
 * carrying the new values is anchored at `fromDate`. Past Sessions are
 * untouched — they belong to a schedule whose rule has not changed for any date
 * it still covers — and overridden Sessions keep their overrides, because the
 * removal below asks the same protection predicate every other scheduling path
 * asks (§4.4, R43.6).
 *
 * **One transaction.** §4.4 states it as a rule rather than a preference: a
 * half-split leaves a gap in the timetable, which is worse than either the old
 * schedule continuing or the new one starting.
 *
 * **Staff are copied to the successor.** A successor with no staff would
 * silently drop the teacher from every future Session — the failure §4.4 names
 * explicitly, and the one that would look like a UI bug for weeks.
 *
 * **No new recurrence machinery.** Both halves are ordinary schedules with
 * ordinary rules, so conflict detection, roster resolution, the calendar and the
 * Session page keep working with no knowledge that a split happened. That is the
 * property the split was chosen for over an exception model.
 */
async function splitCourseSchedule(
  prisma: PrismaClient,
  actor: Actor,
  id: string,
  fromDate: Date,
  data: {
    title?: string;
    description?: string | null;
    roomId?: string | null;
    startTime?: Date;
    endTime?: Date;
    recurrence?: string;
    weekdays?: string[];
    dayOfMonth?: number | null;
    monthOfYear?: number | null;
    anchorDate?: Date | null;
    effectiveUntil?: Date | null;
    deliveryMode?: Delivery["deliveryMode"] | undefined;
    onlineMediaMode?: Delivery["onlineMediaMode"] | undefined;
    /** R109 — the successor's tier: this edit's, or the predecessor's. */
    visibility?: Visibility | undefined;
    version: number;
  },
  now: Date,
): Promise<{
  id: string;
  successorId: string;
  materialized: MaterializeResult;
}> {
  const existing = await prisma.recurringCourseSchedule.findFirst({
    where: { id, deletedAt: null },
    select: {
      title: true,
      description: true,
      subjectId: true,
      teachingMode: true,
      levelId: true,
      administrativeGroupId: true,
      teachingGroupId: true,
      branchId: true,
      roomId: true,
      // R97 — the successor IS the same class, so it inherits how the class is
      // delivered unless this edit says otherwise.
      deliveryMode: true,
      onlineMediaMode: true,
      // R109 — same reasoning, same sentence: the successor IS the same class.
      // A split that did not carry the tier would silently publish the tail of
      // a hidden series, which is a widening nobody asked for.
      visibility: true,
      startTime: true,
      endTime: true,
      recurrence: true,
      weekdays: true,
      dayOfMonth: true,
      monthOfYear: true,
      anchorDate: true,
      effectiveUntil: true,
      academicYearId: true,
      // R91 — carried onto the successor unchanged by the split below.
      staff: {
        where: { deletedAt: null },
        select: {
          userId: true,
          position: true,
          effectiveFrom: true,
          effectiveUntil: true,
        },
      },
    },
  });
  if (!existing) throw new AppError("NOT_FOUND", "no such schedule");
  scope.assertCanActOnBranch(
    actor.roleScopes,
    MANAGING_ROLE,
    existing.branchId,
    "no such schedule",
  );

  const splitOn = atMidnightUtc(fromDate);
  // Splitting at or before a date the series never reached would produce a
  // closed schedule covering nothing and a successor identical to the original.
  if (
    existing.effectiveUntil &&
    splitOn > atMidnightUtc(existing.effectiveUntil)
  ) {
    throw new AppError(
      "VALIDATION_FAILED",
      "that date is after this schedule already ends",
      {
        reason: "SPLIT_AFTER_END",
      },
    );
  }
  const closeAt = addDays(splitOn, -1);
  const horizon = await horizonFor(prisma, now);

  const successorDelivery = resolveDelivery(existing, {
    ...(data.deliveryMode === undefined
      ? {}
      : { deliveryMode: data.deliveryMode }),
    ...(data.onlineMediaMode === undefined
      ? {}
      : { onlineMediaMode: data.onlineMediaMode }),
    ...(data.roomId === undefined ? {} : { roomId: data.roomId }),
  });

  return prisma.$transaction(async (tx) => {
    // The split copies the complete effective-dated record, including periods
    // that ended before the successor begins. Only periods intersecting the
    // successor create a live obligation and therefore require an available
    // account; an expired historical assignment must not block the series
    // forever merely because its row is retained (R91/R111).
    const successorStaff = existing.staff.filter((person) =>
      withinScheduleLife(
        { from: person.effectiveFrom, until: person.effectiveUntil },
        {
          anchorDate: splitOn,
          effectiveUntil: existing.effectiveUntil,
        },
      ),
    );
    await assertStaffAccountsAvailable(
      tx,
      successorStaff.map((person) => person.userId),
    );
    const successorValues = {
      // **The successor IS the same class**, split at a date (R50) — so it keeps
      // its name, and an edit that renames it renames both halves' successor.
      title: data.title ?? existing.title,
      description:
        data.description === undefined
          ? existing.description
          : data.description,
      subjectId: existing.subjectId,
      teachingMode: existing.teachingMode,
      levelId: existing.levelId,
      administrativeGroupId: existing.administrativeGroupId,
      teachingGroupId: existing.teachingGroupId,
      branchId: existing.branchId,
      academicYearId: existing.academicYearId,
      // R97 — all three from one resolution, so a split that takes the tail
      // online leaves the successor with no room rather than a stale one.
      roomId: successorDelivery.roomId,
      deliveryMode: successorDelivery.deliveryMode,
      onlineMediaMode: successorDelivery.onlineMediaMode,
      visibility: data.visibility ?? existing.visibility,
      startTime: data.startTime ?? existing.startTime,
      endTime: data.endTime ?? existing.endTime,
      // Cast to the Prisma enums: the caller's values are already validated by
      // the same Zod schema the create path uses, and the database CHECKs are
      // the backstop either way.
      recurrence: (data.recurrence ??
        existing.recurrence) as typeof existing.recurrence,
      weekdays: (data.weekdays ??
        existing.weekdays) as typeof existing.weekdays,
      dayOfMonth:
        data.dayOfMonth === undefined ? existing.dayOfMonth : data.dayOfMonth,
      monthOfYear:
        data.monthOfYear === undefined
          ? existing.monthOfYear
          : data.monthOfYear,
      // The successor is anchored at the split, which is what makes
      // `biweekly_alternating` keep counting from the right week.
      anchorDate: splitOn,
      // It inherits whatever end the original had — splitting a bounded series
      // must not quietly make the tail unbounded.
      effectiveUntil: existing.effectiveUntil,
    };

    // **Close the original first**, so the conflict check below compares the
    // successor against a predecessor that has already stopped — otherwise a
    // schedule would collide with the half of itself it is replacing.
    await updateWithVersion({
      delegate: tx.recurringCourseSchedule,
      id,
      expectedVersion: data.version,
      requireNotDeleted: true,
      data: { effectiveUntil: closeAt },
    });

    // Its own sessions AND the predecessor's are excluded: the predecessor's
    // future occurrences are removed immediately below, so a clash with them is
    // a clash with rows that are about to stop existing.
    const conflicts = await findConflicts(
      tx,
      {
        ...successorValues,
        staff: existing.staff.map((s) => ({
          userId: s.userId,
          position: s.position,
          effectiveFrom: s.effectiveFrom,
          effectiveUntil: s.effectiveUntil,
        })),
      },
      splitOn,
      horizon,
      id,
    );
    assertNoConflicts(conflicts);

    const successor = await tx.recurringCourseSchedule.create({
      data: successorValues,
      select: { id: true },
    });
    // §4.4: without this the teacher silently disappears from every future
    // session of the successor.
    if (existing.staff.length > 0) {
      await tx.courseScheduleStaff.createMany({
        data: existing.staff.map((s) => ({
          scheduleId: successor.id,
          userId: s.userId,
          position: s.position,
          // **R91 — the periods carry across the split untouched.** A split
          // divides the RULE at a date; it does not re-decide who is assigned,
          // and rewriting the bounds here would silently alter a replacement
          // the administrator arranged separately. Periods that no longer
          // intersect the successor's life simply resolve to nobody on its
          // dates, which is the correct answer rather than an error.
          effectiveFrom: s.effectiveFrom,
          effectiveUntil: s.effectiveUntil,
        })),
      });
    }

    // The predecessor's occurrences from the split date onward now belong to the
    // successor — except the protected ones, which stay exactly where they are.
    // **The same predicate every other scheduling path asks** (R43.6): a session
    // someone overrode, held, or attached work to is not the split's to move.
    const future = await tx.session.findMany({
      where: { scheduleId: id, deletedAt: null, date: { gte: splitOn } },
      select: SELECT_PROTECTABLE,
    });
    const reasons = await protectionReasons(tx, future);
    const removable = future.filter((s) => !reasons.has(s.id));
    if (removable.length > 0) {
      await tx.session.updateMany({
        where: { id: { in: removable.map((s) => s.id) } },
        data: { deletedAt: new Date(), deletedById: actor.userId },
      });
    }

    const loaded = await loadSchedule(tx, successor.id);
    if (!loaded)
      throw new AppError("INTERNAL", "successor vanished mid-transaction");
    const materialized = await materializeSchedule(
      tx,
      loaded,
      splitOn,
      horizon,
    );

    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: "courseschedule.update",
      targetEntity: "RecurringCourseSchedule",
      targetId: id,
      detail: {
        scope: "this_and_future",
        split_on: splitOn.toISOString().slice(0, 10),
        successor_id: successor.id,
        sessions_created: materialized.created,
        // What the split MOVED and what it refused to move — the same pair every
        // other scheduling write reports (§4.4).
        sessions_released: removable.length,
        sessions_left_alone: future.length - removable.length,
        // R109 — the tier the tail of the series runs at from the split date on.
        visibility: successorValues.visibility,
      },
    });

    return { id, successorId: successor.id, materialized };
  });
}

export async function deleteCourseSchedule(
  prisma: PrismaClient,
  actor: Actor,
  id: string,
  now: Date = new Date(),
): Promise<{ futureRemoved: number; retained: number }> {
  assertCanManage(actor);

  const schedule = await prisma.recurringCourseSchedule.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, branchId: true },
  });
  if (!schedule) throw new AppError("NOT_FOUND", "no such schedule");
  scope.assertCanActOnBranch(
    actor.roleScopes,
    MANAGING_ROLE,
    schedule.branchId,
    "no such schedule",
  );

  return prisma.$transaction(async (tx) => {
    // The SAME predicate materialization uses (§4.4, Revision 43.5). This used
    // to re-implement the test inline — `!overridden && linkedContent === 0` —
    // which is exactly the second copy §4.4 forbids: attendance would have
    // joined the protection in one place and not the other, and a delete would
    // have quietly taken sessions a schedule edit refused to touch.
    // The SAME mechanism every other scheduling path asks (§4.4, R43.6).
    // This once re-implemented the test inline — `!overridden && content === 0`
    // — which is the second copy §4.4 forbids: attendance would have joined the
    // protection for edits and not for deletion, and a delete would quietly
    // have taken sessions an edit had just refused to touch.
    const future = await tx.session.findMany({
      where: { scheduleId: id, deletedAt: null, date: { gte: now } },
      select: SELECT_PROTECTABLE,
    });
    const reasons = await protectionReasons(tx, future);
    const removable = future.filter((s) => !reasons.has(s.id));

    const stamp = new Date();
    // Loaded before the tombstone so the snapshot is the row as it STOOD, not as
    // it is once deleted — the distinction the Trash's whole promise rests on.
    const row = await tx.recurringCourseSchedule.findUnique({ where: { id } });
    const staff = await tx.courseScheduleStaff.findMany({
      where: { scheduleId: id, deletedAt: null },
      select: { userId: true, position: true },
    });

    await tx.session.updateMany({
      where: { id: { in: removable.map((s) => s.id) } },
      data: { deletedAt: stamp, deletedById: actor.userId },
    });
    await tx.recurringCourseSchedule.update({
      where: { id },
      data: { deletedAt: stamp, deletedById: actor.userId },
    });

    // TD-5/BR-15. **The removed occurrences are recorded as a count and their
    // ids, not as rows**: they are derived from the schedule and would be
    // regenerated by `session.materialize` on restore, so snapshotting each one
    // would store a copy of something the schedule already determines — while
    // the ids are what a restore needs to know it is not resurrecting the ones
    // protection deliberately spared.
    await trash.snapshot(tx, {
      targetEntity: "RecurringCourseSchedule",
      targetId: id,
      snapshot: {
        ...row,
        staff,
        removed_session_ids: removable.map((s) => s.id),
        retained_session_count: await tx.session.count({
          where: { scheduleId: id, deletedAt: null },
        }),
      },
      deletedById: actor.userId,
    });

    const retained = await tx.session.count({
      where: { scheduleId: id, deletedAt: null },
    });

    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: "courseschedule.delete",
      targetEntity: "RecurringCourseSchedule",
      targetId: id,
      detail: {
        future_sessions_removed: removable.length,
        sessions_retained: retained,
      },
    });
    return { futureRemoved: removable.length, retained };
  });
}

/**
 * **One schedule's materialized occurrences** — the list the §4.4 (Revision 50)
 * scope dialog is chosen from.
 *
 * **A sibling of `/conflicts` and `/roster`, not a new surface.** All three
 * answer a question about one schedule and hang off it; a top-level
 * `GET /sessions` would be a second way to reach the same rows with its own
 * scope rules to keep in step.
 *
 * **Why the calendar could not serve this.** `GET /calendar` returns
 * occurrences without their `schedule_id` — deliberately, since it is a public
 * surface and a reader does not need the rule behind a class. A screen offering
 * *this and all future* must know which schedule it is about to split, and the
 * honest way to know is to have asked for that schedule's sessions.
 *
 * **Each row carries WHY it is protected**, using the same rules every
 * scheduling path asks (R43.6). §4.4 requires the dialog to state which
 * occurrences are about to change; that is unanswerable without knowing which
 * ones will be spared.
 */
export async function listScheduleSessions(
  prisma: PrismaClient,
  actor: Actor,
  id: string,
  params: PageParams = {},
): Promise<Page<ScheduleSessionRow>> {
  assertCanRead(actor);

  const schedule = await prisma.recurringCourseSchedule.findFirst({
    where: { id, deletedAt: null, ...readableScope(actor) },
    select: { id: true },
  });
  // Out of reach answers 404, never 403 (§20 rule 17) — the scope is expressed
  // in the lookup rather than as a check afterwards.
  if (!schedule) throw new AppError("NOT_FOUND", "no such schedule");

  const where = { scheduleId: id, deletedAt: null };
  const window = pageWindow(params);
  const [rows, total] = await Promise.all([
    prisma.session.findMany({
      where,
      // Chronological: this list is read as a timetable, and `id` is the stable
      // tiebreaker that keeps pagination from repeating a row.
      orderBy: [{ date: "asc" }, { id: "asc" }],
      skip: window.skip,
      take: window.take,
      select: {
        id: true,
        date: true,
        startTime: true,
        endTime: true,
        status: true,
        overridden: true,
        roomId: true,
        deliveryMode: true,
        onlineMediaMode: true,
        // R109 — the occurrence's own tier, so the timetable can show which
        // dates of a series were decided about individually.
        visibility: true,
        version: true,
        // **`SessionStaff` carries NO period** (R91). The snapshot IS the
        // occurrence's own truth — who took this class — so a date on it would
        // be a second answer to a question the row already settles.
        staff: {
          where: { deletedAt: null },
          select: { userId: true, position: true },
        },
      },
    }),
    prisma.session.count({ where }),
  ]);

  const reasons = await protectionReasons(
    prisma as unknown as Prisma.TransactionClient,
    rows.map((r) => ({
      id: r.id,
      date: r.date,
      overridden: r.overridden,
      status: r.status,
    })),
  );

  return page(
    rows.map((r) => ({ ...r, protectedReasons: reasons.get(r.id) ?? [] })),
    window,
    total,
  );
}

export interface ScheduleSessionRow {
  id: string;
  date: Date;
  startTime: Date;
  endTime: Date;
  /** R97 — what this occurrence actually is, which the list renders and the
   *  occurrence editor opens on. */
  deliveryMode: string;
  onlineMediaMode: string | null;
  /** R109 — this occurrence's own tier, snapshotted at materialization and
   *  decidable for one date through `session.override`. */
  visibility: string;
  status: string;
  /** R43.4 — *a human decided about this occurrence*, not *differs from the
   *  schedule*. What "this session only" leaves behind. */
  overridden: boolean;
  roomId: string | null;
  version: number;
  staff: { userId: string; position: string }[];
  /** Stable codes from the R43.6 rule set. Empty means a schedule edit or a
   *  split may rewrite this occurrence. */
  protectedReasons: string[];
}

/** Read-only conflict preview for a candidate schedule — the
 *  `GET /admin/course-schedules/{id}/conflicts` behaviour, service side. */
export async function previewConflicts(
  prisma: PrismaClient,
  actor: Actor,
  id: string,
  now: Date = new Date(),
): Promise<ScheduleConflict[]> {
  assertCanManage(actor);
  const s = await prisma.recurringCourseSchedule.findFirst({
    where: { id, deletedAt: null },
    select: {
      branchId: true,
      roomId: true,
      // R97 — read so a partial edit resolves against what the class IS, not
      // against a default. Patching only `online_media_mode` on a class that is
      // already online must not silently make it in-person.
      deliveryMode: true,
      onlineMediaMode: true,
      startTime: true,
      endTime: true,
      recurrence: true,
      weekdays: true,
      dayOfMonth: true,
      monthOfYear: true,
      anchorDate: true,
      effectiveUntil: true,
      staff: {
        where: { deletedAt: null },
        select: {
          userId: true,
          position: true,
          effectiveFrom: true,
          effectiveUntil: true,
        },
      },
    },
  });
  if (!s) throw new AppError("NOT_FOUND", "no such schedule");
  scope.assertCanActOnBranch(
    actor.roleScopes,
    MANAGING_ROLE,
    s.branchId,
    "no such schedule",
  );

  const horizon = await horizonFor(prisma, now);
  return prisma.$transaction((tx) =>
    findConflicts(
      tx,
      {
        ...s,
        staff: s.staff.map((x) => ({ userId: x.userId, position: x.position })),
      },
      now,
      horizon,
      id,
    ),
  );
}

/**
 * The schedules an administrator may see, paginated (TD-10).
 *
 * **Added in the TD-3.12 HTTP slice, not before.** The contract-phase note at
 * the top of this file said the endpoints were unbuilt; it did not say that two
 * of the six had no service behind them either. Listing and roster resolution
 * were the two, and `docs/reference/api-endpoints.md` claimed otherwise.
 *
 * Scoped exactly as every other operational read: a branch Admin sees their own
 * branches, and an all-branches (`NULL`) scope means *every* branch, never
 * *none* (§7, Revision 24).
 */
export async function listCourseSchedules(
  prisma: PrismaClient,
  actor: Actor,
  filters: {
    branchId?: string;
    subjectId?: string;
    academicYearId?: string;
  } & PageParams,
): Promise<
  Page<
    RecurringCourseSchedule & { staff: { userId: string; position: string }[] }
  >
> {
  assertCanRead(actor);

  const where: Prisma.RecurringCourseScheduleWhereInput = {
    deletedAt: null,
    ...(filters.branchId ? { branchId: filters.branchId } : {}),
    ...(filters.subjectId ? { subjectId: filters.subjectId } : {}),
    ...(filters.academicYearId
      ? { academicYearId: filters.academicYearId }
      : {}),
    // Applied last so an explicit filter can NARROW the caller's reach but
    // never widen it — a teacher passing `branch_id` still sees only what they
    // staff, because both conditions must hold.
    ...readableScope(actor),
  };

  const window = pageWindow(filters);
  const [rows, total] = await Promise.all([
    prisma.recurringCourseSchedule.findMany({
      where,
      skip: window.skip,
      take: window.take,
      // A timetable reads by day then by time; `startTime` is a wall-clock
      // column (TD-11), so this is a clock ordering and not an instant one.
      orderBy: [{ startTime: "asc" }, { endTime: "asc" }],
      include: {
        staff: {
          where: { deletedAt: null },
          select: {
            userId: true,
            position: true,
            effectiveFrom: true,
            effectiveUntil: true,
          },
        },
        // **The labels the ids stand for**, resolved here for the same reason
        // `libraryItemDto` resolves its own (TD-3.13): a client cannot render a
        // timetable from ids, and this list was showing raw UUIDs where every
        // other screen in the back office shows a name. One join each, on a
        // page of at most 25 rows.
        subject: { select: { name: true } },
        branch: { select: { name: true } },
        room: { select: { name: true } },
        level: { select: { name: true } },
        // `levelId` beside the name: §2.2 scopes both to one Level, and
        // `level_id` on the DTO is what a client seeds a Level selector from.
        administrativeGroup: { select: { name: true, levelId: true } },
        teachingGroup: { select: { name: true, levelId: true } },
      },
    }),
    prisma.recurringCourseSchedule.count({ where }),
  ]);
  return page(rows, window, total);
}

/**
 * **The resolved audience — never a snapshot** (TD-3.12, §4.4c).
 *
 * Computed live from the schedule's mode and target on every call. There is no
 * stored roster to drift: a student enrolled, moved or un-enrolled a moment ago
 * is in or out of this answer immediately, which is the property
 * `roster-resolution.ts` exists to preserve and the reason it returns a `where`
 * fragment rather than a list of ids.
 */
export async function resolveScheduleRoster(
  prisma: PrismaClient,
  actor: Actor,
  id: string,
): Promise<{ id: string; nameArabic: string | null }[]> {
  assertCanRead(actor);

  const schedule = await prisma.recurringCourseSchedule.findFirst({
    // §5.6 line 753 grants a Teacher roster access to the audience of a
    // schedule they staff. Expressed as part of the lookup rather than as a
    // check afterwards, so a schedule they do not staff is NOT FOUND rather
    // than found-and-refused (§20 rule 17).
    where: { id, deletedAt: null, ...readableScope(actor) },
    select: {
      branchId: true,
      teachingMode: true,
      levelId: true,
      administrativeGroupId: true,
      teachingGroupId: true,
    },
  });
  // Out of scope answers 404, never 403 (§20 rule 17) — a 403 confirms the
  // schedule exists somewhere the caller may not look.
  if (!schedule) throw new AppError("NOT_FOUND", "no such schedule");

  return resolveAudience(prisma, schedule, {
    id: true,
    nameArabic: true,
  }) as Promise<{ id: string; nameArabic: string | null }[]>;
}
