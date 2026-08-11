import type { Branch, PrismaClient, Room } from '../generated/prisma/client.js';
import * as scope from '../policies/branch-scope.js';
import { teacherBranchIds } from '../policies/roster-resolution.js';
import type { Actor } from '../policies/actor.js';
import { AppError } from '../lib/errors.js';
import { page, pageWindow, type Page, type PageParams } from '../lib/pagination.js';
import * as audit from '../repositories/audit.repository.js';
import * as trash from '../repositories/trash.repository.js';
import { assertNoBlockingReferences, updateWithVersion } from '../repositories/optimistic-lock.js';
import { backfillFirstGroups } from './administrative-group.service.js';

/**
 * Branch and Room management (SRS §5.6, §2.2, TD-2, TD-5, TD-15).
 *
 * Ordering, deletion guards, and the Super-Admin-only `display_order` rule all
 * live here rather than in controllers (§16.2: no business logic in the HTTP
 * layer).
 */


const isSuperAdmin = (actor: Actor): boolean => scope.isSuperAdmin(actor.roleScopes);
const isAdmin = (actor: Actor): boolean => scope.hasRole(actor.roleScopes, 'admin') || isSuperAdmin(actor);

/**
 * The role whose assignments bound branch management (§4.2 Revision 24). Naming
 * it is what keeps this a per-role check rather than a union across every role
 * the caller happens to hold.
 */
const MANAGING_ROLE = 'admin';

/**
 * TD-2 (Revision 26): Branches and Rooms are **reference/configuration data** —
 * only a Super Admin may create, edit or delete them. Activating a branch is an
 * organisational decision, so `operational_start_date` and `display_order` fall
 * under the same rule.
 *
 * This also removes an incoherence: an Admin could previously create a branch,
 * but creation cannot be scope-checked (no branch exists yet to check against),
 * so the result was a branch its own creator could not then see.
 */
function assertCanWriteReferenceData(actor: Actor): void {
  if (!isSuperAdmin(actor)) {
    throw new AppError('FORBIDDEN', 'reference data is Super Admin only (§4.2, TD-2 Revision 26)');
  }
}

/**
 * TD-2 (Revision 26): Admins **read** reference data, branch-scoped, because
 * operational work depends on it — a Group references a Branch, a Level and a
 * Room, so withdrawing read access would make Group management impossible.
 *
 * **Teachers read it too, and did not.** R26's own sentence retains read access
 * for *"Admins (branch-scoped) and **Teachers (own groups)**"*, and this guard
 * demanded `isAdmin` — so every teacher was refused a list the specification
 * grants them. A gap against R26, not a rule.
 */
function assertCanReadReferenceData(actor: Actor): void {
  if (!isAdmin(actor) && !scope.hasRole(actor.roleScopes, 'teacher')) {
    throw new AppError('FORBIDDEN', 'branch access requires admin or teacher');
  }
}

/**
 * **The branches this caller may see at all** — `null` meaning every branch.
 *
 * Two different questions, answered from two different places, because the two
 * roles derive reach differently and §4.2 forbids unioning them:
 *
 *   * an **Admin** reaches the branches on their own `admin` assignments
 *     (`branches: null` = all of them, R24);
 *   * a **Teacher** reaches the branches of the schedules they staff (§4.4c as
 *     amended by R43.3 — *"teacher scope resolves through the Course Schedule"*),
 *     which is what `teacherBranchIds` already computes for every other teacher
 *     surface. Their `UserBranchRole` row is deliberately NOT consulted: a
 *     teacher assignment with `branch_id IS NULL` would mean *every branch*, and
 *     a teacher's reach is where they teach, not where their row was written.
 *
 * A caller holding both roles reaches the union of the two — which is not the
 * flat-union §4.2 prohibits: each half was resolved under its own role first.
 */
async function visibleBranchIds(
  prisma: PrismaClient,
  actor: Actor,
): Promise<string[] | null> {
  if (isSuperAdmin(actor)) return null;

  const asAdmin = scope.hasRole(actor.roleScopes, MANAGING_ROLE)
    ? scope.reachableBranches(actor.roleScopes, [MANAGING_ROLE])
    : [];
  // `null` from an all-branches admin assignment ends the question.
  if (asAdmin === null) return null;

  const asTeacher = scope.hasRole(actor.roleScopes, 'teacher')
    ? await teacherBranchIds(prisma, actor.userId)
    : [];

  return [...new Set([...asAdmin, ...asTeacher])];
}

/**
 * §2.2: `display_order` values are editable by **Super Admins only**. An Admin
 * may edit a branch, but any attempt to move it in the ordering is refused —
 * the field is checked separately from the rest of the payload.
 */
function assertMaySetDisplayOrder(actor: Actor, data: { displayOrder?: number | null }): void {
  if ('displayOrder' in data && data.displayOrder !== undefined && !isSuperAdmin(actor)) {
    throw new AppError('FORBIDDEN', 'display_order is Super Admin only (§2.2)');
  }
}

/**
 * §2.2/TD-10 ordering: `display_order ASC NULLS LAST`, then `name` — which is
 * correct Arabic order automatically because the column is natively collated
 * `ar-x-icu` (TD-6a). Never add a per-query COLLATE; fix the column instead.
 */
export async function listBranches(
  prisma: PrismaClient,
  actor: Actor,
  params: PageParams = {},
): Promise<Page<Branch>> {
  assertCanReadReferenceData(actor);
  // **Other branches' names are not shown** (Owner instruction, 2026-08-11).
  // Viewing a branch is not privileged, but seeing branches you have nothing to
  // do with is noise at best and organisational detail at worst.
  const visible = await visibleBranchIds(prisma, actor);
  const where = {
    deletedAt: null,
    ...(visible === null ? {} : { id: { in: visible } }),
  };
  const window = pageWindow(params);
  const [rows, total] = await Promise.all([
    prisma.branch.findMany({
      where,
      // TD-10: `display_order ASC NULLS LAST`, then `name` (correct Arabic order
      // via the native collation), then `id` as the stable tiebreaker.
      orderBy: [{ displayOrder: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }, { id: 'asc' }],
      skip: window.skip,
      take: window.take,
    }),
    prisma.branch.count({ where }),
  ]);
  return page(rows, window, total);
}

/** The Revision-35 public contact fields, shared by create and update. */
export interface BranchPublicFields {
  address?: string | undefined;
  phone?: string | null | undefined;
  email?: string | null | undefined;
  openingHoursAr?: string | undefined;
  googleMapsUrl?: string | null | undefined;
}

/** Only what the caller actually supplied — an absent field must stay absent
 *  rather than be written as null, which would erase a value on a partial edit. */
function publicFieldData(data: BranchPublicFields): Record<string, unknown> {
  return {
    ...(data.address !== undefined ? { address: data.address } : {}),
    ...(data.phone !== undefined ? { phone: data.phone } : {}),
    ...(data.email !== undefined ? { email: data.email } : {}),
    ...(data.openingHoursAr !== undefined ? { openingHoursAr: data.openingHoursAr } : {}),
    ...(data.googleMapsUrl !== undefined ? { googleMapsUrl: data.googleMapsUrl } : {}),
  };
}

export async function createBranch(
  prisma: PrismaClient,
  actor: Actor,
  data: {
    name: string;
    operationalStartDate?: Date | null;
    displayOrder?: number | null;
  } & BranchPublicFields,
): Promise<Branch> {
  assertCanWriteReferenceData(actor);
  assertMaySetDisplayOrder(actor, data);

  return prisma.$transaction(async (tx) => {
    const branch = await tx.branch.create({
      data: {
        name: data.name,
        operationalStartDate: data.operationalStartDate ?? null,
        // Absent stays absent (null in the column); the §2.2 guard above has
        // already refused a non-Super-Admin who tried to SET it.
        displayOrder: data.displayOrder ?? null,
        ...publicFieldData(data),
      },
    });
    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'branch.create',
      targetEntity: 'Branch',
      targetId: branch.id,
      detail: { name: branch.name },
    });

    // TD-4.6d (Revision 43.1) — the bootstrap backfill, INSIDE this transaction
    // so a Branch and the groups it enabled commit together.
    //
    // §15.1 seeds Levels and forbids seeding Branches, so seeded Levels exist
    // before any Branch does and cannot be given their المجموعة 1 at creation
    // time. This is the first moment they can be. Keyed on "every Level with no
    // live group", so it is a no-op on every subsequent branch — see the note
    // on `backfillFirstGroups` for why that is stated as the condition rather
    // than as "is this the first branch".
    await backfillFirstGroups(tx, branch.id, actor.userId);

    return branch;
  });
}

export async function updateBranch(
  prisma: PrismaClient,
  actor: Actor,
  id: string,
  expectedVersion: number,
  data: {
    name?: string;
    operationalStartDate?: Date | null;
    displayOrder?: number | null;
  } & BranchPublicFields,
): Promise<Branch> {
  assertCanWriteReferenceData(actor);
  scope.assertCanActOnBranch(actor.roleScopes, MANAGING_ROLE, id);
  assertMaySetDisplayOrder(actor, data);

  // TD-15.1: conditional UPDATE on `version`; a stale version is a coded 409,
  // never a silent overwrite.
  return updateWithVersion<Branch>({
    delegate: prisma.branch,
    id,
    expectedVersion,
    requireNotDeleted: true,
    // Spread so the optional-property types widen to the index signature the
    // repository takes; the keys are already the column names.
    data: { ...data },
  });
}

/**
 * TD-5: deleting a Branch is **prohibited while Rooms or Groups reference it**
 * (`409 STATE_CONFLICT`). The check and the write share one transaction with a
 * row lock, because check-then-write on an invariant is exactly the TD-15.2
 * pattern — without the lock a Group could be created between the count and
 * the delete.
 */
export async function deleteBranch(
  prisma: PrismaClient,
  actor: Actor,
  id: string,
): Promise<void> {
  assertCanWriteReferenceData(actor);
  scope.assertCanActOnBranch(actor.roleScopes, MANAGING_ROLE, id);

  await prisma.$transaction(async (tx) => {
    // §16.2 sanctioned raw-SQL exception (a): SELECT … FOR UPDATE row lock.
    await tx.$queryRaw`SELECT id FROM "branch" WHERE id = ${id}::uuid FOR UPDATE`;

    const branch = await tx.branch.findFirst({ where: { id, deletedAt: null } });
    if (!branch) throw new AppError('NOT_FOUND', 'branch not found');

    // TD-5 (Revision 43): a Branch is blocked by Rooms, **Administrative
    // Groups** and **Course Schedules** — the last is new, because a schedule
    // states its branch directly and deleting the branch would orphan every
    // session it has materialized.
    const [rooms, groups, schedules] = await Promise.all([
      tx.room.count({ where: { branchId: id, deletedAt: null } }),
      tx.administrativeGroup.count({ where: { branchId: id, deletedAt: null } }),
      tx.recurringCourseSchedule.count({ where: { branchId: id, deletedAt: null } }),
    ]);
    await assertNoBlockingReferences([
      { label: 'rooms', count: rooms },
      { label: 'groups', count: groups },
      { label: 'course_schedules', count: schedules },
    ]);

    // TD-4.8: soft delete + Trash snapshot + audit, all in one transaction.
    await tx.branch.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: actor.userId },
    });
    await trash.snapshot(tx, {
      targetEntity: 'Branch',
      targetId: id,
      snapshot: JSON.parse(JSON.stringify(branch)) as object,
      deletedById: actor.userId,
    });
    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'branch.delete',
      targetEntity: 'Branch',
      targetId: id,
      detail: { name: branch.name },
    });
  });
}

// ── Rooms ──────────────────────────────────────────────────────────────────

export async function listRooms(
  prisma: PrismaClient,
  actor: Actor,
  branchId: string,
  params: PageParams = {},
): Promise<Page<Room>> {
  assertCanReadReferenceData(actor);
  // Rooms follow the branch: reachable through the SAME resolution, so a teacher
  // sees the rooms of the branches they teach in and nobody else's. The previous
  // check asked only the `admin` role, which refused every teacher.
  const visible = await visibleBranchIds(prisma, actor);
  if (visible !== null && !visible.includes(branchId)) {
    // §20 rule 17 — `NOT_FOUND`, never `FORBIDDEN`: a 403 would confirm that a
    // branch with this id exists to somebody with no business knowing.
    throw new AppError('NOT_FOUND', 'no such branch');
  }
  const where = { branchId, deletedAt: null };
  const window = pageWindow(params);
  const [rows, total] = await Promise.all([
    prisma.room.findMany({
      where,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      skip: window.skip,
      take: window.take,
    }),
    prisma.room.count({ where }),
  ]);
  return page(rows, window, total);
}

export async function createRoom(
  prisma: PrismaClient,
  actor: Actor,
  branchId: string,
  data: { name: string },
): Promise<Room> {
  assertCanWriteReferenceData(actor);
  scope.assertCanActOnBranch(actor.roleScopes, MANAGING_ROLE, branchId);

  return prisma.$transaction(async (tx) => {
    const branch = await tx.branch.findFirst({ where: { id: branchId, deletedAt: null } });
    if (!branch) throw new AppError('NOT_FOUND', 'branch not found');

    const room = await tx.room.create({ data: { name: data.name, branchId } });
    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'room.create',
      targetEntity: 'Room',
      targetId: room.id,
      detail: { name: room.name, branch_id: branchId },
    });
    return room;
  });
}

export async function updateRoom(
  prisma: PrismaClient,
  actor: Actor,
  id: string,
  expectedVersion: number,
  data: { name?: string },
): Promise<Room> {
  assertCanWriteReferenceData(actor);
  const room = await prisma.room.findFirst({ where: { id, deletedAt: null } });
  if (!room) throw new AppError('NOT_FOUND', 'room not found');
  scope.assertCanActOnBranch(actor.roleScopes, MANAGING_ROLE, room.branchId);

  return updateWithVersion<Room>({
    delegate: prisma.room,
    id,
    expectedVersion,
    requireNotDeleted: true,
    data,
  });
}

/** TD-5: deleting a Room is **prohibited while Groups reference it**. */
export async function deleteRoom(prisma: PrismaClient, actor: Actor, id: string): Promise<void> {
  assertCanWriteReferenceData(actor);

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "room" WHERE id = ${id}::uuid FOR UPDATE`;

    const room = await tx.room.findFirst({ where: { id, deletedAt: null } });
    if (!room) throw new AppError('NOT_FOUND', 'room not found');
    scope.assertCanActOnBranch(actor.roleScopes, MANAGING_ROLE, room.branchId);

    // TD-5 (Revision 43): a Room is blocked by the schedules and the future
    // sessions that book it. An Administrative Group has no room at all now, so
    // it can no longer block one.
    const [schedules, sessions] = await Promise.all([
      tx.recurringCourseSchedule.count({ where: { roomId: id, deletedAt: null } }),
      tx.session.count({ where: { roomId: id, deletedAt: null } }),
    ]);
    await assertNoBlockingReferences([
      { label: 'course_schedules', count: schedules },
      { label: 'sessions', count: sessions },
    ]);

    await tx.room.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: actor.userId },
    });
    await trash.snapshot(tx, {
      targetEntity: 'Room',
      targetId: id,
      snapshot: JSON.parse(JSON.stringify(room)) as object,
      deletedById: actor.userId,
    });
    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'room.delete',
      targetEntity: 'Room',
      targetId: id,
      detail: { name: room.name, branch_id: room.branchId },
    });
  });
}
