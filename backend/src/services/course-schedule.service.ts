import type {
  Prisma,
  PrismaClient,
  RecurringCourseSchedule,
  TeachingMode,
} from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { page, pageWindow, type Page, type PageParams } from '../lib/pagination.js';
import { addDays, atMidnightUtc, expandSchedule, timesOverlap } from '../lib/recurrence.js';
import * as scope from '../policies/branch-scope.js';
import { assertSubjectTaughtAtLevel } from '../policies/curriculum.js';
import { resolveAudience } from '../policies/roster-resolution.js';
import * as audit from '../repositories/audit.repository.js';
import * as trash from '../repositories/trash.repository.js';
import { enqueue, JOB_QUEUES } from '../repositories/jobs.repository.js';
import { updateWithVersion } from '../repositories/optimistic-lock.js';
import type { Actor } from '../policies/actor.js';
import {
  protectionReasons,
  SELECT_PROTECTABLE,
} from '../policies/session-protection.js';
import {
  horizonFor,
  loadSchedule,
  materializeSchedule,
  type MaterializeResult,
} from './session-materialize.service.js';

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

const MANAGING_ROLE = 'admin';

const isSuperAdmin = (actor: Actor): boolean => scope.isSuperAdmin(actor.roleScopes);

function assertCanManage(actor: Actor): void {
  if (!(scope.hasRole(actor.roleScopes, MANAGING_ROLE) || isSuperAdmin(actor))) {
    throw new AppError('FORBIDDEN', 'course schedule management requires admin');
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
  if (!(isManager(actor) || scope.hasRole(actor.roleScopes, 'teacher'))) {
    throw new AppError('FORBIDDEN', 'reading course schedules requires admin or teaching staff');
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
  return { staff: { some: { userId: actor.userId, deletedAt: null } } };
}

export interface ScheduleStaffInput {
  userId: string;
  position: 'teacher' | 'assistant';
}

export interface CourseScheduleInput {
  subjectId: string;
  teachingMode: TeachingMode;
  /** Exactly one entity, of the kind the mode names (§4.4c). */
  targetId: string;
  branchId: string;
  roomId?: string | null;
  startTime: Date;
  endTime: Date;
  recurrence: string;
  weekdays?: string[];
  dayOfMonth?: number | null;
  monthOfYear?: number | null;
  anchorDate?: Date | null;
  effectiveUntil?: Date | null;
  academicYearId: string;
  staff?: ScheduleStaffInput[];
}

/** One overlap the administrator has to resolve. */
export interface ScheduleConflict {
  kind: 'room' | 'teacher' | 'assistant';
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
    case 'entire_level': {
      const level = await tx.level.findFirst({
        where: { id: targetId, deletedAt: null },
        select: { id: true },
      });
      if (!level) throw new AppError('NOT_FOUND', 'no such level');
      return {
        levelId: targetId,
        administrativeGroupId: null,
        teachingGroupId: null,
        effectiveLevelId: targetId,
      };
    }
    case 'administrative_group': {
      const group = await tx.administrativeGroup.findFirst({
        where: { id: targetId, deletedAt: null },
        select: { id: true, branchId: true, levelId: true },
      });
      if (!group) throw new AppError('NOT_FOUND', 'no such administrative group');
      // §4.4: "The schedule's branch must match its target's branch wherever the
      // target is branch-bound." A room belongs to a branch, so a mismatch would
      // book a room the students cannot reach.
      if (group.branchId !== branchId) {
        throw new AppError('VALIDATION_FAILED', 'group is at a different branch', {
          reason: 'BRANCH_MISMATCH',
          target_branch_id: group.branchId,
          schedule_branch_id: branchId,
        });
      }
      return {
        levelId: null,
        administrativeGroupId: targetId,
        teachingGroupId: null,
        effectiveLevelId: group.levelId,
      };
    }
    case 'teaching_group': {
      const group = await tx.teachingGroup.findFirst({
        where: { id: targetId, deletedAt: null },
        select: { id: true, levelId: true },
      });
      if (!group) throw new AppError('NOT_FOUND', 'no such teaching group');
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
  const positionOf = new Map(candidate.staff.map((s) => [s.userId, s.position]));

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
      status: { not: 'cancelled' },
      ...(excludeScheduleId ? { scheduleId: { not: excludeScheduleId } } : {}),
      OR: [
        ...(candidate.roomId !== null ? [{ roomId: candidate.roomId }] : []),
        // Revision 43.4: the occurrence's OWN staffing snapshot is the truth
        // about who is committed on that date. Asking the schedule instead
        // would miss a session whose staff were individually changed — exactly
        // the case the snapshot exists for.
        ...(staffIds.length > 0
          ? [{ staff: { some: { userId: { in: staffIds }, deletedAt: null } } }]
          : []),
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
    if (!timesOverlap(candidate.startTime, candidate.endTime, s.startTime, s.endTime)) continue;
    const date = s.date.toISOString().slice(0, 10);

    if (candidate.roomId !== null && s.roomId === candidate.roomId) {
      out.push({ kind: 'room', date, sessionId: s.id, scheduleId: s.scheduleId, resourceId: candidate.roomId });
    }
    const busy = new Set<string>(s.staff.map((t) => t.userId));
    for (const userId of staffIds) {
      if (!busy.has(userId)) continue;
      out.push({
        // Assistants are reported under their own kind: an administrator
        // resolving a clash needs to know whether the person is the teacher or
        // a helper, because the remedies differ.
        kind: positionOf.get(userId) === 'assistant' ? 'assistant' : 'teacher',
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
  throw new AppError('SCHEDULE_CONFLICT', 'the room or a member of staff is already committed', {
    reason: 'OVERLAPPING_SESSIONS',
    conflicts: conflicts.slice(0, 20),
    total: conflicts.length,
  });
}

export async function createCourseSchedule(
  prisma: PrismaClient,
  actor: Actor,
  input: CourseScheduleInput,
  now: Date = new Date(),
): Promise<{ id: string; materialized: MaterializeResult }> {
  assertCanManage(actor);
  scope.assertCanActOnBranch(actor.roleScopes, MANAGING_ROLE, input.branchId, 'no such branch');

  const horizon = await horizonFor(prisma, now);

  return prisma.$transaction(async (tx) => {
    const subject = await tx.subject.findFirst({
      where: { id: input.subjectId, deletedAt: null },
      select: { id: true },
    });
    if (!subject) throw new AppError('NOT_FOUND', 'no such subject');

    const target = await resolveTarget(tx, input.teachingMode, input.targetId, input.branchId);

    // **The rule this surface was missing entirely.** Teaching Groups and
    // content both refused a Subject the Level does not teach; scheduling did
    // not, which is how the live database came to hold three schedules while
    // `level_subject` held none — classes delivering a Subject their Level
    // officially does not offer, and to which no content could then be attached.
    // One policy, all three surfaces (`policies/curriculum.ts`).
    await assertSubjectTaughtAtLevel(tx, target.effectiveLevelId, input.subjectId);

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
      if (!room) throw new AppError('NOT_FOUND', 'no such room');
      if (room.branchId !== input.branchId) {
        throw new AppError('VALIDATION_FAILED', 'room is at a different branch', {
          reason: 'ROOM_BRANCH_MISMATCH',
        });
      }
      // BR-23: the room's capacity is NOT consulted. It informs planning and
      // refuses nothing — re-adding a check here would resurrect the invariant
      // whose removal justified dropping the roster lock.
    }

    const staff = input.staff ?? [];
    const conflicts = await findConflicts(
      tx,
      {
        branchId: input.branchId,
        roomId: input.roomId ?? null,
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
        subjectId: input.subjectId,
        teachingMode: input.teachingMode,
        ...targetColumns,
        branchId: input.branchId,
        roomId: input.roomId ?? null,
        startTime: input.startTime,
        endTime: input.endTime,
        recurrence: input.recurrence as never,
        weekdays: (input.weekdays ?? []) as never,
        dayOfMonth: input.dayOfMonth ?? null,
        monthOfYear: input.monthOfYear ?? null,
        anchorDate: input.anchorDate ?? null,
        effectiveUntil: input.effectiveUntil ?? null,
        academicYearId: input.academicYearId,
      },
      select: { id: true },
    });

    for (const s of staff) {
      await tx.courseScheduleStaff.create({
        data: { scheduleId: schedule.id, userId: s.userId, position: s.position },
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
    if (!loaded) throw new AppError('INTERNAL', 'schedule vanished mid-transaction');
    const materialized = await materializeSchedule(tx, loaded, now, horizon);

    // The pg-boss row is enqueued too, so the nightly horizon extension has a
    // record to work from even though the sessions already exist (§16.2: same
    // transaction, via the repository, never `boss.send()`).
    await enqueue(tx, JOB_QUEUES.sessionMaterialize, { schedule_id: schedule.id }, schedule.id);

    await audit.write(tx, {
      actorUserId: actor.userId,
      actionType: 'courseschedule.create',
      targetEntity: 'RecurringCourseSchedule',
      targetId: schedule.id,
      detail: {
        subject_id: input.subjectId,
        teaching_mode: input.teachingMode,
        target_id: input.targetId,
        branch_id: input.branchId,
        room_id: input.roomId ?? null,
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
    roomId?: string | null;
    startTime?: Date;
    endTime?: Date;
    recurrence?: string;
    weekdays?: string[];
    dayOfMonth?: number | null;
    monthOfYear?: number | null;
    anchorDate?: Date | null;
  effectiveUntil?: Date | null;
    version: number;
    /**
     * **SRS Revision 50 — which occurrences this edit applies to.**
     *
     * `all_sessions` (the default, and the behaviour that predates R50) rewrites
     * future un-overridden Sessions of this schedule. `this_and_future` **splits
     * the schedule**: see `splitCourseSchedule`.
     */
    scope?: 'all_sessions' | 'this_and_future';
    /** Required by `this_and_future` — the occurrence the split begins at. */
    fromDate?: Date;
  },
  now: Date = new Date(),
): Promise<{ id: string; successorId?: string; materialized: MaterializeResult }> {
  assertCanManage(actor);

  if (data.scope === 'this_and_future') {
    if (!data.fromDate) {
      throw new AppError('VALIDATION_FAILED', 'this_and_future requires from_date (§4.4, R50)', {
        reason: 'FROM_DATE_REQUIRED',
      });
    }
    return splitCourseSchedule(prisma, actor, id, data.fromDate, data, now);
  }

  const existing = await prisma.recurringCourseSchedule.findFirst({
    where: { id, deletedAt: null },
    select: {
      branchId: true,
      roomId: true,
      startTime: true,
      endTime: true,
      recurrence: true,
      weekdays: true,
      dayOfMonth: true,
      monthOfYear: true,
      anchorDate: true,
      effectiveUntil: true,
      staff: { where: { deletedAt: null }, select: { userId: true, position: true } },
    },
  });
  if (!existing) throw new AppError('NOT_FOUND', 'no such schedule');
  scope.assertCanActOnBranch(actor.roleScopes, MANAGING_ROLE, existing.branchId, 'no such schedule');

  const horizon = await horizonFor(prisma, now);

  return prisma.$transaction(async (tx) => {
    const merged = {
      branchId: existing.branchId,
      roomId: data.roomId === undefined ? existing.roomId : data.roomId,
      startTime: data.startTime ?? existing.startTime,
      endTime: data.endTime ?? existing.endTime,
      recurrence: data.recurrence ?? existing.recurrence,
      weekdays: data.weekdays ?? existing.weekdays,
      dayOfMonth: data.dayOfMonth === undefined ? existing.dayOfMonth : data.dayOfMonth,
      monthOfYear: data.monthOfYear === undefined ? existing.monthOfYear : data.monthOfYear,
      anchorDate: data.anchorDate === undefined ? existing.anchorDate : data.anchorDate,
      staff: existing.staff.map((s) => ({ userId: s.userId, position: s.position })),
    };

    // Its own sessions are excluded, or the schedule would conflict with itself.
    const conflicts = await findConflicts(tx, merged, now, horizon, id);
    assertNoConflicts(conflicts);

    await updateWithVersion({
      delegate: tx.recurringCourseSchedule,
      id,
      expectedVersion: data.version,
      requireNotDeleted: true,
      data: {
        ...(data.roomId === undefined ? {} : { roomId: data.roomId }),
        ...(data.startTime === undefined ? {} : { startTime: data.startTime }),
        ...(data.endTime === undefined ? {} : { endTime: data.endTime }),
        ...(data.recurrence === undefined ? {} : { recurrence: data.recurrence }),
        ...(data.weekdays === undefined ? {} : { weekdays: data.weekdays }),
        ...(data.dayOfMonth === undefined ? {} : { dayOfMonth: data.dayOfMonth }),
        ...(data.monthOfYear === undefined ? {} : { monthOfYear: data.monthOfYear }),
        ...(data.anchorDate === undefined ? {} : { anchorDate: data.anchorDate }),
      },
    });

    const loaded = await loadSchedule(tx, id);
    if (!loaded) throw new AppError('INTERNAL', 'schedule vanished mid-transaction');
    const materialized = await materializeSchedule(tx, loaded, now, horizon);

    await audit.write(tx, {
      actorUserId: actor.userId,
      actionType: 'courseschedule.update',
      targetEntity: 'RecurringCourseSchedule',
      targetId: id,
      detail: {
        sessions_created: materialized.created,
        // Both numbers, because §4.4 makes reporting the untouched ones part of
        // the behaviour rather than a nicety.
        sessions_left_alone: materialized.protectedSessions.length,
        protected_reasons: materialized.protectedSessions.flatMap((p) => p.reasons),
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
    roomId?: string | null;
    startTime?: Date;
    endTime?: Date;
    recurrence?: string;
    weekdays?: string[];
    dayOfMonth?: number | null;
    monthOfYear?: number | null;
    anchorDate?: Date | null;
  effectiveUntil?: Date | null;
    version: number;
  },
  now: Date,
): Promise<{ id: string; successorId: string; materialized: MaterializeResult }> {
  const existing = await prisma.recurringCourseSchedule.findFirst({
    where: { id, deletedAt: null },
    select: {
      subjectId: true,
      teachingMode: true,
      levelId: true,
      administrativeGroupId: true,
      teachingGroupId: true,
      branchId: true,
      roomId: true,
      startTime: true,
      endTime: true,
      recurrence: true,
      weekdays: true,
      dayOfMonth: true,
      monthOfYear: true,
      anchorDate: true,
      effectiveUntil: true,
      academicYearId: true,
      staff: { where: { deletedAt: null }, select: { userId: true, position: true } },
    },
  });
  if (!existing) throw new AppError('NOT_FOUND', 'no such schedule');
  scope.assertCanActOnBranch(actor.roleScopes, MANAGING_ROLE, existing.branchId, 'no such schedule');

  const splitOn = atMidnightUtc(fromDate);
  // Splitting at or before a date the series never reached would produce a
  // closed schedule covering nothing and a successor identical to the original.
  if (existing.effectiveUntil && splitOn > atMidnightUtc(existing.effectiveUntil)) {
    throw new AppError('VALIDATION_FAILED', 'that date is after this schedule already ends', {
      reason: 'SPLIT_AFTER_END',
    });
  }
  const closeAt = addDays(splitOn, -1);
  const horizon = await horizonFor(prisma, now);

  return prisma.$transaction(async (tx) => {
    const successorValues = {
      subjectId: existing.subjectId,
      teachingMode: existing.teachingMode,
      levelId: existing.levelId,
      administrativeGroupId: existing.administrativeGroupId,
      teachingGroupId: existing.teachingGroupId,
      branchId: existing.branchId,
      academicYearId: existing.academicYearId,
      roomId: data.roomId === undefined ? existing.roomId : data.roomId,
      startTime: data.startTime ?? existing.startTime,
      endTime: data.endTime ?? existing.endTime,
      // Cast to the Prisma enums: the caller's values are already validated by
      // the same Zod schema the create path uses, and the database CHECKs are
      // the backstop either way.
      recurrence: (data.recurrence ?? existing.recurrence) as typeof existing.recurrence,
      weekdays: (data.weekdays ?? existing.weekdays) as typeof existing.weekdays,
      dayOfMonth: data.dayOfMonth === undefined ? existing.dayOfMonth : data.dayOfMonth,
      monthOfYear: data.monthOfYear === undefined ? existing.monthOfYear : data.monthOfYear,
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
      { ...successorValues, staff: existing.staff.map((s) => ({ userId: s.userId, position: s.position })) },
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
    if (!loaded) throw new AppError('INTERNAL', 'successor vanished mid-transaction');
    const materialized = await materializeSchedule(tx, loaded, splitOn, horizon);

    await audit.write(tx, {
      actorUserId: actor.userId,
      actionType: 'courseschedule.update',
      targetEntity: 'RecurringCourseSchedule',
      targetId: id,
      detail: {
        scope: 'this_and_future',
        split_on: splitOn.toISOString().slice(0, 10),
        successor_id: successor.id,
        sessions_created: materialized.created,
        // What the split MOVED and what it refused to move — the same pair every
        // other scheduling write reports (§4.4).
        sessions_released: removable.length,
        sessions_left_alone: future.length - removable.length,
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
  if (!schedule) throw new AppError('NOT_FOUND', 'no such schedule');
  scope.assertCanActOnBranch(actor.roleScopes, MANAGING_ROLE, schedule.branchId, 'no such schedule');

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
      targetEntity: 'RecurringCourseSchedule',
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

    const retained = await tx.session.count({ where: { scheduleId: id, deletedAt: null } });

    await audit.write(tx, {
      actorUserId: actor.userId,
      actionType: 'courseschedule.delete',
      targetEntity: 'RecurringCourseSchedule',
      targetId: id,
      detail: { future_sessions_removed: removable.length, sessions_retained: retained },
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
  if (!schedule) throw new AppError('NOT_FOUND', 'no such schedule');

  const where = { scheduleId: id, deletedAt: null };
  const window = pageWindow(params);
  const [rows, total] = await Promise.all([
    prisma.session.findMany({
      where,
      // Chronological: this list is read as a timetable, and `id` is the stable
      // tiebreaker that keeps pagination from repeating a row.
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
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
        version: true,
        staff: { where: { deletedAt: null }, select: { userId: true, position: true } },
      },
    }),
    prisma.session.count({ where }),
  ]);

  const reasons = await protectionReasons(
    prisma as unknown as Prisma.TransactionClient,
    rows.map((r) => ({ id: r.id, date: r.date, overridden: r.overridden, status: r.status })),
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
      startTime: true,
      endTime: true,
      recurrence: true,
      weekdays: true,
      dayOfMonth: true,
      monthOfYear: true,
      anchorDate: true,
      effectiveUntil: true,
      staff: { where: { deletedAt: null }, select: { userId: true, position: true } },
    },
  });
  if (!s) throw new AppError('NOT_FOUND', 'no such schedule');
  scope.assertCanActOnBranch(actor.roleScopes, MANAGING_ROLE, s.branchId, 'no such schedule');

  const horizon = await horizonFor(prisma, now);
  return prisma.$transaction((tx) =>
    findConflicts(
      tx,
      { ...s, staff: s.staff.map((x) => ({ userId: x.userId, position: x.position })) },
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
): Promise<Page<RecurringCourseSchedule & { staff: { userId: string; position: string }[] }>> {
  assertCanRead(actor);

  const where: Prisma.RecurringCourseScheduleWhereInput = {
    deletedAt: null,
    ...(filters.branchId ? { branchId: filters.branchId } : {}),
    ...(filters.subjectId ? { subjectId: filters.subjectId } : {}),
    ...(filters.academicYearId ? { academicYearId: filters.academicYearId } : {}),
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
      orderBy: [{ startTime: 'asc' }, { endTime: 'asc' }],
      include: { staff: { where: { deletedAt: null }, select: { userId: true, position: true } } },
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
  if (!schedule) throw new AppError('NOT_FOUND', 'no such schedule');

  return resolveAudience(prisma, schedule, { id: true, nameArabic: true }) as Promise<
    { id: string; nameArabic: string | null }[]
  >;
}
