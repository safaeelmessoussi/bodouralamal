import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import type { Actor } from '../policies/actor.js';
import {
  clearTeachingContext,
  createTeachingContext,
  type TeachingFixture,
} from '../test-support/educational-fixture.js';
import { readCalendar, type CalendarActor } from './calendar.service.js';
import { createEvent } from './event.service.js';
import { createPhysicalExam } from './exam.service.js';
import { createSchedulingType } from './scheduling-type.service.js';

/**
 * **The calendar's النوع filter speaks the CATALOGUE** (R110, Owner 2026-09-02).
 *
 * The defect this pins: the filter offered `session | event | exam` — the
 * *storage* taxonomy. Two catalogue rows can share one of those, so «نشاط» and
 * «عطلة» both answered `type=event` and a holiday could not be asked for at
 * all; «حصة دراسية» and «محاضرة» are likewise one `class`.
 *
 * Five claims, each of which could hold while another silently broke:
 *
 * 1. **Two types of ONE structural kind filter apart.** This is the whole
 *    point, and it is the assertion that fails if anybody re-derives the filter
 *    from `structural_kind` instead of the id.
 * 2. **A holiday is reachable and is marked as one.** Both the filter and the
 *    occurrence's own `structural_kind`, because the grid renders from the
 *    latter and a filter that works while the chip renders «نشاط» is half a fix.
 * 3. **Each of the three sources is filterable**, including the two that had
 *    nowhere to record a type before this revision.
 * 4. **Legacy rows are not guessed into a type.** A schedule created before the
 *    catalogue matches NO type filter and stays visible unfiltered. The
 *    tempting bug is a fallback on `structural_kind`, which would quietly make
 *    every untyped class answer to «حصة دراسية» *and* to «محاضرة».
 * 5. **The write paths refuse a mismatched kind**, on create and on update
 *    alike — the R57 shape where a rule holds on one path and not the other.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = '[type-filter-test]';
/* A session's title is its Subject's name, and `createTeachingContext` names
   the Subject `<tag> مادة` — so these are how each fixture's class appears. */
const CLASS_TYPED = 'typed مادة';
const CLASS_LEGACY = 'legacy مادة';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const NOW = day('2094-01-01');
const WHEN = day('2094-06-15');
const RANGE = { from: day('2094-06-01'), to: day('2094-06-30') };

let actorUserId = '';
let branchId = '';
let roomId = '';
let typed: TeachingFixture;
let legacy: TeachingFixture;

const ids: Record<string, string> = {};

const superAdmin = (): Actor => ({
  userId: actorUserId,
  roles: ['super_admin'],
  roleScopes: [{ role: 'super_admin', branches: null }],
  activeRole: 'super_admin',
});

const viewer = (): CalendarActor => ({
  userId: actorUserId,
  roles: ['super_admin'],
  roleScopes: [{ role: 'super_admin', branches: null }],
  accountStatus: 'active',
});

/** Only this suite's rows: the development database is shared (P1.2). */
const mine = <T extends { title: string }>(rows: T[]): T[] =>
  rows.filter((r) => r.title.startsWith(TAG));

async function makeType(name: string, kind: 'class' | 'activity' | 'exam' | 'holiday') {
  const row = await createSchedulingType(prisma, superAdmin(), {
    name: `${TAG} ${name}`,
    structuralKind: kind,
    attendanceRequired: false,
  });
  ids[name] = row.id;
  return row.id;
}

async function makeEvent(title: string, schedulingTypeId: string): Promise<void> {
  await createEvent(
    prisma,
    superAdmin(),
    {
      title: `${TAG} ${title}`,
      schedulingTypeId,
      visibility: 'public',
      startDate: WHEN,
      recurrenceType: 'none',
      global: true,
    } as never,
    NOW,
  );
}

/**
 * One dated occurrence on this suite's own timeline, for `fixture`.
 *
 * **A class occurrence is titled by its SUBJECT** (`calendar.service.ts`), not
 * by the schedule's own name — so each fixture's subject tag is what identifies
 * its session below.
 */
async function session(fixture: TeachingFixture): Promise<void> {
  await prisma.session.create({
    data: {
      scheduleId: fixture.scheduleId,
      date: WHEN,
      startTime: new Date(Date.UTC(1970, 0, 1, 9, 0, 0)),
      endTime: new Date(Date.UTC(1970, 0, 1, 10, 30, 0)),
    },
  });
}

async function clear(): Promise<void> {
  const events = await prisma.event.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true },
  });
  const eventIds = events.map((e) => e.id);
  await prisma.eventBranch.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.eventStaff.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.notification.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.event.deleteMany({ where: { id: { in: eventIds } } });

  const exams = await prisma.exam.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true },
  });
  const examIds = exams.map((e) => e.id);
  await prisma.examStaff.deleteMany({ where: { examId: { in: examIds } } });
  await prisma.notification.deleteMany({ where: { examId: { in: examIds } } });
  await prisma.exam.deleteMany({ where: { id: { in: examIds } } });

  // Before the types: `scheduling_type_id` is RESTRICT on every one of them.
  await clearTeachingContext(prisma, `${TAG} typed`);
  await clearTeachingContext(prisma, `${TAG} legacy`);

  const types = await prisma.schedulingType.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  const typeIds = types.map((t) => t.id);
  await prisma.trash.deleteMany({ where: { targetId: { in: typeIds } } });
  await prisma.auditLog.deleteMany({ where: { targetId: { in: typeIds } } });
  await prisma.schedulingType.deleteMany({ where: { id: { in: typeIds } } });

  await prisma.room.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });

  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

beforeAll(async () => {
  await clear();
  actorUserId = (
    await prisma.user.create({
      data: { sex: 'female', nameArabic: `${TAG} مديرة`, accountStatus: 'active' },
    })
  ).id;
  branchId = (
    await prisma.branch.create({
      data: { name: `${TAG} فرع`, operationalStartDate: day('2020-01-01') },
    })
  ).id;
  roomId = (await prisma.room.create({ data: { name: `${TAG} قاعة`, branchId } })).id;

  // Two activity types, so the claim under test is not merely "activity vs
  // holiday" — it is that two rows of the SAME kind filter independently.
  await makeType('نشاط', 'activity');
  await makeType('حفل', 'activity');
  await makeType('عطلة', 'holiday');
  await makeType('حصة دراسية', 'class');
  await makeType('محاضرة', 'class');
  await makeType('اختبار', 'exam');

  typed = await createTeachingContext(prisma, `${TAG} typed`, branchId, {});
  legacy = await createTeachingContext(prisma, `${TAG} legacy`, branchId, {});
  await prisma.recurringCourseSchedule.update({
    where: { id: typed.scheduleId },
    data: { schedulingTypeId: ids['حصة دراسية']! },
  });
  await session(typed);
  // Deliberately untyped: the row every installation has from before R110.
  await session(legacy);

  await makeEvent('رحلة', ids['نشاط']!);
  await makeEvent('حفل ختام', ids['حفل']!);
  await makeEvent('عيد', ids['عطلة']!);

  await createPhysicalExam(prisma, superAdmin(), {
    title: `${TAG} امتحان`,
    maxGrade: 20,
    date: WHEN,
    startTime: new Date(Date.UTC(1970, 0, 1, 9, 0, 0)),
    endTime: new Date(Date.UTC(1970, 0, 1, 10, 0, 0)),
    levelId: typed.levelId,
    subjectId: typed.subjectId,
    academicYearId: (await prisma.academicYear.findFirstOrThrow({ select: { id: true } })).id,
    branchId,
    roomId,
    schedulingTypeId: ids['اختبار']!,
  });
}, 120_000);

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

const read = (over: Record<string, unknown> = {}) =>
  readCalendar(prisma, viewer(), { ...RANGE, ...over } as never).then(mine);

const titles = async (over: Record<string, unknown> = {}): Promise<string[]> =>
  (await read(over)).map((o) => o.title.replace(`${TAG} `, '')).sort();

/* ── 1. Two catalogue rows of ONE structural kind ───────────────────────── */

describe('two types sharing a structural kind filter independently', () => {
  it('narrows to نشاط alone, not to every Event', async () => {
    expect(await titles({ schedulingTypeId: ids['نشاط'] })).toEqual(['رحلة']);
  });

  it('narrows to حفل alone', async () => {
    expect(await titles({ schedulingTypeId: ids['حفل'] })).toEqual(['حفل ختام']);
  });

  /**
   * **The regression that motivated the revision.** Before it, this and the two
   * above all returned the same three rows, because `type=event` was the finest
   * question the contract could ask.
   */
  it('narrows to عطلة alone — the case the old filter could not express', async () => {
    expect(await titles({ schedulingTypeId: ids['عطلة'] })).toEqual(['عيد']);
  });

  it('narrows two class types apart, on the source that had no column before', async () => {
    expect(await titles({ schedulingTypeId: ids['حصة دراسية'] })).toEqual([CLASS_TYPED]);
    // Nothing is typed محاضرة, and the answer is empty rather than "every class".
    expect(await titles({ schedulingTypeId: ids['محاضرة'] })).toEqual([]);
  });

  it('narrows to the sitting through its own type', async () => {
    expect(await titles({ schedulingTypeId: ids['اختبار'] })).toEqual(['امتحان']);
  });
});

/* ── 2. What the occurrence carries ─────────────────────────────────────── */

describe('every occurrence says which catalogue row it is', () => {
  it('marks a holiday apart from an activity, both of which are Events', async () => {
    const rows = await read();
    const holiday = rows.find((o) => o.title.endsWith('عيد'));
    const activity = rows.find((o) => o.title.endsWith('رحلة'));
    expect(holiday?.kind).toBe('event');
    expect(activity?.kind).toBe('event');
    // `kind` cannot tell them apart; this is what the chip and the badge read.
    expect(holiday?.structuralKind).toBe('holiday');
    expect(activity?.structuralKind).toBe('activity');
    expect(holiday?.schedulingTypeId).toBe(ids['عطلة']);
    expect(holiday?.schedulingTypeName).toBe(`${TAG} عطلة`);
  });

  it('carries the type on a class and on a sitting too', async () => {
    const rows = await read();
    expect(rows.find((o) => o.title.endsWith(CLASS_TYPED))?.schedulingTypeId).toBe(
      ids['حصة دراسية'],
    );
    expect(rows.find((o) => o.title.endsWith('امتحان'))?.schedulingTypeId).toBe(ids['اختبار']);
  });
});

/* ── 3. Legacy rows, honestly ───────────────────────────────────────────── */

describe('a row that predates the catalogue', () => {
  it('is visible with no filter — «الكل» still shows everything', async () => {
    expect(await titles()).toContain(CLASS_LEGACY);
  });

  /**
   * **Not guessed into a type.** A `structural_kind` fallback would make this
   * class answer to «حصة دراسية» *and* to «محاضرة» — two contradictory claims
   * about what it was, from a row that records neither.
   */
  it('matches NO catalogue filter, including the one of its own kind', async () => {
    expect(await titles({ schedulingTypeId: ids['حصة دراسية'] })).not.toContain(CLASS_LEGACY);
    expect(await titles({ schedulingTypeId: ids['محاضرة'] })).not.toContain(CLASS_LEGACY);
  });

  it('reports its type as null rather than inventing one', async () => {
    const row = (await read()).find((o) => o.title.endsWith(CLASS_LEGACY));
    expect(row?.schedulingTypeId).toBeNull();
    expect(row?.structuralKind).toBeNull();
  });
});

/* ── 4. The older contract still answers ────────────────────────────────── */

describe('backward compatibility', () => {
  it('still honours `kind`, so a link saved before the revision works', async () => {
    expect(await titles({ kind: 'event' })).toEqual(['حفل ختام', 'رحلة', 'عيد'].sort());
  });

  it('returns nothing for an id naming no type, rather than the whole grid', async () => {
    expect(await titles({ schedulingTypeId: '00000000-0000-4000-8000-000000000999' })).toEqual([]);
  });

  it('lets both narrow together, and a contradictory pair is honestly empty', async () => {
    expect(await titles({ kind: 'session', schedulingTypeId: ids['عطلة'] })).toEqual([]);
  });
});

/* ── 5. The write paths ─────────────────────────────────────────────────── */

describe('a row cannot be typed as a kind it is not', () => {
  it('refuses a sitting typed «عطلة»', async () => {
    await expect(
      createPhysicalExam(prisma, superAdmin(), {
        title: `${TAG} مرفوض`,
        maxGrade: 20,
        date: WHEN,
        startTime: new Date(Date.UTC(1970, 0, 1, 11, 0, 0)),
        endTime: new Date(Date.UTC(1970, 0, 1, 12, 0, 0)),
        levelId: typed.levelId,
        subjectId: typed.subjectId,
        academicYearId: (await prisma.academicYear.findFirstOrThrow({ select: { id: true } })).id,
        branchId,
        roomId,
        schedulingTypeId: ids['عطلة']!,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('refuses an activity typed «حصة دراسية» — the rule that already existed', async () => {
    await expect(makeEvent('مرفوض', ids['حصة دراسية']!)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });
});
