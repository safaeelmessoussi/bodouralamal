import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import type { Actor } from '../policies/actor.js';
import type { RoleScope } from '../policies/branch-scope.js';
import {
  createBranch,
  createRoom,
  deleteBranch,
  deleteRoom,
  listBranches,
  listRooms,
  updateBranch,
  updateRoom,
} from './branch.service.js';

/**
 * TD-2 Revision 26 — Branches and Rooms are **reference/configuration data**.
 *
 * Only a Super Admin may create, edit or delete them; an Admin **reads** them,
 * branch-scoped, because Group management depends on selecting a Branch, Level
 * and Room. These tests pin both halves, since a permission boundary that is
 * only asserted in one direction is half tested.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = '[branch-perm-test]';

/**
 * Actors are built around a REAL user row: writes emit TD-8 audit rows, whose
 * `actor_user_id` is a foreign key, so a synthetic id fails on the constraint
 * rather than on the permission being tested.
 */
let actorUserId: string;

const actorOf = (scopes: RoleScope[]): Actor => ({
  userId: actorUserId,
  roles: scopes.map((s) => s.role),
  roleScopes: scopes,
});

const superAdmin = () => actorOf([{ role: 'super_admin', branches: null }]);
const allBranchAdmin = () => actorOf([{ role: 'admin', branches: null }]);
const teacher = () => actorOf([{ role: 'teacher', branches: null }]);
const scopedAdmin = (branches: string[]) => actorOf([{ role: 'admin', branches }]);

async function seedBranch(name: string): Promise<string> {
  const b = await prisma.branch.create({
    data: { name: `${TAG} ${name}`, operationalStartDate: new Date('2026-01-01') },
  });
  return b.id;
}

async function clear(): Promise<void> {
  const branches = await prisma.branch.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = branches.map((b) => b.id);
  await prisma.trash.deleteMany({ where: { targetId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { targetId: { in: ids } } });
  const rooms = await prisma.room.findMany({
    where: { OR: [{ branchId: { in: ids } }, { name: { startsWith: TAG } }] },
    select: { id: true },
  });
  const roomIds = rooms.map((r) => r.id);
  await prisma.trash.deleteMany({ where: { targetId: { in: roomIds } } });
  await prisma.auditLog.deleteMany({ where: { targetId: { in: roomIds } } });
  await prisma.room.deleteMany({ where: { id: { in: roomIds } } });
  // TD-4.6d (Revision 43.1): `createBranch` now also backfills المجموعة 1 for
  // every Level that has none, so a branch created here can own groups it never
  // asked for. They are RESTRICT against Branch (TD-5), so they go first.
  // Recorded rather than quietly added: this teardown predates the backfill,
  // and the failure it caused is the honest signal that creating a Branch is no
  // longer a single-row operation.
  await prisma.administrativeGroup.deleteMany({ where: { branchId: { in: ids } } });
  await prisma.branch.deleteMany({ where: { id: { in: ids } } });

  const actors = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const actorIds = actors.map((a) => a.id);
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: actorIds } } });
  await prisma.trash.deleteMany({ where: { deletedById: { in: actorIds } } });
  await prisma.user.deleteMany({ where: { id: { in: actorIds } } });
}

beforeEach(async () => {
  await clear();
  const u = await prisma.user.create({
    data: { nameArabic: `${TAG} فاعلة`, accountStatus: 'active' },
  });
  actorUserId = u.id;
});
afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe('TD-2 R26 — WRITING reference data is Super Admin only', () => {
  it('an Admin cannot create a branch', async () => {
    await expect(
      createBranch(prisma, allBranchAdmin(), { name: `${TAG} فرع جديد` }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await prisma.branch.count({ where: { name: { startsWith: TAG } } })).toBe(0);
  });

  it('a Super Admin can create a branch', async () => {
    const branch = await createBranch(prisma, superAdmin(), { name: `${TAG} فرع جديد` });
    expect(branch.id).toBeTruthy();
  });

  it('an Admin cannot edit or delete a branch they administer', async () => {
    const id = await seedBranch('مراكش');
    const admin = scopedAdmin([id]);

    await expect(
      updateBranch(prisma, admin, id, 0, { name: `${TAG} محاولة` }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(deleteBranch(prisma, admin, id)).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const after = await prisma.branch.findUnique({ where: { id } });
    expect(after?.name).toBe(`${TAG} مراكش`);
    expect(after?.deletedAt).toBeNull();
  });

  it('operational_start_date is Super Admin only — activating a branch is organisational', async () => {
    const id = await seedBranch('مراكش');
    const admin = scopedAdmin([id]);

    await expect(
      updateBranch(prisma, admin, id, 0, { operationalStartDate: new Date('2027-01-01') }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const updated = await updateBranch(
      prisma,
      superAdmin(),
      id,
      0,
      { operationalStartDate: new Date('2027-01-01') },
    );
    expect(updated.operationalStartDate?.toISOString().slice(0, 10)).toBe('2027-01-01');
  });

  it('an Admin cannot create, edit or delete rooms', async () => {
    const branchId = await seedBranch('مراكش');
    const admin = scopedAdmin([branchId]);

    await expect(
      createRoom(prisma, admin, branchId, { name: `${TAG} قاعة` }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const room = await createRoom(prisma, superAdmin(), branchId, { name: `${TAG} قاعة` });
    await expect(
      updateRoom(prisma, admin, room.id, 0, { name: `${TAG} محاولة` }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(deleteRoom(prisma, admin, room.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('a teacher cannot write reference data either', async () => {
    await expect(
      createBranch(prisma, teacher(), { name: `${TAG} فرع` }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('TD-2 R26 — READING reference data stays with Admins, branch-scoped', () => {
  it('an Admin reads the branches they administer, and not others', async () => {
    const marrakesh = await seedBranch('مراكش');
    const casablanca = await seedBranch('الدار البيضاء');

    const visible = (await listBranches(prisma, scopedAdmin([marrakesh]))).data;
    const ids = visible.map((b) => b.id);
    expect(ids).toContain(marrakesh);
    expect(ids).not.toContain(casablanca);
  });

  it('an Admin reads the rooms of a branch they administer', async () => {
    const branchId = await seedBranch('مراكش');
    await createRoom(prisma, superAdmin(), branchId, { name: `${TAG} قاعة` });

    // This is the access Group management depends on: an Admin must be able to
    // pick a Room even though only a Super Admin may create one.
    const rooms = (await listRooms(prisma, scopedAdmin([branchId]), branchId)).data;
    expect(rooms).toHaveLength(1);
  });

  it('an Admin cannot read rooms of a branch outside their scope (404, no leak)', async () => {
    const mine = await seedBranch('مراكش');
    const theirs = await seedBranch('الدار البيضاء');
    await createRoom(prisma, superAdmin(), theirs, { name: `${TAG} قاعتهم` });

    await expect(listRooms(prisma, scopedAdmin([mine]), theirs)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('an all-branches Admin reads every branch', async () => {
    await seedBranch('مراكش');
    await seedBranch('الدار البيضاء');
    const visible = (await listBranches(prisma, allBranchAdmin())).data;
    expect(visible.filter((b) => b.name.startsWith(TAG))).toHaveLength(2);
  });

  it('a Super Admin reads every branch', async () => {
    await seedBranch('مراكش');
    await seedBranch('الدار البيضاء');
    const visible = (await listBranches(prisma, superAdmin())).data;
    expect(visible.filter((b) => b.name.startsWith(TAG))).toHaveLength(2);
  });

  it('a teacher cannot browse the branch list', async () => {
    await expect(listBranches(prisma, teacher())).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
