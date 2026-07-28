import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import type { RoleScope } from './branch-scope.js';
import {
  assertCanAccessGroup,
  assertCanAccessStudent,
  teacherGroupIds,
  teacherStudentIds,
  teachesGroup,
  teachesStudent,
} from './teacher-scope.js';

/**
 * §4.2 teacher scoping against the real database.
 *
 * §4.2 requires that **all** teacher scoping resolve through `GroupTeacher`, so
 * these tests build genuine branches, levels, groups and enrolments rather than
 * asserting against a stubbed shape — the joins are the behaviour.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = '[teacher-scope-test]';

const teacherActor = (userId: string): { userId: string; roleScopes: RoleScope[] } => ({
  userId,
  roleScopes: [{ role: 'teacher', branches: null }],
});
const adminActor = (userId: string, branches: string[] | null) => ({
  userId,
  roleScopes: [{ role: 'admin', branches }] as RoleScope[],
});
const superAdminActor = (userId: string) => ({
  userId,
  roleScopes: [{ role: 'super_admin', branches: null }] as RoleScope[],
});

async function person(label: string): Promise<string> {
  const u = await prisma.user.create({
    data: { nameArabic: `${TAG} ${label}`, accountStatus: 'active' },
  });
  return u.id;
}

let levelId: string;

async function makeBranch(name: string): Promise<string> {
  const b = await prisma.branch.create({
    data: { name: `${TAG} ${name}`, operationalStartDate: new Date('2026-01-01') },
  });
  return b.id;
}

async function makeGroup(branchId: string, name: string): Promise<string> {
  const g = await prisma.group.create({
    data: {
      name: `${TAG} ${name}`,
      levelId,
      branchId,
      dayOfWeek: 'monday',
      startTime: new Date('1970-01-01T09:00:00Z'),
      endTime: new Date('1970-01-01T10:30:00Z'),
      maxStudents: 20,
    },
  });
  return g.id;
}

async function assign(groupId: string, teacherId: string): Promise<string> {
  const row = await prisma.groupTeacher.create({ data: { groupId, teacherId } });
  return row.id;
}

async function enrol(groupId: string, studentId: string): Promise<string> {
  const row = await prisma.studentGroup.create({ data: { groupId, studentId } });
  return row.id;
}

async function clear(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  const groups = await prisma.group.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  const groupIds = groups.map((g) => g.id);
  await prisma.studentGroup.deleteMany({
    where: { OR: [{ studentId: { in: ids } }, { groupId: { in: groupIds } }] },
  });
  await prisma.groupTeacher.deleteMany({
    where: { OR: [{ teacherId: { in: ids } }, { groupId: { in: groupIds } }] },
  });
  await prisma.group.deleteMany({ where: { id: { in: groupIds } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeEach(async () => {
  await clear();
  // Any existing level: groups need one, and the level itself is not the scope.
  const level = await prisma.level.findFirst({ select: { id: true } });
  levelId = level!.id;
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe('§4.2 — teacher reach resolves through GroupTeacher only', () => {
  it('resolves the groups a teacher is assigned to, including co-teaching', async () => {
    const branch = await makeBranch('مراكش');
    const g1 = await makeGroup(branch, 'مجموعة أ');
    const g2 = await makeGroup(branch, 'مجموعة ب');
    const teacher = await person('معلمة');
    const coTeacher = await person('معلمة مشاركة');

    await assign(g1, teacher);
    await assign(g2, teacher);
    await assign(g1, coTeacher); // §7: two instructor slots per group

    expect((await teacherGroupIds(prisma, teacher)).sort()).toEqual([g1, g2].sort());
    expect(await teacherGroupIds(prisma, coTeacher)).toEqual([g1]);
    expect(await teachesGroup(prisma, teacher, g1)).toBe(true);
    expect(await teachesGroup(prisma, coTeacher, g2)).toBe(false);
  });

  it('THE point of §4.2: one teacher across two branches, without a second scope axis', async () => {
    // "Level 1 in Marrakesh and Level 2 in Casablanca" — expressed entirely by
    // group assignment, because a Group already carries level_id and branch_id.
    const marrakesh = await makeBranch('مراكش');
    const casablanca = await makeBranch('الدار البيضاء');
    const gm = await makeGroup(marrakesh, 'المستوى الأول');
    const gc = await makeGroup(casablanca, 'المستوى الثاني');
    const teacher = await person('معلمة');
    await assign(gm, teacher);
    await assign(gc, teacher);

    const marrakeshStudent = await person('طالبة مراكش');
    const casablancaStudent = await person('طالبة البيضاء');
    await enrol(gm, marrakeshStudent);
    await enrol(gc, casablancaStudent);

    expect(await teachesStudent(prisma, teacher, marrakeshStudent)).toBe(true);
    expect(await teachesStudent(prisma, teacher, casablancaStudent)).toBe(true);
    // And the teacher holds no branch-scoped assignment at all.
    expect(await prisma.userBranchRole.count({ where: { userId: teacher } })).toBe(0);
  });

  it('a student in another teacher\'s group is out of reach', async () => {
    const branch = await makeBranch('مراكش');
    const mine = await makeGroup(branch, 'مجموعتي');
    const theirs = await makeGroup(branch, 'مجموعتهم');
    const teacher = await person('معلمة');
    const other = await person('معلمة أخرى');
    await assign(mine, teacher);
    await assign(theirs, other);

    const theirStudent = await person('طالبة غيري');
    await enrol(theirs, theirStudent);

    expect(await teachesStudent(prisma, teacher, theirStudent)).toBe(false);
    await expect(
      assertCanAccessStudent(prisma, teacherActor(teacher), theirStudent),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('§20 rule 17: an out-of-scope student is indistinguishable from a nonexistent one', async () => {
    const teacher = await person('معلمة');
    const branch = await makeBranch('مراكش');
    const theirs = await makeGroup(branch, 'مجموعتهم');
    const stranger = await person('طالبة غريبة');
    await enrol(theirs, stranger);

    // Both must be NOT_FOUND: a 403 for the real student would confirm that a
    // minor's record exists.
    await expect(
      assertCanAccessStudent(prisma, teacherActor(teacher), stranger),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      assertCanAccessStudent(prisma, teacherActor(teacher), '11111111-2222-4333-8444-555555555555'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('revoking the group assignment ends reach on the very next call', async () => {
    const branch = await makeBranch('مراكش');
    const group = await makeGroup(branch, 'مجموعة');
    const teacher = await person('معلمة');
    const student = await person('طالبة');
    const assignmentId = await assign(group, teacher);
    await enrol(group, student);

    await expect(assertCanAccessStudent(prisma, teacherActor(teacher), student)).resolves
      .toBeUndefined();

    await prisma.groupTeacher.update({
      where: { id: assignmentId },
      data: { deletedAt: new Date() },
    });

    expect(await teachesStudent(prisma, teacher, student)).toBe(false);
    await expect(
      assertCanAccessStudent(prisma, teacherActor(teacher), student),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('un-enrolling the student ends reach too', async () => {
    const branch = await makeBranch('مراكش');
    const group = await makeGroup(branch, 'مجموعة');
    const teacher = await person('معلمة');
    const student = await person('طالبة');
    await assign(group, teacher);
    const enrolment = await enrol(group, student);

    expect(await teachesStudent(prisma, teacher, student)).toBe(true);
    await prisma.studentGroup.update({
      where: { id: enrolment },
      data: { deletedAt: new Date() },
    });
    expect(await teachesStudent(prisma, teacher, student)).toBe(false);
  });

  it('a soft-deleted GROUP takes its assignments out of scope', async () => {
    const branch = await makeBranch('مراكش');
    const group = await makeGroup(branch, 'مجموعة');
    const teacher = await person('معلمة');
    const student = await person('طالبة');
    await assign(group, teacher);
    await enrol(group, student);

    await prisma.group.update({ where: { id: group }, data: { deletedAt: new Date() } });

    expect(await teacherGroupIds(prisma, teacher)).toEqual([]);
    expect(await teachesStudent(prisma, teacher, student)).toBe(false);
  });

  it('a teacher with no assignments reaches nothing', async () => {
    const teacher = await person('معلمة بلا مجموعات');
    expect(await teacherGroupIds(prisma, teacher)).toEqual([]);
    expect(await teacherStudentIds(prisma, teacher)).toEqual([]);
  });

  it('teacherStudentIds spans every assigned group without duplicates', async () => {
    const branch = await makeBranch('مراكش');
    const g1 = await makeGroup(branch, 'أ');
    const g2 = await makeGroup(branch, 'ب');
    const teacher = await person('معلمة');
    const shared = await person('طالبة في المجموعتين');
    const only2 = await person('طالبة ب');
    await assign(g1, teacher);
    await assign(g2, teacher);
    await enrol(g1, shared);
    await enrol(g2, shared); // enrolled twice
    await enrol(g2, only2);

    const ids = await teacherStudentIds(prisma, teacher);
    expect(ids.sort()).toEqual([shared, only2].sort());
  });
});

describe('TD-2 — staff reach alongside teachers', () => {
  it('Super Admin reaches any student, unscoped by role', async () => {
    const branch = await makeBranch('مراكش');
    const group = await makeGroup(branch, 'مجموعة');
    const student = await person('طالبة');
    await enrol(group, student);
    const admin = await person('مشرف عام');

    await expect(assertCanAccessStudent(prisma, superAdminActor(admin), student)).resolves
      .toBeUndefined();
  });

  it('a branch Admin reaches students in their branches only', async () => {
    const marrakesh = await makeBranch('مراكش');
    const casablanca = await makeBranch('الدار البيضاء');
    const gm = await makeGroup(marrakesh, 'أ');
    const gc = await makeGroup(casablanca, 'ب');
    const mine = await person('طالبة مراكش');
    const theirs = await person('طالبة البيضاء');
    await enrol(gm, mine);
    await enrol(gc, theirs);
    const admin = await person('مشرفة');

    await expect(assertCanAccessStudent(prisma, adminActor(admin, [marrakesh]), mine)).resolves
      .toBeUndefined();
    await expect(
      assertCanAccessStudent(prisma, adminActor(admin, [marrakesh]), theirs),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('an all-branches Admin reaches every student', async () => {
    const casablanca = await makeBranch('الدار البيضاء');
    const gc = await makeGroup(casablanca, 'ب');
    const student = await person('طالبة');
    await enrol(gc, student);
    const admin = await person('مشرفة');

    await expect(assertCanAccessStudent(prisma, adminActor(admin, null), student)).resolves
      .toBeUndefined();
  });

  it('an Admin who also teaches reaches their own groups outside their branch scope', async () => {
    // The admin check must not short-circuit the teacher check: this person has
    // a legitimate teaching relationship in a branch they do not administer.
    const marrakesh = await makeBranch('مراكش');
    const casablanca = await makeBranch('الدار البيضاء');
    const gc = await makeGroup(casablanca, 'ب');
    const student = await person('طالبة البيضاء');
    await enrol(gc, student);

    const dual = await person('مشرفة ومعلمة');
    await assign(gc, dual);

    const actor = {
      userId: dual,
      roleScopes: [
        { role: 'admin', branches: [marrakesh] },
        { role: 'teacher', branches: null },
      ] as RoleScope[],
    };
    await expect(assertCanAccessStudent(prisma, actor, student)).resolves.toBeUndefined();
  });

  it('assertCanAccessGroup follows the same rules', async () => {
    const marrakesh = await makeBranch('مراكش');
    const casablanca = await makeBranch('الدار البيضاء');
    const gm = await makeGroup(marrakesh, 'أ');
    const gc = await makeGroup(casablanca, 'ب');
    const teacher = await person('معلمة');
    await assign(gc, teacher);
    const admin = await person('مشرفة');

    await expect(assertCanAccessGroup(prisma, adminActor(admin, [marrakesh]), gm)).resolves
      .toBeUndefined();
    await expect(
      assertCanAccessGroup(prisma, adminActor(admin, [marrakesh]), gc),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(assertCanAccessGroup(prisma, teacherActor(teacher), gc)).resolves.toBeUndefined();
    await expect(
      assertCanAccessGroup(prisma, teacherActor(teacher), gm),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('a parent-only caller reaches nothing here', async () => {
    const branch = await makeBranch('مراكش');
    const group = await makeGroup(branch, 'مجموعة');
    const student = await person('طالبة');
    await enrol(group, student);
    const parent = await person('والدة');

    // Parent access to a child runs through §4.3's child context, never here.
    await expect(
      assertCanAccessStudent(
        prisma,
        { userId: parent, roleScopes: [{ role: 'parent', branches: null }] },
        student,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
