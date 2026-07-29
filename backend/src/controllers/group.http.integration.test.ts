import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { issueAccessToken } from '../lib/access-token.js';
import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import { httpCall } from '../test-support/http-client.js';

/**
 * Group, roster and instructor routes over real HTTP (§4.4, §5.6).
 *
 * The service suites prove the invariants; this proves the **wiring** — paths,
 * the authenticate middleware, status codes, the `HH:MM` boundary format and the
 * structured `details` a client actually receives. None of that is visible to a
 * service test.
 *
 * Requires the compose stack with the api image built from current source.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = '[group-http-test]';

interface Body {
  error?: { code?: string; details?: Record<string, unknown> };
  data?: unknown[];
  id?: string;
  version?: number;
  start_time?: string;
  end_time?: string;
  enrolled?: number;
  meta?: { page: number; page_size: number; total: number };
  capacity?: number;
  slots_used?: number;
}

const call = (method: string, path: string, token?: string, body?: unknown) =>
  httpCall<Body>(BASE, method, path, { token, ...(body !== undefined ? { body } : {}) });

const bearer = (userId: string, roles: string[]): string =>
  issueAccessToken(
    { userId, roleScopes: roles.map((role) => ({ role, branches: null })), accountStatus: 'active' as never },
    config.JWT_SIGNING_KEY,
  ).token;

let levelId: string;
let superToken: string;
let teacherToken: string;
let teacherId: string;

async function person(label: string): Promise<string> {
  const u = await prisma.user.create({
    data: { nameArabic: `${TAG} ${label}`, accountStatus: 'active' },
  });
  return u.id;
}

async function withRole(label: string, role: string): Promise<string> {
  const id = await person(label);
  const r = await prisma.role.findUnique({ where: { name: role } });
  await prisma.userBranchRole.create({ data: { userId: id, roleId: r!.id, branchId: null } });
  return id;
}

async function makeBranch(): Promise<string> {
  const b = await prisma.branch.create({
    data: { name: `${TAG} فرع`, operationalStartDate: new Date('2026-01-01') },
  });
  return b.id;
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
  // Rooms reference the branch under RESTRICT, so they must go before it.
  await prisma.room.deleteMany({ where: { name: { startsWith: TAG } } });

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

beforeAll(async () => {
  const health = await fetch(`${config.PUBLIC_BASE_URL}/healthz`).catch(() => null);
  if (!health || health.status !== 200) {
    throw new Error('API not reachable — run: docker compose up -d --build api');
  }
});

beforeEach(async () => {
  await clear();
  const level = await prisma.level.findFirst({ select: { id: true } });
  levelId = level!.id;
  superToken = bearer(await withRole('مشرف عام', 'super_admin'), ['super_admin']);
  teacherId = await withRole('معلمة', 'teacher');
  teacherToken = bearer(teacherId, ['teacher']);
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

async function createGroupHttp(branchId: string, over: Record<string, unknown> = {}) {
  return call('POST', '/admin/groups', superToken, {
    name: `${TAG} مجموعة`,
    level_id: levelId,
    branch_id: branchId,
    day_of_week: 'monday',
    start_time: '09:00',
    end_time: '10:30',
    max_students: 20,
    ...over,
  });
}

describe('/admin/groups over HTTP', () => {
  it('creates a group and returns wall-clock HH:MM, not an instant', async () => {
    const branchId = await makeBranch();
    const res = await createGroupHttp(branchId);

    expect(res.status).toBe(201);
    // TD-11: the boundary format is a local clock time; an ISO instant here
    // would reintroduce the timezone the `time` column exists to avoid.
    expect(res.body.start_time).toBe('09:00');
    expect(res.body.end_time).toBe('10:30');
  });

  it('refuses an anonymous caller with the TD-3.8 envelope', async () => {
    const res = await call('GET', '/admin/groups');
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe('AUTH_REQUIRED');
  });

  it('TD-2: a teacher cannot create a group', async () => {
    const branchId = await makeBranch();
    const res = await call('POST', '/admin/groups', teacherToken, {
      name: `${TAG} محاولة`,
      level_id: levelId,
      branch_id: branchId,
      day_of_week: 'monday',
      start_time: '09:00',
      end_time: '10:30',
      max_students: 20,
    });
    expect(res.status).toBe(403);
  });

  it('rejects a malformed clock value at the boundary', async () => {
    const branchId = await makeBranch();
    expect((await createGroupHttp(branchId, { start_time: '9am' })).status).toBe(400);
    expect((await createGroupHttp(branchId, { start_time: '25:00' })).status).toBe(400);
  });

  it('a room/time overlap returns 409 with structured details, not a new code', async () => {
    const branchId = await makeBranch();
    const room = await prisma.room.create({ data: { name: `${TAG} قاعة`, branchId } });
    const first = await createGroupHttp(branchId, { room_id: room.id });
    expect(first.status).toBe(201);

    const clash = await createGroupHttp(branchId, {
      room_id: room.id,
      start_time: '10:00',
      end_time: '11:00',
    });
    expect(clash.status).toBe(409);
    expect(clash.body.error?.code).toBe('STATE_CONFLICT');
    expect(clash.body.error?.details?.['reason']).toBe('ROOM_TIME_OVERLAP');
    expect(clash.body.error?.details?.['conflicting_group_id']).toBe(first.body.id);
  });

  it('TD-15: a stale version is 409 VERSION_CONFLICT', async () => {
    const branchId = await makeBranch();
    const group = await createGroupHttp(branchId);
    const stale = group.body.version!;

    expect((await call('PATCH', `/admin/groups/${group.body.id}`, superToken, {
      version: stale, max_students: 25,
    })).status).toBe(200);

    const second = await call('PATCH', `/admin/groups/${group.body.id}`, superToken, {
      version: stale, max_students: 30,
    });
    expect(second.status).toBe(409);
    expect(second.body.error?.code).toBe('VERSION_CONFLICT');
  });
});

describe('/admin/groups/{id}/roster over HTTP', () => {
  it('enrols, lists, and un-enrols', async () => {
    const branchId = await makeBranch();
    const group = await createGroupHttp(branchId);
    const student = await person('طالبة');

    const enrolled = await call('POST', `/admin/groups/${group.body.id}/roster`, superToken, {
      student_id: student,
    });
    expect(enrolled.status).toBe(201);
    expect(enrolled.body.enrolled).toBe(1);

    const listed = await call('GET', `/admin/groups/${group.body.id}/roster`, superToken);
    expect((listed.body.data as { student_id: string }[]).map((r) => r.student_id)).toEqual([
      student,
    ]);

    expect(
      (await call('DELETE', `/admin/groups/${group.body.id}/roster/${student}`, superToken)).status,
    ).toBe(204);
  });

  it('CAPACITY_FULL carries the capacity in details', async () => {
    const branchId = await makeBranch();
    const group = await createGroupHttp(branchId, { max_students: 1 });
    await call('POST', `/admin/groups/${group.body.id}/roster`, superToken, {
      student_id: await person('أ'),
    });

    const full = await call('POST', `/admin/groups/${group.body.id}/roster`, superToken, {
      student_id: await person('ب'),
    });
    expect(full.status).toBe(409);
    expect(full.body.error?.code).toBe('CAPACITY_FULL');
    expect(full.body.error?.details?.['capacity']).toBe(1);
  });

  it('TD-2: a teacher cannot manage the roster', async () => {
    const branchId = await makeBranch();
    const group = await createGroupHttp(branchId);
    const res = await call('POST', `/admin/groups/${group.body.id}/roster`, teacherToken, {
      student_id: await person('طالبة'),
    });
    expect(res.status).toBe(403);
  });
});

describe('TD-10 — list endpoints are paginated over HTTP', () => {
  it('GET /admin/groups returns the TD-10 envelope', async () => {
    const branchId = await makeBranch();
    await createGroupHttp(branchId);

    const res = await call('GET', '/admin/groups', superToken);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    // The envelope is what the frontend will bind to; `total` is the
    // unpaginated count, without which a client cannot compute page count.
    expect(res.body.meta).toMatchObject({ page: 1, page_size: 25 });
    expect(typeof res.body.meta!.total).toBe('number');
  });

  it('honours ?page and ?page_size, and caps the size at 100', async () => {
    const branchId = await makeBranch();
    await createGroupHttp(branchId, { name: `${TAG} أولى`, start_time: '08:00', end_time: '09:00' });
    await createGroupHttp(branchId, { name: `${TAG} ثانية`, start_time: '11:00', end_time: '12:00' });

    const first = await call('GET', '/admin/groups?page=1&page_size=1', superToken);
    expect(first.body.data).toHaveLength(1);
    expect(first.body.meta).toMatchObject({ page: 1, page_size: 1 });
    expect(first.body.meta!.total).toBeGreaterThanOrEqual(2);

    const second = await call('GET', '/admin/groups?page=2&page_size=1', superToken);
    expect(second.body.data).toHaveLength(1);
    // Different page, different row — the `id` tiebreaker makes this stable.
    expect((second.body.data as { id: string }[])[0]!.id).not.toBe(
      (first.body.data as { id: string }[])[0]!.id,
    );

    // TD-10 caps rather than refuses: a client bug must not become an outage.
    const huge = await call('GET', '/admin/groups?page_size=5000', superToken);
    expect(huge.status).toBe(200);
    expect(huge.body.meta!.page_size).toBe(100);
  });

  it('a malformed page value falls back to the default instead of failing', async () => {
    const res = await call('GET', '/admin/groups?page=abc&page_size=xyz', superToken);
    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ page: 1, page_size: 25 });
  });

  it('the roster is paginated too', async () => {
    const branchId = await makeBranch();
    const group = await createGroupHttp(branchId);
    await call('POST', `/admin/groups/${group.body.id}/roster`, superToken, {
      student_id: await person('طالبة'),
    });

    const res = await call('GET', `/admin/groups/${group.body.id}/roster`, superToken);
    expect(res.body.meta).toMatchObject({ page: 1, page_size: 25, total: 1 });
  });
});

describe('/admin/groups/{id}/instructors over HTTP', () => {
  it('assigns up to two instructors and refuses a third with details', async () => {
    const branchId = await makeBranch();
    const group = await createGroupHttp(branchId);
    const second = await withRole('معلمة ثانية', 'teacher');
    const third = await withRole('معلمة ثالثة', 'teacher');

    const a = await call('POST', `/admin/groups/${group.body.id}/instructors`, superToken, {
      teacher_id: teacherId,
    });
    expect(a.status).toBe(201);
    expect(a.body.slots_used).toBe(1);

    expect(
      (await call('POST', `/admin/groups/${group.body.id}/instructors`, superToken, {
        teacher_id: second,
      })).body.slots_used,
    ).toBe(2);

    const full = await call('POST', `/admin/groups/${group.body.id}/instructors`, superToken, {
      teacher_id: third,
    });
    expect(full.status).toBe(409);
    expect(full.body.error?.details?.['reason']).toBe('INSTRUCTOR_SLOTS_FULL');
  });

  it('removing an instructor frees a slot', async () => {
    const branchId = await makeBranch();
    const group = await createGroupHttp(branchId);
    await call('POST', `/admin/groups/${group.body.id}/instructors`, superToken, {
      teacher_id: teacherId,
    });

    expect(
      (await call('DELETE', `/admin/groups/${group.body.id}/instructors/${teacherId}`, superToken))
        .status,
    ).toBe(204);
    expect(
      (await call('POST', `/admin/groups/${group.body.id}/instructors`, superToken, {
        teacher_id: teacherId,
      })).status,
    ).toBe(201);
  });

  it('refuses a user who does not hold the teacher role', async () => {
    const branchId = await makeBranch();
    const group = await createGroupHttp(branchId);
    const res = await call('POST', `/admin/groups/${group.body.id}/instructors`, superToken, {
      teacher_id: await person('ليست معلمة'),
    });
    expect(res.status).toBe(404);
  });
});
