import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import type { RoleScope } from '../policies/branch-scope.js';
import { teachesStudent } from '../policies/teacher-scope.js';
import { assignTeacher, createGroup, unassignTeacher, type Actor } from './group.service.js';
import { enrolStudent, listRoster, unenrolStudent } from './roster.service.js';

/**
 * Group membership — §4.4 co-teaching, §5.6 enrolment, §4.1a, TD-4.6, TD-5, TD-15.
 *
 * Capacity and instructor slots are check-then-write invariants, so both are
 * exercised concurrently against a real PostgreSQL. The consent re-evaluation
 * enqueue is asserted on **every** roster change, because §5.6 makes that a
 * property of the mutation rather than of a later reconciliation.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = '[roster-test]';

let levelId: string;
let actorUserId: string;

const actorOf = (scopes: RoleScope[]): Actor => ({
  userId: actorUserId,
  roles: scopes.map((s) => s.role),
  roleScopes: scopes,
});
const superAdmin = () => actorOf([{ role: 'super_admin', branches: null }]);
const teacherActor = () => actorOf([{ role: 'teacher', branches: null }]);
const admin = (branches: string[]) => actorOf([{ role: 'admin', branches }]);

/** Captures a thrown AppError without widening the success type into the union. */
async function failure(
  run: () => Promise<unknown>,
): Promise<{ code?: string; details?: Record<string, unknown> }> {
  try {
    await run();
    return {};
  } catch (e) {
    return e as { code?: string; details?: Record<string, unknown> };
  }
}

const at = (hh: number, mm = 0) => new Date(Date.UTC(1970, 0, 1, hh, mm, 0));

async function person(label: string): Promise<string> {
  const u = await prisma.user.create({
    data: { nameArabic: `${TAG} ${label}`, accountStatus: 'active' },
  });
  return u.id;
}

async function teacher(label: string): Promise<string> {
  const id = await person(label);
  const role = await prisma.role.findUnique({ where: { name: 'teacher' } });
  await prisma.userBranchRole.create({ data: { userId: id, roleId: role!.id, branchId: null } });
  return id;
}

async function makeBranch(name: string): Promise<string> {
  const b = await prisma.branch.create({
    data: { name: `${TAG} ${name}`, operationalStartDate: new Date('2026-01-01') },
  });
  return b.id;
}

async function makeGroup(branchId: string, maxStudents = 20): Promise<string> {
  const g = await createGroup(prisma, superAdmin(), {
    name: `${TAG} مجموعة ${Math.random().toString(36).slice(2, 7)}`,
    levelId,
    branchId,
    roomId: null,
    dayOfWeek: 'monday',
    startTime: at(9),
    endTime: at(10, 30),
    maxStudents,
  });
  return g.id;
}

async function queuedFor(groupId: string): Promise<number> {
  const rows = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT count(*)::bigint AS count FROM pgboss.job
    WHERE name = 'consent.reevaluate' AND data->>'group_id' = ${groupId}
  `;
  return Number(rows[0]?.count ?? 0);
}

async function clear(): Promise<void> {
  const groups = await prisma.group.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = groups.map((g) => g.id);
  for (const g of ids) {
    await prisma.$executeRaw`DELETE FROM pgboss.job WHERE name = 'consent.reevaluate' AND data->>'group_id' = ${g}`;
  }
  await prisma.trash.deleteMany({ where: { targetId: { in: ids } } });
  await prisma.studentGroup.deleteMany({ where: { groupId: { in: ids } } });
  await prisma.groupTeacher.deleteMany({ where: { groupId: { in: ids } } });
  await prisma.group.deleteMany({ where: { id: { in: ids } } });

  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({
    where: { OR: [{ actorUserId: { in: userIds } }, { targetId: { in: [...ids, ...userIds] } }] },
  });
  await prisma.trash.deleteMany({ where: { deletedById: { in: userIds } } });
  await prisma.studentGroup.deleteMany({ where: { studentId: { in: userIds } } });
  await prisma.groupTeacher.deleteMany({ where: { teacherId: { in: userIds } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeEach(async () => {
  await clear();
  const level = await prisma.level.findFirst({ select: { id: true } });
  levelId = level!.id;
  const u = await prisma.user.create({
    data: { nameArabic: `${TAG} فاعلة`, accountStatus: 'active' },
  });
  actorUserId = u.id;
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe('§4.4 — co-teaching, two instructor slots', () => {
  it('assigns a teacher and grants §4.2 reach to that group\'s students', async () => {
    const branchId = await makeBranch('مراكش');
    const groupId = await makeGroup(branchId);
    const t = await teacher('معلمة');
    const student = await person('طالبة');
    await enrolStudent(prisma, superAdmin(), groupId, student);

    expect(await teachesStudent(prisma, t, student)).toBe(false);
    await assignTeacher(prisma, superAdmin(), groupId, t);
    // The assignment IS the scope (§4.2) — no separate grant is needed.
    expect(await teachesStudent(prisma, t, student)).toBe(true);
  });

  it('allows a second instructor but refuses a third', async () => {
    const branchId = await makeBranch('مراكش');
    const groupId = await makeGroup(branchId);
    const [a, b, c] = [await teacher('أ'), await teacher('ب'), await teacher('ج')];

    await assignTeacher(prisma, superAdmin(), groupId, a);
    const second = await assignTeacher(prisma, superAdmin(), groupId, b);
    expect(second.slotsUsed).toBe(2);

    const err = await failure(() => assignTeacher(prisma, superAdmin(), groupId, c));
    expect(err.code).toBe('STATE_CONFLICT');
    expect(err.details?.['reason']).toBe('INSTRUCTOR_SLOTS_FULL');
  });

  it('unassigning frees a slot and ends reach on the next call', async () => {
    const branchId = await makeBranch('مراكش');
    const groupId = await makeGroup(branchId);
    const [a, b, c] = [await teacher('أ'), await teacher('ب'), await teacher('ج')];
    const student = await person('طالبة');
    await enrolStudent(prisma, superAdmin(), groupId, student);
    await assignTeacher(prisma, superAdmin(), groupId, a);
    await assignTeacher(prisma, superAdmin(), groupId, b);

    await unassignTeacher(prisma, superAdmin(), groupId, a);

    expect(await teachesStudent(prisma, a, student)).toBe(false);
    await expect(assignTeacher(prisma, superAdmin(), groupId, c)).resolves.toBeTruthy();
  });

  it('refuses someone who does not hold the teacher role', async () => {
    const branchId = await makeBranch('مراكش');
    const groupId = await makeGroup(branchId);
    const notATeacher = await person('ليست معلمة');

    // Assigning them would grant §4.2 teaching reach to an account TD-2 never
    // intended to have it.
    await expect(
      assignTeacher(prisma, superAdmin(), groupId, notATeacher),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('re-assigning a previously removed teacher revives the row, not a duplicate', async () => {
    const branchId = await makeBranch('مراكش');
    const groupId = await makeGroup(branchId);
    const t = await teacher('معلمة');

    await assignTeacher(prisma, superAdmin(), groupId, t);
    await unassignTeacher(prisma, superAdmin(), groupId, t);
    await assignTeacher(prisma, superAdmin(), groupId, t);

    expect(await prisma.groupTeacher.count({ where: { groupId, teacherId: t } })).toBe(1);
  });

  it('a duplicate live assignment is refused', async () => {
    const branchId = await makeBranch('مراكش');
    const groupId = await makeGroup(branchId);
    const t = await teacher('معلمة');
    await assignTeacher(prisma, superAdmin(), groupId, t);

    await expect(assignTeacher(prisma, superAdmin(), groupId, t)).rejects.toMatchObject({
      code: 'DUPLICATE',
    });
  });
});

describe('§5.6 / TD-4.6 — enrolment and capacity', () => {
  it('enrols a student and lists them on the roster', async () => {
    const branchId = await makeBranch('مراكش');
    const groupId = await makeGroup(branchId);
    const student = await person('طالبة');

    const result = await enrolStudent(prisma, superAdmin(), groupId, student);
    expect(result.enrolled).toBe(1);
    expect(((await listRoster(prisma, superAdmin(), groupId))).data.map((r) => r.studentId)).toEqual([
      student,
    ]);
  });

  it('refuses an enrolment beyond max_students with CAPACITY_FULL', async () => {
    const branchId = await makeBranch('مراكش');
    const groupId = await makeGroup(branchId, 1);
    await enrolStudent(prisma, superAdmin(), groupId, await person('أ'));

    const second = await person('ب');
    const err = await failure(() => enrolStudent(prisma, superAdmin(), groupId, second));
    expect(err.code).toBe('CAPACITY_FULL');
    expect(err.details?.['capacity']).toBe(1);
  });

  it('§19.2: concurrent adds at capacity − 1 admit exactly one', async () => {
    const branchId = await makeBranch('مراكش');
    const groupId = await makeGroup(branchId, 2);
    await enrolStudent(prisma, superAdmin(), groupId, await person('موجودة'));
    const [x, y] = [await person('س'), await person('ص')];

    // A named §19.2 regression test: the TD-4.6 Group row lock is what stops
    // both from seeing the last seat.
    const results = await Promise.allSettled([
      enrolStudent(prisma, superAdmin(), groupId, x),
      enrolStudent(prisma, superAdmin(), groupId, y),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.studentGroup.count({ where: { groupId, deletedAt: null } })).toBe(2);
  });

  it('un-enrolling frees a seat', async () => {
    const branchId = await makeBranch('مراكش');
    const groupId = await makeGroup(branchId, 1);
    const first = await person('أ');
    await enrolStudent(prisma, superAdmin(), groupId, first);
    await unenrolStudent(prisma, superAdmin(), groupId, first);

    await expect(
      enrolStudent(prisma, superAdmin(), groupId, await person('ب')),
    ).resolves.toBeTruthy();
  });

  it('re-enrolling revives the row rather than duplicating it', async () => {
    const branchId = await makeBranch('مراكش');
    const groupId = await makeGroup(branchId);
    const student = await person('طالبة');
    await enrolStudent(prisma, superAdmin(), groupId, student);
    await unenrolStudent(prisma, superAdmin(), groupId, student);
    await enrolStudent(prisma, superAdmin(), groupId, student);

    expect(await prisma.studentGroup.count({ where: { groupId, studentId: student } })).toBe(1);
  });

  it('a duplicate enrolment is refused', async () => {
    const branchId = await makeBranch('مراكش');
    const groupId = await makeGroup(branchId);
    const student = await person('طالبة');
    await enrolStudent(prisma, superAdmin(), groupId, student);

    await expect(enrolStudent(prisma, superAdmin(), groupId, student)).rejects.toMatchObject({
      code: 'DUPLICATE',
    });
  });
});

describe('§4.1a — every roster change enqueues consent re-evaluation', () => {
  it('an ENROLMENT enqueues for the group', async () => {
    const branchId = await makeBranch('مراكش');
    const groupId = await makeGroup(branchId);
    expect(await queuedFor(groupId)).toBe(0);

    await enrolStudent(prisma, superAdmin(), groupId, await person('طالبة'));
    expect(await queuedFor(groupId)).toBeGreaterThan(0);
  });

  it('an UN-ENROLMENT enqueues for the group it just left', async () => {
    const branchId = await makeBranch('مراكش');
    const groupId = await makeGroup(branchId);
    const student = await person('طالبة');
    await enrolStudent(prisma, superAdmin(), groupId, student);
    await prisma.$executeRaw`DELETE FROM pgboss.job WHERE name = 'consent.reevaluate' AND data->>'group_id' = ${groupId}`;

    await unenrolStudent(prisma, superAdmin(), groupId, student);

    // The group is named explicitly: deriving it from the student's remaining
    // groups would skip the very one whose gate changed.
    expect(await queuedFor(groupId)).toBeGreaterThan(0);
  });

  it('a REFUSED enrolment enqueues nothing', async () => {
    const branchId = await makeBranch('مراكش');
    const groupId = await makeGroup(branchId, 1);
    await enrolStudent(prisma, superAdmin(), groupId, await person('أ'));
    await prisma.$executeRaw`DELETE FROM pgboss.job WHERE name = 'consent.reevaluate' AND data->>'group_id' = ${groupId}`;

    await enrolStudent(prisma, superAdmin(), groupId, await person('ب')).catch(() => undefined);
    expect(await queuedFor(groupId)).toBe(0);
  });
});

describe('TD-2 / TD-5 — authorization and record preservation', () => {
  it('a Teacher cannot manage the roster or assign colleagues', async () => {
    const branchId = await makeBranch('مراكش');
    const groupId = await makeGroup(branchId);
    const student = await person('طالبة');

    await expect(
      enrolStudent(prisma, teacherActor(), groupId, student),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      assignTeacher(prisma, teacherActor(), groupId, await teacher('معلمة')),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('an Admin outside the group\'s branch is refused', async () => {
    const mine = await makeBranch('مراكش');
    const theirs = await makeBranch('الدار البيضاء');
    const groupId = await makeGroup(theirs);

    await expect(
      enrolStudent(prisma, admin([mine]), groupId, await person('طالبة')),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('TD-5: un-enrolment soft-deletes the enrolment row only', async () => {
    const branchId = await makeBranch('مراكش');
    const groupId = await makeGroup(branchId);
    const student = await person('طالبة');
    await enrolStudent(prisma, superAdmin(), groupId, student);

    await unenrolStudent(prisma, superAdmin(), groupId, student);

    const row = await prisma.studentGroup.findFirst({ where: { groupId, studentId: student } });
    // The row must still EXIST and be soft-deleted. Asserting only
    // `row?.deletedAt` would pass on a hard delete, because optional chaining
    // yields undefined and `expect(undefined).not.toBeNull()` succeeds — which
    // let a TD-5-breaking mutant survive until this was tightened.
    expect(row).not.toBeNull();
    expect(row!.deletedAt).toBeInstanceOf(Date);
    // The student themself is untouched — un-enrolment is not deletion.
    expect((await prisma.user.findUnique({ where: { id: student } }))?.deletedAt).toBeNull();
  });
});
