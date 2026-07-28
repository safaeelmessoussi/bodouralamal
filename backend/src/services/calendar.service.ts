import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { toHijri } from '../lib/hijri.js';
import * as scope from '../policies/branch-scope.js';
import type { RoleScope } from '../policies/branch-scope.js';
import { teacherGroupIds } from '../policies/teacher-scope.js';

/**
 * Calendar read (SRS §4.4, TD-3.4, TD-11, §19.2).
 *
 * One unified grid over **two different things**: the recurring weekly timetable
 * that Groups carry (§4.4 — *"scheduling is Group-driven"*), and the one-off
 * Event exception layer laid on top of it.
 *
 * **All date arithmetic is wall-clock and DST-immune by construction.** Dates
 * are `date` columns and times are `time` columns; nothing is ever converted to
 * an instant, so a 09:00 class stays at 09:00 across Morocco's Ramadan DST
 * shift. §19.2 names that as a mandatory regression test, and it is asserted
 * rather than assumed.
 *
 * **Visibility is resolved server-side per §4.4's three tiers**, and the
 * endpoint is public: an unauthenticated caller sees the public tier and
 * nothing else.
 */

export interface CalendarActor {
  userId: string;
  roles: string[];
  roleScopes: RoleScope[];
  accountStatus: string;
}

export interface CalendarQuery {
  from: Date;
  to: Date;
  branchId?: string;
  levelId?: string;
  groupId?: string;
}

export interface Occurrence {
  kind: 'group' | 'event';
  id: string;
  title: string;
  /** Local calendar date, `YYYY-MM-DD` (TD-11) — never an instant. */
  date: string;
  startTime: string | null;
  endTime: string | null;
  visibility: string | null;
  branchId: string | null;
  /**
   * The decorative Hijri overlay (§4.4, §5.7) with the admin day-offset already
   * applied, so `DualDateDisplay` renders it without re-deriving anything. It
   * is a label: nothing in scheduling or recurrence reads it back.
   */
  hijriDate: string;
  hijriMonthArabic: string;
}

/** §5.7/TD-9: the Super-Admin-set day-offset, −2…+2. */
const HIJRI_OFFSET_KEY = 'hijri.day_offset';

/**
 * Reads the offset for this request. An absent or non-numeric row means 0 —
 * `/calendar` is public and must not fail over a decorative label; TD-9's range
 * is enforced where the setting is written, and `toHijri` clamps regardless.
 */
async function hijriOffset(prisma: Pick<PrismaClient, 'systemSetting'>): Promise<number> {
  const row = await prisma.systemSetting.findUnique({ where: { key: HIJRI_OFFSET_KEY } });
  return typeof row?.value === 'number' ? row.value : 0;
}

/** The overlay fields for one occurrence, offset already applied. */
function hijri(date: Date, offset: number): Pick<Occurrence, 'hijriDate' | 'hijriMonthArabic'> {
  const h = toHijri(date, offset);
  return { hijriDate: h.iso, hijriMonthArabic: h.monthNameArabic };
}

/** TD-10-style guard: an unbounded range would expand every recurrence forever. */
const MAX_RANGE_DAYS = 366;

const iso = (d: Date): string => d.toISOString().slice(0, 10);
const hhmm = (d: Date | null): string | null =>
  d === null
    ? null
    : `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;

/** Whole days between two calendar dates — pure date arithmetic, no timezone. */
const daysBetween = (a: Date, b: Date): number =>
  Math.round((b.getTime() - a.getTime()) / 86_400_000);

const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * 86_400_000);

/** §4.4: the week starts on Monday. `Date.getUTCDay()` is Sunday-based. */
const DAY_INDEX: Record<string, number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 0,
};

/**
 * Expands one event into the dates it occurs on within `[from, to]`.
 *
 * Every branch is integer day arithmetic on UTC-midnight dates. That is the
 * whole DST defence: no local-time conversion happens, so a clock shift cannot
 * move an occurrence to a different day or hour.
 */
export function expandEvent(
  event: {
    startDate: Date;
    endDate: Date | null;
    recurrenceType: string;
    recurrenceEndDate: Date | null;
  },
  from: Date,
  to: Date,
): Date[] {
  const last = event.recurrenceEndDate && event.recurrenceEndDate < to ? event.recurrenceEndDate : to;
  if (event.startDate > last) return [];

  const out: Date[] = [];
  const push = (d: Date): void => {
    if (d >= from && d <= last) out.push(d);
  };

  switch (event.recurrenceType) {
    case 'none': {
      // A multi-day one-off occupies every day of its span.
      const end = event.endDate ?? event.startDate;
      for (let d = event.startDate; d <= end; d = addDays(d, 1)) push(d);
      break;
    }
    case 'daily':
      for (let d = event.startDate; d <= last; d = addDays(d, 1)) push(d);
      break;
    case 'weekly':
      for (let d = event.startDate; d <= last; d = addDays(d, 7)) push(d);
      break;
    case 'biweekly_alternating':
      // §4.4's "week on / week off": every fourteenth day from the start.
      for (let d = event.startDate; d <= last; d = addDays(d, 14)) push(d);
      break;
    case 'yearly': {
      const startYear = event.startDate.getUTCFullYear();
      for (let year = startYear; ; year += 1) {
        const d = new Date(
          Date.UTC(year, event.startDate.getUTCMonth(), event.startDate.getUTCDate()),
        );
        if (d > last) break;
        push(d);
      }
      break;
    }
    default:
      break;
  }
  return out;
}

/** Expands a Group's fixed weekly slot across the range (§4.4). */
export function expandGroup(dayOfWeek: string, from: Date, to: Date): Date[] {
  const target = DAY_INDEX[dayOfWeek];
  if (target === undefined) return [];

  const out: Date[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (d.getUTCDay() === target) out.push(d);
  }
  return out;
}

const isSuperAdmin = (a: CalendarActor | null) => a !== null && scope.isSuperAdmin(a.roleScopes);
const isAdmin = (a: CalendarActor | null) =>
  a !== null && (scope.hasRole(a.roleScopes, 'admin') || isSuperAdmin(a));
const isTeacher = (a: CalendarActor | null) => a !== null && scope.hasRole(a.roleScopes, 'teacher');

/**
 * Builds the §4.4 visibility filter for Events.
 *
 * The tiers are deliberately not symmetrical, and the asymmetries are the
 * SRS's own accepted decisions rather than oversights:
 *
 *   - **Private is NOT filtered by a Student's own branch or group** (§4.4
 *     records this as a deliberate trade-off, Risk R-6).
 *   - **Hidden is visible to ALL Admins regardless of branch scope**, while
 *     Private is limited to staff within their scope.
 *   - A **Pending** user sees the public tier only, exactly like an anonymous
 *     visitor — the account exists but grants nothing (TD-1).
 */
async function visibilityFilter(
  prisma: PrismaClient,
  actor: CalendarActor | null,
): Promise<Record<string, unknown>> {
  // Anonymous, or an account that is not yet approved.
  if (actor === null || actor.accountStatus !== 'active') {
    return { visibility: 'public' };
  }

  if (isSuperAdmin(actor)) return {};

  if (isAdmin(actor)) {
    const reachable = scope.reachableBranches(actor.roleScopes, ['admin']);
    if (reachable === null) return {};
    return {
      OR: [
        { visibility: 'public' },
        // Hidden: all Admins, regardless of branch scope (§4.4, accepted).
        { visibility: 'hidden' },
        // Private: staff within their branch scope. A global event (no branch
        // rows at all) is in scope for everyone by construction.
        {
          visibility: 'private',
          OR: [
            { branchScopes: { some: { branchId: { in: reachable } } } },
            { branchScopes: { none: {} } },
          ],
        },
      ],
    };
  }

  if (isTeacher(actor)) {
    const groupIds = await teacherGroupIds(prisma, actor.userId);
    const groups = await prisma.group.findMany({
      where: { id: { in: groupIds } },
      select: { id: true, branchId: true, levelId: true, level: { select: { categoryId: true } } },
    });
    const branchIds = [...new Set(groups.map((g) => g.branchId))];
    const levelIds = [...new Set(groups.map((g) => g.levelId))];
    const categoryIds = [...new Set(groups.map((g) => g.level.categoryId))];

    // §4.4: a Teacher sees Hidden events whose scope intersects their assigned
    // groups — the group itself, its level, category or branch, or a global
    // event — and never one belonging exclusively to groups they do not teach.
    const intersects = {
      OR: [
        { groupScopes: { some: { groupId: { in: groupIds } } } },
        { levelScopes: { some: { levelId: { in: levelIds } } } },
        { categoryScopes: { some: { categoryId: { in: categoryIds } } } },
        { branchScopes: { some: { branchId: { in: branchIds } } } },
        // A global event reaches everyone with no scope rows to intersect.
        {
          AND: [
            { groupScopes: { none: {} } },
            { levelScopes: { none: {} } },
            { categoryScopes: { none: {} } },
            { branchScopes: { none: {} } },
          ],
        },
      ],
    };

    return {
      OR: [
        { visibility: 'public' },
        { visibility: 'private', ...intersects },
        { visibility: 'hidden', ...intersects },
      ],
    };
  }

  // Approved Student or Parent: public and private, never hidden. Private is
  // deliberately unfiltered by branch or group (§4.4, Risk R-6).
  return { OR: [{ visibility: 'public' }, { visibility: 'private' }] };
}

/**
 * §4.4 branch-activation boundary: when the view is scoped to a branch, nothing
 * before its `operational_start_date` is rendered — *"no scheduling data or
 * events rendered"* prior to that date.
 */
async function operationalFloor(
  prisma: PrismaClient,
  branchId: string | undefined,
): Promise<Date | null> {
  if (!branchId) return null;
  const branch = await prisma.branch.findFirst({
    where: { id: branchId, deletedAt: null },
    select: { operationalStartDate: true },
  });
  return branch?.operationalStartDate ?? null;
}

export async function readCalendar(
  prisma: PrismaClient,
  actor: CalendarActor | null,
  query: CalendarQuery,
): Promise<Occurrence[]> {
  if (query.to < query.from) {
    throw new AppError('VALIDATION_FAILED', 'to must not precede from');
  }
  if (daysBetween(query.from, query.to) > MAX_RANGE_DAYS) {
    throw new AppError('VALIDATION_FAILED', `range must not exceed ${MAX_RANGE_DAYS} days`);
  }

  const floor = await operationalFloor(prisma, query.branchId);
  const from = floor && floor > query.from ? floor : query.from;
  if (from > query.to) return [];

  // ── Events, filtered by tier and by the requested scope.
  const scopeFilters: Record<string, unknown>[] = [];
  if (query.branchId) {
    scopeFilters.push({
      OR: [{ branchScopes: { some: { branchId: query.branchId } } }, { branchScopes: { none: {} } }],
    });
  }
  if (query.levelId) scopeFilters.push({ levelScopes: { some: { levelId: query.levelId } } });
  if (query.groupId) scopeFilters.push({ groupScopes: { some: { groupId: query.groupId } } });

  const events = await prisma.event.findMany({
    where: {
      deletedAt: null,
      startDate: { lte: query.to },
      ...(await visibilityFilter(prisma, actor)),
      ...(scopeFilters.length ? { AND: scopeFilters } : {}),
    },
    include: { branchScopes: { select: { branchId: true }, take: 1 } },
  });

  // One read per request, applied to every occurrence below.
  const offset = await hijriOffset(prisma);

  const out: Occurrence[] = [];
  for (const event of events) {
    for (const date of expandEvent(event, from, query.to)) {
      out.push({
        kind: 'event',
        id: event.id,
        title: event.title,
        date: iso(date),
        startTime: hhmm(event.startTime),
        endTime: hhmm(event.endTime),
        visibility: event.visibility,
        branchId: event.branchScopes[0]?.branchId ?? null,
        ...hijri(date, offset),
      });
    }
  }

  // ── The recurring Group timetable. Groups carry no visibility tier of their
  // own, so an anonymous caller sees none of them: a timetable is not public.
  if (actor !== null && actor.accountStatus === 'active') {
    const groups = await prisma.group.findMany({
      where: {
        deletedAt: null,
        ...(query.branchId ? { branchId: query.branchId } : {}),
        ...(query.levelId ? { levelId: query.levelId } : {}),
        ...(query.groupId ? { id: query.groupId } : {}),
        // A Teacher sees their own groups; staff see their branch scope.
        ...(isAdmin(actor)
          ? (() => {
              const reachable = scope.reachableBranches(actor.roleScopes, ['admin']);
              return reachable === null ? {} : { branchId: { in: reachable } };
            })()
          : isTeacher(actor)
            ? { teachers: { some: { teacherId: actor.userId, deletedAt: null } } }
            : {}),
      },
    });

    for (const group of groups) {
      for (const date of expandGroup(group.dayOfWeek, from, query.to)) {
        out.push({
          kind: 'group',
          id: group.id,
          title: group.name,
          date: iso(date),
          startTime: hhmm(group.startTime),
          endTime: hhmm(group.endTime),
          visibility: null,
          branchId: group.branchId,
          ...hijri(date, offset),
        });
      }
    }
  }

  // Deterministic order: date, then time, then id (TD-10's tiebreaker habit).
  return out.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.startTime ?? '').localeCompare(b.startTime ?? '') ||
      a.id.localeCompare(b.id),
  );
}
