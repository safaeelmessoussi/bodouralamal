import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { issueAccessToken } from '../lib/access-token.js';
import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import { httpCall } from '../test-support/http-client.js';

/**
 * Administrative Groups over real HTTP (TD-3.12, §4.4c, Revision 43).
 *
 * **Why an HTTP suite exists beside the service suite.** A service test asserts
 * the *decision*; it never sees the *wire*. `GET /admin/branches` shipped raw
 * Prisma rows for months with every service test green, which is exactly how a
 * contract drifts unnoticed. So these tests assert the **exact key set** of each
 * response rather than the presence of the fields wanted — the failure being
 * guarded is a field *arriving* that nobody chose, and a presence check passes
 * straight through it.
 *
 * **The Revision 43 stake is higher than shape.** §20 rule 22 forbids ever
 * re-conflating organisation with delivery, and an API is where that would creep
 * back: a client asking for `max_students` and receiving `201` would reasonably
 * believe a capacity was recorded, when BR-23 says none exists to record. Those
 * keys are therefore asserted **refused**, not merely absent from the response.
 *
 * Requires the compose stack, with the api image built from current source:
 *   docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build api
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = '[http-adminis-group-test]';

/** The whole contract, in one sorted list (§16.2 allow-list projection). */
const GROUP_KEYS = ['branch_id', 'display_order', 'id', 'level_id', 'name', 'version'];

interface Res {
  status: number;
  body: Record<string, unknown> & {
    error?: { code?: string; details?: Record<string, unknown> };
    data?: Record<string, unknown>[];
  };
}

async function call(method: string, path: string, token?: string, body?: unknown): Promise<Res> {
  return httpCall<Res['body']>(BASE, method, path, {
    token,
    ...(body !== undefined ? { body } : {}),
  });
}

async function makeUser(label: string): Promise<string> {
  const user = await prisma.user.create({
    data: { nameArabic: `${TAG} ${label}`, accountStatus: 'active' },
  });
  return user.id;
}

function bearer(userId: string, scopes: { role: string; branches: string[] | null }[]): string {
  return issueAccessToken(
    { userId, roleScopes: scopes as never, accountStatus: 'active' as never },
    config.JWT_SIGNING_KEY,
  ).token;
}

let superAdmin: string;
let scopedAdmin: string;
let teacherToken: string;
let branchA: string;
let branchB: string;
let levelId: string;
let soloLevelId: string;
let soloGroupId: string;

async function clear(): Promise<void> {
  const groups = await prisma.administrativeGroup.findMany({
    where: { branch: { name: { startsWith: TAG } } },
    select: { id: true },
  });
  const branches = await prisma.branch.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  // TD-8 keeps `AuditLog.actor` and `Trash.deletedBy` RESTRICT on purpose:
  // deleting a user must never quietly erase the record of what they did. Every
  // write here is audited, so the fixture clears its OWN trail — scoped to these
  // ids, never a blanket truncate.
  const targetIds = [...groups.map((g) => g.id), ...branches.map((b) => b.id)];
  if (targetIds.length > 0) {
    await prisma.trash.deleteMany({ where: { targetId: { in: targetIds } } });
    await prisma.auditLog.deleteMany({ where: { targetId: { in: targetIds } } });
  }
  await prisma.administrativeGroup.deleteMany({ where: { id: { in: groups.map((g) => g.id) } } });
  // RESTRICT against both Level and Branch (TD-5), so groups go first.
  await prisma.level.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.branch.deleteMany({ where: { id: { in: branches.map((b) => b.id) } } });

  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  if (userIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
    await prisma.trash.deleteMany({ where: { deletedById: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}

beforeAll(async () => {
  // Fail loudly rather than skipping (§19.2): a silently skipped wiring test is
  // indistinguishable from a passing one. Health is served at the ORIGIN root
  // (TD-14), not under /api/v1.
  const health = await fetch(`${config.PUBLIC_BASE_URL}/healthz`).catch(() => null);
  if (!health || health.status !== 200) {
    throw new Error(
      `API not reachable at ${config.PUBLIC_BASE_URL}/healthz — run: ` +
        'docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build api',
    );
  }

  await clear();

  // Branches are created through Prisma rather than the branch API on purpose:
  // `createBranch` runs the TD-4.6d backfill, which would give every grouples
  // Level in the database a المجموعة 1 at this branch — real behaviour, but it
  // would make this fixture's group counts depend on the rest of the database.
  const a = await prisma.branch.create({
    data: { name: `${TAG} فرع أ`, operationalStartDate: new Date('2026-01-01') },
  });
  const b = await prisma.branch.create({
    data: { name: `${TAG} فرع ب`, operationalStartDate: new Date('2026-01-01') },
  });
  branchA = a.id;
  branchB = b.id;

  const category = await prisma.category.create({ data: { name: `${TAG} فئة` } });
  const level = await prisma.level.create({
    data: { name: `${TAG} مستوى`, categoryId: category.id, genderRestriction: 'any' },
  });
  levelId = level.id;

  const solo = await prisma.level.create({
    data: { name: `${TAG} مستوى وحيد`, categoryId: category.id, genderRestriction: 'any' },
  });
  soloLevelId = solo.id;
  const soloGroup = await prisma.administrativeGroup.create({
    data: { name: `${TAG} وحيدة`, levelId: solo.id, branchId: branchA, displayOrder: 0 },
  });
  soloGroupId = soloGroup.id;

  superAdmin = bearer(await makeUser('مدير عام'), [{ role: 'super_admin', branches: null }]);
  // Scoped to branch A ONLY — the half of TD-2 a null scope cannot exercise.
  scopedAdmin = bearer(await makeUser('مدير فرع'), [{ role: 'admin', branches: [branchA] }]);
  teacherToken = bearer(await makeUser('أستاذة'), [{ role: 'teacher', branches: null }]);
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe('the response is an explicit contract DTO (§16.2)', () => {
  it('POST, GET and PATCH all return exactly the documented keys', async () => {
    const created = await call('POST', '/admin/administrative-groups', superAdmin, {
      name: `${TAG} المجموعة أ`,
      level_id: levelId,
      branch_id: branchA,
      display_order: 1,
    });
    expect(created.status).toBe(201);
    expect(Object.keys(created.body).sort()).toEqual(GROUP_KEYS);
    expect(created.body.level_id).toBe(levelId);
    expect(created.body.branch_id).toBe(branchA);

    const list = await call(
      'GET',
      `/admin/administrative-groups?level_id=${levelId}`,
      superAdmin,
    );
    expect(list.status).toBe(200);
    const row = list.body.data!.find((g) => g.id === created.body.id)!;
    expect(Object.keys(row).sort()).toEqual(GROUP_KEYS);

    const patched = await call(
      'PATCH',
      `/admin/administrative-groups/${created.body.id}`,
      superAdmin,
      { name: `${TAG} المجموعة أ معدّلة`, version: created.body.version },
    );
    expect(patched.status).toBe(200);
    expect(Object.keys(patched.body).sort()).toEqual(GROUP_KEYS);
    expect(patched.body.version).toBe((created.body.version as number) + 1);
  });

  it('exposes no internal column and no camelCase original', async () => {
    const list = await call('GET', `/admin/administrative-groups?level_id=${levelId}`, superAdmin);
    for (const row of list.body.data!) {
      // Named individually so the failure message says WHICH column leaked.
      for (const internal of ['created_at', 'updated_at', 'deleted_at', 'deleted_by']) {
        expect(row).not.toHaveProperty(internal);
      }
      for (const camel of ['levelId', 'branchId', 'displayOrder', 'deletedAt']) {
        expect(row).not.toHaveProperty(camel);
      }
    }
  });

  it('never carries a delivery field — §20 rule 22, and no capacity at all (BR-23)', async () => {
    const list = await call('GET', `/admin/administrative-groups?level_id=${levelId}`, superAdmin);
    for (const row of list.body.data!) {
      for (const retired of [
        'max_students',
        'capacity',
        'room_id',
        'teacher_id',
        'assistant_id',
        'day_of_week',
        'start_time',
        'end_time',
      ]) {
        expect(row).not.toHaveProperty(retired);
      }
    }
  });

  it('paginates per TD-10, reporting the unpaginated total', async () => {
    const res = await call(
      'GET',
      `/admin/administrative-groups?level_id=${levelId}&page=1&page_size=1`,
      superAdmin,
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta).toMatchObject({ page: 1, page_size: 1 });
    expect((res.body.meta as { total: number }).total).toBeGreaterThanOrEqual(1);
  });
});

describe('the write boundary REFUSES what Revision 43 removed', () => {
  it('rejects max_students rather than silently dropping it', async () => {
    // The important half: a 201 here would tell a client a capacity had been
    // recorded. BR-23 says there is none to record, so the honest answer is a
    // refusal — the field does not exist, rather than being ignored.
    const res = await call('POST', '/admin/administrative-groups', superAdmin, {
      name: `${TAG} بسعة`,
      level_id: levelId,
      branch_id: branchA,
      max_students: 30,
    });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('VALIDATION_FAILED');
    expect(
      await prisma.administrativeGroup.count({ where: { name: `${TAG} بسعة` } }),
    ).toBe(0);
  });

  it('rejects a room, a teacher and a weekly schedule the same way', async () => {
    for (const extra of [
      { room_id: branchA },
      { teacher_id: branchA },
      { day_of_week: 'monday' },
      { start_time: '09:00' },
    ]) {
      const res = await call('POST', '/admin/administrative-groups', superAdmin, {
        name: `${TAG} مرفوضة`,
        level_id: levelId,
        branch_id: branchA,
        ...extra,
      });
      expect(res.status).toBe(400);
    }
  });

  it('refuses to move a group between Levels or Branches on PATCH', async () => {
    // Both are re-creations, not edits: a new Level would invalidate every
    // Enrollment.level_id pointing here, and a new Branch would change where
    // these students are recorded as attending without a per-student decision.
    const group = await call('POST', '/admin/administrative-groups', superAdmin, {
      name: `${TAG} للنقل`,
      level_id: levelId,
      branch_id: branchA,
    });

    for (const move of [{ level_id: soloLevelId }, { branch_id: branchB }]) {
      const res = await call(
        'PATCH',
        `/admin/administrative-groups/${group.body.id}`,
        superAdmin,
        { version: group.body.version, ...move },
      );
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe('VALIDATION_FAILED');
    }

    const after = await prisma.administrativeGroup.findUniqueOrThrow({
      where: { id: group.body.id as string },
      select: { levelId: true, branchId: true },
    });
    expect(after).toEqual({ levelId, branchId: branchA });
  });

  it('TD-15: a stale version is a 409, not a silent overwrite', async () => {
    const group = await call('POST', '/admin/administrative-groups', superAdmin, {
      name: `${TAG} للتعارض`,
      level_id: levelId,
      branch_id: branchA,
    });

    // A real prior edit is what makes the stale version stale. Sending
    // `created.version - 1` instead would be **-1** on a fresh row, which the
    // validator refuses as malformed (`400`) before optimistic locking is ever
    // consulted — a test that would pass on a build with no locking at all.
    const first = await call(
      'PATCH',
      `/admin/administrative-groups/${group.body.id}`,
      superAdmin,
      { name: `${TAG} تحرير أول`, version: group.body.version },
    );
    expect(first.status).toBe(200);

    const stale = await call(
      'PATCH',
      `/admin/administrative-groups/${group.body.id}`,
      superAdmin,
      { name: `${TAG} تعارض`, version: group.body.version },
    );
    expect(stale.status).toBe(409);
    expect(stale.body.error?.code).toBe('VERSION_CONFLICT');

    // The colleague's edit survived — the point of the refusal.
    const row = await prisma.administrativeGroup.findUniqueOrThrow({
      where: { id: group.body.id as string },
      select: { name: true },
    });
    expect(row.name).toBe(`${TAG} تحرير أول`);
  });

  it('a malformed filter is a 400, not an empty list', async () => {
    // "That is not an id" and "this Level has no groups" are different answers,
    // and the second one misleads a screen into reporting an empty Level.
    const res = await call('GET', '/admin/administrative-groups?level_id=not-a-uuid', superAdmin);
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('VALIDATION_FAILED');
  });
});

describe('the routes are mounted and guarded (TD-2)', () => {
  it('refuses an anonymous caller with the TD-3.8 envelope', async () => {
    const res = await call('GET', '/admin/administrative-groups');
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe('AUTH_REQUIRED');
  });

  it('refuses a teacher — organisation is not a teaching concern', async () => {
    const res = await call('GET', '/admin/administrative-groups', teacherToken);
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe('FORBIDDEN');
  });

  it('a branch-scoped Admin reads their own branch and not another', async () => {
    await call('POST', '/admin/administrative-groups', superAdmin, {
      name: `${TAG} في ب`,
      level_id: levelId,
      branch_id: branchB,
    });

    const res = await call(
      'GET',
      `/admin/administrative-groups?level_id=${levelId}`,
      scopedAdmin,
    );
    expect(res.status).toBe(200);
    const branchIds = new Set(res.body.data!.map((g) => g.branch_id));
    expect(branchIds.has(branchA)).toBe(true);
    expect(branchIds.has(branchB)).toBe(false);
  });

  it('creating in a branch outside scope is 404, never 403 (§20 rule 17)', async () => {
    // A 403 would confirm that branch B exists, which is the leak the rule
    // exists to prevent.
    const res = await call('POST', '/admin/administrative-groups', scopedAdmin, {
      name: `${TAG} تسلل`,
      level_id: levelId,
      branch_id: branchB,
    });
    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBe('NOT_FOUND');
  });

  it('a scoped Admin may create within their own branch', async () => {
    const res = await call('POST', '/admin/administrative-groups', scopedAdmin, {
      name: `${TAG} مسموحة`,
      level_id: levelId,
      branch_id: branchA,
    });
    expect(res.status).toBe(201);
  });

  it('an unknown Level is 404', async () => {
    const res = await call('POST', '/admin/administrative-groups', superAdmin, {
      name: `${TAG} بلا مستوى`,
      level_id: '00000000-0000-4000-8000-000000000000',
      branch_id: branchA,
    });
    expect(res.status).toBe(404);
  });
});

describe('deletion is guarded (TD-5, §4.4b)', () => {
  it('refuses to remove the LAST group of a Level', async () => {
    // §4.4b: the state TD-4.6b prevents at creation is otherwise reachable by
    // deletion — the same broken state arrived at from the other side.
    const res = await call('DELETE', `/admin/administrative-groups/${soloGroupId}`, superAdmin);
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe('STATE_CONFLICT');
    expect(res.body.error?.details?.['reason']).toBe('LAST_GROUP_IN_LEVEL');

    const still = await prisma.administrativeGroup.findUniqueOrThrow({
      where: { id: soloGroupId },
      select: { deletedAt: true },
    });
    expect(still.deletedAt).toBeNull();
  });

  it('removes a group that is neither last nor referenced', async () => {
    const group = await call('POST', '/admin/administrative-groups', superAdmin, {
      name: `${TAG} للحذف`,
      level_id: soloLevelId,
      branch_id: branchA,
    });
    const res = await call('DELETE', `/admin/administrative-groups/${group.body.id}`, superAdmin);
    expect(res.status).toBe(204);

    // TD-5 soft delete: the row survives, carrying its tombstone.
    const row = await prisma.administrativeGroup.findUniqueOrThrow({
      where: { id: group.body.id as string },
      select: { deletedAt: true },
    });
    expect(row.deletedAt).not.toBeNull();
  });

  it('refuses while students are still enrolled', async () => {
    const group = await call('POST', '/admin/administrative-groups', superAdmin, {
      name: `${TAG} بطلبة`,
      level_id: soloLevelId,
      branch_id: branchA,
    });
    const student = await prisma.user.create({
      data: { nameArabic: `${TAG} طالبة`, accountStatus: 'active', sex: 'female' },
    });
    await prisma.enrollment.create({
      data: {
        studentId: student.id,
        administrativeGroupId: group.body.id as string,
        levelId: soloLevelId,
      },
    });

    const res = await call('DELETE', `/admin/administrative-groups/${group.body.id}`, superAdmin);
    expect(res.status).toBe(409);
    expect(res.body.error?.details?.['reason']).toBe('ENROLMENTS_EXIST');

    await prisma.enrollment.deleteMany({ where: { studentId: student.id } });
  });
});
