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
): Promise<{ cancelled: number; restored: number; activityDates: { cancelled: number; released: number } }> {
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
  // R224 §2 — the activity dates it cancelled go with it, or are re-read.
  const activities = await applyHolidayToActivities(tx, eventId, holiday);
  if (holiday === null) return { cancelled: 0, restored: release.length, activityDates: activities };

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
  return { cancelled: cancel.length, restored: release.length, activityDates: activities };
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

/* ── R224 §2 — a holiday cancels the activity dates it covers ──────────── */

/**
 * **SRS Revision 224 §2 (the Owner, 2026-10-16: «everything regarding that
 * category during that holiday should be canceled, even the activities, then
 * it's up to teachers and admin to إعادة البرمجة»).** The same coverage as a
 * class: the date is one of the holiday's days, the hours overlap when both
 * have hours, the branch and the Category meet. An activity's dimensions are
 * read as the calendar reads them (R169 §6): a Category named directly or
 * through a Level or a group, a branch named directly or through a group; a
 * holiday with hours covers only an activity whose hours meet them; a
 * dimension it leaves empty is «الكل» — every Category, every branch — so it is
 * covered only by a holiday that covers them all. A holiday never cancels a
 * holiday. Each covered date is a row (`EventDateCancellation`); a restored
 * row («إعادة البرمجة») is left alone; what the holiday no longer covers, or
 * all of it once the holiday is deleted, is removed.
 */
const ACTIVITY_SELECT = {
  id: true,
  startDate: true,
  endDate: true,
  startTime: true,
  endTime: true,
  recurrenceType: true,
  recurrenceEndDate: true,
  branchScopes: { select: { branchId: true } },
  categoryScopes: { select: { categoryId: true } },
  levelScopes: { select: { level: { select: { categoryId: true } } } },
  administrativeGroupScopes: {
    select: { administrativeGroup: { select: { branchId: true, level: { select: { categoryId: true } } } } },
  },
} as const;
type Activity = Prisma.EventGetPayload<{ select: typeof ACTIVITY_SELECT }>;

interface Universe {
  branches: number;
  categories: number;
}

function meets(holidayIds: readonly string[], mine: ReadonlySet<string>, all: number): boolean {
  if (holidayIds.length === 0) return true;
  // «الكل» on the activity: only a holiday naming every one of them covers it.
  if (mine.size === 0) return new Set(holidayIds).size >= all;
  return [...mine].some((id) => holidayIds.includes(id));
}

function coveredDates(holiday: HolidayCoverage, activity: Activity, universe: Universe): Date[] {
  const categories = new Set([
    ...activity.categoryScopes.map((r) => r.categoryId),
    ...activity.levelScopes.map((r) => r.level.categoryId),
    ...activity.administrativeGroupScopes.map((r) => r.administrativeGroup.level.categoryId),
  ]);
  const branches = new Set([
    ...activity.branchScopes.map((r) => r.branchId),
    ...activity.administrativeGroupScopes.map((r) => r.administrativeGroup.branchId),
  ]);
  if (!meets(holiday.categoryIds, categories, universe.categories)) return [];
  if (!meets(holiday.branchIds, branches, universe.branches)) return [];
  // A holiday with hours covers only the activities whose hours meet them; an
  // activity with no hours (the whole day) is covered by a whole-day holiday.
  if (holiday.startTime !== null && holiday.endTime !== null) {
    if (activity.startTime === null || activity.endTime === null) return [];
    if (!timesOverlap(holiday.startTime, holiday.endTime, activity.startTime, activity.endTime)) return [];
  }
  const first = holiday.startDate;
  const last =
    holiday.recurrenceType === 'none'
      ? (holiday.endDate ?? holiday.startDate)
      : (holiday.recurrenceEndDate ?? new Date(Date.UTC(first.getUTCFullYear() + 1, first.getUTCMonth(), first.getUTCDate())));
  return expandEvent(activity, first, last).filter((day) => expandEvent(holiday, day, day).length > 0);
}

async function universeOf(tx: Prisma.TransactionClient): Promise<Universe> {
  const [branches, categories] = await Promise.all([
    tx.branch.count({ where: { deletedAt: null } }),
    tx.category.count({ where: { deletedAt: null } }),
  ]);
  return { branches, categories };
}

async function applyHolidayToActivities(
  tx: Prisma.TransactionClient,
  holidayId: string,
  holiday: HolidayCoverage | null,
): Promise<{ cancelled: number; released: number }> {
  const existing = await tx.eventDateCancellation.findMany({
    where: { cancelledByEventId: holidayId },
    select: { id: true, eventId: true, date: true },
  });
  const keep = new Set<string>();
  let cancelled = 0;
  if (holiday !== null) {
    const universe = await universeOf(tx);
    const last =
      holiday.recurrenceType === 'none' ? (holiday.endDate ?? holiday.startDate) : holiday.recurrenceEndDate;
    const activities = await tx.event.findMany({
      where: {
        deletedAt: null,
        id: { not: holidayId },
        // A holiday never cancels a holiday.
        NOT: { schedulingType: { structuralKind: 'holiday' } },
        ...(last ? { startDate: { lte: last } } : {}),
      },
      select: ACTIVITY_SELECT,
    });
    for (const activity of activities) {
      for (const day of coveredDates(holiday, activity, universe)) {
        keep.add(`${activity.id}|${day.toISOString()}`);
        const row = await tx.eventDateCancellation.findUnique({
          where: { eventId_date: { eventId: activity.id, date: day } },
          select: { id: true },
        });
        // A date already cancelled — by this holiday, by another, or restored
        // («إعادة البرمجة») — stays as it is.
        if (row !== null) continue;
        await tx.eventDateCancellation.create({
          data: { eventId: activity.id, date: day, cancelledByEventId: holidayId, reason: reasonFor(holiday) },
        });
        cancelled += 1;
      }
    }
  }
  const release = existing.filter((r) => !keep.has(`${r.eventId}|${r.date.toISOString()}`)).map((r) => r.id);
  if (release.length > 0) await tx.eventDateCancellation.deleteMany({ where: { id: { in: release } } });
  return { cancelled, released: release.length };
}

/**
 * R224 §2 — an activity created or edited is read against every live holiday:
 * its covered dates are cancelled, and the dates no longer in it, or no longer
 * covered, come back.
 */
export async function applyHolidaysToActivity(tx: Prisma.TransactionClient, activityId: string): Promise<number> {
  const activity = await tx.event.findFirst({
    where: { id: activityId, deletedAt: null, NOT: { schedulingType: { structuralKind: 'holiday' } } },
    select: ACTIVITY_SELECT,
  });
  const existing = await tx.eventDateCancellation.findMany({
    where: { eventId: activityId },
    select: { id: true, date: true, cancelledByEventId: true, restoredAt: true },
  });
  if (activity === null) return 0;
  const universe = await universeOf(tx);
  const holidays = (
    await tx.event.findMany({
      where: { deletedAt: null, schedulingType: { structuralKind: 'holiday' } },
      select: HOLIDAY_SELECT,
    })
  ).map(toCoverage);
  const wanted = new Map<string, HolidayCoverage>();
  for (const holiday of holidays) {
    for (const day of coveredDates(holiday, activity, universe)) {
      if (!wanted.has(day.toISOString())) wanted.set(day.toISOString(), holiday);
    }
  }
  // Unrestored rows whose date is no longer covered come back.
  const stale = existing.filter((r) => r.restoredAt === null && !wanted.has(r.date.toISOString())).map((r) => r.id);
  if (stale.length > 0) await tx.eventDateCancellation.deleteMany({ where: { id: { in: stale } } });
  const have = new Set(existing.map((r) => r.date.toISOString()));
  let cancelled = 0;
  for (const [iso, holiday] of wanted) {
    if (have.has(iso)) continue;
    await tx.eventDateCancellation.create({
      data: { eventId: activityId, date: new Date(iso), cancelledByEventId: holiday.id, reason: reasonFor(holiday) },
    });
    cancelled += 1;
  }
  return cancelled;
}

/**
 * **SRS Revision 237 — a children's and teens' holiday covers every programme
 * that is not an adult one, including one created later** (the Owner,
 * 2026-10-21: «i added some events for اليافعين but the sessions of those
 * events in the vacations days were not canceled, include all categories
 * except the women one to be canceled automatically in all vacations, for
 * women category only the official ones that are concerning adults»).
 *
 * A holiday that names Categories, none of them adult (`holds_own_login` is
 * the adult marker — the women's programme), is a school holiday: it gains
 * every live non-adult Category it lacks. A holiday naming no Category (every
 * one, the official days) or naming an adult one is left as it is. Returns the
 * holidays that changed, for the caller to re-apply.
 */
export async function widenYoungHolidays(tx: Prisma.TransactionClient): Promise<string[]> {
  const young = await tx.category.findMany({
    // Not adult: `false`, or not stated — `NOT true` would drop the NULLs (SQL).
    where: { deletedAt: null, OR: [{ holdsOwnLogin: false }, { holdsOwnLogin: null }] },
    select: { id: true },
  });
  const youngIds = new Set(young.map((c) => c.id));
  const holidays = await tx.event.findMany({
    where: { deletedAt: null, schedulingType: { structuralKind: 'holiday' } },
    select: { id: true, categoryScopes: { select: { categoryId: true } } },
  });
  const changed: string[] = [];
  for (const holiday of holidays) {
    const named = holiday.categoryScopes.map((r) => r.categoryId);
    if (named.length === 0 || named.some((id) => !youngIds.has(id))) continue;
    const missing = [...youngIds].filter((id) => !named.includes(id));
    if (missing.length === 0) continue;
    await tx.eventCategory.createMany({ data: missing.map((categoryId) => ({ eventId: holiday.id, categoryId })) });
    changed.push(holiday.id);
  }
  return changed;
}
