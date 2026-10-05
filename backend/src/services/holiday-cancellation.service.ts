import type { Prisma } from '../generated/prisma/client.js';
import { atMidnightUtc, expandEvent, timesOverlap } from '../lib/recurrence.js';

/**
 * **SRS Revision 199 §5 — a عطلة cancels the classes it covers, reversibly**
 * (the Owner, 2026-10-05: «if a vacation is added for a category for a period
 * of time, events for that category for that period should be automatically
 * … cancelled … in case a vacation is added by mistake, the events … should
 * be recoverable»).
 *
 * A class occurrence (`Session`) is covered by a live holiday when its date is
 * one of the holiday's days (its span, or its recurrence), its time overlaps
 * the holiday's hours when the holiday has hours, its branch is one of the
 * holiday's branches (none named: every branch) and one of its Categories is
 * one of the holiday's Categories (none named: every Category). Only a
 * `scheduled` occurrence is cancelled — a held one is history, and one a
 * person cancelled keeps that person's reason. The occurrence records the
 * holiday (`cancelled_by_event_id`), so:
 *
 * - editing the holiday re-applies it: what it no longer covers comes back;
 * - deleting it brings back everything it cancelled; restoring it from the
 *   Trash cancels again;
 * - a class materialised later on a holiday is born cancelled;
 * - «إعادة البرمجة» on one occurrence still works (an administrator's choice
 *   for that date wins; the link is cleared).
 *
 * No notification is written: a holiday is itself on every calendar.
 */

/** What decides whether a holiday covers an occurrence. */
interface HolidayCoverage {
  id: string;
  title: string;
  startDate: Date;
  endDate: Date | null;
  startTime: Date | null;
  endTime: Date | null;
  recurrenceType: string;
  recurrenceEndDate: Date | null;
  branchIds: string[];
  categoryIds: string[];
}

const HOLIDAY_SELECT = {
  id: true,
  title: true,
  startDate: true,
  endDate: true,
  startTime: true,
  endTime: true,
  recurrenceType: true,
  recurrenceEndDate: true,
  branchScopes: { select: { branchId: true } },
  categoryScopes: { select: { categoryId: true } },
} as const;

/** The Categories an occurrence is for — named directly or through its Levels, groups and circles. */
const SESSION_SCOPE_SELECT = {
  id: true,
  date: true,
  startTime: true,
  endTime: true,
  status: true,
  cancelledByEventId: true,
  audienceCategories: { select: { categoryId: true } },
  audienceLevels: { select: { level: { select: { categoryId: true } } } },
  audienceAdministrativeGroups: { select: { administrativeGroup: { select: { level: { select: { categoryId: true } } } } } },
  audienceTeachingGroups: { select: { teachingGroup: { select: { level: { select: { categoryId: true } } } } } },
  schedule: {
    select: {
      branchId: true,
      level: { select: { categoryId: true } },
      administrativeGroup: { select: { level: { select: { categoryId: true } } } },
      teachingGroup: { select: { level: { select: { categoryId: true } } } },
      categoryScopes: { select: { categoryId: true } },
      levelScopes: { select: { level: { select: { categoryId: true } } } },
      administrativeGroupScopes: { select: { administrativeGroup: { select: { level: { select: { categoryId: true } } } } } },
      teachingGroupScopes: { select: { teachingGroup: { select: { level: { select: { categoryId: true } } } } } },
    },
  },
} as const;

type ScopedSession = Prisma.SessionGetPayload<{ select: typeof SESSION_SCOPE_SELECT }>;

function categoriesOf(session: ScopedSession): Set<string> {
  const own = [
    ...session.audienceCategories.map((r) => r.categoryId),
    ...session.audienceLevels.map((r) => r.level.categoryId),
    ...session.audienceAdministrativeGroups.map((r) => r.administrativeGroup.level.categoryId),
    ...session.audienceTeachingGroups.map((r) => r.teachingGroup.level.categoryId),
  ];
  // An occurrence with its own audience (R92) is that audience for its date.
  if (own.length > 0) return new Set(own);
  const sch = session.schedule;
  return new Set(
    [
      sch.level?.categoryId,
      sch.administrativeGroup?.level.categoryId,
      sch.teachingGroup?.level.categoryId,
      ...sch.categoryScopes.map((r) => r.categoryId),
      ...sch.levelScopes.map((r) => r.level.categoryId),
      ...sch.administrativeGroupScopes.map((r) => r.administrativeGroup.level.categoryId),
      ...sch.teachingGroupScopes.map((r) => r.teachingGroup.level.categoryId),
    ].filter((id): id is string => typeof id === 'string'),
  );
}

function covers(holiday: HolidayCoverage, session: ScopedSession): boolean {
  const day = atMidnightUtc(session.date);
  if (expandEvent(holiday, day, day).length === 0) return false;
  if (
    holiday.startTime !== null &&
    holiday.endTime !== null &&
    !timesOverlap(holiday.startTime, holiday.endTime, session.startTime, session.endTime)
  ) {
    return false;
  }
  if (holiday.branchIds.length > 0 && !holiday.branchIds.includes(session.schedule.branchId)) return false;
  if (holiday.categoryIds.length > 0) {
    const mine = categoriesOf(session);
    if (![...mine].some((id) => holiday.categoryIds.includes(id))) return false;
  }
  return true;
}

async function liveHoliday(tx: Prisma.TransactionClient, eventId: string): Promise<HolidayCoverage | null> {
  const row = await tx.event.findFirst({
    where: { id: eventId, deletedAt: null, schedulingType: { structuralKind: 'holiday' } },
    select: HOLIDAY_SELECT,
  });
  return row === null ? null : toCoverage(row);
}

function toCoverage(row: Prisma.EventGetPayload<{ select: typeof HOLIDAY_SELECT }>): HolidayCoverage {
  return {
    ...row,
    branchIds: row.branchScopes.map((r) => r.branchId),
    categoryIds: row.categoryScopes.map((r) => r.categoryId),
  };
}

function reasonFor(holiday: HolidayCoverage): string {
  return `عطلة: ${holiday.title}`.slice(0, 500);
}

/**
 * Re-applies ONE holiday after it was created, edited, deleted or restored:
 * its own cancellations it no longer covers come back, and the `scheduled`
 * occurrences it covers are cancelled. Returns both counts for the audit row.
 */
export async function applyHoliday(
  tx: Prisma.TransactionClient,
  eventId: string,
): Promise<{ cancelled: number; restored: number }> {
  const holiday = await liveHoliday(tx, eventId);

  // What it cancelled before, and no longer covers (all of it, once deleted).
  const mine = await tx.session.findMany({
    where: { cancelledByEventId: eventId, status: 'cancelled' },
    select: SESSION_SCOPE_SELECT,
  });
  const release = mine.filter((s) => holiday === null || !covers(holiday, s)).map((s) => s.id);
  if (release.length > 0) {
    await tx.session.updateMany({
      where: { id: { in: release } },
      data: { status: 'scheduled', cancellationReason: null, cancelledByEventId: null, version: { increment: 1 } },
    });
  }
  if (holiday === null) return { cancelled: 0, restored: release.length };

  const candidates = await tx.session.findMany({
    where: {
      deletedAt: null,
      status: 'scheduled',
      date: {
        gte: holiday.startDate,
        ...(holiday.recurrenceType === 'none'
          ? { lte: holiday.endDate ?? holiday.startDate }
          : holiday.recurrenceEndDate
            ? { lte: holiday.recurrenceEndDate }
            : {}),
      },
      schedule: {
        deletedAt: null,
        ...(holiday.branchIds.length > 0 ? { branchId: { in: holiday.branchIds } } : {}),
      },
    },
    select: SESSION_SCOPE_SELECT,
  });
  const cancel = candidates.filter((s) => covers(holiday, s)).map((s) => s.id);
  if (cancel.length > 0) {
    await tx.session.updateMany({
      where: { id: { in: cancel }, status: 'scheduled' },
      data: {
        status: 'cancelled',
        cancellationReason: reasonFor(holiday),
        cancelledByEventId: holiday.id,
        version: { increment: 1 },
      },
    });
  }
  return { cancelled: cancel.length, restored: release.length };
}

/**
 * Newly materialised occurrences on a holiday are born cancelled — the same
 * coverage rule, asked of the live holidays whose days reach them.
 */
export async function applyHolidaysToSessions(
  tx: Prisma.TransactionClient,
  sessionIds: readonly string[],
): Promise<number> {
  if (sessionIds.length === 0) return 0;
  const sessions = await tx.session.findMany({
    where: { id: { in: [...sessionIds] }, status: 'scheduled', deletedAt: null },
    select: SESSION_SCOPE_SELECT,
  });
  if (sessions.length === 0) return 0;
  const first = sessions.reduce((a, s) => (s.date < a ? s.date : a), sessions[0]!.date);
  const holidays = (
    await tx.event.findMany({
      where: {
        deletedAt: null,
        schedulingType: { structuralKind: 'holiday' },
        OR: [
          { recurrenceType: 'none', OR: [{ endDate: { gte: first } }, { endDate: null, startDate: { gte: first } }] },
          { NOT: { recurrenceType: 'none' }, OR: [{ recurrenceEndDate: null }, { recurrenceEndDate: { gte: first } }] },
        ],
      },
      select: HOLIDAY_SELECT,
    })
  ).map(toCoverage);
  let cancelled = 0;
  for (const session of sessions) {
    const holiday = holidays.find((h) => covers(h, session));
    if (!holiday) continue;
    await tx.session.update({
      where: { id: session.id },
      data: { status: 'cancelled', cancellationReason: reasonFor(holiday), cancelledByEventId: holiday.id },
    });
    cancelled += 1;
  }
  return cancelled;
}
