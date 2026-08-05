import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { publicDisplayName } from '../lib/display-name.js';
import { baseHijri, sortMonthStarts, type MonthStart } from '../lib/hijri.js';
import * as scope from '../policies/branch-scope.js';
import { visibleContentIds } from './library.service.js';
import { expandEvent } from '../lib/recurrence.js';

/**
 * Recurrence expansion moved to `lib/recurrence.ts` (Revision 43): §4.4 makes
 * the recurrence vocabulary ONE shared value object used by both `Event` and
 * `RecurringCourseSchedule`, so its arithmetic cannot live inside the calendar
 * service. Re-exported here so existing callers and their tests are unaffected.
 */
export { expandEvent };
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
  /** TD-3.4 names this `administrative_group_id`; `group_id` was a paraphrase
   *  of a key the specification spells out (cf. CHANGES.log M3b-14b). */
  administrativeGroupId?: string;
  academicYearId?: string;
  subjectId?: string;
  teacherId?: string;
}

export interface Occurrence {
  kind: 'session' | 'event';
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
  /* Sessions only (TD-3.4, R43). An Event has no subject, no teaching mode and
     no lifecycle, so these stay null for it rather than being invented. */
  subjectId: string | null;
  subjectName: string | null;
  teachingMode: string | null;
  /**
   * **Who the class is for**, in one string the calendar can render without a
   * second request (§4.4c): the Administrative Group's name, the Teaching
   * Group's, or the Level's, according to the mode. It previously travelled
   * inside `description`, which meant a session's description field held
   * something that was not a description and an Event's held something that
   * was — TD-3.4 (R43) gives it its own name.
   */
  audienceLabel: string | null;
  /** TD-1 lifecycle. A cancelled occurrence still appears — the calendar's job
   *  is to say a class is not happening, not to hide that it was scheduled. */
  status: string | null;
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

/**
 * The columns a Session occurrence needs, in one place.
 *
 * `GET /calendar` and `GET /calendar/sessions/{id}` return **the same
 * occurrence** (TD-3.4: *"the occurrence above, plus …"*). Two `include` blocks
 * and two mappers would be two shapes that agree today, and this project's own
 * history is that the copy drifts — so both read this constant and call the one
 * mapper below.
 */
const SESSION_OCCURRENCE_INCLUDE = {
  room: { select: { name: true } },
  staff: {
    where: { deletedAt: null },
    select: { user: { select: { id: true, nameArabic: true, publicDisplayName: true } } },
  },
  schedule: {
    select: {
      branchId: true,
      branch: { select: { name: true } },
      subject: { select: { id: true, name: true } },
      teachingMode: true,
      level: { select: { id: true, name: true, category: { select: { id: true, name: true } } } },
      administrativeGroup: {
        select: {
          name: true,
          level: { select: { id: true, name: true, category: { select: { id: true, name: true } } } },
        },
      },
      teachingGroup: {
        select: {
          name: true,
          level: { select: { id: true, name: true, category: { select: { id: true, name: true } } } },
        },
      },
    },
  },
} as const;

type SessionWithOccurrenceData = Prisma.SessionGetPayload<{
  include: typeof SESSION_OCCURRENCE_INCLUDE;
}>;

/** The single Session → `Occurrence` mapping. */
function sessionOccurrence(
  session: SessionWithOccurrenceData,
  monthStarts: readonly MonthStart[],
): Occurrence {
  const sch = session.schedule;
  const level = sch.level ?? sch.administrativeGroup?.level ?? sch.teachingGroup?.level ?? null;
  return {
    kind: 'session',
    id: session.id,
    title: sch.subject.name,
    date: iso(session.date),
    startTime: hhmm(session.startTime),
    endTime: hhmm(session.endTime),
    visibility: null,
    branchId: sch.branchId,
    // A Session has no description of its own; the audience label that used to
    // be smuggled in here now has its own field.
    description: null,
    subjectId: sch.subject.id,
    subjectName: sch.subject.name,
    teachingMode: sch.teachingMode,
    audienceLabel:
      sch.administrativeGroup?.name ?? sch.teachingGroup?.name ?? level?.name ?? null,
    status: session.status,
    recurrence: null,
    branchName: sch.branch.name,
    roomName: session.room?.name ?? null,
    categoryId: level?.category.id ?? null,
    categoryName: level?.category.name ?? null,
    levelId: level?.id ?? null,
    levelName: level?.name ?? null,
    // From the session's OWN snapshot, never the schedule's (Revision 43.4).
    instructors: session.staff.map((assignment) => ({
      id: assignment.user.id,
      displayName: publicDisplayName(assignment.user),
    })),
    ...hijri(session.date, monthStarts),
  };
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
  if (query.administrativeGroupId) {
    scopeFilters.push({
      administrativeGroupScopes: {
        some: { administrativeGroupId: query.administrativeGroupId },
      },
    });
  }

  /**
   * **A filter no Event can satisfy excludes Events, rather than being ignored.**
   *
   * An Event has no subject, no academic year and no instructors (§4.4 — it is
   * the *non-teaching* layer). Asking for `subject_id=X` and receiving Events
   * back would return occurrences that plainly do not match the request, which
   * is a more misleading answer than returning fewer rows. So these three
   * narrow the grid to Sessions.
   *
   * `branch_id`, `level_id`, `category_id` and `administrative_group_id` are
   * NOT in this list: an Event *can* carry each of them through its explicit
   * scope joins, so those filter both kinds.
   */
  const sessionOnlyFilter =
    query.subjectId !== undefined ||
    query.academicYearId !== undefined ||
    query.teacherId !== undefined;

  const events = sessionOnlyFilter ? [] : await prisma.event.findMany({
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
        subjectId: null,
        subjectName: null,
        teachingMode: null,
        audienceLabel: null,
        status: null,
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

  // ── Sessions: the materialized occurrences of a Recurring Course Schedule
  // (§4.4, Revision 43). This replaced the retired `Group` weekly-slot
  // expansion entirely.
  //
  // **Two consequences of the new model are visible right here:**
  //
  // 1. **No expansion happens.** A session IS a row with a date, so the
  //    calendar reads rather than computes. That is the same property that
  //    makes conflict detection exact (§4.4).
  // 2. **The occurrence carries its OWN room and staff** (Revision 43.4), so a
  //    class taught last March shows the person who actually taught it even
  //    after the schedule changed hands. Reading the schedule's staff here
  //    would have silently rewritten history on every calendar load.
  //
  // **Sessions are PUBLIC (§4.4, Revision 43)** — anonymous visitors browse the
  // timetable. That reverses the retired rule, under which a Group timetable was
  // visible only to signed-in users.
  {
    const sessions = await prisma.session.findMany({
      where: {
        deletedAt: null,
        date: { gte: from, lte: query.to },
        schedule: {
          deletedAt: null,
          ...(query.branchId ? { branchId: query.branchId } : {}),
          ...(query.levelId
            ? {
                OR: [
                  { levelId: query.levelId },
                  { administrativeGroup: { levelId: query.levelId } },
                  { teachingGroup: { levelId: query.levelId } },
                ],
              }
            : {}),
          ...(query.administrativeGroupId
            ? { administrativeGroupId: query.administrativeGroupId }
            : {}),
          ...(query.academicYearId ? { academicYearId: query.academicYearId } : {}),
          ...(query.subjectId ? { subjectId: query.subjectId } : {}),
        },
        // The session's OWN staffing snapshot, not the schedule's (R43.4): a
        // teacher who covered one occurrence should find it here, and one
        // removed from the schedule should not lose the ones they actually took.
        ...(query.teacherId
          ? { staff: { some: { userId: query.teacherId, deletedAt: null } } }
          : {}),
      },
      include: SESSION_OCCURRENCE_INCLUDE,
    });

    for (const session of sessions) {
      const sch = session.schedule;
      const level = sch.level ?? sch.administrativeGroup?.level ?? sch.teachingGroup?.level ?? null;
      // The category filter is applied here rather than in the query: a
      // schedule reaches its level through one of three different relations
      // depending on its teaching mode, and Prisma cannot express "whichever of
      // these is non-null" as a single filter.
      if (query.categoryId && level?.category.id !== query.categoryId) continue;

      out.push(sessionOccurrence(session, monthStarts));
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

/**
 * `prefilled_filters` (TD-3.4, R43) — the filters a signed-in caller's screen
 * opens on, derived from their profile and **freely changeable**.
 *
 * **The filter set itself is identical for everyone** (§5.2, SRS line 53). This
 * changes where the dropdowns *start*, never what they offer and never what the
 * results are — the §4.4 tier model still filters every set, for everyone.
 *
 * **A value is prefilled only when it is unambiguous, and `null` otherwise.**
 * That is the one real design decision here, and it goes the safe way: a student
 * enrolled in three Levels has no single "own Level", and picking one would open
 * their calendar on a third of their own timetable while looking like it showed
 * all of it. An unset filter shows everything they may see, which is the honest
 * default. So plural means `null`, not *first*.
 */
export interface PrefilledFilters {
  academicYearId: string | null;
  categoryId: string | null;
  levelId: string | null;
  branchId: string | null;
  subjectId: string | null;
  teacherId: string | null;
}

/** The single element, or `null` when the answer is not unique. */
function only<T>(values: T[]): T | null {
  const distinct = [...new Set(values)];
  return distinct.length === 1 ? distinct[0]! : null;
}

export async function prefilledFilters(
  prisma: PrismaClient,
  actor: CalendarActor | null,
): Promise<PrefilledFilters | null> {
  // Anonymous, or an account that grants nothing yet (TD-1): no profile to
  // derive from. `null` rather than an object of nulls — *there is nothing to
  // prefill* and *nothing was unambiguous* are different answers.
  if (actor === null || actor.accountStatus !== 'active') return null;

  const currentYear = await prisma.academicYear.findFirst({
    where: { isCurrent: true },
    select: { id: true },
  });

  // A teacher's own subjects and branches come from the schedules they staff
  // (§4.4c — CourseScheduleStaff is the resolution, stated directly).
  const staffed = await prisma.courseScheduleStaff.findMany({
    where: { userId: actor.userId, deletedAt: null, schedule: { deletedAt: null } },
    select: { schedule: { select: { branchId: true, subjectId: true } } },
  });

  // A parent has no enrolments of their own; §5.2 prefills from their children,
  // reached through approved links only (§4.3).
  const links = await prisma.familyLink.findMany({
    where: { parentId: actor.userId, status: 'approved', deletedAt: null },
    select: { studentId: true },
  });

  const enrolments = await prisma.enrollment.findMany({
    where: {
      studentId: { in: [actor.userId, ...links.map((l) => l.studentId)] },
      deletedAt: null,
      administrativeGroup: { deletedAt: null },
    },
    select: {
      levelId: true,
      level: { select: { categoryId: true } },
      administrativeGroup: { select: { branchId: true } },
    },
  });

  // An administrator's scope is their branches; a single-branch admin gets that
  // branch, an all-branches one gets nothing to prefill, which is correct.
  const scopedBranches = scope.reachableBranches(actor.roleScopes, ['admin', 'teacher']) ?? [];

  return {
    academicYearId: currentYear?.id ?? null,
    categoryId: only(enrolments.map((e) => e.level.categoryId)),
    levelId: only(enrolments.map((e) => e.levelId)),
    branchId: only([
      ...enrolments.map((e) => e.administrativeGroup.branchId),
      ...staffed.map((x) => x.schedule.branchId),
      ...scopedBranches,
    ]),
    subjectId: only(staffed.map((x) => x.schedule.subjectId)),
    // A teacher's calendar opens on their own sessions. Anyone else has no
    // "own teacher", and guessing one would filter a parent's calendar down to
    // a single member of staff.
    teacherId: staffed.length > 0 ? actor.userId : null,
  };
}

/* ── The §5.2 Session page (TD-3.4 `GET /calendar/sessions/{id}`) ────────── */

/**
 * One linked item, in the shape TD-3.4 names:
 * `linked_content[{ id, title, subject_id, level_id }]`.
 */
export interface SessionPageContent {
  id: string;
  title: string;
  subjectId: string;
  levelId: string;
  mimeType: string;
}

export interface SessionPage {
  occurrence: Occurrence;
  /**
   * **No storage exists for this yet.** TD-3.4 names `notes` in the response and
   * §5.2 lists them on the page, but §7 gives `Session` no notes column and
   * defines no note entity — `User.notes` is a different field on a different
   * model. Inventing a column would be a §7 schema decision, which is the
   * Document Owner's (the same class as the deferred `EducationalContent`
   * uploader field), so the endpoint ships the key with `null` rather than
   * omitting it: a client coded against TD-3.4 finds the field where the
   * specification says it is, and the gap is visible instead of silent.
   */
  notes: null;
  /**
   * Session **recordings** — §4.9's recording resources, which are exactly the
   * audio items among the linked content (video is excluded from the MVP
   * entirely, §4.9). These are what BR-2's consent gate forces private, which is
   * why §5.2 says an anonymous visitor sees a public session's details but
   * *never its private recordings*.
   */
  recordings: SessionPageContent[];
  /** The linked materials — the linked content that is not a recording, so the
   *  two lists are disjoint and each answers a different question. */
  linkedContent: SessionPageContent[];
}

/**
 * The §5.2 Session page: the calendar occurrence, plus what is attached to it.
 *
 * **Public, at the caller's tier.** The occurrence itself is public — §4.4
 * (Revision 43) made the timetable browsable by anonymous visitors — while the
 * attached content passes the §4.9 tiers through `visibleContentIds`, the *same*
 * rule the library list applies. That is the whole shape of §5.2's sentence: an
 * anonymous visitor sees a public session's existence and details, never its
 * private recordings.
 */
export async function readSessionPage(
  prisma: PrismaClient,
  actor: CalendarActor | null,
  sessionId: string,
): Promise<SessionPage> {
  const session = await prisma.session.findFirst({
    where: { id: sessionId, deletedAt: null, schedule: { deletedAt: null } },
    include: SESSION_OCCURRENCE_INCLUDE,
  });
  if (!session) throw new AppError('NOT_FOUND', 'no such session');

  const monthStarts = await publishedMonthStarts(prisma, session.date, session.date);

  const links = await prisma.sessionContent.findMany({
    where: { sessionId, deletedAt: null, content: { deletedAt: null } },
    select: {
      content: {
        select: { id: true, title: true, subjectId: true, levelId: true, mimeType: true },
      },
    },
  });

  const visible = await visibleContentIds(
    prisma,
    actor,
    links.map((l) => l.content.id),
  );
  const items = links
    .map((l) => l.content)
    .filter((c) => visible.has(c.id))
    .map((c) => ({
      id: c.id,
      title: c.title,
      subjectId: c.subjectId,
      levelId: c.levelId,
      mimeType: c.mimeType,
    }));

  return {
    occurrence: sessionOccurrence(session, monthStarts),
    notes: null,
    // §4.9: teachers upload phone recordings, and video is excluded entirely, so
    // "is this a recording" is exactly "is this audio".
    recordings: items.filter((c) => c.mimeType.startsWith('audio/')),
    linkedContent: items.filter((c) => !c.mimeType.startsWith('audio/')),
  };
}
