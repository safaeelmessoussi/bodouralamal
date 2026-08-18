import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { issueAccessToken } from '../lib/access-token.js';
import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import { httpCall } from '../test-support/http-client.js';

/**
 * **An enrolment's identity is `beneficiary + Level + Branch`, and the edit
 * route cannot change it** (2026-08-18).
 *
 * ## Why this file exists at HTTP level
 *
 * The service now takes a patch type with no `levelId` and no `branchId`, which
 * makes the rule a compile-time fact for every internal caller. It says nothing
 * about a client sending the keys anyway — and that is exactly the request this
 * rule has to survive. `.strict()` refuses them, and only a test over the wire
 * can prove it.
 *
 * ## What the rule means
 *
 * *Edit* changes the subdivision INSIDE an enrolment: the optional
 * Administrative Group. Moving somebody to another Level or Branch is a
 * different enrolment — إنهاء التسجيل, then تسجيل مستفيدة — and the platform
 * expresses that with the verbs it already has rather than by mutating identity.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = '[http-enrolment-test]';

interface Res {
  status: number;
  body: { error?: { code?: string }; data?: Record<string, unknown>[]; id?: string };
}

const call = (method: string, path: string, token?: string, body?: unknown): Promise<Res> =>
  httpCall<Res['body']>(BASE, method, path, {
    token,
    ...(body !== undefined ? { body } : {}),
  });

const bearer = (userId: string): string =>
  issueAccessToken(
    { userId, roleScopes: [{ role: 'super_admin', branches: null }] as never, accountStatus: 'active' as never },
    config.JWT_SIGNING_KEY,
  ).token;

let superAdmin: string;
let student: string;
let levelA: string;
let levelB: string;
let branchA: string;
let branchB: string;
let groupA1: string;
let groupA2: string;
let enrolmentA: string;

async function clear(): Promise<void> {
  const levels = await prisma.level.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  const levelIds = levels.map((l) => l.id);
  await prisma.enrollment.deleteMany({ where: { levelId: { in: levelIds } } });
  await prisma.administrativeGroup.deleteMany({ where: { levelId: { in: levelIds } } });
  await prisma.level.deleteMany({ where: { id: { in: levelIds } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  if (ids.length > 0) {
    await prisma.enrollment.deleteMany({ where: { studentId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
    await prisma.trash.deleteMany({ where: { deletedById: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
}

beforeAll(async () => {
  const health = await fetch(`${config.PUBLIC_BASE_URL}/healthz`).catch(() => null);
  if (!health || health.status !== 200) throw new Error('API not reachable');
  await clear();

  const admin = await prisma.user.create({
    data: { nameArabic: `${TAG} مديرة`, accountStatus: 'active', sex: 'female' },
  });
  superAdmin = bearer(admin.id);
  student = (
    await prisma.user.create({
      data: {
        nameArabic: `${TAG} مستفيدة`,
        accountStatus: 'active',
        sex: 'female',
        isBeneficiary: true,
      },
    })
  ).id;

  const category = await prisma.category.create({ data: { name: `${TAG} فئة` } });
  levelA = (
    await prisma.level.create({
      data: { name: `${TAG} مستوى أ`, categoryId: category.id, genderRestriction: 'any' },
    })
  ).id;
  levelB = (
    await prisma.level.create({
      data: { name: `${TAG} مستوى ب`, categoryId: category.id, genderRestriction: 'any' },
    })
  ).id;
  branchA = (await prisma.branch.create({ data: { name: `${TAG} فرع أ` } })).id;
  branchB = (await prisma.branch.create({ data: { name: `${TAG} فرع ب` } })).id;
  groupA1 = (
    await prisma.administrativeGroup.create({
      data: { name: `${TAG} مجموعة 1`, levelId: levelA, branchId: branchA },
    })
  ).id;
  groupA2 = (
    await prisma.administrativeGroup.create({
      data: { name: `${TAG} مجموعة 2`, levelId: levelA, branchId: branchA },
    })
  ).id;

  const created = await call('POST', '/admin/enrollments', superAdmin, {
    student_id: student,
    level_id: levelA,
    branch_id: branchA,
    administrative_group_id: groupA1,
  });
  expect(created.status).toBe(201);
  enrolmentA = String(created.body.id);
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

const stored = async () =>
  prisma.enrollment.findUniqueOrThrow({
    where: { id: enrolmentA },
    select: { levelId: true, branchId: true, administrativeGroupId: true },
  });

describe('the edit route changes the SUBDIVISION, never the identity', () => {
  it('refuses a forged `level_id`, and changes nothing', async () => {
    const res = await call('PATCH', `/admin/enrollments/${enrolmentA}`, superAdmin, {
      level_id: levelB,
    });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('VALIDATION_FAILED');
    expect((await stored()).levelId).toBe(levelA);
  });

  it('refuses a forged `branch_id`, and changes nothing', async () => {
    // This one was ACCEPTED until 2026-08-18: `branch_id` was an editable field,
    // so an enrolment could be moved between premises while keeping its id — a
    // different enrolment wearing the old one's identity.
    const res = await call('PATCH', `/admin/enrollments/${enrolmentA}`, superAdmin, {
      branch_id: branchB,
    });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('VALIDATION_FAILED');
    expect((await stored()).branchId).toBe(branchA);
  });

  it('refuses them even when smuggled beside a legitimate change', async () => {
    // `.strict()` refuses the whole body rather than applying the valid half:
    // a partial application would be the silent drop R55/R57 warns about.
    const res = await call('PATCH', `/admin/enrollments/${enrolmentA}`, superAdmin, {
      administrative_group_id: groupA2,
      branch_id: branchB,
    });
    expect(res.status).toBe(400);
    const row = await stored();
    expect(row.branchId).toBe(branchA);
    expect(row.administrativeGroupId).toBe(groupA1);
  });

  it('CHANGES the Administrative Group, which is what this route is for', async () => {
    const res = await call('PATCH', `/admin/enrollments/${enrolmentA}`, superAdmin, {
      administrative_group_id: groupA2,
    });
    expect(res.status).toBe(204);
    expect((await stored()).administrativeGroupId).toBe(groupA2);
  });

  it('CLEARS it, because direct Level placement is a real answer (R66)', async () => {
    const res = await call('PATCH', `/admin/enrollments/${enrolmentA}`, superAdmin, {
      administrative_group_id: null,
    });
    expect(res.status).toBe(204);
    const row = await stored();
    expect(row.administrativeGroupId).toBeNull();
    // The identity is untouched by the placement changing underneath it.
    expect(row.levelId).toBe(levelA);
    expect(row.branchId).toBe(branchA);
  });
});

describe('another Level is another enrolment, and they coexist', () => {
  it('creates a SECOND enrolment rather than moving the first', async () => {
    const created = await call('POST', '/admin/enrollments', superAdmin, {
      student_id: student,
      level_id: levelB,
      branch_id: branchB,
    });
    expect(created.status).toBe(201);

    const rows = await prisma.enrollment.findMany({
      where: { studentId: student, deletedAt: null },
      select: { levelId: true, branchId: true },
      orderBy: { levelId: 'asc' },
    });
    expect(rows).toHaveLength(2);
    // Different Levels AND different branches, held at once — which is the
    // whole reason the edit route must not move either.
    expect(new Set(rows.map((r) => r.levelId))).toEqual(new Set([levelA, levelB]));
    expect(new Set(rows.map((r) => r.branchId))).toEqual(new Set([branchA, branchB]));
  });

  it('ending one leaves the other intact', async () => {
    const res = await call('DELETE', `/admin/enrollments/${enrolmentA}`, superAdmin);
    expect(res.status).toBe(204);

    const live = await prisma.enrollment.findMany({
      where: { studentId: student, deletedAt: null },
      select: { levelId: true },
    });
    expect(live).toHaveLength(1);
    expect(live[0]!.levelId).toBe(levelB);

    // And the beneficiary herself is untouched — ending a placement is not
    // removing a person (R79.4).
    const person = await prisma.user.findUniqueOrThrow({
      where: { id: student },
      select: { deletedAt: true, isBeneficiary: true },
    });
    expect(person.deletedAt).toBeNull();
    expect(person.isBeneficiary).toBe(true);
  });
});
