import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { issueAccessToken } from '../lib/access-token.js';
import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import { httpCall } from '../test-support/http-client.js';

/**
 * Recurring Course Schedules over real HTTP (TD-3.12, §4.4, Revision 43).
 *
 * **Three things are only observable at this layer.** TD-11's wall-clock/instant
 * split is a *wire* property — a service test passes `Date` objects and never
 * sees whether `15:00` survives the round trip as a clock reading or arrives as
 * a timezone-shifted instant. The single-target contract (`teaching_mode` +
 * `target_id` rather than three nullable columns) exists only in the DTO. And
 * `materialization` travelling with a write is a decision about what a response
 * owes an administrator, which no service assertion can make.
 *
 * Requires the compose stack, with the api image built from current source:
 *   docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build api
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = '[http-course-schedule-test]';

const SCHEDULE_KEYS = [
  'academic_year_id',
  'anchor_date',
  'branch_id',
  // R55.1 — resolved labels, so a timetable can be rendered without five
  // further requests. Labels only; the ids above stay the identifiers.
  'branch_name',
  'day_of_month',
  // R57 — the class's own name and note. Labels, never identifiers.
  'description',
  // R55 — R50's bound reaches the contract; `null` is open-ended.
  'effective_until',
  'end_time',
  'id',
  'month_of_year',
  'recurrence',
  'room_id',
  'room_name',
  'staff',
  'start_time',
  'subject_id',
  'subject_name',
  'target_id',
  'target_name',
  'teaching_mode',
  'title',
  'version',
  'weekdays',
];
/** A write nests the schedule beside what it did to the timetable. */
const WRITE_KEYS = ['materialization', 'schedule'];
const MATERIALIZATION_KEYS = ['created', 'existing', 'protected_sessions', 'resynced'];
const CONFLICT_KEYS = ['date', 'kind', 'resource_id', 'schedule_id', 'session_id'];

interface Res {
  status: number;
  body: Record<string, unknown> & {
    error?: { code?: string; details?: Record<string, unknown> };
    data?: Record<string, unknown>[];
    conflicts?: Record<string, unknown>[];
    students?: Record<string, unknown>[];
    materialization?: Record<string, unknown>;
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

async function makeUser(label: string, sex: 'female' | null = null): Promise<string> {
  const u = await prisma.user.create({
    data: { nameArabic: `${TAG} ${label}`, accountStatus: 'active', ...(sex ? { sex } : {}) },
  });
  return u.id;
}

let superAdmin: string;
let scopedAdmin: string;
let teacherToken: string;
let staffingTeacherToken: string;
let branchA: string;
let branchB: string;
let roomA: string;
let levelId: string;
let subjectId: string;
let groupA: string;
let groupB: string;
let academicYearId: string;
let teacherId: string;
let studentA: string;

/** A term that certainly contains future dates, so materialization has work to do. */
const YEAR_LABEL = '2099-2100';

async function clear(): Promise<void> {
  const schedules = await prisma.recurringCourseSchedule.findMany({
    where: { branch: { name: { startsWith: TAG } } },
    select: { id: true },
  });
  const ids = schedules.map((s) => s.id);
  // `session_staff` is RESTRICT against `session` (TD-5): a session's staffing
  // is part of the record of what happened, so it never disappears silently
  // beneath it. The fixture therefore unwinds in the same order.
  await prisma.sessionStaff.deleteMany({ where: { session: { scheduleId: { in: ids } } } });
  await prisma.session.deleteMany({ where: { scheduleId: { in: ids } } });
  await prisma.courseScheduleStaff.deleteMany({ where: { scheduleId: { in: ids } } });
  if (ids.length > 0) {
    await prisma.trash.deleteMany({ where: { targetId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { targetId: { in: ids } } });
  }
  await prisma.recurringCourseSchedule.deleteMany({ where: { id: { in: ids } } });

  const levels = await prisma.level.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  const levelIds = levels.map((l) => l.id);
  const groups = await prisma.administrativeGroup.findMany({
    where: { levelId: { in: levelIds } },
    select: { id: true },
  });
  await prisma.enrollment.deleteMany({
    where: { administrativeGroupId: { in: groups.map((g) => g.id) } },
  });
  await prisma.administrativeGroup.deleteMany({ where: { id: { in: groups.map((g) => g.id) } } });
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
    await prisma.trash.deleteMany({ where: { deletedById: { in: userIds } } });
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
  roomA = (await prisma.room.create({ data: { name: `${TAG} قاعة`, branchId: branchA } })).id;

  const category = await prisma.category.create({ data: { name: `${TAG} فئة` } });
  levelId = (
    await prisma.level.create({
      data: { name: `${TAG} مستوى`, categoryId: category.id, genderRestriction: 'any' },
    })
  ).id;
  subjectId = (await prisma.subject.create({ data: { name: `${TAG} مادة` } })).id;
  await prisma.levelSubject.create({ data: { levelId, subjectId } });

  groupA = (
    await prisma.administrativeGroup.create({
      data: { name: `${TAG} مجموعة أ`, levelId, branchId: branchA },
    })
  ).id;
  groupB = (
    await prisma.administrativeGroup.create({
      data: { name: `${TAG} مجموعة ب`, levelId, branchId: branchB },
    })
  ).id;

  // Not marked current: `horizonFor` falls back to one year out, which is all
  // this suite needs and avoids competing with whatever the database already
  // considers the live academic year.
  academicYearId = (await prisma.academicYear.create({ data: { label: YEAR_LABEL } })).id;

  teacherId = await makeUser('أستاذ');
  studentA = await makeUser('طالبة أ', 'female');
  await prisma.enrollment.create({
    // R66 — the enrolment carries its own branch.
    data: { studentId: studentA, administrativeGroupId: groupA, levelId, branchId: branchA },
  });

  superAdmin = bearer(await makeUser('مدير عام'), [{ role: 'super_admin', branches: null }]);
  scopedAdmin = bearer(await makeUser('مدير فرع'), [{ role: 'admin', branches: [branchA] }]);
  teacherToken = bearer(await makeUser('أستاذة'), [{ role: 'teacher', branches: null }]);
  // The teacher who actually staffs `teacherId`'s schedules — the fixture wires
  // `teacherId` into every scheduleBody() as staff.
  staffingTeacherToken = bearer(teacherId, [{ role: 'teacher', branches: null }]);
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

/**
 * A distinct clock window per schedule.
 *
 * Every schedule here books the same room on the same weekday, so without this
 * the second create in the file legitimately collides with the first and TD-4.6c
 * refuses it — the conflict detection working, reported as a broken fixture. The
 * tests that *want* a clash ask for one explicitly.
 */
let slotIndex = 0;
function slot(): { start_time: string; end_time: string } {
  // Starts at 00:00 in 15-minute steps, deliberately: the TD-11 test pins an
  // explicit 15:00–16:30 schedule in this same room and weekday, and an
  // allocator that walks up to 15:00 eventually collides with it. Adding tests
  // is what surfaced that — the allocator was fine until the count grew.
  const minutes = slotIndex++ * 15;
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  const end = minutes + 10;
  return {
    start_time: `${hh}:${mm}`,
    end_time: `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`,
  };
}

function scheduleBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    // R57 — a class carries its own name.
    title: `${TAG} حلقة`,
    subject_id: subjectId,
    teaching_mode: 'administrative_group',
    target_id: groupA,
    branch_id: branchA,
    room_id: roomA,
    ...slot(),
    recurrence: 'weekly',
    weekdays: ['tuesday'],
    academic_year_id: academicYearId,
    staff: [{ user_id: teacherId, position: 'teacher' }],
    ...over,
  };
}

describe('the response is an explicit contract DTO (§16.2)', () => {
  it('POST returns the schedule plus what it did to the timetable', async () => {
    const res = await call('POST', '/admin/course-schedules', superAdmin, scheduleBody());
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(WRITE_KEYS);
    // The schedule keeps exactly the shape it has in a list row — one renderer
    // serves both, and a flattened near-copy is what would drift.
    expect(Object.keys(res.body.schedule as object).sort()).toEqual(SCHEDULE_KEYS);
    expect(Object.keys(res.body.materialization!).sort()).toEqual(MATERIALIZATION_KEYS);
    // A write that reported only `created` would claim the timetable is
    // consistent when part of it deliberately is not (§4.4, R43.6).
    expect(Array.isArray(res.body.materialization!['protected_sessions'])).toBe(true);
    expect(res.body.materialization!['created']).toBeGreaterThan(0);
  });

  it('collapses the three target columns into one mode + one target (§4.4c)', async () => {
    const res = await call('POST', '/admin/course-schedules', superAdmin, scheduleBody());
    const schedule = res.body.schedule as Record<string, unknown>;
    expect(schedule['teaching_mode']).toBe('administrative_group');
    expect(schedule['target_id']).toBe(groupA);
    // A response holding two of these would have no correct reading.
    for (const column of ['level_id', 'administrative_group_id', 'teaching_group_id']) {
      expect(schedule).not.toHaveProperty(column);
    }
  });

  it('renders times as TD-11 wall-clock, never as an instant', async () => {
    const res = await call(
      'POST',
      '/admin/course-schedules',
      superAdmin,
      scheduleBody({ start_time: '15:00', end_time: '16:30' }),
    );
    // A class starts at 15:00 at its branch. An ISO instant here would invite a
    // client to shift it — the exact bug TD-11 exists to prevent.
    const schedule = res.body.schedule as Record<string, unknown>;
    expect(schedule['start_time']).toBe('15:00');
    expect(schedule['end_time']).toBe('16:30');
    expect(String(schedule['start_time'])).not.toContain('T');
    expect(String(schedule['start_time'])).not.toContain('Z');
  });

  it('exposes no internal column and no camelCase original', async () => {
    const list = await call('GET', '/admin/course-schedules', superAdmin);
    expect(list.status).toBe(200);
    for (const row of list.body.data!) {
      expect(Object.keys(row).sort()).toEqual(SCHEDULE_KEYS);
      for (const internal of ['created_at', 'updated_at', 'deleted_at', 'deleted_by']) {
        expect(row).not.toHaveProperty(internal);
      }
      for (const camel of ['startTime', 'branchId', 'academicYearId', 'teachingMode']) {
        expect(row).not.toHaveProperty(camel);
      }
    }
  });

  it('paginates per TD-10', async () => {
    const res = await call('GET', '/admin/course-schedules?page=1&page_size=1', superAdmin);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta).toMatchObject({ page: 1, page_size: 1 });
  });
});

describe('the write boundary refuses what would re-point history', () => {
  it('rejects an ISO instant where a wall-clock time belongs', async () => {
    const res = await call(
      'POST',
      '/admin/course-schedules',
      superAdmin,
      scheduleBody({ start_time: '2099-09-01T15:00:00Z' }),
    );
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('VALIDATION_FAILED');
  });

  it('rejects a second target rather than dropping it', async () => {
    // One field cannot be ambiguous; two can, and the CHECK constraint would
    // report the ambiguity as a raw violation instead of a refusal.
    const res = await call(
      'POST',
      '/admin/course-schedules',
      superAdmin,
      scheduleBody({ level_id: levelId }),
    );
    expect(res.status).toBe(400);
  });

  it('refuses to change the subject, target, branch or academic year on PATCH', async () => {
    const created = await call('POST', '/admin/course-schedules', superAdmin, scheduleBody());
    for (const move of [
      { subject_id: subjectId },
      { target_id: groupB },
      { teaching_mode: 'entire_level' },
      { branch_id: branchB },
      { academic_year_id: academicYearId },
    ]) {
      const res = await call('PATCH', `/admin/course-schedules/${(created.body.schedule as { id: string }).id}`, superAdmin, {
        version: (created.body.schedule as { version: number }).version,
        ...move,
      });
      expect(res.status).toBe(400);
    }
  });

  it('refuses a target at another branch (§4.4 BRANCH_MISMATCH)', async () => {
    // A room at one branch cannot serve students at another.
    const res = await call(
      'POST',
      '/admin/course-schedules',
      superAdmin,
      scheduleBody({ target_id: groupB }),
    );
    expect(res.status).toBe(400);
    expect(res.body.error?.details?.['reason']).toBe('BRANCH_MISMATCH');
  });

  it('TD-15: a stale version is a 409, not a silent overwrite', async () => {
    const created = await call('POST', '/admin/course-schedules', superAdmin, scheduleBody());
    const first = await call('PATCH', `/admin/course-schedules/${(created.body.schedule as { id: string }).id}`, superAdmin, {
      version: (created.body.schedule as { version: number }).version,
      start_time: '20:00',
      end_time: '21:00',
    });
    expect(first.status).toBe(200);
    expect((first.body.schedule as { start_time: string }).start_time).toBe('20:00');

    const stale = await call('PATCH', `/admin/course-schedules/${(created.body.schedule as { id: string }).id}`, superAdmin, {
      version: (created.body.schedule as { version: number }).version,
      start_time: '21:30',
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error?.code).toBe('VERSION_CONFLICT');
  });

  it('an edit reports what it left alone as well as what it rewrote', async () => {
    const created = await call('POST', '/admin/course-schedules', superAdmin, scheduleBody());
    const patched = await call('PATCH', `/admin/course-schedules/${(created.body.schedule as { id: string }).id}`, superAdmin, {
      version: (created.body.schedule as { version: number }).version,
      start_time: '22:00',
      end_time: '23:00',
    });
    expect(patched.status).toBe(200);
    // R43.4: without `resynced`, an edit changed nothing about the occurrences
    // that already existed and §4.4's promise was not true.
    expect(Object.keys(patched.body.materialization!).sort()).toEqual(MATERIALIZATION_KEYS);
    expect(patched.body.materialization!['resynced']).toBeGreaterThan(0);
  });
});

describe('the routes are mounted and guarded (TD-2)', () => {
  it('refuses an anonymous caller, and serves a teacher their own scope', async () => {
    const anon = await call('GET', '/admin/course-schedules');
    expect(anon.status).toBe(401);
    expect(anon.body.error?.code).toBe('AUTH_REQUIRED');

    // This assertion used to demand 403 for any teacher. The Document Owner
    // decided (2026-08-05) that `/admin/` is a routing namespace rather than an
    // authorization boundary, so a Teacher READS this endpoint scoped to the
    // schedules they staff — see the role-scoped block at the foot of this file.
    // A teacher staffing nothing gets an empty list, which is a different fact
    // from being refused.
    const teacher = await call('GET', '/admin/course-schedules', teacherToken);
    expect(teacher.status).toBe(200);
    expect(teacher.body.data).toEqual([]);
  });

  it('a branch-scoped Admin sees their own branch only', async () => {
    await prisma.recurringCourseSchedule.create({
      data: {
title: `${TAG} حلقة`,
        subjectId,
        teachingMode: 'administrative_group',
        administrativeGroupId: groupB,
        branchId: branchB,
        startTime: new Date('1970-01-01T09:00:00Z'),
        endTime: new Date('1970-01-01T10:00:00Z'),
        recurrence: 'weekly',
        weekdays: ['monday'],
        academicYearId,
      },
    });

    const res = await call('GET', '/admin/course-schedules', scopedAdmin);
    const branches = new Set(res.body.data!.map((s) => s.branch_id));
    expect(branches.has(branchA)).toBe(true);
    expect(branches.has(branchB)).toBe(false);
  });

  it('a schedule outside scope is 404, never 403 (§20 rule 17)', async () => {
    const inB = await prisma.recurringCourseSchedule.findFirstOrThrow({
      where: { branchId: branchB },
      select: { id: true },
    });
    for (const path of [
      `/admin/course-schedules/${inB.id}/roster`,
      `/admin/course-schedules/${inB.id}/conflicts`,
    ]) {
      const res = await call('GET', path, scopedAdmin);
      expect(res.status).toBe(404);
      expect(res.body.error?.code).toBe('NOT_FOUND');
    }
  });
});

describe('conflicts and the resolved roster', () => {
  it('reports a room clash found against MATERIALIZED sessions', async () => {
    const booked = slot();
    const first = await call(
      'POST',
      '/admin/course-schedules',
      superAdmin,
      scheduleBody(booked),
    );
    expect(first.status).toBe(201);

    // Same room, same weekday, overlapping clock window. Comparing recurrence
    // rules could not decide this; comparing materialized dates can.
    const clash = await call(
      'POST',
      '/admin/course-schedules',
      superAdmin,
      scheduleBody(booked),
    );
    expect(clash.status).toBe(409);
    // Its own code, not the generic STATE_CONFLICT: a booking clash names a
    // room or a person the administrator has to free, which is a different
    // remedy from any other 409 in the catalogue.
    expect(clash.body.error?.code).toBe('SCHEDULE_CONFLICT');

    const preview = await call(
      'GET',
      `/admin/course-schedules/${(first.body.schedule as { id: string }).id}/conflicts`,
      superAdmin,
    );
    expect(preview.status).toBe(200);
    expect(Array.isArray(preview.body.conflicts)).toBe(true);
    if (preview.body.conflicts!.length > 0) {
      expect(Object.keys(preview.body.conflicts![0]!).sort()).toEqual(CONFLICT_KEYS);
    }
  });

  it('resolves the audience live, and drops an un-enrolled student immediately', async () => {
    const created = await call('POST', '/admin/course-schedules', superAdmin, scheduleBody());

    const before = await call(
      'GET',
      `/admin/course-schedules/${(created.body.schedule as { id: string }).id}/roster`,
      superAdmin,
    );
    expect(before.status).toBe(200);
    expect(before.body.students!.map((s) => s.student_id)).toContain(studentA);
    expect(Object.keys(before.body.students![0]!).sort()).toEqual(['name', 'student_id']);

    // There is no stored roster to drift: the next request re-resolves.
    await prisma.enrollment.updateMany({
      where: { studentId: studentA },
      data: { deletedAt: new Date() },
    });
    const after = await call(
      'GET',
      `/admin/course-schedules/${(created.body.schedule as { id: string }).id}/roster`,
      superAdmin,
    );
    expect(after.body.students!.map((s) => s.student_id)).not.toContain(studentA);

    await prisma.enrollment.updateMany({
      where: { studentId: studentA },
      data: { deletedAt: null },
    });
  });
});

describe('deletion reports what it kept (§4.4, TD-5)', () => {
  it('answers 200 with future_removed and retained', async () => {
    const created = await call('POST', '/admin/course-schedules', superAdmin, scheduleBody());
    const res = await call('DELETE', `/admin/course-schedules/${(created.body.schedule as { id: string }).id}`, superAdmin);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['future_removed', 'retained']);
    // Sessions holding data whose loss would change historical truth survive the
    // schedule that created them; an administrator expecting a clear timetable
    // needs the count, and it is unavailable afterwards.
    expect(res.body.future_removed).toBeGreaterThan(0);

    const row = await prisma.recurringCourseSchedule.findUniqueOrThrow({
      where: { id: (created.body.schedule as { id: string }).id },
      select: { deletedAt: true },
    });
    expect(row.deletedAt).not.toBeNull();
  });
});

/* ── Role-scoped reads on ONE endpoint (Document Owner decision, 2026-08-05) ── */

describe('a Teacher reads the schedules they staff, through the same endpoint', () => {
  it('lists only their own, and never another teacher’s', async () => {
    // `/admin/` is a routing namespace, not an authorization boundary. The
    // representation a teacher needs is byte-identical to an administrator's,
    // so it is the same route with role-scoped data rather than a second one
    // returning the same shape.
    const mine = await call('POST', '/admin/course-schedules', superAdmin, scheduleBody());
    expect(mine.status).toBe(201);
    const mineId = (mine.body.schedule as { id: string }).id;

    // Staffed by nobody in this suite's teacher fixture.
    const theirs = await call(
      'POST',
      '/admin/course-schedules',
      superAdmin,
      scheduleBody({ staff: [] }),
    );
    expect(theirs.status).toBe(201);
    const theirsId = (theirs.body.schedule as { id: string }).id;

    const res = await call('GET', '/admin/course-schedules?page_size=100', staffingTeacherToken);
    expect(res.status).toBe(200);
    const ids = res.body.data!.map((r) => r.id);
    expect(ids).toContain(mineId);
    expect(ids).not.toContain(theirsId);
  });

  it('a teacher who staffs nothing sees an empty list, not a 403', async () => {
    // Empty is the honest answer: they may read this resource, and their scope
    // resolves to nothing. A 403 would say they may not ask the question.
    const res = await call('GET', '/admin/course-schedules', teacherToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('an explicit filter can NARROW a teacher’s reach but never widen it', async () => {
    const res = await call(
      'GET',
      `/admin/course-schedules?branch_id=${branchB}&page_size=100`,
      staffingTeacherToken,
    );
    expect(res.status).toBe(200);
    // They staff nothing at branch B, and asking for it does not reach past
    // their own scope — both conditions must hold.
    expect(res.body.data).toEqual([]);
  });

  it('reads the roster of a schedule they staff, and 404s on one they do not', async () => {
    // §5.6 line 753 grants roster access to the audience of a schedule they
    // staff. A schedule they do not staff is NOT FOUND rather than
    // found-and-refused (§20 rule 17).
    const mine = await call('POST', '/admin/course-schedules', superAdmin, scheduleBody());
    const theirs = await call(
      'POST',
      '/admin/course-schedules',
      superAdmin,
      scheduleBody({ staff: [] }),
    );

    const ok = await call(
      'GET',
      `/admin/course-schedules/${(mine.body.schedule as { id: string }).id}/roster`,
      staffingTeacherToken,
    );
    expect(ok.status).toBe(200);

    const denied = await call(
      'GET',
      `/admin/course-schedules/${(theirs.body.schedule as { id: string }).id}/roster`,
      staffingTeacherToken,
    );
    expect(denied.status).toBe(404);
    expect(denied.body.error?.code).toBe('NOT_FOUND');
  });

  it('still cannot create, edit, delete, or preview conflicts', async () => {
    // §14.1: teachers "do not create or edit schedules". Widening the READ did
    // not widen the write — that distinction is the whole point of scoping by
    // role rather than by route.
    const created = await call('POST', '/admin/course-schedules', superAdmin, scheduleBody());
    const id = (created.body.schedule as { id: string }).id;
    const version = (created.body.schedule as { version: number }).version;

    expect((await call('POST', '/admin/course-schedules', staffingTeacherToken, scheduleBody())).status).toBe(403);
    expect(
      (await call('PATCH', `/admin/course-schedules/${id}`, staffingTeacherToken, { version, start_time: '21:00' })).status,
    ).toBe(403);
    expect((await call('DELETE', `/admin/course-schedules/${id}`, staffingTeacherToken)).status).toBe(403);
    expect((await call('GET', `/admin/course-schedules/${id}/conflicts`, staffingTeacherToken)).status).toBe(403);
  });

  it('refuses a caller who is neither admin nor teaching staff', async () => {
    const outsider = bearer(await makeUser('زائرة'), []);
    const res = await call('GET', '/admin/course-schedules', outsider);
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe('FORBIDDEN');
  });
});
