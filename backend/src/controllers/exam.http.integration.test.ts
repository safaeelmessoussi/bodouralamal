import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { issueAccessToken } from '../lib/access-token.js';
import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import { httpCall } from '../test-support/http-client.js';

/**
 * Physical exam sittings over real HTTP (TD-3.6, §4.6 as amended by Revision 58).
 *
 * **Why this layer and not the service.** Three of R58's decisions exist only on
 * the wire and a service test cannot see any of them:
 *
 * * `online` is refused with a *coded* reason (`ONLINE_NOT_AVAILABLE`) rather
 *   than a generic validation error — the interface offers the disabled option
 *   for the same purpose (§14.4), and the code is what tells it which capability
 *   is missing;
 * * the identity fields are **refused**, not dropped, on `PATCH` — a silent drop
 *   is exactly the R55/R57 defect where a rename returned `200` and changed
 *   nothing, so every assertion here **reads the row back** rather than trusting
 *   a status code;
 * * `null` administrative group means *the whole Level sits together*, which is
 *   a statement the DTO has to carry rather than an absent field.
 *
 * Requires the compose stack with the api image built from current source:
 *   docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build api
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = '[http-exam-test]';

/** The DTO's full surface — pinned so a field cannot quietly leave it. */
const EXAM_KEYS = [
  'academic_year_id',
  'administrative_group_id',
  'administrative_group_name',
  'branch_id',
  'branch_name',
  'date',
  'description',
  'end_time',
  'id',
  'level_id',
  'level_name',
  'mode',
  'room_id',
  'room_name',
  'staff',
  'start_time',
  'subject_id',
  'subject_name',
  'title',
  'version',
];

interface Res {
  status: number;
  body: Record<string, unknown> & {
    error?: { code?: string; details?: Record<string, unknown> };
    data?: Record<string, unknown>[];
    meta?: { total?: number };
  };
}

async function call(method: string, path: string, token?: string, body?: unknown): Promise<Res> {
  return httpCall<Res['body']>(BASE, method, path, {
    token,
    ...(body !== undefined ? { body } : {}),
  });
}

function bearer(userId: string, scopes: { role: string; branches: string[] | null }[]): string {
  return issueAccessToken(
    { userId, roleScopes: scopes as never, accountStatus: 'active' as never },
    config.JWT_SIGNING_KEY,
  ).token;
}

async function makeUser(label: string): Promise<string> {
  const u = await prisma.user.create({
    data: { nameArabic: `${TAG} ${label}`, accountStatus: 'active' },
  });
  return u.id;
}

let superAdmin: string;
let adminToken: string;
let parentToken: string;
let branchA: string;
let branchB: string;
let roomA: string;
let roomB: string;
let levelId: string;
let otherLevelId: string;
let subjectId: string;
let untaughtSubjectId: string;
let groupA: string;
let groupB: string;
let academicYearId: string;
let supervisorId: string;
let assistantId: string;

/** `label` is a short column — a year is `YYYY-YYYY`, not a sentence. */
const YEAR_LABEL = '2098-2099';

async function clear(): Promise<void> {
  const exams = await prisma.exam.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = exams.map((e) => e.id);
  await prisma.examStaff.deleteMany({ where: { examId: { in: ids } } });
  if (ids.length > 0) {
    await prisma.trash.deleteMany({ where: { targetId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { targetId: { in: ids } } });
  }
  await prisma.exam.deleteMany({ where: { id: { in: ids } } });

  const levels = await prisma.level.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  const levelIds = levels.map((l) => l.id);
  await prisma.administrativeGroup.deleteMany({ where: { levelId: { in: levelIds } } });
  await prisma.levelSubject.deleteMany({ where: { levelId: { in: levelIds } } });
  await prisma.level.deleteMany({ where: { id: { in: levelIds } } });
  await prisma.subject.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.room.deleteMany({ where: { branch: { name: { startsWith: TAG } } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.academicYear.deleteMany({ where: { label: YEAR_LABEL } });

  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  if (userIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { targetId: { in: userIds } } });
    // The tombstone names who wrote it and `deleted_by` is RESTRICT — the
    // snapshot goes before the person (TD-5).
    await prisma.trash.deleteMany({ where: { deletedById: { in: userIds } } });
    await prisma.userBranchRole.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}

beforeAll(async () => {
  const health = await fetch(`${config.PUBLIC_BASE_URL}/healthz`).catch(() => null);
  if (!health || health.status !== 200) {
    throw new Error(
      `API not reachable at ${config.PUBLIC_BASE_URL}/healthz — run: ` +
        'docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build api',
    );
  }
  await clear();

  branchA = (await prisma.branch.create({ data: { name: `${TAG} فرع أ` } })).id;
  branchB = (await prisma.branch.create({ data: { name: `${TAG} فرع ب` } })).id;
  roomA = (await prisma.room.create({ data: { name: `${TAG} قاعة أ`, branchId: branchA } })).id;
  roomB = (await prisma.room.create({ data: { name: `${TAG} قاعة ب`, branchId: branchB } })).id;

  const category = await prisma.category.create({ data: { name: `${TAG} فئة` } });
  levelId = (
    await prisma.level.create({
      data: { name: `${TAG} مستوى`, categoryId: category.id, genderRestriction: 'any' },
    })
  ).id;
  otherLevelId = (
    await prisma.level.create({
      data: { name: `${TAG} مستوى آخر`, categoryId: category.id, genderRestriction: 'any' },
    })
  ).id;
  subjectId = (await prisma.subject.create({ data: { name: `${TAG} مادة` } })).id;
  untaughtSubjectId = (await prisma.subject.create({ data: { name: `${TAG} مادة غير مقررة` } })).id;
  await prisma.levelSubject.create({ data: { levelId, subjectId } });

  groupA = (
    await prisma.administrativeGroup.create({
      data: { name: `${TAG} مجموعة أ`, levelId, branchId: branchA },
    })
  ).id;
  // At the OTHER branch, deliberately: the audience must sit where the exam is.
  groupB = (
    await prisma.administrativeGroup.create({
      data: { name: `${TAG} مجموعة ب`, levelId, branchId: branchB },
    })
  ).id;

  academicYearId = (await prisma.academicYear.create({ data: { label: YEAR_LABEL } })).id;

  supervisorId = await makeUser('مؤطرة');
  assistantId = await makeUser('مساعدة');
  superAdmin = bearer(await makeUser('مديرة عامة'), [{ role: 'super_admin', branches: null }]);
  adminToken = bearer(await makeUser('مديرة فرع'), [{ role: 'admin', branches: null }]);
  parentToken = bearer(await makeUser('والدة'), [{ role: 'parent', branches: null }]);
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

/** A distinct date per exam, so nothing here collides by accident. */
let dayIndex = 0;
function body(over: Record<string, unknown> = {}): Record<string, unknown> {
  dayIndex += 1;
  return {
    mode: 'physical',
    title: `${TAG} امتحان`,
    date: `2099-03-${String(dayIndex).padStart(2, '0')}`,
    start_time: '09:00',
    end_time: '11:00',
    level_id: levelId,
    subject_id: subjectId,
    academic_year_id: academicYearId,
    branch_id: branchA,
    room_id: roomA,
    staff: [
      { user_id: supervisorId, position: 'supervisor' },
      { user_id: assistantId, position: 'assistant' },
    ],
    ...over,
  };
}

async function createExam(over: Record<string, unknown> = {}): Promise<string> {
  const res = await call('POST', '/exams', superAdmin, body(over));
  expect(res.status).toBe(201);
  return res.body['id'] as string;
}

/** Reads the row back through the API — never trusts a status code (R57). */
async function fetchExam(id: string): Promise<Record<string, unknown>> {
  const res = await call('GET', `/exams?page_size=100`, superAdmin);
  expect(res.status).toBe(200);
  const row = (res.body.data ?? []).find((r) => r['id'] === id);
  expect(row, 'exam not present in the list').toBeDefined();
  return row!;
}

describe('POST /exams', () => {
  it('creates a physical sitting and publishes names beside every id', async () => {
    const id = await createExam();
    const row = await fetchExam(id);

    expect(Object.keys(row).sort()).toEqual(EXAM_KEYS);
    expect(row['mode']).toBe('physical');
    // TD-11 — a calendar date and a wall-clock window, never an instant.
    expect(row['date']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(row['start_time']).toBe('09:00');
    expect(row['end_time']).toBe('11:00');
    // A timetable cannot be read from ids (R55.1).
    expect(row['branch_name']).toContain('فرع أ');
    expect(row['room_name']).toContain('قاعة أ');
    expect(row['level_name']).toContain('مستوى');
    expect(row['subject_name']).toContain('مادة');
  });

  it('treats a missing group as THE WHOLE LEVEL, not as a gap', async () => {
    const id = await createExam({ administrative_group_id: null });
    const row = await fetchExam(id);

    expect(row['administrative_group_id']).toBeNull();
    expect(row['administrative_group_name']).toBeNull();
    // The Level is still named, which is what makes the null readable.
    expect(row['level_name']).toContain('مستوى');
  });

  it('refuses `online` with a coded reason rather than a generic error', async () => {
    const res = await call('POST', '/exams', superAdmin, body({ mode: 'online' }));

    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe('STATE_CONFLICT');
    // The code is the point: a client learns WHICH capability is missing.
    expect(res.body.error?.details?.['reason']).toBe('ONLINE_NOT_AVAILABLE');
    // And nothing was written — a refusal is not a half-create.
    expect(await prisma.exam.count({ where: { title: { startsWith: TAG }, mode: 'online' } })).toBe(0);
  });

  it('refuses a subject the level does not teach, under the platform-wide name', async () => {
    const res = await call('POST', '/exams', superAdmin, body({ subject_id: untaughtSubjectId }));

    expect(res.status).toBe(409);
    // `policies/curriculum.ts` owns this rule for every surface — an exam must
    // not invent a second spelling of it.
    expect(res.body.error?.details?.['reason']).toBe('SUBJECT_NOT_IN_LEVEL');
  });

  it('refuses a room at another branch, under the name sessions already use', async () => {
    const res = await call('POST', '/exams', superAdmin, body({ room_id: roomB }));

    expect(res.status).toBe(400);
    expect(res.body.error?.details?.['reason']).toBe('ROOM_BRANCH_MISMATCH');
  });

  it('refuses a group that does not sit at this branch and level', async () => {
    const atOtherBranch = await call(
      'POST',
      '/exams',
      superAdmin,
      body({ administrative_group_id: groupB }),
    );
    expect(atOtherBranch.status).toBe(400);
    // The audience-elsewhere rule, under the code §4.4 already gives it.
    expect(atOtherBranch.body.error?.details?.['reason']).toBe('BRANCH_MISMATCH');

    const atOtherLevel = await call(
      'POST',
      '/exams',
      superAdmin,
      body({ level_id: otherLevelId, subject_id: subjectId }),
    );
    // The other Level teaches nothing, so the curriculum rule answers first.
    expect(atOtherLevel.status).toBe(409);
    expect(atOtherLevel.body.error?.details?.['reason']).toBe('SUBJECT_NOT_IN_LEVEL');
  });

  it('refuses a parent and an anonymous caller', async () => {
    expect((await call('POST', '/exams', parentToken, body())).status).toBe(403);
    expect((await call('POST', '/exams', undefined, body())).status).toBe(401);
  });
});

describe('PATCH /exams/{id}', () => {
  it('renames and re-times the sitting — verified by READING THE ROW', async () => {
    const id = await createExam();
    const before = await fetchExam(id);

    const res = await call('PATCH', `/exams/${id}`, superAdmin, {
      version: before['version'],
      title: `${TAG} امتحان مُعاد جدولته`,
      description: 'قاعة الامتحان تفتح قبل ربع ساعة',
      date: '2099-04-20',
      start_time: '14:00',
      end_time: '16:00',
    });
    expect(res.status).toBe(204);

    const after = await fetchExam(id);
    // R57's defect was a `200` that changed nothing. Only the row proves it.
    expect(after['title']).toBe(`${TAG} امتحان مُعاد جدولته`);
    expect(after['description']).toBe('قاعة الامتحان تفتح قبل ربع ساعة');
    expect(after['date']).toBe('2099-04-20');
    expect(after['start_time']).toBe('14:00');
    expect(after['end_time']).toBe('16:00');
    expect(after['version']).toBe((before['version'] as number) + 1);
  });

  it('REFUSES the identity fields rather than silently dropping them', async () => {
    const id = await createExam();
    const row = await fetchExam(id);

    for (const patch of [
      { mode: 'online' },
      { level_id: otherLevelId },
      { subject_id: untaughtSubjectId },
      { branch_id: branchB },
      { academic_year_id: academicYearId },
    ]) {
      const res = await call('PATCH', `/exams/${id}`, superAdmin, {
        version: row['version'],
        ...patch,
      });
      // A drop would return 204 and leave the caller believing it worked. The
      // schema is `.strict()`, so the refusal is a 400 naming the field.
      expect(res.status, `expected ${JSON.stringify(patch)} to be refused`).toBe(400);
    }

    // Nothing moved, including the version — a refused write is not a write.
    expect(await fetchExam(id)).toEqual(row);
  });

  it('replaces the staff wholesale and can clear the group back to the level', async () => {
    const id = await createExam({ administrative_group_id: groupA });
    const before = await fetchExam(id);
    expect((before['staff'] as unknown[]).length).toBe(2);

    const res = await call('PATCH', `/exams/${id}`, superAdmin, {
      version: before['version'],
      administrative_group_id: null,
      staff: [{ user_id: assistantId, position: 'supervisor' }],
    });
    expect(res.status).toBe(204);

    const after = await fetchExam(id);
    expect(after['administrative_group_id']).toBeNull();
    expect(after['staff']).toEqual([{ user_id: assistantId, position: 'supervisor' }]);
  });

  it('refuses a stale version (TD-15)', async () => {
    const id = await createExam();
    const row = await fetchExam(id);
    // A version the row has never held. `version - 1` would be `-1` on a fresh
    // row, which the validator refuses first and would test the wrong thing.
    const wrong = (row['version'] as number) + 1;

    const res = await call('PATCH', `/exams/${id}`, superAdmin, { version: wrong, title: 'x' });
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe('VERSION_CONFLICT');
  });
});

describe('DELETE /exams/{id}', () => {
  it('soft-deletes with a Trash snapshot and drops out of the list', async () => {
    const id = await createExam();

    expect((await call('DELETE', `/exams/${id}`, superAdmin)).status).toBe(204);

    const list = await call('GET', '/exams?page_size=100', superAdmin);
    expect((list.body.data ?? []).some((r) => r['id'] === id)).toBe(false);

    // TD-5 — the row survives, and the tombstone names what was removed.
    const row = await prisma.exam.findUnique({ where: { id } });
    expect(row?.deletedAt).not.toBeNull();
    expect(await prisma.trash.count({ where: { targetId: id } })).toBe(1);
  });

  it('refuses a parent', async () => {
    const id = await createExam();
    expect((await call('DELETE', `/exams/${id}`, parentToken)).status).toBe(403);
  });
});

describe('GET /exams', () => {
  it('filters by branch, level and date window', async () => {
    const mine = await createExam({ date: '2099-05-10' });
    const elsewhere = await createExam({ date: '2099-05-11', branch_id: branchB, room_id: roomB });

    const byBranch = await call('GET', `/exams?branch_id=${branchA}&page_size=100`, superAdmin);
    const ids = (byBranch.body.data ?? []).map((r) => r['id']);
    expect(ids).toContain(mine);
    expect(ids).not.toContain(elsewhere);

    const window = await call(
      'GET',
      `/exams?from=2099-05-11&to=2099-05-11&page_size=100`,
      superAdmin,
    );
    const windowIds = (window.body.data ?? []).map((r) => r['id']);
    expect(windowIds).toContain(elsewhere);
    expect(windowIds).not.toContain(mine);

    const byLevel = await call('GET', `/exams?level_id=${otherLevelId}&page_size=100`, superAdmin);
    expect((byLevel.body.data ?? []).map((r) => r['id'])).not.toContain(mine);
  });
});

describe('GET /calendar', () => {
  it('shows the sitting as its own kind, on its own date', async () => {
    const id = await createExam({ date: '2099-06-15', start_time: '08:30', end_time: '10:30' });

    const res = await call('GET', '/calendar?from=2099-06-01&to=2099-06-30', superAdmin);
    expect(res.status).toBe(200);

    const rows = (res.body['occurrences'] ?? res.body.data ?? []) as Record<string, unknown>[];
    const mine = rows.find((r) => r['id'] === id);
    expect(mine, 'exam missing from the calendar').toBeDefined();
    // R58 — a third kind, so the grid can colour it apart from a class.
    expect(mine!['kind']).toBe('exam');
    expect(mine!['date']).toBe('2099-06-15');
    expect(mine!['start_time']).toBe('08:30');
    // An exam repeats nothing and nobody teaches it — absent, not invented.
    expect(mine!['recurrence']).toBeNull();
    expect(mine!['instructors']).toEqual([]);
    // Every id on the grid arrives with its name (R55.1) — the category came
    // through as a bare id until this suite read the row.
    expect(mine!['category_id']).not.toBeNull();
    expect(mine!['category_name']).toContain('فئة');
    expect(mine!['level_name']).toContain('مستوى');
  });

  it('narrows exams by category, as it narrows sessions', async () => {
    const id = await createExam({ date: '2099-06-16' });
    const category = await prisma.level.findUniqueOrThrow({
      where: { id: levelId },
      select: { categoryId: true },
    });

    const inside = await call(
      'GET',
      `/calendar?from=2099-06-01&to=2099-06-30&category_id=${category.categoryId}`,
      superAdmin,
    );
    const rows = (inside.body.data ?? []) as Record<string, unknown>[];
    expect(rows.some((r) => r['id'] === id)).toBe(true);
  });
});

describe('an exam is restorable, and comes back whole (R59.3)', () => {
  it('reinstates the supervising staff removed with it', async () => {
    const id = await createExam();
    const before = await fetchExam(id);
    expect((before['staff'] as unknown[]).length).toBe(2);

    expect((await call('DELETE', `/exams/${id}`, superAdmin)).status).toBe(204);

    const trash = await call('GET', '/admin/trash?entity=Exam&page_size=100', superAdmin);
    const entry = (trash.body.data ?? []).find((r) => r['target_id'] === id);
    expect(entry, 'the exam is missing from the Trash').toBeDefined();
    // R59.3 moved it out of NOT_YET_SUPPORTED, and the server says so per row.
    expect(entry!['restorable']).toBe(true);

    expect((await call('POST', `/admin/trash/${entry!['id']}/restore`, superAdmin)).status).toBe(200);

    const after = await fetchExam(id);
    // **The assertion this test exists for.** The exam itself came back on the
    // first attempt; the staff did not, because the child rows were tombstoned a
    // few milliseconds before the Trash entry and fell outside the window. A
    // restored exam with nobody supervising it is precisely the half-restore §7
    // warns about, and it is invisible unless something reads the staff back.
    expect(after['staff']).toEqual(before['staff']);
  });

  it('refuses an Admin restoring or destroying it — the Trash is Super Admin only', async () => {
    const id = await createExam();
    await call('DELETE', `/exams/${id}`, superAdmin);
    const trash = await call('GET', '/admin/trash?entity=Exam&page_size=100', superAdmin);
    const entry = (trash.body.data ?? []).find((r) => r['target_id'] === id)!;

    // The exam's own DELETE is an Admin capability; the Trash's verbs are not.
    expect((await call('POST', `/admin/trash/${entry['id']}/restore`, adminToken)).status).toBe(403);
    expect((await call('DELETE', `/admin/trash/${entry['id']}`, adminToken)).status).toBe(403);

    const row = await prisma.exam.findUnique({ where: { id } });
    expect(row?.deletedAt).not.toBeNull();
  });
});
