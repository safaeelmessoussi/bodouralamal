import type { Group, Prisma, PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import * as scope from '../policies/branch-scope.js';
import type { RoleScope } from '../policies/branch-scope.js';
import * as audit from '../repositories/audit.repository.js';
import * as trash from '../repositories/trash.repository.js';
import { updateWithVersion } from '../repositories/optimistic-lock.js';

/**
 * Group management (SRS §4.4, §5.6, TD-2, TD-11, TD-15).
 *
 * §4.4: *"Scheduling is Group-driven, not Event-driven."* A Group carries its
 * own fixed weekly slot — `day_of_week`, `start_time`, `end_time`, `room_id`,
 * `branch_id`, `max_students` — and enrolling in it *is* the student's standing
 * class time. There is no separate recurring-session object.
 *
 * A Group is **operational data** (Revision 26): Admins manage it within their
 * branch scope, and it *references* a Branch, Level and Room which they select
 * but cannot modify. Times are **local Moroccan wall-clock** (TD-11) and are
 * stored as `time` columns, never as instants — a class at 09:00 is at 09:00
 * across a DST change, which is exactly why no timezone conversion happens here.
 */

/** TD-2: Groups are operational data — Admin within scope, or Super Admin. */
const MANAGING_ROLE = 'admin';

export interface Actor {
  userId: string;
  roles: string[];
  roleScopes: RoleScope[];
}

const isSuperAdmin = (actor: Actor) => scope.isSuperAdmin(actor.roleScopes);
const isAdmin = (actor: Actor) => scope.hasRole(actor.roleScopes, MANAGING_ROLE) || isSuperAdmin(actor);

function assertCanManage(actor: Actor): void {
  if (!isAdmin(actor)) throw new AppError('FORBIDDEN', 'group management requires admin');
}

export interface GroupInput {
  name: string;
  levelId: string;
  branchId: string;
  roomId?: string | null;
  dayOfWeek: string;
  startTime: Date;
  endTime: Date;
  maxStudents: number;
}

/**
 * Two half-open intervals on the same day overlap unless one ends at or before
 * the other starts. Half-open is deliberate: a class ending at 10:30 and the
 * next starting at 10:30 do **not** conflict, which is how back-to-back slots
 * are actually scheduled.
 */
function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Minutes since midnight — `time` columns carry no meaningful date part. */
const minutes = (d: Date): number => d.getUTCHours() * 60 + d.getUTCMinutes();

/**
 * Rejects a Group whose slot collides with another Group in the same room
 * (§4.4 "conflict detection (same room/time overlap)").
 *
 * **TD-15 pessimistic lock:** this is a check-then-write invariant, so the
 * governing row — the Room — is locked before the check, via §16.2's sanctioned
 * repository-level raw SQL. Without it two concurrent creates each see a free
 * slot and both commit, double-booking the room. Locking the parent Room rather
 * than the child Groups also keeps TD-15's "parent before children" ordering.
 *
 * A Group with no room cannot collide: nothing is being shared.
 */
async function assertNoRoomConflict(
  tx: Prisma.TransactionClient,
  input: { roomId?: string | null; dayOfWeek: string; startTime: Date; endTime: Date },
  excludeGroupId?: string,
): Promise<void> {
  if (!input.roomId) return;

  await tx.$queryRaw`SELECT id FROM "room" WHERE id = ${input.roomId}::uuid FOR UPDATE`;

  const sameSlot = await tx.group.findMany({
    where: {
      roomId: input.roomId,
      dayOfWeek: input.dayOfWeek as never,
      deletedAt: null,
      ...(excludeGroupId ? { id: { not: excludeGroupId } } : {}),
    },
    select: { id: true, startTime: true, endTime: true },
  });

  const clash = sameSlot.find((g) =>
    overlaps(
      new Date(0, 0, 0, 0, minutes(input.startTime)),
      new Date(0, 0, 0, 0, minutes(input.endTime)),
      new Date(0, 0, 0, 0, minutes(g.startTime)),
      new Date(0, 0, 0, 0, minutes(g.endTime)),
    ),
  );
  if (clash) {
    // TD-3.8 deliberately has no dedicated schedule-conflict code: a room/time
    // collision is a specific kind of state conflict, and the global error
    // vocabulary is not expanded for each one. The distinction a client needs
    // travels in the envelope's `details` instead, which already exists.
    throw new AppError('STATE_CONFLICT', 'room is already booked for an overlapping slot', {
      reason: 'ROOM_TIME_OVERLAP',
      constraint: 'ROOM_SCHEDULE',
      conflicting_group_id: clash.id,
    });
  }
}

/** Validates the reference rows a Group points at (Revision 26: it selects, never modifies). */
async function assertReferencesValid(
  tx: Prisma.TransactionClient,
  input: { levelId: string; branchId: string; roomId?: string | null },
): Promise<void> {
  const [level, branch] = await Promise.all([
    tx.level.findFirst({ where: { id: input.levelId, deletedAt: null }, select: { id: true } }),
    tx.branch.findFirst({ where: { id: input.branchId, deletedAt: null }, select: { id: true } }),
  ]);
  if (!level) throw new AppError('NOT_FOUND', 'level not found');
  if (!branch) throw new AppError('NOT_FOUND', 'branch not found');

  if (input.roomId) {
    // A room belonging to a different branch would put the group in two places.
    const room = await tx.room.findFirst({
      where: { id: input.roomId, branchId: input.branchId, deletedAt: null },
      select: { id: true },
    });
    if (!room) throw new AppError('NOT_FOUND', 'room not found in this branch');
  }
}

function assertValidSlot(input: { startTime: Date; endTime: Date; maxStudents: number }): void {
  if (minutes(input.endTime) <= minutes(input.startTime)) {
    throw new AppError('VALIDATION_FAILED', 'end_time must be after start_time');
  }
  if (input.maxStudents < 1) {
    throw new AppError('VALIDATION_FAILED', 'max_students must be at least 1');
  }
}

export async function listGroups(prisma: PrismaClient, actor: Actor): Promise<Group[]> {
  assertCanManage(actor);
  // `branchFilter` is Branch-keyed (`id`); a Group keys its branch as `branchId`.
  const reachable = scope.reachableBranches(actor.roleScopes, [MANAGING_ROLE]);
  return prisma.group.findMany({
    where: {
      deletedAt: null,
      ...(reachable === null ? {} : { branchId: { in: reachable } }),
    },
    orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }, { name: 'asc' }, { id: 'asc' }],
  });
}

export async function createGroup(
  prisma: PrismaClient,
  actor: Actor,
  input: GroupInput,
): Promise<Group> {
  assertCanManage(actor);
  scope.assertCanActOnBranch(actor.roleScopes, MANAGING_ROLE, input.branchId);
  assertValidSlot(input);

  return prisma.$transaction(async (tx) => {
    await assertReferencesValid(tx, input);
    await assertNoRoomConflict(tx, input);

    const group = await tx.group.create({
      data: {
        name: input.name,
        levelId: input.levelId,
        branchId: input.branchId,
        roomId: input.roomId ?? null,
        dayOfWeek: input.dayOfWeek as never,
        startTime: input.startTime,
        endTime: input.endTime,
        maxStudents: input.maxStudents,
      },
    });

    await audit.write(tx, {
      actorUserId: actor.userId,
      actionType: 'group.create',
      targetEntity: 'Group',
      targetId: group.id,
      detail: { name: group.name, branch_id: input.branchId, room_id: input.roomId ?? null },
    });
    return group;
  });
}

export async function updateGroup(
  prisma: PrismaClient,
  actor: Actor,
  id: string,
  expectedVersion: number,
  data: Partial<GroupInput>,
): Promise<Group> {
  assertCanManage(actor);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.group.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new AppError('NOT_FOUND', 'no such group');
    scope.assertCanActOnBranch(actor.roleScopes, MANAGING_ROLE, existing.branchId);

    const merged = {
      levelId: data.levelId ?? existing.levelId,
      branchId: data.branchId ?? existing.branchId,
      roomId: data.roomId === undefined ? existing.roomId : data.roomId,
      dayOfWeek: data.dayOfWeek ?? existing.dayOfWeek,
      startTime: data.startTime ?? existing.startTime,
      endTime: data.endTime ?? existing.endTime,
      maxStudents: data.maxStudents ?? existing.maxStudents,
    };
    // Moving a group into another branch requires scope over the destination
    // too, or an Admin could push a group outside their own reach.
    if (merged.branchId !== existing.branchId) scope.assertCanActOnBranch(actor.roleScopes, MANAGING_ROLE, merged.branchId);
    assertValidSlot(merged);
    await assertReferencesValid(tx, merged);
    await assertNoRoomConflict(tx, merged, id);

    // TD-15.1: conditional UPDATE on `version` — a stale version is a coded 409
    // rather than a silent overwrite of a colleague's edit.
    const updated = await updateWithVersion<Group>({
      delegate: tx.group,
      id,
      expectedVersion,
      requireNotDeleted: true,
      data: { ...(data.name ? { name: data.name } : {}), ...merged },
    });

    await audit.write(tx, {
      actorUserId: actor.userId,
      actionType: 'group.update',
      targetEntity: 'Group',
      targetId: id,
      detail: { fields_changed: Object.keys(data) },
    });
    return updated;
  });
}

export async function deleteGroup(prisma: PrismaClient, actor: Actor, id: string): Promise<void> {
  assertCanManage(actor);

  await prisma.$transaction(async (tx) => {
    const group = await tx.group.findFirst({ where: { id, deletedAt: null } });
    if (!group) throw new AppError('NOT_FOUND', 'no such group');
    scope.assertCanActOnBranch(actor.roleScopes, MANAGING_ROLE, group.branchId);

    // TD-5: deletion is blocked while students are enrolled, matching the
    // Branch/Room precedent — un-enrolment is a deliberate roster action, not a
    // side effect of deleting the group they are in.
    const enrolled = await tx.studentGroup.count({ where: { groupId: id, deletedAt: null } });
    if (enrolled > 0) {
      throw new AppError('STATE_CONFLICT', `group still has ${enrolled} enrolled student(s)`);
    }

    await tx.group.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: actor.userId },
    });
    await trash.snapshot(tx, {
      targetEntity: 'Group',
      targetId: id,
      // The times are `time` columns; serialising them explicitly keeps the
      // wall-clock value readable in the snapshot (TD-11).
      snapshot: JSON.parse(
        JSON.stringify({
          ...group,
          startTime: group.startTime.toISOString(),
          endTime: group.endTime.toISOString(),
        }),
      ) as object,
      deletedById: actor.userId,
    });
    await audit.write(tx, {
      actorUserId: actor.userId,
      actionType: 'group.delete',
      targetEntity: 'Group',
      targetId: id,
      detail: { name: group.name },
    });
  });
}


/**
 * §4.4/§7: **two instructor slots per group.** Co-teaching is supported and
 * capped — a third assignment is refused rather than silently accepted, because
 * `GroupTeacher` is the resolution table for *all* teacher scoping (§4.2), so an
 * unbounded roster of teachers would quietly widen access to every student in
 * the group.
 */
const INSTRUCTOR_SLOTS = 2;

export async function assignTeacher(
  prisma: PrismaClient,
  actor: Actor,
  groupId: string,
  teacherId: string,
): Promise<{ id: string; slotsUsed: number }> {
  assertCanManage(actor);

  return prisma.$transaction(async (tx) => {
    const group = await tx.group.findFirst({ where: { id: groupId, deletedAt: null } });
    if (!group) throw new AppError('NOT_FOUND', 'no such group');
    scope.assertCanActOnBranch(actor.roleScopes, MANAGING_ROLE, group.branchId);

    // The person must actually hold the teacher role: assigning someone who
    // does not would grant §4.2 teaching reach to an account that TD-2 never
    // intended to have it.
    const holdsRole = await tx.userBranchRole.findFirst({
      where: { userId: teacherId, deletedAt: null, role: { name: 'teacher' }, user: { deletedAt: null } },
      select: { id: true },
    });
    if (!holdsRole) throw new AppError('NOT_FOUND', 'no such teacher');

    const existing = await tx.groupTeacher.findFirst({ where: { groupId, teacherId } });
    if (existing && existing.deletedAt === null) {
      throw new AppError('DUPLICATE', 'teacher already assigned to this group');
    }

    // TD-15: check-then-write on a bounded invariant, so lock the governing row.
    await tx.$queryRaw`SELECT id FROM "group" WHERE id = ${groupId}::uuid FOR UPDATE`;
    const used = await tx.groupTeacher.count({ where: { groupId, deletedAt: null } });
    if (used >= INSTRUCTOR_SLOTS) {
      throw new AppError('STATE_CONFLICT', `group already has ${INSTRUCTOR_SLOTS} instructors`, {
        reason: 'INSTRUCTOR_SLOTS_FULL',
        constraint: 'GROUP_TEACHER_SLOTS',
        slots: INSTRUCTOR_SLOTS,
      });
    }

    // A previously revoked assignment is revived rather than duplicated: §7's
    // unique (group_id, teacher_id) spans deleted rows.
    const row = existing
      ? await tx.groupTeacher.update({
          where: { id: existing.id },
          data: { deletedAt: null, deletedById: null },
          select: { id: true },
        })
      : await tx.groupTeacher.create({ data: { groupId, teacherId }, select: { id: true } });

    await audit.write(tx, {
      actorUserId: actor.userId,
      actionType: 'groupteacher.assign',
      targetEntity: 'GroupTeacher',
      targetId: row.id,
      detail: { group_id: groupId, teacher_id: teacherId, slots_used: used + 1 },
    });
    return { id: row.id, slotsUsed: used + 1 };
  });
}

export async function unassignTeacher(
  prisma: PrismaClient,
  actor: Actor,
  groupId: string,
  teacherId: string,
): Promise<void> {
  assertCanManage(actor);

  await prisma.$transaction(async (tx) => {
    const group = await tx.group.findFirst({ where: { id: groupId, deletedAt: null } });
    if (!group) throw new AppError('NOT_FOUND', 'no such group');
    scope.assertCanActOnBranch(actor.roleScopes, MANAGING_ROLE, group.branchId);

    const row = await tx.groupTeacher.findFirst({ where: { groupId, teacherId, deletedAt: null } });
    if (!row) throw new AppError('NOT_FOUND', 'teacher is not assigned to this group');

    // Soft-delete: §4.2 resolves teacher reach through live rows, so this ends
    // their access to the group's students on the very next request.
    await tx.groupTeacher.update({
      where: { id: row.id },
      data: { deletedAt: new Date(), deletedById: actor.userId },
    });
    await audit.write(tx, {
      actorUserId: actor.userId,
      actionType: 'groupteacher.unassign',
      targetEntity: 'GroupTeacher',
      targetId: row.id,
      detail: { group_id: groupId, teacher_id: teacherId },
    });
  });
}
