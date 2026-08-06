import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import type { Actor } from '../policies/actor.js';
import { deleteEvent } from './event.service.js';
import { deleteCourseSchedule } from './course-schedule.service.js';
import { createTeachingContext } from '../test-support/educational-fixture.js';

/**
 * **Every soft delete reaches the Trash** (TD-5, BR-15, §4.10, R52).
 *
 * ## The defect this file exists for
 *
 * Deleting an Event or a Course Schedule set `deleted_at` and wrote an audit row
 * — and wrote **no `Trash` snapshot**. The record vanished from every screen and
 * appeared on the one screen built to report deletions as *nothing at all*. It
 * was not recoverable either: §4.10's restore runbook reads the snapshot, and
 * there was none.
 *
 * The reason it went unnoticed is worth stating, because it generalises: every
 * one of those services had a passing test for *"the row is soft-deleted"*, and
 * that assertion is true of a half-implemented delete. **Soft deletion is two
 * obligations — hide the row, and record what was hidden — and a test for the
 * first cannot see the absence of the second.**
 *
 * ## Why the guard below is structural rather than a list of cases
 *
 * A per-entity test would have to be remembered for every entity added later,
 * which is exactly the discipline that failed here. So the last test reads the
 * service sources and requires that **any module writing a `deletedAt`
 * tombstone also calls `trash.snapshot`** — the two appear together or the file
 * is named. A new entity cannot quietly opt out.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = '[trash-coverage]';

const actor = (): Actor =>
  ({
    userId: actorId,
    roles: ['super_admin'],
    roleScopes: [{ role: 'super_admin', branches: null }],
  }) as unknown as Actor;

let actorId = '';
let branchId = '';

async function clear(): Promise<void> {
  const ids = (
    await prisma.user.findMany({ where: { nameArabic: { startsWith: TAG } }, select: { id: true } })
  ).map((u) => u.id);
  const levels = (
    await prisma.level.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } })
  ).map((l) => l.id);
  const groups = (
    await prisma.administrativeGroup.findMany({
      where: { levelId: { in: levels } },
      select: { id: true },
    })
  ).map((g) => g.id);
  const schedules = (
    await prisma.recurringCourseSchedule.findMany({
      where: { administrativeGroupId: { in: groups } },
      select: { id: true },
    })
  ).map((s) => s.id);
  const events = (
    await prisma.event.findMany({ where: { title: { startsWith: TAG } }, select: { id: true } })
  ).map((e) => e.id);

  await prisma.trash.deleteMany({
    where: { targetId: { in: [...schedules, ...events] } },
  });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
  await prisma.eventBranch.deleteMany({ where: { eventId: { in: events } } });
  await prisma.eventCategory.deleteMany({ where: { eventId: { in: events } } });
  await prisma.eventLevel.deleteMany({ where: { eventId: { in: events } } });
  await prisma.eventAdministrativeGroup.deleteMany({ where: { eventId: { in: events } } });
  await prisma.event.deleteMany({ where: { id: { in: events } } });
  await prisma.sessionStaff.deleteMany({ where: { session: { scheduleId: { in: schedules } } } });
  await prisma.session.deleteMany({ where: { scheduleId: { in: schedules } } });
  await prisma.courseScheduleStaff.deleteMany({ where: { scheduleId: { in: schedules } } });
  await prisma.recurringCourseSchedule.deleteMany({ where: { id: { in: schedules } } });
  await prisma.enrollment.deleteMany({ where: { levelId: { in: levels } } });
  await prisma.administrativeGroup.deleteMany({ where: { id: { in: groups } } });
  await prisma.levelSubject.deleteMany({ where: { levelId: { in: levels } } });
  await prisma.level.deleteMany({ where: { id: { in: levels } } });
  await prisma.subject.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeEach(async () => {
  await clear();
  actorId = (
    await prisma.user.create({ data: { nameArabic: `${TAG} مديرة`, accountStatus: 'active' } })
  ).id;
  branchId = (await prisma.branch.create({ data: { name: `${TAG} فرع` } })).id;
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe('deleting an Event (الأنشطة)', () => {
  it('leaves a Trash entry, not just a tombstone', async () => {
    const event = await prisma.event.create({
      data: {
        title: `${TAG} نشاط`,
        startDate: new Date('2026-10-01'),
        visibility: 'public',
        recurrenceType: 'none',
      },
    });
    await prisma.eventBranch.create({ data: { eventId: event.id, branchId } });

    await deleteEvent(prisma, actor(), event.id);

    const entry = await prisma.trash.findFirst({
      where: { targetEntity: 'Event', targetId: event.id },
    });
    expect(entry).not.toBeNull();
    expect(entry!.deletedById).toBe(actorId);
    // BR-15's window is the deadline for acting, so it has to be on the row.
    expect(entry!.purgeAfter.getTime()).toBeGreaterThan(Date.now());
  });

  it('captures the scope joins, which the delete HARD removes', async () => {
    // Without this the snapshot describes an event that reaches nobody: the
    // joins are gone from the database, so the snapshot is the only record that
    // this event was ever scoped to that branch.
    const event = await prisma.event.create({
      data: {
        title: `${TAG} نشاط بنطاق`,
        startDate: new Date('2026-10-02'),
        visibility: 'public',
        recurrenceType: 'none',
      },
    });
    await prisma.eventBranch.create({ data: { eventId: event.id, branchId } });

    await deleteEvent(prisma, actor(), event.id);

    const entry = await prisma.trash.findFirstOrThrow({
      where: { targetEntity: 'Event', targetId: event.id },
    });
    const snapshot = entry.snapshot as { scope?: { branch_ids?: string[] } };
    expect(snapshot.scope?.branch_ids).toEqual([branchId]);
    expect(await prisma.eventBranch.count({ where: { eventId: event.id } })).toBe(0);
  });
});

describe('deleting a Course Schedule (الحصص)', () => {
  it('leaves a Trash entry carrying its staff and the occurrences it removed', async () => {
    const fixture = await createTeachingContext(prisma, TAG, branchId);
    await prisma.courseScheduleStaff.create({
      data: { scheduleId: fixture.scheduleId, userId: actorId, position: 'teacher' },
    });

    await deleteCourseSchedule(prisma, actor(), fixture.scheduleId);

    const entry = await prisma.trash.findFirst({
      where: { targetEntity: 'RecurringCourseSchedule', targetId: fixture.scheduleId },
    });
    expect(entry).not.toBeNull();
    const snapshot = entry!.snapshot as {
      staff?: { userId: string }[];
      removed_session_ids?: string[];
    };
    // `CourseScheduleStaff` is what makes a teacher's reach expressible (§4.4c),
    // so a schedule restored without it is a class nobody teaches.
    expect(snapshot.staff?.map((s) => s.userId)).toContain(actorId);
    expect(Array.isArray(snapshot.removed_session_ids)).toBe(true);
  });
});

describe('the structural guard', () => {
  it('names any service that writes a tombstone without a Trash snapshot', () => {
    // The discipline that failed here was "remember to snapshot", so this does
    // not enumerate entities — it reads the sources. A new service that
    // soft-deletes and forgets is named by this test on the day it is written,
    // rather than on the day somebody looks in the Trash for a record that
    // never arrived.
    const dir = new URL('.', import.meta.url).pathname;
    const offenders: string[] = [];

    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.service.ts')) continue;
      const source = readFileSync(join(dir, file), 'utf8');
      const tombstones = /deletedAt:\s*(new Date\(\)|stamp|now)\b/.test(source);
      const snapshots = /(trash\.)?snapshot\(/.test(source);
      if (tombstones && !snapshots) offenders.push(file);
    }

    expect(offenders, `soft-delete without a Trash snapshot: ${offenders.join(', ')}`).toEqual([
      // `enrollment.service.ts` is the one deliberate exception, and TD-5 states
      // it: un-enrolment is a **membership** ending, not a record being deleted.
      // §4.10 keeps the grades and submissions, the student is untouched, and
      // there is nothing to restore that re-enrolling does not do properly —
      // through the roster screen, with its own audit row (`enrollment.delete`).
      'enrollment.service.ts',
    ]);
  });
});
