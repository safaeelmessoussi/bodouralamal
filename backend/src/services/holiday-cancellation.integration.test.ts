import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import type { Actor } from '../policies/actor.js';
import { clearTeachingContext, createTeachingContext, materializeRange, type TeachingFixture } from '../test-support/educational-fixture.js';
import { readCalendar } from './calendar.service.js';
import { createEvent, deleteEvent, listCancelledDates, restoreCancelledDate, updateEvent } from './event.service.js';
import { applyHolidaysToSessions, widenYoungHolidays } from './holiday-cancellation.service.js';
import { restoreSession } from './session.service.js';
import { restoreEntry } from './trash.service.js';

/**
 * **SRS Revision 199 §5 — a عطلة cancels the classes of its Categories in its
 * period, and gives them back when it is edited away, deleted or restored.**
 * Real PostgreSQL: the properties are the CHECK on `cancelled_by_event_id`,
 * the version bumps and the Trash round trip.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = '[holiday-r199-test]';

let actorUserId = '';
const superAdmin = (): Actor => ({
  userId: actorUserId,
  roles: ['super_admin'],
  roleScopes: [{ role: 'super_admin', branches: null }],
  activeRole: 'super_admin',
});

let branchId = '';
let women: TeachingFixture;
let children: TeachingFixture;
let holidayTypeId = '';
const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
// Saturdays in November 2026.
const SATURDAYS = ['2026-11-07', '2026-11-14', '2026-11-21', '2026-11-28'];

async function statusOf(fixture: TeachingFixture, iso: string): Promise<{ status: string; by: string | null; reason: string | null }> {
  const row = await prisma.session.findUniqueOrThrow({
    where: { scheduleId_date: { scheduleId: fixture.scheduleId, date: day(iso) } },
    select: { status: true, cancelledByEventId: true, cancellationReason: true },
  });
  return { status: row.status, by: row.cancelledByEventId, reason: row.cancellationReason };
}

beforeAll(async () => {
  await clearTeachingContext(prisma, TAG);
  actorUserId = (
    await prisma.user.create({ data: { nameArabic: `${TAG} مشرفة`, sex: 'female', accountStatus: 'active' } })
  ).id;
  const role = await prisma.role.findUniqueOrThrow({ where: { name: 'super_admin' } });
  await prisma.userBranchRole.create({ data: { userId: actorUserId, roleId: role.id, branchId: null } });
  branchId = (await prisma.branch.create({ data: { name: `${TAG} فرع`, operationalStartDate: new Date('2025-01-01') } })).id;
  women = await createTeachingContext(prisma, `${TAG} نساء`, branchId);
  children = await createTeachingContext(prisma, `${TAG} أطفال`, branchId);
  await materializeRange(prisma, women, day('2026-11-01'), day('2026-11-30'));
  await materializeRange(prisma, children, day('2026-11-01'), day('2026-11-30'));
  holidayTypeId =
    (await prisma.schedulingType.findFirst({ where: { structuralKind: 'holiday', deletedAt: null }, select: { id: true } }))?.id ??
    (
      await prisma.schedulingType.create({
        data: { name: `${TAG} عطلة`, structuralKind: 'holiday', attendanceMode: 'disabled', displayOrder: 99 },
      })
    ).id;
});

afterAll(async () => {
  const events = await prisma.event.findMany({ where: { title: { startsWith: TAG } }, select: { id: true } });
  const ids = events.map((e) => e.id);
  await prisma.session.updateMany({ where: { cancelledByEventId: { in: ids } }, data: { cancelledByEventId: null } });
  await prisma.trash.deleteMany({ where: { targetId: { in: ids } } });
  await prisma.eventCategory.deleteMany({ where: { eventId: { in: ids } } });
  await prisma.eventBranch.deleteMany({ where: { eventId: { in: ids } } });
  await prisma.event.deleteMany({ where: { id: { in: ids } } });
  await prisma.schedulingType.deleteMany({ where: { name: { startsWith: TAG } } });
  await clearTeachingContext(prisma, `${TAG} نساء`);
  await clearTeachingContext(prisma, `${TAG} أطفال`);
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.auditLog.deleteMany({ where: { actorUserId } });
  await prisma.userBranchRole.deleteMany({ where: { userId: actorUserId } });
  await prisma.user.deleteMany({ where: { id: actorUserId } });
  await prisma.$disconnect();
});

describe('R199 §5 — a عطلة cancels its Category’s classes, reversibly', () => {
  let holidayId = '';

  it('cancels the covered classes of its Category in its period, and no other', async () => {
    const created = await createEvent(prisma, superAdmin(), {
      title: `${TAG} عطلة منتصف الدورة`,
      schedulingTypeId: holidayTypeId,
      visibility: 'public',
      startDate: day('2026-11-10'),
      endDate: day('2026-11-22'),
      recurrenceType: 'none',
      branchIds: [branchId],
      categoryIds: [women.categoryId],
    });
    holidayId = created.event.id;
    expect(await statusOf(women, '2026-11-07')).toMatchObject({ status: 'scheduled', by: null });
    expect(await statusOf(women, '2026-11-14')).toMatchObject({ status: 'cancelled', by: holidayId });
    expect((await statusOf(women, '2026-11-21')).reason).toContain('عطلة');
    expect(await statusOf(women, '2026-11-28')).toMatchObject({ status: 'scheduled' });
    // Another Category on the same days is untouched.
    expect(await statusOf(children, '2026-11-14')).toMatchObject({ status: 'scheduled', by: null });
  });

  it('shortening the holiday gives back what it no longer covers', async () => {
    const current = await prisma.event.findUniqueOrThrow({ where: { id: holidayId }, select: { version: true } });
    await updateEvent(prisma, superAdmin(), holidayId, current.version, { endDate: day('2026-11-15') });
    expect(await statusOf(women, '2026-11-14')).toMatchObject({ status: 'cancelled', by: holidayId });
    expect(await statusOf(women, '2026-11-21')).toMatchObject({ status: 'scheduled', by: null, reason: null });
  });

  it('a class materialised later on the holiday is born cancelled', async () => {
    const row = await prisma.session.findUniqueOrThrow({
      where: { scheduleId_date: { scheduleId: women.scheduleId, date: day('2026-11-14') } },
      select: { id: true },
    });
    // Simulate a fresh occurrence: back to scheduled, then the materialiser's hook.
    await prisma.session.update({ where: { id: row.id }, data: { status: 'scheduled', cancelledByEventId: null, cancellationReason: null } });
    expect(await applyHolidaysToSessions(prisma as never, [row.id])).toBe(1);
    expect(await statusOf(women, '2026-11-14')).toMatchObject({ status: 'cancelled', by: holidayId });
  });

  it('«إعادة البرمجة» of one occurrence wins over the holiday and clears the link', async () => {
    const row = await prisma.session.findUniqueOrThrow({
      where: { scheduleId_date: { scheduleId: women.scheduleId, date: day('2026-11-14') } },
      select: { id: true, version: true },
    });
    await restoreSession(prisma, superAdmin(), row.id, row.version, day('2026-11-01'));
    expect(await statusOf(women, '2026-11-14')).toMatchObject({ status: 'scheduled', by: null });
    // …and the holiday, re-applied, cancels it again only when edited again.
    await prisma.session.update({ where: { id: row.id }, data: { status: 'cancelled', cancelledByEventId: holidayId } });
  });

  it('the database refuses a holiday link on an occurrence that is not cancelled', async () => {
    const row = await prisma.session.findUniqueOrThrow({
      where: { scheduleId_date: { scheduleId: women.scheduleId, date: day('2026-11-28') } },
      select: { id: true },
    });
    await expect(prisma.session.update({ where: { id: row.id }, data: { cancelledByEventId: holidayId } })).rejects.toThrow();
  });

  it('deleting the holiday gives every class back; restoring it from the Trash cancels them again', async () => {
    await deleteEvent(prisma, superAdmin(), holidayId);
    expect(await statusOf(women, '2026-11-14')).toMatchObject({ status: 'scheduled', by: null });
    const entry = await prisma.trash.findFirstOrThrow({ where: { targetEntity: 'Event', targetId: holidayId }, select: { id: true } });
    const result = await restoreEntry(prisma, superAdmin(), entry.id);
    expect(result.holiday_cancelled_sessions).toBe(1);
    expect(await statusOf(women, '2026-11-14')).toMatchObject({ status: 'cancelled', by: holidayId });
  });

  it('a class cancelled by a person keeps that person’s reason, and is never «given back» by the holiday', async () => {
    const row = await prisma.session.findUniqueOrThrow({
      where: { scheduleId_date: { scheduleId: women.scheduleId, date: day('2026-11-07') } },
      select: { id: true },
    });
    await prisma.session.update({ where: { id: row.id }, data: { status: 'cancelled', cancellationReason: 'مرض المؤطرة' } });
    const current = await prisma.event.findUniqueOrThrow({ where: { id: holidayId }, select: { version: true } });
    await updateEvent(prisma, superAdmin(), holidayId, current.version, { startDate: day('2026-11-05') });
    expect(await statusOf(women, '2026-11-07')).toMatchObject({ status: 'cancelled', by: null, reason: 'مرض المؤطرة' });
    const after = await prisma.event.findUniqueOrThrow({ where: { id: holidayId }, select: { version: true } });
    await deleteEvent(prisma, superAdmin(), holidayId);
    expect(after.version).toBeGreaterThan(0);
    expect(await statusOf(women, '2026-11-07')).toMatchObject({ status: 'cancelled', reason: 'مرض المؤطرة' });
  });
});

/**
 * **R224 §2 (the Owner, 2026-10-16) — a holiday cancels its Categories'
 * activities too, and the calendar shows none of them; «إعادة البرمجة» puts a
 * date back, and a re-applied holiday leaves it there.**
 */
describe('R224 §2 — a عطلة cancels its Category’s activity dates', () => {
  let activityTypeId = '';
  let holidayId = '';
  const ids = { childWeekly: '', women: '', everyone: '' };
  const shown = async (id: string, iso: string): Promise<boolean> =>
    (await readCalendar(prisma, null, { from: day(iso), to: day(iso) })).some((o) => o.kind === 'event' && o.id === id);

  beforeAll(async () => {
    activityTypeId = (
      await prisma.schedulingType.create({
        data: { name: `${TAG} نشاط`, structuralKind: 'activity', attendanceMode: 'disabled', displayOrder: 98 },
      })
    ).id;
    const activity = async (title: string, scope: { categoryIds?: string[]; global?: boolean }) =>
      (
        await createEvent(prisma, superAdmin(), {
          title: `${TAG} ${title}`,
          schedulingTypeId: activityTypeId,
          visibility: 'public',
          startDate: day('2026-12-05'),
          endDate: null,
          recurrenceType: 'weekly',
          recurrenceEndDate: day('2026-12-26'),
          ...(scope.global ? { global: true } : { branchIds: [branchId], categoryIds: scope.categoryIds ?? [] }),
        })
      ).event.id;
    ids.childWeekly = await activity('ورشة الأطفال', { categoryIds: [children.categoryId] });
    ids.women = await activity('ورشة النساء', { categoryIds: [women.categoryId] });
    ids.everyone = await activity('حفل للجميع', { global: true });
  });

  it('cancels the covered dates of its Category, which the calendar no longer shows', async () => {
    holidayId = (
      await createEvent(prisma, superAdmin(), {
        title: `${TAG} عطلة الأطفال`,
        schedulingTypeId: holidayTypeId,
        visibility: 'public',
        startDate: day('2026-12-10'),
        endDate: day('2026-12-20'),
        recurrenceType: 'none',
        branchIds: [branchId],
        categoryIds: [children.categoryId],
      })
    ).event.id;
    expect(await shown(ids.childWeekly, '2026-12-05')).toBe(true);
    expect(await shown(ids.childWeekly, '2026-12-12')).toBe(false);
    expect(await shown(ids.childWeekly, '2026-12-19')).toBe(false);
    expect(await shown(ids.childWeekly, '2026-12-26')).toBe(true);
    // Another Category, and an activity for «الكل», are not this holiday's.
    expect(await shown(ids.women, '2026-12-12')).toBe(true);
    expect(await shown(ids.everyone, '2026-12-12')).toBe(true);
    const dates = await listCancelledDates(prisma, superAdmin(), ids.childWeekly);
    expect(dates.map((d) => d.date.toISOString().slice(0, 10))).toEqual(['2026-12-12', '2026-12-19']);
    expect(dates[0]!.reason).toContain('عطلة');
  });

  it('«إعادة البرمجة» shows the date again, and re-applying the holiday leaves it there', async () => {
    await restoreCancelledDate(prisma, superAdmin(), ids.childWeekly, day('2026-12-12'));
    expect(await shown(ids.childWeekly, '2026-12-12')).toBe(true);
    const current = await prisma.event.findUniqueOrThrow({ where: { id: holidayId }, select: { version: true } });
    await updateEvent(prisma, superAdmin(), holidayId, current.version, { endDate: day('2026-12-21') });
    expect(await shown(ids.childWeekly, '2026-12-12')).toBe(true);
    expect(await shown(ids.childWeekly, '2026-12-19')).toBe(false);
  });

  it('an activity edited onto the holiday is cancelled there; deleting the holiday gives every date back', async () => {
    const before = await prisma.event.findUniqueOrThrow({ where: { id: ids.women }, select: { version: true } });
    await updateEvent(prisma, superAdmin(), ids.women, before.version, { scope: { branchIds: [branchId], categoryIds: [children.categoryId] } });
    expect(await shown(ids.women, '2026-12-19')).toBe(false);
    await deleteEvent(prisma, superAdmin(), holidayId);
    expect(await shown(ids.childWeekly, '2026-12-19')).toBe(true);
    expect(await shown(ids.women, '2026-12-19')).toBe(true);
    expect(await prisma.eventDateCancellation.count({ where: { cancelledByEventId: holidayId } })).toBe(0);
  });

  it('a holiday for every Category covers an activity for «الكل»', async () => {
    const all = await prisma.category.findMany({ where: { deletedAt: null }, select: { id: true } });
    const branches = await prisma.branch.findMany({ where: { deletedAt: null }, select: { id: true } });
    const everywhere = (
      await createEvent(prisma, superAdmin(), {
        title: `${TAG} عطلة للجميع`,
        schedulingTypeId: holidayTypeId,
        visibility: 'public',
        startDate: day('2026-12-26'),
        endDate: null,
        recurrenceType: 'none',
        branchIds: branches.map((b) => b.id),
        categoryIds: all.map((c) => c.id),
      })
    ).event.id;
    expect(await shown(ids.everyone, '2026-12-26')).toBe(false);
    await deleteEvent(prisma, superAdmin(), everywhere);
    expect(await shown(ids.everyone, '2026-12-26')).toBe(true);
  });
});

// Saturdays referenced so a reader sees the calendar the cases assume.
void SATURDAYS;

describe('R237 — a school holiday covers every programme but the adult one', () => {
  class Rollback extends Error {}

  it('gains a non-adult programme it lacks; an official (no programme) or adult holiday is left as it is', async () => {
    const school = await createEvent(prisma, superAdmin(), {
      title: `${TAG} عطلة الفترة البينية`,
      schedulingTypeId: holidayTypeId,
      visibility: 'public',
      startDate: day('2027-02-01'),
      endDate: day('2027-02-07'),
      recurrenceType: 'none',
      branchIds: [branchId],
      categoryIds: [children.categoryId],
    });
    const official = await createEvent(prisma, superAdmin(), {
      title: `${TAG} عيد رسمي`,
      schedulingTypeId: holidayTypeId,
      visibility: 'public',
      startDate: day('2027-02-10'),
      recurrenceType: 'none',
      branchIds: [branchId],
    });
    const adults = await createEvent(prisma, superAdmin(), {
      title: `${TAG} عطلة النساء`,
      schedulingTypeId: holidayTypeId,
      visibility: 'public',
      startDate: day('2027-02-12'),
      recurrenceType: 'none',
      branchIds: [branchId],
      categoryIds: [women.categoryId],
    });
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.category.update({ where: { id: women.categoryId }, data: { holdsOwnLogin: true } });
        const boys = await tx.category.create({ data: { name: `${TAG} اليافعين` } });
        const changed = await widenYoungHolidays(tx);
        const scope = async (id: string) =>
          (await tx.eventCategory.findMany({ where: { eventId: id }, select: { categoryId: true } })).map((r) => r.categoryId);
        expect(changed).toContain(school.event.id);
        expect(await scope(school.event.id)).toEqual(expect.arrayContaining([children.categoryId, boys.id]));
        expect(await scope(school.event.id)).not.toContain(women.categoryId);
        expect(await scope(official.event.id)).toEqual([]);
        expect(await scope(adults.event.id)).toEqual([women.categoryId]);
        // A second pass changes nothing.
        expect(await widenYoungHolidays(tx)).not.toContain(school.event.id);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });
});
