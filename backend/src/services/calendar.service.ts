import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { publicDisplayName } from '../lib/display-name.js';
import { baseHijri, sortMonthStarts, type MonthStart } from '../lib/hijri.js';
import * as scope from '../policies/branch-scope.js';
import { expandEvent, expandGroup } from '../lib/recurrence.js';

/**
 * Recurrence expansion moved to `lib/recurrence.ts` (Revision 43): §4.4 makes
 * the recurrence vocabulary ONE shared value object used by both `Event` and
 * `RecurringCourseSchedule`, so its arithmetic cannot live inside the calendar
 * service. Re-exported here so existing callers and their tests are unaffected.
 */
export { expandEvent, expandGroup };
import type { RoleScope } from '../policies/branch-scope.js';
import { teacherEventScope } from '../policies/roster-resolution.js';

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
  categoryId?: string;
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
  /* Revision 36 — the occurrence is self-sufficient, so opening an event costs
     no further request. Fields a given kind has no source for stay null rather
     than being invented: an Event has no room or instructor, a Group no
     description or recurrence. */
  description: string | null;
  recurrence: string | null;
  branchName: string | null;
  roomName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  levelId: string | null;
  levelName: string | null;
  /** Revision 36.1: `displayName` is ALREADY RESOLVED — clients render it
   *  verbatim and implement no fallback. */
  instructors: { id: string; displayName: string }[];
  /**
   * The decorative Hijri overlay (§4.4, §5.7), read from the Ministry's
   * official announcements as recorded in `HijriMonthStart` (Revisions 31–32).
   * `null` when the month has not been recorded and published — `DualDateDisplay`
   * then renders the Gregorian date alone rather than a computed guess.
   */
  hijriDate: string | null;
  hijriMonthArabic: string | null;
}

/**
 * Loads the published official month starts that could cover this range
 * (Revisions 31–32). One query per request, not one per occurrence.
 *
 * The window is widened by a month on each side because resolution walks
 * **backwards** to the month containing a date: a date early in `from`'s month
 * belongs to a month that began before `from`, and the *following* start is
 * what bounds the last month's length.
 */
async function publishedMonthStarts(
  prisma: Pick<PrismaClient, 'hijriMonthStart'>,
  from: Date,
  to: Date,
): Promise<MonthStart[]> {
  const MARGIN_DAYS = 40;
  const margin = MARGIN_DAYS * 86_400_000;
  const rows = await prisma.hijriMonthStart.findMany({
    where: {
      deletedAt: null,
      status: 'published',
      gregorianStartDate: {
        gte: new Date(from.getTime() - margin),
        lte: new Date(to.getTime() + margin),
      },
    },
    select: { hijriYear: true, hijriMonth: true, gregorianStartDate: true },
  });
  return sortMonthStarts(rows);
}

/** The overlay fields for one occurrence, resolved from official data. */
function hijri(date: Date, starts: readonly MonthStart[]): Pick<Occurrence, 'hijriDate' | 'hijriMonthArabic'> {
  const h = baseHijri(date, starts);
  if (!h) return { hijriDate: null, hijriMonthArabic: null };
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
    // Revision 43: resolved from the courses they staff (§4.4c), which is the
    // single definition of a teacher's reach. The retired path asked
    // `GroupTeacher` and then read `Group` for its level and branch; a schedule
    // states its branch directly, and the derivation lives with the rest of the
    // rule rather than here.
    const { branchIds, levelIds, categoryIds, administrativeGroupIds: groupIds } =
      await teacherEventScope(prisma, actor.userId);

    // §4.4: a Teacher sees Hidden events whose scope intersects their teaching
    // scope — one of their Administrative Groups, or the level, category or
    // branch of anything they teach, or a global event — and never one
    // belonging exclusively to groups they do not teach.
    const intersects = {
      OR: [
        { administrativeGroupScopes: { some: { administrativeGroupId: { in: groupIds } } } },
        { levelScopes: { some: { levelId: { in: levelIds } } } },
        { categoryScopes: { some: { categoryId: { in: categoryIds } } } },
        { branchScopes: { some: { branchId: { in: branchIds } } } },
        // A global event reaches everyone with no scope rows to intersect.
        {
          AND: [
            { administrativeGroupScopes: { none: {} } },
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
  if (query.categoryId) {
    scopeFilters.push({ categoryScopes: { some: { categoryId: query.categoryId } } });
  }
  if (query.groupId) {
    scopeFilters.push({
      administrativeGroupScopes: { some: { administrativeGroupId: query.groupId } },
    });
  }

  const events = await prisma.event.findMany({
    where: {
      deletedAt: null,
      startDate: { lte: query.to },
      ...(await visibilityFilter(prisma, actor)),
      ...(scopeFilters.length ? { AND: scopeFilters } : {}),
    },
    include: {
      branchScopes: { select: { branch: { select: { id: true, name: true } } }, take: 1 },
      categoryScopes: { select: { category: { select: { id: true, name: true } } }, take: 1 },
      levelScopes: { select: { level: { select: { id: true, name: true } } }, take: 1 },
    },
  });

  // One read per request, applied to every occurrence below.
  const monthStarts = await publishedMonthStarts(prisma, from, query.to);

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
        branchId: event.branchScopes[0]?.branch.id ?? null,
        description: event.description,
        recurrence: event.recurrenceType,
        branchName: event.branchScopes[0]?.branch.name ?? null,
        // An Event is the exception layer (§4.4); it has no room and no
        // instructor of its own.
        roomName: null,
        categoryId: event.categoryScopes[0]?.category.id ?? null,
        categoryName: event.categoryScopes[0]?.category.name ?? null,
        levelId: event.levelScopes[0]?.level.id ?? null,
        levelName: event.levelScopes[0]?.level.name ?? null,
        instructors: [],
        ...hijri(date, monthStarts),
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
        // A Group has no category of its own; it inherits it through its Level.
        ...(query.categoryId ? { level: { categoryId: query.categoryId } } : {}),
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
      include: {
        branch: { select: { name: true } },
        room: { select: { name: true } },
        level: { select: { id: true, name: true, category: { select: { id: true, name: true } } } },
        teachers: {
          where: { deletedAt: null },
          select: {
            teacher: { select: { id: true, nameArabic: true, publicDisplayName: true } },
          },
        },
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
          // A Group is the routine timetable; its description and recurrence
          // are the weekly slot itself, so neither field applies.
          description: null,
          recurrence: null,
          branchName: group.branch.name,
          roomName: group.room?.name ?? null,
          categoryId: group.level.category.id,
          categoryName: group.level.category.name,
          levelId: group.level.id,
          levelName: group.level.name,
          instructors: group.teachers.map((assignment) => ({
            id: assignment.teacher.id,
            displayName: publicDisplayName(assignment.teacher),
          })),
          ...hijri(date, monthStarts),
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
