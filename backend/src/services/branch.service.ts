import type { Branch, PrismaClient, Room } from '../generated/prisma/client.js';
import * as scope from '../policies/branch-scope.js';
import { type RoleScope } from '../policies/branch-scope.js';
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

export interface Actor {
  userId: string;
  roles: string[];
  /**
   * Carried so a **public** endpoint can apply §4.4's rule that a `Pending`
   * account sees the public tier — the guarded router refuses non-active
   * callers outright, but `/calendar` must serve them something.
   */
  accountStatus?: string;
  /** Branch ids this actor is scoped to; empty for an unscoped Super Admin. */
  roleScopes: RoleScope[];
}

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
 */
function assertCanReadReferenceData(actor: Actor): void {
  if (!isAdmin(actor)) throw new AppError('FORBIDDEN', 'branch access requires admin');
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
  const where = {
    deletedAt: null,
    ...scope.branchFilter(actor.roleScopes, [MANAGING_ROLE]),
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

    const [rooms, groups] = await Promise.all([
      tx.room.count({ where: { branchId: id, deletedAt: null } }),
      tx.group.count({ where: { branchId: id, deletedAt: null } }),
    ]);
    await assertNoBlockingReferences([
      { label: 'rooms', count: rooms },
      { label: 'groups', count: groups },
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
  scope.assertCanActOnBranch(actor.roleScopes, MANAGING_ROLE, branchId);
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

    const groups = await tx.group.count({ where: { roomId: id, deletedAt: null } });
    await assertNoBlockingReferences([{ label: 'groups', count: groups }]);

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
      actionType: 'room.delete',
      targetEntity: 'Room',
      targetId: id,
      detail: { name: room.name, branch_id: room.branchId },
    });
  });
}
