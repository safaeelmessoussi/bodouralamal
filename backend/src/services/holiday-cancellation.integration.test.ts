import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import type { Actor } from '../policies/actor.js';
import { clearTeachingContext, createTeachingContext, materializeRange, type TeachingFixture } from '../test-support/educational-fixture.js';
import { createEvent, deleteEvent, updateEvent } from './event.service.js';
import { applyHolidaysToSessions } from './holiday-cancellation.service.js';
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

// Saturdays referenced so a reader sees the calendar the cases assume.
void SATURDAYS;
