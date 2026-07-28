import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import type { RoleScope } from '../policies/branch-scope.js';
import {
  createGroup,
  deleteGroup,
  listGroups,
  updateGroup,
  type Actor,
  type GroupInput,
} from './group.service.js';

/**
 * Group management — §4.4, TD-2, TD-11, TD-15.
 *
 * Room/time conflict detection is check-then-write, so it is proven against a
 * real PostgreSQL rather than a mock. See the concurrency test for an honest
 * note on what it does and does not establish about the TD-15 row lock.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = '[group-test]';

let levelId: string;
let actorUserId: string;

const actorOf = (scopes: RoleScope[]): Actor => ({
  userId: actorUserId,
  roles: scopes.map((s) => s.role),
  roleScopes: scopes,
});
const superAdmin = () => actorOf([{ role: 'super_admin', branches: null }]);
const teacher = () => actorOf([{ role: 'teacher', branches: null }]);
const admin = (branches: string[]) => actorOf([{ role: 'admin', branches }]);

/** 09:00 → a `time` column value; only the clock part is meaningful (TD-11). */
const at = (hh: number, mm = 0) => new Date(Date.UTC(1970, 0, 1, hh, mm, 0));

async function makeBranch(name: string): Promise<string> {
  const b = await prisma.branch.create({
    data: { name: `${TAG} ${name}`, operationalStartDate: new Date('2026-01-01') },
  });
  return b.id;
}

async function makeRoom(branchId: string, name: string): Promise<string> {
  const r = await prisma.room.create({ data: { name: `${TAG} ${name}`, branchId } });
  return r.id;
}

function input(over: Partial<GroupInput> & { branchId: string }): GroupInput {
  return {
    name: `${TAG} مجموعة`,
    levelId,
    dayOfWeek: 'monday',
    startTime: at(9),
    endTime: at(10, 30),
    maxStudents: 20,
    ...over,
  };
}

async function clear(): Promise<void> {
  const groups = await prisma.group.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = groups.map((g) => g.id);
  await prisma.trash.deleteMany({ where: { targetId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { targetId: { in: ids } } });
  await prisma.studentGroup.deleteMany({ where: { groupId: { in: ids } } });
  await prisma.groupTeacher.deleteMany({ where: { groupId: { in: ids } } });
  await prisma.group.deleteMany({ where: { id: { in: ids } } });
  await prisma.room.deleteMany({ where: { name: { startsWith: TAG } } });

  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.trash.deleteMany({ where: { deletedById: { in: userIds } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeEach(async () => {
  await clear();
  const level = await prisma.level.findFirst({ select: { id: true } });
  levelId = level!.id;
  // Audit rows carry an actor FK, so the actor must be a real user.
  const u = await prisma.user.create({
    data: { nameArabic: `${TAG} فاعلة`, accountStatus: 'active' },
  });
  actorUserId = u.id;
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe('§4.4 — Group CRUD', () => {
  it('creates a group carrying its own weekly slot', async () => {
    const branchId = await makeBranch('مراكش');
    const group = await createGroup(prisma, superAdmin(), input({ branchId }));

    expect(group.dayOfWeek).toBe('monday');
    expect(group.maxStudents).toBe(20);
    // §4.4: the group IS the recurring slot; no separate session object exists.
    expect(group.branchId).toBe(branchId);
  });

  it('rejects an end time at or before the start', async () => {
    const branchId = await makeBranch('مراكش');
    await expect(
      createGroup(prisma, superAdmin(), input({ branchId, startTime: at(10), endTime: at(9) })),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      createGroup(prisma, superAdmin(), input({ branchId, startTime: at(9), endTime: at(9) })),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects a capacity below one', async () => {
    const branchId = await makeBranch('مراكش');
    await expect(
      createGroup(prisma, superAdmin(), input({ branchId, maxStudents: 0 })),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects a room belonging to a DIFFERENT branch', async () => {
    const marrakesh = await makeBranch('مراكش');
    const casablanca = await makeBranch('الدار البيضاء');
    const foreignRoom = await makeRoom(casablanca, 'قاعة');

    // Otherwise the group would be in two places at once.
    await expect(
      createGroup(prisma, superAdmin(), input({ branchId: marrakesh, roomId: foreignRoom })),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('soft-deletes, snapshots to Trash and audits', async () => {
    const branchId = await makeBranch('مراكش');
    const group = await createGroup(prisma, superAdmin(), input({ branchId }));

    await deleteGroup(prisma, superAdmin(), group.id);

    expect((await prisma.group.findUnique({ where: { id: group.id } }))?.deletedAt).not.toBeNull();
    expect(await prisma.trash.count({ where: { targetId: group.id } })).toBe(1);
    expect(
      await prisma.auditLog.count({ where: { targetId: group.id, actionType: 'group.delete' } }),
    ).toBe(1);
  });

  it('TD-5: deletion is blocked while students are enrolled', async () => {
    const branchId = await makeBranch('مراكش');
    const group = await createGroup(prisma, superAdmin(), input({ branchId }));
    const student = await prisma.user.create({
      data: { nameArabic: `${TAG} طالبة`, accountStatus: 'active' },
    });
    await prisma.studentGroup.create({ data: { groupId: group.id, studentId: student.id } });

    await expect(deleteGroup(prisma, superAdmin(), group.id)).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
    });
    expect((await prisma.group.findUnique({ where: { id: group.id } }))?.deletedAt).toBeNull();
  });
});

describe('§4.4 — room/time conflict detection', () => {
  it('refuses an overlapping slot in the same room on the same day', async () => {
    const branchId = await makeBranch('مراكش');
    const roomId = await makeRoom(branchId, 'قاعة');
    await createGroup(prisma, superAdmin(), input({ branchId, roomId }));

    await expect(
      createGroup(
        prisma,
        superAdmin(),
        input({ branchId, roomId, startTime: at(10), endTime: at(11) }),
      ),
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
  });

  it('allows BACK-TO-BACK slots — half-open intervals do not collide', async () => {
    const branchId = await makeBranch('مراكش');
    const roomId = await makeRoom(branchId, 'قاعة');
    await createGroup(prisma, superAdmin(), input({ branchId, roomId }));

    // 10:30–12:00 immediately after 09:00–10:30 is how timetables are built.
    const next = await createGroup(
      prisma,
      superAdmin(),
      input({ branchId, roomId, startTime: at(10, 30), endTime: at(12) }),
    );
    expect(next.id).toBeTruthy();
  });

  it('allows the same slot in a DIFFERENT room, and on a different day', async () => {
    const branchId = await makeBranch('مراكش');
    const roomA = await makeRoom(branchId, 'قاعة أ');
    const roomB = await makeRoom(branchId, 'قاعة ب');
    await createGroup(prisma, superAdmin(), input({ branchId, roomId: roomA }));

    await expect(
      createGroup(prisma, superAdmin(), input({ branchId, roomId: roomB })),
    ).resolves.toBeTruthy();
    await expect(
      createGroup(prisma, superAdmin(), input({ branchId, roomId: roomA, dayOfWeek: 'tuesday' })),
    ).resolves.toBeTruthy();
  });

  it('a group with NO room never conflicts', async () => {
    const branchId = await makeBranch('مراكش');
    await createGroup(prisma, superAdmin(), input({ branchId, roomId: null }));
    await expect(
      createGroup(prisma, superAdmin(), input({ branchId, roomId: null })),
    ).resolves.toBeTruthy();
  });

  it('a soft-deleted group frees its slot', async () => {
    const branchId = await makeBranch('مراكش');
    const roomId = await makeRoom(branchId, 'قاعة');
    const first = await createGroup(prisma, superAdmin(), input({ branchId, roomId }));
    await deleteGroup(prisma, superAdmin(), first.id);

    await expect(
      createGroup(prisma, superAdmin(), input({ branchId, roomId })),
    ).resolves.toBeTruthy();
  });

  it('two concurrent creates for one slot admit exactly one', async () => {
    const branchId = await makeBranch('مراكش');
    const roomId = await makeRoom(branchId, 'قاعة');

    const results = await Promise.allSettled([
      createGroup(prisma, superAdmin(), input({ branchId, roomId })),
      createGroup(prisma, superAdmin(), input({ branchId, roomId })),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.group.count({ where: { roomId, deletedAt: null } })).toBe(1);

    // HONEST LIMITATION: this asserts the outcome, not the mechanism. Mutation
    // testing showed it still passes with the TD-15 `FOR UPDATE` removed — both
    // transactions are short enough that they rarely interleave in the window
    // between the conflict check and the insert. The lock is retained because
    // TD-15 mandates it for check-then-write invariants and the race is real
    // under load, but proving it needs a test that widens the window
    // deliberately (a delay injected between check and write). Recorded rather
    // than left as false confidence.
  });

  it('updating into an occupied slot is refused, but keeping its own is fine', async () => {
    const branchId = await makeBranch('مراكش');
    const roomId = await makeRoom(branchId, 'قاعة');
    const morning = await createGroup(prisma, superAdmin(), input({ branchId, roomId }));
    const afternoon = await createGroup(
      prisma,
      superAdmin(),
      input({ branchId, roomId, startTime: at(14), endTime: at(15) }),
    );

    await expect(
      updateGroup(prisma, superAdmin(), afternoon.id, afternoon.version, {
        startTime: at(9, 30),
        endTime: at(10),
      }),
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' });

    // A group must not conflict with itself when its slot is unchanged.
    await expect(
      updateGroup(prisma, superAdmin(), morning.id, morning.version, { maxStudents: 25 }),
    ).resolves.toMatchObject({ maxStudents: 25 });
  });
});

describe('TD-15 — optimistic locking on update', () => {
  it('a stale version is a 409, never a silent overwrite', async () => {
    const branchId = await makeBranch('مراكش');
    const group = await createGroup(prisma, superAdmin(), input({ branchId }));

    await updateGroup(prisma, superAdmin(), group.id, group.version, { maxStudents: 25 });
    await expect(
      updateGroup(prisma, superAdmin(), group.id, group.version, { maxStudents: 30 }),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });

    expect((await prisma.group.findUnique({ where: { id: group.id } }))?.maxStudents).toBe(25);
  });
});

describe('TD-2 / Revision 26 — who may manage groups', () => {
  it('a branch Admin manages groups in their own branch only', async () => {
    const mine = await makeBranch('مراكش');
    const theirs = await makeBranch('الدار البيضاء');

    await expect(createGroup(prisma, admin([mine]), input({ branchId: mine }))).resolves
      .toBeTruthy();
    await expect(
      createGroup(prisma, admin([mine]), input({ branchId: theirs })),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('an Admin cannot move a group into a branch outside their scope', async () => {
    const mine = await makeBranch('مراكش');
    const theirs = await makeBranch('الدار البيضاء');
    const group = await createGroup(prisma, admin([mine]), input({ branchId: mine }));

    await expect(
      updateGroup(prisma, admin([mine]), group.id, group.version, { branchId: theirs }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('a Teacher cannot create, update or delete a group', async () => {
    const branchId = await makeBranch('مراكش');
    const group = await createGroup(prisma, superAdmin(), input({ branchId }));

    await expect(createGroup(prisma, teacher(), input({ branchId }))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      updateGroup(prisma, teacher(), group.id, group.version, { maxStudents: 5 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(deleteGroup(prisma, teacher(), group.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('the list is branch-scoped for an Admin', async () => {
    const mine = await makeBranch('مراكش');
    const theirs = await makeBranch('الدار البيضاء');
    const ours = await createGroup(prisma, superAdmin(), input({ branchId: mine }));
    const notOurs = await createGroup(prisma, superAdmin(), input({ branchId: theirs }));

    const visible = (await listGroups(prisma, admin([mine]))).map((g) => g.id);
    expect(visible).toContain(ours.id);
    expect(visible).not.toContain(notOurs.id);
  });
});
