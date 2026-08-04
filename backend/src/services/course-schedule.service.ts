import type { Prisma, PrismaClient, TeachingMode } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { expandSchedule, timesOverlap } from '../lib/recurrence.js';
import * as scope from '../policies/branch-scope.js';
import * as audit from '../repositories/audit.repository.js';
import { enqueue, JOB_QUEUES } from '../repositories/jobs.repository.js';
import { updateWithVersion } from '../repositories/optimistic-lock.js';
import type { Actor } from './branch.service.js';
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
 * *Not built here:* the `/admin/course-schedules` endpoints. Service layer only.
 */

const MANAGING_ROLE = 'admin';

const isSuperAdmin = (actor: Actor): boolean => scope.isSuperAdmin(actor.roleScopes);

function assertCanManage(actor: Actor): void {
  if (!(scope.hasRole(actor.roleScopes, MANAGING_ROLE) || isSuperAdmin(actor))) {
    throw new AppError('FORBIDDEN', 'course schedule management requires admin');
  }
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
): Promise<{ levelId: string | null; administrativeGroupId: string | null; teachingGroupId: string | null }> {
  switch (mode) {
    case 'entire_level': {
      const level = await tx.level.findFirst({
        where: { id: targetId, deletedAt: null },
        select: { id: true },
      });
      if (!level) throw new AppError('NOT_FOUND', 'no such level');
      return { levelId: targetId, administrativeGroupId: null, teachingGroupId: null };
    }
    case 'administrative_group': {
      const group = await tx.administrativeGroup.findFirst({
        where: { id: targetId, deletedAt: null },
        select: { id: true, branchId: true },
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
      return { levelId: null, administrativeGroupId: targetId, teachingGroupId: null };
    }
    case 'teaching_group': {
      const group = await tx.teachingGroup.findFirst({
        where: { id: targetId, deletedAt: null },
        select: { id: true },
      });
      if (!group) throw new AppError('NOT_FOUND', 'no such teaching group');
      // A Teaching Group has no branch (§4.4c, R43.3), so there is nothing to
      // match here — the branch is the schedule's own statement of where it
      // meets.
      return { levelId: null, administrativeGroupId: null, teachingGroupId: targetId };
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
        ...(staffIds.length > 0
          ? [
              { teacherId: { in: staffIds } },
              { schedule: { staff: { some: { userId: { in: staffIds }, deletedAt: null } } } },
            ]
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
      teacherId: true,
      schedule: {
        select: { staff: { where: { deletedAt: null }, select: { userId: true } } },
      },
    },
  });

  const out: ScheduleConflict[] = [];
  for (const s of clashes) {
    if (!timesOverlap(candidate.startTime, candidate.endTime, s.startTime, s.endTime)) continue;
    const date = s.date.toISOString().slice(0, 10);

    if (candidate.roomId !== null && s.roomId === candidate.roomId) {
      out.push({ kind: 'room', date, sessionId: s.id, scheduleId: s.scheduleId, resourceId: candidate.roomId });
    }
    const busy = new Set<string>([
      ...(s.teacherId ? [s.teacherId] : []),
      ...s.schedule.staff.map((t) => t.userId),
    ]);
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
        ...target,
        branchId: input.branchId,
        roomId: input.roomId ?? null,
        startTime: input.startTime,
        endTime: input.endTime,
        recurrence: input.recurrence as never,
        weekdays: (input.weekdays ?? []) as never,
        dayOfMonth: input.dayOfMonth ?? null,
        monthOfYear: input.monthOfYear ?? null,
        anchorDate: input.anchorDate ?? null,
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
    version: number;
  },
  now: Date = new Date(),
): Promise<{ id: string; materialized: MaterializeResult }> {
  assertCanManage(actor);

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
        protected_reasons: materialized.protectedSessions.map((p) => p.reason),
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
    const future = await tx.session.findMany({
      where: { scheduleId: id, deletedAt: null, date: { gte: now }, status: 'scheduled' },
      select: { id: true, overridden: true, _count: { select: { linkedContent: { where: { deletedAt: null } } } } },
    });
    const removable = future.filter((s) => !s.overridden && s._count.linkedContent === 0);

    const stamp = new Date();
    await tx.session.updateMany({
      where: { id: { in: removable.map((s) => s.id) } },
      data: { deletedAt: stamp, deletedById: actor.userId },
    });
    await tx.recurringCourseSchedule.update({
      where: { id },
      data: { deletedAt: stamp, deletedById: actor.userId },
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
