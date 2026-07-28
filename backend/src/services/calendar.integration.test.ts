import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import type { RoleScope } from '../policies/branch-scope.js';
import {
  expandEvent,
  expandGroup,
  readCalendar,
  type CalendarActor,
  type Occurrence,
} from './calendar.service.js';
import { createEvent } from './event.service.js';
import { assignTeacher, createGroup, type Actor } from './group.service.js';

/**
 * Calendar read — §4.4, TD-3.4, TD-11, §19.2.
 *
 * Two things are proven here that nothing else covers: the **three visibility
 * tiers** resolved server-side for every kind of caller including anonymous, and
 * the **§19.2 Ramadan DST regression** — a wall-clock time must survive
 * Morocco's clock shift unchanged.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = '[calendar-test]';

let levelId: string;
let actorUserId: string;

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const TODAY = day('2026-06-01');

const staffActor = (scopes: RoleScope[]): Actor => ({
  userId: actorUserId,
  roles: scopes.map((s) => s.role),
  roleScopes: scopes,
});
const superAdmin = () => staffActor([{ role: 'super_admin', branches: null }]);

const viewer = (
  userId: string,
  roles: string[],
  branches: string[] | null = null,
  accountStatus = 'active',
): CalendarActor => ({
  userId,
  roles,
  roleScopes: roles.map((role) => ({ role, branches })),
  accountStatus,
});

async function person(label: string): Promise<string> {
  const u = await prisma.user.create({
    data: { nameArabic: `${TAG} ${label}`, accountStatus: 'active' },
  });
  return u.id;
}

async function teacherUser(label: string): Promise<string> {
  const id = await person(label);
  const r = await prisma.role.findUnique({ where: { name: 'teacher' } });
  await prisma.userBranchRole.create({ data: { userId: id, roleId: r!.id, branchId: null } });
  return id;
}

async function makeBranch(name: string, opened = '2020-01-01'): Promise<string> {
  const b = await prisma.branch.create({
    data: { name: `${TAG} ${name}`, operationalStartDate: day(opened) },
  });
  return b.id;
}

async function makeGroup(branchId: string, dayOfWeek = 'monday', hour = 9): Promise<string> {
  const g = await createGroup(prisma, superAdmin(), {
    name: `${TAG} مجموعة ${Math.random().toString(36).slice(2, 7)}`,
    levelId,
    branchId,
    roomId: null,
    dayOfWeek,
    startTime: new Date(Date.UTC(1970, 0, 1, hour, 0)),
    endTime: new Date(Date.UTC(1970, 0, 1, hour + 1, 30)),
    maxStudents: 20,
  });
  return g.id;
}

async function makeEvent(
  visibility: 'public' | 'private' | 'hidden',
  over: Record<string, unknown> = {},
): Promise<string> {
  const created = await createEvent(
    prisma,
    superAdmin(),
    {
      title: `${TAG} ${visibility}`,
      visibility,
      startDate: day('2026-06-15'),
      recurrenceType: 'none',
      ...over,
    } as never,
    TODAY,
  );
  return created.event.id;
}

async function clear(): Promise<void> {
  const events = await prisma.event.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true },
  });
  const eventIds = events.map((e) => e.id);
  await prisma.eventBranch.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.eventCategory.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.eventLevel.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.eventGroup.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.event.deleteMany({ where: { id: { in: eventIds } } });

  const groups = await prisma.group.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  const groupIds = groups.map((g) => g.id);
  await prisma.groupTeacher.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.studentGroup.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.group.deleteMany({ where: { id: { in: groupIds } } });

  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({
    where: { OR: [{ actorUserId: { in: userIds } }, { targetId: { in: eventIds } }] },
  });
  await prisma.groupTeacher.deleteMany({ where: { teacherId: { in: userIds } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeEach(async () => {
  await clear();
  const level = await prisma.level.findFirst({ select: { id: true } });
  levelId = level!.id;
  actorUserId = await person('فاعلة');
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

const range = { from: day('2026-06-01'), to: day('2026-06-30') };

/**
 * The suites share one database, so every assertion is scoped to rows this file
 * created. Asserting on a global result set measures whatever other suites
 * happen to have left behind — a mistake this project has made before.
 */
function scoped(rows: Occurrence[]): Occurrence[] {
  return rows.filter((r) => r.title.startsWith(TAG));
}
const titles = (rows: Occurrence[]): string[] => scoped(rows).map((r) => r.title);

describe('§19.2 — Ramadan DST wall-clock stability (TD-11)', () => {
  it('a weekly 09:00 class stays at 09:00 across Morocco\'s Ramadan clock shift', async () => {
    const branchId = await makeBranch('مراكش');
    await makeGroup(branchId, 'monday', 9);

    // Morocco is UTC+1 year-round but returns to UTC+0 for Ramadan — in 2026
    // roughly mid-February to late March. This range spans BOTH transitions.
    const occurrences = await readCalendar(prisma, viewer(actorUserId, ['super_admin']), {
      from: day('2026-02-01'),
      to: day('2026-04-05'),
    });
    const classes = scoped(occurrences).filter((o) => o.kind === 'group');

    expect(classes.length).toBeGreaterThan(6);
    // Every single occurrence, on both sides of both shifts, reads 09:00. This
    // holds because dates and times are stored as `date`/`time` and never
    // converted to an instant — the property TD-11 exists to guarantee.
    for (const c of classes) {
      expect(c.startTime).toBe('09:00');
      expect(c.endTime).toBe('10:30');
    }
  });

  it('an event\'s time is unchanged across the same span', async () => {
    const branchId = await makeBranch('مراكش');
    await makeEvent('public', {
      startDate: day('2026-02-10'),
      startTime: new Date(Date.UTC(1970, 0, 1, 18, 30)),
      recurrenceType: 'weekly',
      recurrenceEndDate: day('2026-04-05'),
      branchIds: [branchId],
    });

    const rows = await readCalendar(prisma, null, {
      from: day('2026-02-01'),
      to: day('2026-04-05'),
    });
    const ours = scoped(rows);
    expect(ours.length).toBeGreaterThan(5);
    for (const r of ours) expect(r.startTime).toBe('18:30');
  });
});

describe('§4.4 — recurrence expansion', () => {
  const base = { startDate: day('2026-06-01'), endDate: null, recurrenceEndDate: day('2026-06-30') };

  it('none yields a single date; a multi-day span yields every day', () => {
    expect(
      expandEvent({ ...base, recurrenceType: 'none', recurrenceEndDate: null }, range.from, range.to),
    ).toHaveLength(1);
    expect(
      expandEvent(
        { startDate: day('2026-06-01'), endDate: day('2026-06-03'), recurrenceType: 'none', recurrenceEndDate: null },
        range.from,
        range.to,
      ),
    ).toHaveLength(3);
  });

  it('daily, weekly and yearly expand as expected', () => {
    expect(expandEvent({ ...base, recurrenceType: 'daily' }, range.from, range.to)).toHaveLength(30);
    expect(expandEvent({ ...base, recurrenceType: 'weekly' }, range.from, range.to)).toHaveLength(5);
    expect(
      expandEvent(
        { ...base, recurrenceType: 'yearly', recurrenceEndDate: day('2029-01-01') },
        day('2026-01-01'),
        day('2029-01-01'),
      ),
      // 2026, 2027, 2028 — the 2029 occurrence falls on 2029-06-01, after the
      // range ends on 2029-01-01.
    ).toHaveLength(3);
  });

  it('biweekly-alternating is week-on/week-off, not weekly', () => {
    const dates = expandEvent({ ...base, recurrenceType: 'biweekly_alternating' }, range.from, range.to);
    // June 1, 15, 29 — every fourteenth day, half as many as weekly.
    expect(dates.map((d) => d.toISOString().slice(0, 10))).toEqual([
      '2026-06-01',
      '2026-06-15',
      '2026-06-29',
    ]);
  });

  it('recurrence stops at recurrence_end_date, not at the range end', () => {
    const dates = expandEvent(
      { ...base, recurrenceType: 'daily', recurrenceEndDate: day('2026-06-05') },
      range.from,
      range.to,
    );
    expect(dates).toHaveLength(5);
  });

  it('a group expands onto its own weekday only, Monday-based', () => {
    const mondays = expandGroup('monday', day('2026-06-01'), day('2026-06-30'));
    expect(mondays.map((d) => d.getUTCDay())).toEqual([1, 1, 1, 1, 1]);
    expect(expandGroup('sunday', day('2026-06-01'), day('2026-06-30'))).toHaveLength(4);
  });
});

describe('§4.4 — three-tier visibility', () => {
  it('an ANONYMOUS caller sees the public tier only, and no timetable', async () => {
    const branchId = await makeBranch('مراكش');
    await makeGroup(branchId);
    await makeEvent('public', { branchIds: [branchId] });
    await makeEvent('private', { branchIds: [branchId] });
    await makeEvent('hidden', { branchIds: [branchId] });

    const rows = await readCalendar(prisma, null, range);

    expect(titles(rows)).toEqual([`${TAG} public`]);
    // A group timetable is not public information.
    expect(scoped(rows).some((r) => r.kind === 'group')).toBe(false);
  });

  it('a PENDING account sees exactly what an anonymous visitor sees (TD-1)', async () => {
    const branchId = await makeBranch('مراكش');
    await makeEvent('public', { branchIds: [branchId] });
    await makeEvent('private', { branchIds: [branchId] });

    const pending = viewer(await person('قيد الموافقة'), ['student'], null, 'pending');
    expect(titles(await readCalendar(prisma, pending, range))).toEqual([`${TAG} public`]);
  });

  it('an approved STUDENT sees public and private, never hidden', async () => {
    const branchId = await makeBranch('مراكش');
    await makeEvent('public', { branchIds: [branchId] });
    await makeEvent('private', { branchIds: [branchId] });
    await makeEvent('hidden', { branchIds: [branchId] });

    const rows = await readCalendar(prisma, viewer(await person('طالبة'), ['student']), range);
    expect(titles(rows).sort()).toEqual([`${TAG} private`, `${TAG} public`]);
  });

  it('§4.4 Risk R-6: a student\'s private tier is NOT filtered by their branch', async () => {
    const elsewhere = await makeBranch('الدار البيضاء');
    await makeEvent('private', { branchIds: [elsewhere] });

    // A deliberate, recorded trade-off — the student sees it regardless.
    const rows = await readCalendar(prisma, viewer(await person('طالبة'), ['student']), range);
    expect(titles(rows)).toContain(`${TAG} private`);
  });

  it('a TEACHER sees hidden events intersecting their groups, not others', async () => {
    const branchId = await makeBranch('مراكش');
    const mine = await makeGroup(branchId);
    const theirs = await makeGroup(branchId, 'tuesday');
    const t = await teacherUser('معلمة');
    await assignTeacher(prisma, superAdmin(), mine, t);

    await makeEvent('hidden', { groupIds: [mine] });
    const otherHidden = await prisma.event.findUnique({
      where: { id: await makeEvent('hidden', { groupIds: [theirs] }) },
    });

    const rows = await readCalendar(prisma, viewer(t, ['teacher']), range);
    const ids = scoped(rows).map((r) => r.id);
    expect(ids).not.toContain(otherHidden!.id);
    expect(scoped(rows).filter((r) => r.visibility === 'hidden')).toHaveLength(1);
  });

  it('a teacher sees a hidden event scoped to their group\'s LEVEL', async () => {
    const branchId = await makeBranch('مراكش');
    const mine = await makeGroup(branchId);
    const t = await teacherUser('معلمة');
    await assignTeacher(prisma, superAdmin(), mine, t);
    await makeEvent('hidden', { levelIds: [levelId] });

    // §4.4: the group itself, its level, category, branch, or a global event.
    const rows = await readCalendar(prisma, viewer(t, ['teacher']), range);
    expect(scoped(rows).some((r) => r.visibility === 'hidden')).toBe(true);
  });

  it('§4.4 accepted decision: ALL admins see hidden, regardless of branch scope', async () => {
    const mine = await makeBranch('مراكش');
    const elsewhere = await makeBranch('الدار البيضاء');
    await makeEvent('hidden', { branchIds: [elsewhere] });

    const rows = await readCalendar(prisma, viewer(await person('مشرفة'), ['admin'], [mine]), range);
    expect(scoped(rows).some((r) => r.visibility === 'hidden')).toBe(true);
  });

  it('a branch admin\'s PRIVATE tier IS limited to their scope', async () => {
    const mine = await makeBranch('مراكش');
    const elsewhere = await makeBranch('الدار البيضاء');
    await makeEvent('private', { branchIds: [elsewhere] });

    // The asymmetry is the SRS's own: hidden is unscoped for admins, private is not.
    const rows = await readCalendar(prisma, viewer(await person('مشرفة'), ['admin'], [mine]), range);
    expect(scoped(rows).some((r) => r.visibility === 'private')).toBe(false);
  });

  it('a Super Admin sees every tier', async () => {
    const branchId = await makeBranch('مراكش');
    await makeEvent('public', { branchIds: [branchId] });
    await makeEvent('private', { branchIds: [branchId] });
    await makeEvent('hidden', { branchIds: [branchId] });

    const rows = await readCalendar(prisma, viewer(await person('مشرف عام'), ['super_admin']), range);
    expect(titles(rows).sort()).toEqual([`${TAG} hidden`, `${TAG} private`, `${TAG} public`]);
  });
});

describe('§4.4 — operational boundary and range guards', () => {
  it('nothing before a branch\'s operational_start_date is rendered', async () => {
    const branchId = await makeBranch('أكادير', '2026-06-15');
    await makeGroup(branchId);
    await makeEvent('public', { startDate: day('2026-06-02'), branchIds: [branchId] });

    const rows = await readCalendar(prisma, viewer(actorUserId, ['super_admin']), {
      ...range,
      branchId,
    });

    const ours = scoped(rows);
    // `[].every()` is true, so the boundary assertion alone would pass if the
    // filter removed EVERYTHING. Prove the after-side survives first.
    expect(ours.length).toBeGreaterThan(0);
    expect(ours.some((r) => r.kind === 'group')).toBe(true);
    // §4.4: no scheduling data or events before the branch opens.
    expect(ours.every((r) => r.date >= '2026-06-15')).toBe(true);
    // And the event deliberately placed before the boundary is genuinely gone,
    // rather than merely absent from a list that is empty for another reason.
    expect(ours.some((r) => r.date === '2026-06-02')).toBe(false);
  });

  it('refuses an inverted or oversized range', async () => {
    const actor = viewer(actorUserId, ['super_admin']);
    await expect(
      readCalendar(prisma, actor, { from: day('2026-06-30'), to: day('2026-06-01') }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      readCalendar(prisma, actor, { from: day('2026-01-01'), to: day('2028-01-01') }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('returns a unified, deterministically ordered grid of groups and events', async () => {
    const branchId = await makeBranch('مراكش');
    await makeGroup(branchId, 'monday', 9);
    await makeEvent('public', { startDate: day('2026-06-01'), branchIds: [branchId] });

    const rows = await readCalendar(prisma, viewer(actorUserId, ['super_admin']), range);
    const ours = scoped(rows);
    expect(ours.some((r) => r.kind === 'group')).toBe(true);
    expect(ours.some((r) => r.kind === 'event')).toBe(true);

    const dates = rows.map((r) => r.date);
    expect([...dates].sort()).toEqual(dates);
  });
});

describe('§4.4/§5.7 — the Hijri overlay from official recorded data (Revision 31)', () => {
  /** The officially announced Moroccan dates: 1 Muharram 1448 = 17 June 2026. */
  const OFFICIAL: [number, number, string][] = [
    [1447, 12, '2026-05-18'],
    [1448, 1, '2026-06-17'],
    [1448, 2, '2026-07-16'],
  ];

  async function record(published: boolean): Promise<void> {
    for (const [y, m, iso] of OFFICIAL) {
      await prisma.hijriMonthStart.create({
        data: {
          hijriYear: y,
          hijriMonth: m,
          gregorianStartDate: day(iso),
          status: published ? 'published' : 'draft',
        },
      });
    }
  }

  async function clearMonths(): Promise<void> {
    await prisma.hijriMonthStart.deleteMany({ where: { hijriYear: { in: [1447, 1448] } } });
  }

  beforeEach(clearMonths);
  afterEach(clearMonths);

  it('labels occurrences from the recorded official calendar', async () => {
    await record(true);
    await makeEvent('public', { startDate: day('2026-06-20') });

    const rows = scoped(await readCalendar(prisma, null, { from: day('2026-06-01'), to: day('2026-06-30') }));
    const event = rows.find((r) => r.kind === 'event');

    // 20 June is the fourth day of Muharram, counting from the announced 17th.
    expect(event!.hijriDate).toBe('1448-01-04');
    expect(event!.hijriMonthArabic).toBe('محرم');
    // Decorative only (§4.4): the Gregorian date is untouched.
    expect(event!.date).toBe('2026-06-20');
  });

  it('reproduces the OFFICIAL date rather than the algorithmic one', async () => {
    // Umm al-Qura puts 1 Muharram 1448 on 16 June; Morocco announced the 17th.
    // On the 16th the official answer is still Dhu al-Hijja 1447. If this ever
    // reads 1448-01-01, an algorithm has crept back in.
    await record(true);
    await makeEvent('public', { startDate: day('2026-06-16') });

    const rows = scoped(await readCalendar(prisma, null, { from: day('2026-06-01'), to: day('2026-06-30') }));
    const event = rows.find((r) => r.kind === 'event');

    expect(event!.hijriDate).toBe('1447-12-30');
    expect(event!.hijriMonthArabic).toBe('ذو الحجة');
  });

  it('renders NO overlay for a month that is recorded but not yet published', async () => {
    await record(false);
    await makeEvent('public', { startDate: day('2026-06-20') });

    const rows = scoped(await readCalendar(prisma, null, { from: day('2026-06-01'), to: day('2026-06-30') }));
    const event = rows.find((r) => r.kind === 'event');

    // Publishing is what makes a month visible; a draft must not leak out.
    expect(event!.hijriDate).toBeNull();
    expect(event!.hijriMonthArabic).toBeNull();
  });

  it('renders NO overlay for a month the Ministry has not announced', async () => {
    // §18/Revision 31: silence where the official answer is genuinely unknown,
    // never a computed guess. The Gregorian date still renders.
    await makeEvent('public', { startDate: day('2026-06-20') });

    const rows = scoped(await readCalendar(prisma, null, { from: day('2026-06-01'), to: day('2026-06-30') }));
    const event = rows.find((r) => r.kind === 'event');

    expect(event!.hijriDate).toBeNull();
    expect(event!.date).toBe('2026-06-20');
  });

  it('group occurrences carry the overlay too, not only events', async () => {
    await record(true);
    const branchId = await makeBranch('مراكش');
    await makeGroup(branchId);
    const student = await person('طالبة');

    const rows = scoped(
      await readCalendar(prisma, viewer(student, ['student']), {
        from: day('2026-06-18'),
        to: day('2026-06-30'),
      }),
    );
    const session = rows.find((r) => r.kind === 'group');

    expect(session!.hijriDate).toMatch(/^1448-01-\d{2}$/);
    expect(session!.hijriMonthArabic).toBe('محرم');
  });

  it('crosses the Hijri year boundary on the recorded date', async () => {
    await record(true);
    await makeEvent('public', { startDate: day('2026-06-17') });

    const rows = scoped(await readCalendar(prisma, null, { from: day('2026-06-01'), to: day('2026-06-30') }));
    expect(rows.find((r) => r.kind === 'event')!.hijriDate).toBe('1448-01-01');
  });
});
