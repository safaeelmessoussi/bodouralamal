import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { issueAccessToken } from '../lib/access-token.js';
import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import { httpCall } from '../test-support/http-client.js';

/**
 * Curriculum taxonomy CRUD over HTTP — Categories, Subjects and Levels
 * (§5.6, §14.1, TD-2 R26, TD-4.6b, TD-5, TD-15).
 *
 * The properties worth pinning are the ones that make the back office *safe*
 * rather than merely present: who may write, what a delete refuses, and the one
 * asymmetry TD-4.6b creates — a Level always owns at least one Administrative
 * Group, so a guard that counted groups would make deletion unreachable.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = '[http-taxonomy-test]';

interface Res {
  status: number;
  body: {
    error?: { code?: string; details?: Record<string, unknown> };
    data?: Record<string, unknown> & Record<string, unknown>[];
  };
}

const call = (
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<Res> =>
  httpCall<Res['body']>(BASE, method, path, {
    ...(token !== undefined ? { token } : {}),
    ...(body !== undefined ? { body } : {}),
  });

const bearer = (userId: string, scopes: { role: string; branches: string[] | null }[]): string =>
  issueAccessToken(
    { userId, roleScopes: scopes as never, accountStatus: 'active' as never },
    config.JWT_SIGNING_KEY,
  ).token;

let superAdmin: string;
let admin: string;
let teacher: string;
let branchId: string;
let categoryId: string;

async function makeUser(label: string): Promise<string> {
  const u = await prisma.user.create({
    data: { nameArabic: `${TAG} ${label}`, accountStatus: 'active' },
  });
  return u.id;
}

async function clear(): Promise<void> {
  const levels = await prisma.level.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  const levelIds = levels.map((l) => l.id);
  await prisma.teachingGroup.deleteMany({ where: { levelId: { in: levelIds } } });
  await prisma.levelSubject.deleteMany({ where: { levelId: { in: levelIds } } });
  await prisma.enrollment.deleteMany({ where: { levelId: { in: levelIds } } });
  await prisma.administrativeGroup.deleteMany({ where: { levelId: { in: levelIds } } });
  await prisma.level.deleteMany({ where: { id: { in: levelIds } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.subject.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.room.deleteMany({ where: { branch: { name: { startsWith: TAG } } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  if (ids.length > 0) {
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
    await prisma.trash.deleteMany({ where: { deletedById: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
}

beforeAll(async () => {
  const health = await fetch(`${config.PUBLIC_BASE_URL}/healthz`).catch(() => null);
  if (!health || health.status !== 200) throw new Error('API not reachable');
  await clear();

  branchId = (await prisma.branch.create({ data: { name: `${TAG} فرع` } })).id;
  superAdmin = bearer(await makeUser('مدير عام'), [{ role: 'super_admin', branches: null }]);
  admin = bearer(await makeUser('مسؤولة'), [{ role: 'admin', branches: null }]);
  teacher = bearer(await makeUser('أستاذة'), [{ role: 'teacher', branches: null }]);
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe('Categories (§5.6 الفئات والمواد)', () => {
  it('creates one, and reports that it holds no Levels yet', async () => {
    const res = await call('POST', '/admin/categories', superAdmin, {
      name: `${TAG} فئة`,
      display_order: 1,
    });
    expect(res.status).toBe(201);
    categoryId = String((res.body.data as unknown as Record<string, unknown>)['id']);
    // `level_count` is what tells the screen whether deleting is possible at
    // all, without a request per row.
    expect((res.body.data as unknown as Record<string, unknown>)['level_count']).toBe(0);
  });

  it('lists with the version an editor must send back (TD-15)', async () => {
    const res = await call('GET', '/admin/categories', superAdmin);
    expect(res.status).toBe(200);
    const row = (res.body.data as unknown as Record<string, unknown>[]).find(
      (r) => r['id'] === categoryId,
    )!;
    expect(Object.keys(row).sort()).toEqual([
      'display_order',
      'id',
      'level_count',
      'name',
      'version',
    ]);
  });

  it('refuses a stale version with 409 VERSION_CONFLICT rather than overwriting', async () => {
    const res = await call('PATCH', `/admin/categories/${categoryId}`, superAdmin, {
      version: 99,
      name: `${TAG} فئة معدلة`,
    });
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe('VERSION_CONFLICT');
  });

  it('is Super Admin to write and Admin to read (TD-2 R26)', async () => {
    expect((await call('GET', '/admin/categories', admin)).status).toBe(200);
    const res = await call('POST', '/admin/categories', admin, { name: `${TAG} مرفوضة` });
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe('FORBIDDEN');
  });

  it('refuses a Teacher entirely (Revision 30)', async () => {
    expect((await call('GET', '/admin/categories', teacher)).status).toBe(403);
  });
});

describe('Subjects (§5.6 الفئات والمواد)', () => {
  let subjectId = '';

  it('creates, renames and lists through the ONE subject endpoint', async () => {
    const created = await call('POST', '/admin/subjects', superAdmin, { name: `${TAG} مادة` });
    expect(created.status).toBe(201);
    const row = created.body.data as unknown as Record<string, unknown>;
    subjectId = String(row['id']);

    // The selector and the editor read the same list — that is why `version`
    // is published on it.
    const renamed = await call('PATCH', `/admin/subjects/${subjectId}`, superAdmin, {
      version: row['version'],
      name: `${TAG} مادة معدلة`,
    });
    expect(renamed.status).toBe(200);

    const list = await call('GET', '/admin/subjects', superAdmin);
    const listed = (list.body.data as unknown as Record<string, unknown>[]).find(
      (r) => r['id'] === subjectId,
    )!;
    expect(listed['name']).toBe(`${TAG} مادة معدلة`);
  });

  it('refuses deletion while a Level still teaches it', async () => {
    const level = await prisma.level.create({
      data: { name: `${TAG} مستوى للمادة`, categoryId, genderRestriction: 'any' },
    });
    await prisma.levelSubject.create({ data: { levelId: level.id, subjectId } });

    const res = await call('DELETE', `/admin/subjects/${subjectId}`, superAdmin);
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe('STATE_CONFLICT');
    // Named, so the screen can say WHICH relationship blocks it rather than
    // "cannot delete".
    expect(res.body.error?.details?.['blocked_by']).toHaveProperty('levels');

    await prisma.levelSubject.deleteMany({ where: { levelId: level.id } });
    await prisma.level.delete({ where: { id: level.id } });
  });

  it('deletes once nothing teaches it, and leaves a Trash snapshot (TD-5)', async () => {
    const res = await call('DELETE', `/admin/subjects/${subjectId}`, superAdmin);
    expect(res.status).toBe(204);
    const row = await prisma.subject.findUnique({ where: { id: subjectId } });
    expect(row?.deletedAt).not.toBeNull();
    expect(
      await prisma.trash.count({ where: { targetEntity: 'Subject', targetId: subjectId } }),
    ).toBe(1);
  });

  it('drops out of the selector once deleted', async () => {
    const list = await call('GET', '/admin/subjects', superAdmin);
    expect(
      (list.body.data as unknown as Record<string, unknown>[]).map((r) => r['id']),
    ).not.toContain(subjectId);
  });
});

describe('Levels (§5.6 مستويات, TD-4.6b)', () => {
  let levelId = '';

  it('creates the Level and its المجموعة 1 in one act, and reports the group', async () => {
    const res = await call('POST', '/admin/levels', superAdmin, {
      name: `${TAG} مستوى`,
      category_id: categoryId,
      gender_restriction: 'girls_only',
      branch_id: branchId,
    });
    expect(res.status).toBe(201);
    const row = res.body.data as unknown as Record<string, unknown>;
    levelId = String(row['id']);

    // A Level with no group is a Level nobody can be admitted to (TD-4.6b), so
    // the group is created here rather than left to a later step — and it is
    // REPORTED, or an administrator cannot tell where it went.
    const group = row['first_group'] as Record<string, unknown>;
    expect(group['name']).toBe('المجموعة 1');
    expect(group['branch_id']).toBe(branchId);
    expect(
      await prisma.administrativeGroup.count({ where: { levelId, deletedAt: null } }),
    ).toBe(1);
  });

  it('never stores the branch on the Level itself (§4.4b)', async () => {
    // A Level is Category-scoped and branch-independent; `branch_id` says where
    // المجموعة 1 goes and nothing else. Putting it on the Level would break
    // entire_level teaching mode, which resolves across the groups at a branch.
    const res = await call('GET', '/admin/levels', superAdmin);
    const row = (res.body.data as unknown as Record<string, unknown>[]).find(
      (r) => r['id'] === levelId,
    )!;
    expect(row).not.toHaveProperty('branch_id');
    expect(row['category_name']).toBe(`${TAG} فئة`);
    expect(row['group_count']).toBe(1);
    expect(row['gender_restriction']).toBe('girls_only');
  });

  it('filters by category, and rejects a malformed filter rather than ignoring it', async () => {
    const ok = await call('GET', `/admin/levels?category_id=${categoryId}`, superAdmin);
    expect(ok.status).toBe(200);
    expect((ok.body.data as unknown as Record<string, unknown>[]).length).toBeGreaterThan(0);

    // Silently returning every Level for a bad filter would answer a question
    // nobody asked.
    const bad = await call('GET', '/admin/levels?category_id=not-a-uuid', superAdmin);
    expect(bad.status).toBe(400);
  });

  it('will not move a Level between Categories', async () => {
    // Absent from the schema on purpose: a move would re-file every enrolled
    // student into a different educational stage, and §2.2 scopes display_order
    // within the Category, so the ordering would stop meaning anything.
    const row = await prisma.level.findUniqueOrThrow({ where: { id: levelId } });
    const other = await prisma.category.create({ data: { name: `${TAG} فئة أخرى` } });
    const res = await call('PATCH', `/admin/levels/${levelId}`, superAdmin, {
      version: row.version,
      category_id: other.id,
    });
    // The unknown key is rejected outright rather than quietly dropped, so a
    // client believing it moved the Level finds out immediately.
    expect(res.status).toBe(400);
    expect(
      (await prisma.level.findUniqueOrThrow({ where: { id: levelId } })).categoryId,
    ).toBe(categoryId);
  });

  it('refuses deletion while a student is enrolled', async () => {
    const group = await prisma.administrativeGroup.findFirstOrThrow({ where: { levelId } });
    const student = await makeUser('طالبة');
    await prisma.enrollment.create({
      data: { studentId: student, administrativeGroupId: group.id, levelId },
    });

    const res = await call('DELETE', `/admin/levels/${levelId}`, superAdmin);
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe('STATE_CONFLICT');
    expect(res.body.error?.details?.['blocked_by']).toHaveProperty('enrollments');

    await prisma.enrollment.deleteMany({ where: { levelId } });
  });

  it('deletes an empty Level, taking the group TD-4.6b created with it', async () => {
    // The inverse of TD-4.6b, and the reason a group count is NOT a blocker:
    // every Level owns at least one group by construction, so a guard counting
    // them would make deletion unreachable. The guards above have already
    // established the group holds nothing.
    const res = await call('DELETE', `/admin/levels/${levelId}`, superAdmin);
    expect(res.status).toBe(204);
    expect(
      await prisma.administrativeGroup.count({ where: { levelId, deletedAt: null } }),
    ).toBe(0);

    const audited = await prisma.auditLog.findFirst({
      where: { targetEntity: 'Level', targetId: levelId, actionType: 'level.delete' },
    });
    // The groups disappeared as a CONSEQUENCE of this decision; TD-8's record
    // has to say which.
    expect((audited?.detail as Record<string, unknown>)['cascaded_group_ids']).toHaveLength(1);
  });

  it('is Super Admin to write (TD-2 R26)', async () => {
    const res = await call('POST', '/admin/levels', admin, {
      name: `${TAG} مستوى مرفوض`,
      category_id: categoryId,
      branch_id: branchId,
    });
    expect(res.status).toBe(403);
  });
});

describe('Category deletion (TD-5)', () => {
  it('refuses while Levels reference it, and never cascades a live curriculum', async () => {
    const level = await prisma.level.create({
      data: { name: `${TAG} مستوى حي`, categoryId, genderRestriction: 'any' },
    });
    const res = await call('DELETE', `/admin/categories/${categoryId}`, superAdmin);
    expect(res.status).toBe(409);
    expect(res.body.error?.details?.['blocked_by']).toHaveProperty('levels');
    // A Level carries enrolments, groups and schedules — cascading here would
    // delete a live curriculum from a control that says "delete category".
    expect((await prisma.level.findUniqueOrThrow({ where: { id: level.id } })).deletedAt).toBeNull();
    await prisma.level.delete({ where: { id: level.id } });
  });

  it('deletes once empty', async () => {
    expect((await call('DELETE', `/admin/categories/${categoryId}`, superAdmin)).status).toBe(204);
  });
});
