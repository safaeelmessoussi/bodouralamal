import type {
  ContentOrigin,
  Prisma,
  PrismaClient,
} from "../generated/prisma/client.js";
import { AppError } from "../lib/errors.js";
import {
  nextRecordingName,
  recordingBaseName,
} from "../lib/recording-name.js";
import { publicDisplayName } from "../lib/display-name.js";
import { baseHijri, sortMonthStarts, type MonthStart } from "../lib/hijri.js";
import * as scope from "../policies/branch-scope.js";
import { visibleContentIds } from "./library.service.js";
import { expandEvent } from "../lib/recurrence.js";

/**
 * Recurrence expansion moved to `lib/recurrence.ts` (Revision 43): §4.4 makes
 * the recurrence vocabulary ONE shared value object used by both `Event` and
 * `RecurringCourseSchedule`, so its arithmetic cannot live inside the calendar
 * service. Re-exported here so existing callers and their tests are unaffected.
 */
export { expandEvent };
import type { RoleScope } from "../policies/branch-scope.js";
import {
  eventsStaffedBy,
  teacherEventScope,
} from "../policies/roster-resolution.js";
import {
  eventResponsibleWhere,
  examTierWhere,
  sessionTierWhere,
} from "../policies/scheduling-visibility.js";

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
  /**
   * R84 — the Teaching Circle. **Sessions only, and that is the domain
   * speaking**: a schedule may be addressed to a circle (§4.4c), and an Event
   * cannot be — there is no `EventTeachingGroup` join, and inventing one would
   * be inventing a relationship the SRS does not define. So this narrows to
   * class occurrences, exactly as `subject_id` already does.
   */
  teachingGroupId?: string;
  /**
   * R84 — `session`, `event` or `exam`: **the storage taxonomy**, and the
   * platform's own words for what it schedules are `schedulingTypeId` below.
   * Kept because deep links carry it.
   */
  kind?: "session" | "event" | "exam";
  /**
   * **Which catalogue row** (R110, Owner 2026-09-02) — the association's own
   * vocabulary: «حصة دراسية», «محاضرة», «حفل», «عطلة».
   *
   * `kind` could not express this. Two types share one `structural_kind` —
   * عطلة and نشاط are both stored as an `Event` — so `kind=event` returned
   * both and a holiday was unfilterable. The type resolves to its kind, which
   * still selects the source; the id then narrows within it.
   *
   * **A row recording no type matches no type filter.** Every schedule and
   * sitting predating the catalogue is such a row, and inferring one from a
   * name is what §4.4b forbids. They appear under «الكل».
   */
  schedulingTypeId?: string;
}

export interface Occurrence {
  /**
   * R58 — `exam` joins the two. A physical sitting is one dated occurrence on
   * the same grid as everything else, and the interface must be able to mark it
   * out: it is the one item on a timetable somebody must not mistake for an
   * ordinary class.
   */
  kind: "session" | "event" | "exam";
  /**
   * **The catalogue row this occurrence is** (R110, Owner 2026-09-02), and its
   * `structural_kind`, so a reader can tell a عطلة from an ordinary activity —
   * `kind` says `event` for both. `null` on rows that predate the catalogue.
   */
  schedulingTypeId: string | null;
  schedulingTypeName: string | null;
  structuralKind: string | null;
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
  /**
   * **R97 — how the occurrence is delivered.** `'in_person' | 'online'` for a
   * Session; **`null` for an Event and an Exam**, which have no delivery model
   * at all and must not be given an invented one — the same discipline every
   * other kind-specific field on this interface follows.
   *
   * `onlineMediaMode` is non-null exactly when `deliveryMode` is `'online'`.
   *
   * **Provider-independent** (R97, §17 of the delivery slice): no room name,
   * URL, token or vendor identifier belongs here. Joining a class is a later
   * revision's concern and will not reach the calendar through this field.
   */
  deliveryMode: string | null;
  onlineMediaMode: string | null;
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
  /**
   * TD-1 lifecycle.
   *
   * **R83.1 — a cancelled occurrence does NOT appear in an ordinary calendar.**
   * R77 said the opposite, on the reasoning that a calendar should say a class
   * is not happening; the Owner's calendars show what is **on**, and a class
   * that is not happening is not on. The row is never deleted — it keeps its
   * cancellation state, its reason, its audit row and its notice, restoring
   * returns it, and a history screen asks for it with `include_cancelled`.
   */
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
  prisma: Pick<PrismaClient, "hijriMonthStart">,
  from: Date,
  to: Date,
): Promise<MonthStart[]> {
  const MARGIN_DAYS = 40;
  const margin = MARGIN_DAYS * 86_400_000;
  const rows = await prisma.hijriMonthStart.findMany({
    where: {
      deletedAt: null,
      status: "published",
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
function hijri(
  date: Date,
  starts: readonly MonthStart[],
): Pick<Occurrence, "hijriDate" | "hijriMonthArabic"> {
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
    : `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;

/** Whole days between two calendar dates — pure date arithmetic, no timezone. */
const daysBetween = (a: Date, b: Date): number =>
  Math.round((b.getTime() - a.getTime()) / 86_400_000);

const isSuperAdmin = (a: CalendarActor | null) =>
  a !== null && scope.isSuperAdmin(a.roleScopes);
const isAdmin = (a: CalendarActor | null) =>
  a !== null && (scope.hasRole(a.roleScopes, "admin") || isSuperAdmin(a));
const isTeacher = (a: CalendarActor | null) =>
  a !== null && scope.hasRole(a.roleScopes, "teacher");
const isStudentOrParent = (a: CalendarActor | null) =>
  a !== null &&
  (scope.hasRole(a.roleScopes, "student") || scope.hasRole(a.roleScopes, "parent"));

/**
 * Builds the visibility filter for Events.
 *
 * **The `hidden` arm is R109's and lives in `policies/scheduling-visibility.ts`**
 * — one rule for all three kinds of scheduling item, so a class, an activity and
 * a sitting cannot drift apart on who owns a hidden one. Everything else here is
 * §4.4's, unchanged.
 *
 * The remaining asymmetries are the SRS's own accepted decisions rather than
 * oversights:
 *
 *   - **Private is NOT filtered by a Student's own branch or group** (§4.4
 *     records this as a deliberate trade-off, Risk R-6).
 *   - Private is limited to staff within their scope, so a scoped Admin sees
 *     *less* private material than any approved beneficiary does. Accepted,
 *     and unchanged by R109.
 *   - A **Pending** user sees the public tier only, exactly like an anonymous
 *     visitor — the account exists but grants nothing (TD-1).
 *
 * **What R109 REMOVED:** *"Hidden is visible to ALL Admins regardless of branch
 * scope"*. A hidden Event is now read by the person responsible for it and by
 * Super Admins, and by nobody else. This is the one place in the revision where
 * somebody loses reach they have today, and it is deliberate.
 */
async function visibilityFilter(
  prisma: PrismaClient,
  actor: CalendarActor | null,
): Promise<Record<string, unknown>> {
  // Anonymous, or an account that is not yet approved.
  if (actor === null || actor.accountStatus !== "active") {
    return { visibility: "public" };
  }

  if (isSuperAdmin(actor)) return {};

  if (isAdmin(actor)) {
    const reachable = scope.reachableBranches(actor.roleScopes, ["admin"]);
    return {
      OR: [
        { visibility: "public" },
        // **R109 — hidden is the responsible person's, not every Admin's.**
        // An all-branches Admin used to fall out of this function with `{}`,
        // which returned every hidden Event in the platform; she now reads the
        // hidden ones she answers for, exactly as a branch-scoped Admin does.
        eventResponsibleWhere(actor),
        // Private: staff within their branch scope. A global event (no branch
        // rows at all) is in scope for everyone by construction.
        reachable === null
          ? { visibility: "private" }
          : {
              visibility: "private",
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
    const {
      branchIds,
      levelIds,
      categoryIds,
      administrativeGroupIds: groupIds,
    } = await teacherEventScope(prisma, actor.userId);

    // §4.4: a Teacher sees Private events whose scope intersects their teaching
    // scope — one of their Administrative Groups, or the level, category or
    // branch of anything they teach, or a global event — and never one
    // belonging exclusively to groups they do not teach.
    // R71.2 — the union's other arm. A مؤطرة sees an event she staffs whether
    // or not her teaching scope reaches it: an assistant at a celebration for
    // another branch's group must still find it in her own calendar. **Both
    // positions see; only `responsible` may edit** (R71.3, `event.service.ts`).
    // **R109 narrowed the HIDDEN tier out of this union entirely** — scope
    // intersection no longer reaches a hidden event, ownership does.
    const staffed = [...(await eventsStaffedBy(prisma, actor.userId)).keys()];

    const intersects = {
      OR: [
        { id: { in: staffed } },
        {
          administrativeGroupScopes: {
            some: { administrativeGroupId: { in: groupIds } },
          },
        },
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
        { visibility: "public" },
        { visibility: "private", ...intersects },
        eventResponsibleWhere(actor),
      ],
    };
  }

  if (isStudentOrParent(actor)) {
    // Approved Student or Parent: public and private, never hidden. Private is
    // deliberately unfiltered by branch or group (§4.4, Risk R-6).
    return { OR: [{ visibility: "public" }, { visibility: "private" }] };
  }

  // Active is a lifecycle fact, not calendar authority. A pre-provisioned or
  // otherwise role-less account receives no private tier merely because it can
  // authenticate.
  return { visibility: "public" };
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
    select: {
      user: { select: { id: true, nameArabic: true, publicDisplayName: true } },
    },
  },
  schedule: {
    select: {
      branchId: true,
      /* R110 (Owner 2026-09-02) — carried so a reader can tell a عطلة from an
         ordinary activity; `kind` says `event` for both. */
      schedulingType: { select: { id: true, name: true, structuralKind: true } },

      branch: { select: { name: true } },
      subject: { select: { id: true, name: true } },
      teachingMode: true,
      level: {
        select: {
          id: true,
          name: true,
          category: { select: { id: true, name: true } },
        },
      },
      administrativeGroup: {
        select: {
          name: true,
          level: {
            select: {
              id: true,
              name: true,
              category: { select: { id: true, name: true } },
            },
          },
        },
      },
      teachingGroup: {
        select: {
          name: true,
          level: {
            select: {
              id: true,
              name: true,
              category: { select: { id: true, name: true } },
            },
          },
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
  const level =
    sch.level ??
    sch.administrativeGroup?.level ??
    sch.teachingGroup?.level ??
    null;
  return {
    kind: "session",
    schedulingTypeId: sch.schedulingType?.id ?? null,
    schedulingTypeName: sch.schedulingType?.name ?? null,
    structuralKind: sch.schedulingType?.structuralKind ?? null,
    id: session.id,
    title: sch.subject.name,
    date: iso(session.date),
    startTime: hhmm(session.startTime),
    endTime: hhmm(session.endTime),
    // R109 — the occurrence's OWN tier, snapshotted at materialization. It was
    // `null` because a حصة had no tier at all; it is never `null` now.
    visibility: session.visibility,
    branchId: sch.branchId,
    // A Session has no description of its own; the audience label that used to
    // be smuggled in here now has its own field.
    description: null,
    subjectId: sch.subject.id,
    subjectName: sch.subject.name,
    teachingMode: sch.teachingMode,
    audienceLabel:
      sch.administrativeGroup?.name ??
      sch.teachingGroup?.name ??
      level?.name ??
      null,
    status: session.status,
    recurrence: null,
    branchName: sch.branch.name,
    // R97 — an online occurrence holds no room at all (CHECK
    // `session_online_no_room_check`), so this is `null` by construction rather
    // than by a filter here.
    roomName: session.room?.name ?? null,
    deliveryMode: session.deliveryMode,
    onlineMediaMode: session.onlineMediaMode,
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

/**
 * **What a personal calendar is** (R82.8).
 *
 * `GET /calendar` answers *what is on at the association*, by visibility tier.
 * That is the right answer for a visitor and the wrong one for a signed-in
 * person, who wants *what concerns me* — and the difference is not cosmetic: a
 * beneficiary sees every public session in the platform today, including Levels
 * she is not enrolled in.
 *
 * The personal read is a **filter over the same projection**, never a second
 * one, and it creates **no per-user rows**: the pipeline stays *definition →
 * occurrence → audience filter at read time*, which is what §4.4 already
 * describes and what keeps a moved enrolment correct on the next read rather
 * than needing a backfill.
 *
 * Two populations, and they are different questions:
 *
 * * **a beneficiary** — the sessions her enrolments place her in, and the events
 *   addressed to a scope she belongs to;
 * * **a مؤطرة** — the sessions and events she is **assigned to**, from the
 *   Session's own staffing snapshot (R43.4) and `EventStaff`.
 *
 * Somebody who is both gets the union, which is the honest answer for a مؤطرة
 * who also studies (R79 makes that expressible).
 */
async function personalFilters(
  prisma: PrismaClient,
  userId: string,
): Promise<{
  event: Prisma.EventWhereInput;
  session: Prisma.SessionWhereInput;
}> {
  const enrolments = await prisma.enrollment.findMany({
    where: { studentId: userId, deletedAt: null },
    select: {
      levelId: true,
      branchId: true,
      administrativeGroupId: true,
      level: { select: { categoryId: true } },
    },
  });
  const seats = await prisma.studentTeachingGroup.findMany({
    where: {
      studentId: userId,
      deletedAt: null,
      teachingGroup: { deletedAt: null },
    },
    select: { teachingGroupId: true },
  });

  const levelIds = [...new Set(enrolments.map((e) => e.levelId))];
  const branchIds = [...new Set(enrolments.map((e) => e.branchId))];
  const categoryIds = [...new Set(enrolments.map((e) => e.level.categoryId))];
  const groupIds = enrolments
    .map((e) => e.administrativeGroupId)
    .filter((id): id is string => id !== null);
  const circleIds = seats.map((s) => s.teachingGroupId);

  /**
   * **An event concerns her if ANY of its scopes names something she is in** —
   * a union, unlike the notification audience, which intersects the scopes of an
   * event to find its recipients. The two are different questions asked from
   * different ends: *does this event's scope include me* versus *who does this
   * event's scope include*.
   *
   * A **global** event (no scope rows at all) is on everybody's calendar, which
   * is exactly where R82.7 puts it: visible to all, notified to none.
   */
  const event: Prisma.EventWhereInput = {
    OR: [
      {
        AND: [
          { branchScopes: { none: {} } },
          { categoryScopes: { none: {} } },
          { levelScopes: { none: {} } },
          { administrativeGroupScopes: { none: {} } },
        ],
      },
      ...(branchIds.length
        ? [{ branchScopes: { some: { branchId: { in: branchIds } } } }]
        : []),
      ...(categoryIds.length
        ? [{ categoryScopes: { some: { categoryId: { in: categoryIds } } } }]
        : []),
      ...(levelIds.length
        ? [{ levelScopes: { some: { levelId: { in: levelIds } } } }]
        : []),
      ...(groupIds.length
        ? [
            {
              administrativeGroupScopes: {
                some: { administrativeGroupId: { in: groupIds } },
              },
            },
          ]
        : []),
      // Her own assignments, whatever the scope says.
      { staff: { some: { userId, deletedAt: null } } },
    ],
  };

  const session: Prisma.SessionWhereInput = {
    OR: [
      // Assigned — the Session's OWN snapshot (R43.4), so a مؤطرة who covered
      // one occurrence keeps it and one merely removed from the schedule does
      // not lose the ones she actually took.
      { staff: { some: { userId, deletedAt: null } } },
      ...(levelIds.length || groupIds.length || circleIds.length
        ? [
            {
              /**
               * **The inherited audience** — and only where the occurrence has
               * not overridden it (R92).
               *
               * `audienceBranches: { none: {} }` is the whole of *inherit*: an
               * occurrence that states its own branches is answered by the arm
               * below instead, so a combined class does not appear twice and,
               * more importantly, does not still appear for somebody the
               * override removed.
               */
              audienceBranches: { none: {} },
              schedule: {
                OR: [
                  // *That Level at that branch* — the R66 pairing, not the Level
                  // alone: a Level spans branches and her class does not.
                  ...enrolments.map((e) => ({
                    levelId: e.levelId,
                    branchId: e.branchId,
                  })),
                  ...(groupIds.length
                    ? [{ administrativeGroupId: { in: groupIds } }]
                    : []),
                  ...(circleIds.length
                    ? [{ teachingGroupId: { in: circleIds } }]
                    : []),
                ],
              },
            },
            /**
             * **R92 — the combined occurrence.**
             *
             * One lesson delivered once instead of twice: the second branch's
             * beneficiaries see the SAME Session, held at the first branch. The
             * Level still has to match — combining branches is a statement about
             * where the people come from, never about what is being taught — and
             * the branch is matched against the OCCURRENCE's own list rather
             * than the schedule's.
             *
             * Without this arm the override would be honoured by notifications
             * and invisible on the calendar: told about a class she cannot see,
             * which is the single failure R92's shared resolver exists to
             * prevent.
             */
            ...(enrolments.length
              ? [
                  {
                    OR: enrolments.map((e) => ({
                      audienceBranches: { some: { branchId: e.branchId } },
                      schedule: { levelId: e.levelId },
                    })),
                  },
                ]
              : []),
          ]
        : []),
    ],
  };

  return { event, session };
}

export async function readCalendar(
  prisma: PrismaClient,
  actor: CalendarActor | null,
  query: CalendarQuery & { mine?: boolean; includeCancelled?: boolean },
): Promise<Occurrence[]> {
  if (query.to < query.from) {
    throw new AppError("VALIDATION_FAILED", "to must not precede from");
  }
  if (daysBetween(query.from, query.to) > MAX_RANGE_DAYS) {
    throw new AppError(
      "VALIDATION_FAILED",
      `range must not exceed ${MAX_RANGE_DAYS} days`,
    );
  }

  /**
   * **The personal narrowing, composed into the same queries** (R82.8) — not a
   * second pipeline, and not a filter applied after expansion: narrowing after
   * the fact would still have read every occurrence in the platform to throw
   * most of them away.
   *
   * It requires an authenticated actor by construction: `mine` is only reachable
   * through the guarded route, and there is no user id in the request for a
   * caller to have chosen (the TD-12 property `GET /students/me` relies on).
   */
  const personal =
    query.mine === true && actor !== null
      ? await personalFilters(prisma, actor.userId)
      : null;

  /**
   * **The catalogue filter resolves to its structural kind FIRST** (R110, Owner
   * 2026-09-02).
   *
   * The kind decides *which of the three sources can hold such a row at all*,
   * so a class type never queries the Event table. The id then narrows within
   * that source. That ordering is what lets عطلة and نشاط — both Events — be
   * asked for separately, which `kind=event` never could.
   *
   * A soft-deleted type still resolves: retiring a type must not make the rows
   * that used it unfindable, which is the same reason the FK is `RESTRICT`.
   */
  const typeFilter = query.schedulingTypeId
    ? await prisma.schedulingType.findUnique({
        where: { id: query.schedulingTypeId },
        select: { id: true, structuralKind: true },
      })
    : null;
  /* An id naming no type is a filter nothing can satisfy, not a filter to
     ignore: silently returning the whole grid answers a question nobody
     asked. */
  if (query.schedulingTypeId && !typeFilter) return [];
  const typeKind = typeFilter?.structuralKind ?? null;

  const floor = await operationalFloor(prisma, query.branchId);
  const from = floor && floor > query.from ? floor : query.from;
  if (from > query.to) return [];

  // ── Events, filtered by tier and by the requested scope.
  const scopeFilters: Record<string, unknown>[] = [];
  if (query.branchId) {
    scopeFilters.push({
      OR: [
        { branchScopes: { some: { branchId: query.branchId } } },
        { branchScopes: { none: {} } },
      ],
    });
  }
  if (query.levelId)
    scopeFilters.push({ levelScopes: { some: { levelId: query.levelId } } });
  if (query.categoryId) {
    scopeFilters.push({
      categoryScopes: { some: { categoryId: query.categoryId } },
    });
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
    query.teacherId !== undefined ||
    // R84 — a circle is a teaching concept an Event does not carry.
    query.teachingGroupId !== undefined ||
    query.kind === "session";

  const events =
    sessionOnlyFilter ||
    (query.kind !== undefined && query.kind !== "event") ||
    (typeKind !== null && typeKind !== "activity" && typeKind !== "holiday")
      ? []
      : await prisma.event.findMany({
          where: {
            deletedAt: null,
            startDate: { lte: query.to },
            // The tier still applies on a personal calendar: being concerned by an
            // event does not widen what she may see of it.
            ...(await visibilityFilter(prisma, actor)),
            ...(scopeFilters.length ? { AND: scopeFilters } : {}),
            ...(personal ? { AND: [...scopeFilters, personal.event] } : {}),
            ...(typeFilter ? { schedulingTypeId: typeFilter.id } : {}),
          },
          include: {
            schedulingType: {
              select: { id: true, name: true, structuralKind: true },
            },
            branchScopes: {
              select: { branch: { select: { id: true, name: true } } },
              take: 1,
            },
            categoryScopes: {
              select: { category: { select: { id: true, name: true } } },
              take: 1,
            },
            levelScopes: {
              select: { level: { select: { id: true, name: true } } },
              take: 1,
            },
          },
        });

  // One read per request, applied to every occurrence below.
  const monthStarts = await publishedMonthStarts(prisma, from, query.to);

  const out: Occurrence[] = [];
  for (const event of events) {
    for (const date of expandEvent(event, from, query.to)) {
      out.push({
        kind: "event",
        schedulingTypeId: event.schedulingType?.id ?? null,
        schedulingTypeName: event.schedulingType?.name ?? null,
        structuralKind: event.schedulingType?.structuralKind ?? null,
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
        // R97 — an Event has no delivery model. `null` rather than a default,
        // exactly as `subjectId` and `status` are null for it.
        deliveryMode: null,
        onlineMediaMode: null,
        categoryId: event.categoryScopes[0]?.category.id ?? null,
        categoryName: event.categoryScopes[0]?.category.name ?? null,
        levelId: event.levelScopes[0]?.level.id ?? null,
        levelName: event.levelScopes[0]?.level.name ?? null,
        instructors: [],
        ...hijri(date, monthStarts),
      });
    }
  }

  // ── Exams: physical sittings (§4.6 as amended by R58).
  //
  // **Read, not expanded.** An exam is one dated occurrence — it produces no
  // Sessions and follows no recurrence rule — so there is nothing to expand and
  // the date on the row is the date on the grid.
  //
  // `online` is excluded: it has no place and no clock window, so it is not a
  // thing that happens *somewhere at a time* and has no business on a room-and-
  // date timetable. When the mode is built, whether it belongs here is its own
  // decision rather than a consequence of this one.
  //
  // The same subject/year filters that narrow the grid to Sessions apply: an
  // exam carries both, so it answers them honestly rather than being dropped.
  const exams =
    query.teacherId !== undefined ||
    query.teachingGroupId !== undefined ||
    (query.kind !== undefined && query.kind !== "exam") ||
    (typeKind !== null && typeKind !== "exam")
      ? []
      : await prisma.exam.findMany({
          where: {
            deletedAt: null,
            mode: "physical",
            date: { gte: from, lte: query.to },
            // R109 — the same tier model the Events above pass, at the caller's
            // own tier. An anonymous visitor reads public sittings and nothing
            // else.
            ...examTierWhere(actor),
            ...(typeFilter ? { schedulingTypeId: typeFilter.id } : {}),
            ...(query.branchId ? { branchId: query.branchId } : {}),
            ...(query.levelId ? { levelId: query.levelId } : {}),
            ...(query.subjectId ? { subjectId: query.subjectId } : {}),
            ...(query.academicYearId
              ? { academicYearId: query.academicYearId }
              : {}),
            // A Category narrows an exam through its Level — the same question the
            // grid asks of a session, answered rather than ignored.
            ...(query.categoryId
              ? { level: { categoryId: query.categoryId } }
              : {}),
          },
          include: {
            // The category NAME travels with its id, as it does for a session: an id
            // with no name is unreadable on a grid, and the filter chip beside the
            // calendar is drawn from exactly this pair (R55.1).
            level: {
              select: {
                id: true,
                name: true,
                category: { select: { id: true, name: true } },
              },
            },
            subject: { select: { id: true, name: true } },
            branch: { select: { id: true, name: true } },
            room: { select: { name: true } },
            administrativeGroup: { select: { name: true } },
            schedulingType: {
              select: { id: true, name: true, structuralKind: true },
            },
          },
        });

  for (const exam of exams) {
    out.push({
      kind: "exam",
      schedulingTypeId: exam.schedulingType?.id ?? null,
      schedulingTypeName: exam.schedulingType?.name ?? null,
      structuralKind: exam.schedulingType?.structuralKind ?? null,
      id: exam.id,
      title: exam.title,
      date: iso(exam.date),
      startTime: hhmm(exam.startTime),
      endTime: hhmm(exam.endTime),
      // **R109 supersedes §4.6's *"an exam has no visibility tier of its
      // own"***. That clause described the audience — who the paper is for —
      // and answered nothing about whether the sitting is announced.
      visibility: exam.visibility,
      branchId: exam.branchId,
      description: exam.description,
      // Not a recurrence — one sitting, one date. `null` rather than `'none'`,
      // which would imply a rule that simply does not repeat.
      recurrence: null,
      branchName: exam.branch?.name ?? null,
      roomName: exam.room?.name ?? null,
      // R97 — an Exam sitting is physical by §4.6 and has no delivery model of
      // its own. Inventing `in_person` here would state a fact the row does not
      // hold.
      deliveryMode: null,
      onlineMediaMode: null,
      categoryId: exam.level.category.id,
      categoryName: exam.level.category.name,
      levelId: exam.levelId,
      levelName: exam.level.name,
      subjectId: exam.subjectId,
      subjectName: exam.subject?.name ?? null,
      teachingMode: null,
      // Who sits it: the narrower group where one was chosen, the Level
      // otherwise — the same question `audienceLabel` answers for a session.
      audienceLabel: exam.administrativeGroup?.name ?? exam.level.name,
      status: null,
      // §4.6 exam staff are supervisors, not instructors. The calendar's
      // `instructors` slot means *who teaches this*, and nobody teaches an
      // exam — inventing a value here would misstate what the row is.
      instructors: [],
      ...hijri(exam.date, monthStarts),
    });
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
  // **Sessions WERE unconditionally public (§4.4, Revision 43)** — anonymous
  // visitors browse the timetable. **R109 supersedes that**: a حصة now carries a
  // tier of its own, and every occurrence that existed before the revision was
  // backfilled `public`, so the browsable timetable is unchanged in fact and
  // becomes a decision an administrator can take rather than a property of the
  // model.
  // R84 — asking for activities alone means no class occurrence belongs in the
  // answer. Skipping the query beats filtering its result: the rows are never
  // read at all.
  if (
    (query.kind === undefined || query.kind === "session") &&
    (typeKind === null || typeKind === "class")
  ) {
    const sessions = await prisma.session.findMany({
      where: {
        deletedAt: null,
        date: { gte: from, lte: query.to },
        // R109 — at the caller's tier, exactly as the Events and Exams above.
        // The tier still applies on a personal calendar: being enrolled in the
        // class does not widen what she may see of it.
        ...sessionTierWhere(actor),
        // **R83.1** — the ordinary projection is what is ON. A history screen
        // passes `include_cancelled` and gets them back; nothing else does.
        ...(query.includeCancelled === true
          ? {}
          : { status: { not: "cancelled" } }),
        ...(personal ? { AND: [personal.session] } : {}),
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
          ...(query.teachingGroupId
            ? { teachingGroupId: query.teachingGroupId }
            : {}),
          ...(query.academicYearId
            ? { academicYearId: query.academicYearId }
            : {}),
          ...(query.subjectId ? { subjectId: query.subjectId } : {}),
          ...(typeFilter ? { schedulingTypeId: typeFilter.id } : {}),
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
      const level =
        sch.level ??
        sch.administrativeGroup?.level ??
        sch.teachingGroup?.level ??
        null;
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
      (a.startTime ?? "").localeCompare(b.startTime ?? "") ||
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
  if (actor === null || actor.accountStatus !== "active") return null;

  const currentYear = await prisma.academicYear.findFirst({
    where: { isCurrent: true },
    select: { id: true },
  });

  // A teacher's own subjects and branches come from the schedules they staff
  // (§4.4c — CourseScheduleStaff is the resolution, stated directly).
  const staffed = await prisma.courseScheduleStaff.findMany({
    where: {
      userId: actor.userId,
      deletedAt: null,
      schedule: { deletedAt: null },
    },
    select: { schedule: { select: { branchId: true, subjectId: true } } },
  });

  // A parent has no enrolments of their own; §5.2 prefills from their children,
  // reached through approved links only (§4.3).
  const links = await prisma.familyLink.findMany({
    where: { parentId: actor.userId, status: "approved", deletedAt: null },
    select: { studentId: true },
  });

  const enrolments = await prisma.enrollment.findMany({
    where: {
      studentId: { in: [actor.userId, ...links.map((l) => l.studentId)] },
      deletedAt: null,
      // **R66 for the sixth time.** A Prisma relation filter never matches a
      // NULL relation, so `administrativeGroup: { deletedAt: null }` silently
      // dropped every beneficiary enrolled directly in an unsubdivided Level —
      // she got no scope prefill on her own calendar, with no error to notice.
      // The null arm is the platform's predicate (`enrollment.service.ts`).
      OR: [
        { administrativeGroupId: null },
        { administrativeGroup: { deletedAt: null } },
      ],
    },
    select: {
      levelId: true,
      level: { select: { categoryId: true } },
      branchId: true,
    },
  });

  // An administrator's scope is their branches; a single-branch admin gets that
  // branch, an all-branches one gets nothing to prefill, which is correct.
  const scopedBranches =
    scope.reachableBranches(actor.roleScopes, ["admin", "teacher"]) ?? [];

  return {
    academicYearId: currentYear?.id ?? null,
    categoryId: only(enrolments.map((e) => e.level.categoryId)),
    levelId: only(enrolments.map((e) => e.levelId)),
    branchId: only([
      // R66 — the enrolment's own branch.
      ...enrolments.map((e) => e.branchId),
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
  /** R99.10 — what this item IS. «التسجيلات» is decided here; the MIME type
   *  decides only how it plays. */
  origin: ContentOrigin;
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
  /**
   * **What to call the next recording of this occurrence** (R75.6, server-owned
   * since R99).
   *
   * The browser recorder shows it, editable, before saving; the ingestion worker
   * allocates the same rule under a row lock. It is a **suggestion and never an
   * invariant** — nothing reads it back — which is why it is computed from the
   * titles this caller can actually see rather than from the whole namespace: a
   * number derived from an item the caller may not see would report that the
   * item exists (§20 rule 17), and the worker's own allocation is what makes the
   * unattended path collision-free.
   */
  suggestedRecordingName: string;
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
/**
 * **Which sessions reference one piece of content** — `SessionContent` read
 * backwards (2026-08-17).
 *
 * ## Why the reverse direction needs a read at all
 *
 * `SessionContent` is many-to-many and has always been navigable both ways in
 * the data; only the *forward* direction had a surface. §4.9's point is that
 * **content is referenced, never owned** — *"one semester PDF is referenced by
 * every session that uses it"* — and a reader looking at that PDF in the library
 * had no way to see the sentence's other half.
 *
 * **No new relationship, no second join, no denormalised column.** The content
 * remains the source of truth; this is a projection of rows that already exist.
 *
 * ## Visibility: the content gates, the sessions do not
 *
 * The two are gated by different rules and conflating them would leak in one
 * direction or hide in the other:
 *
 * * **The content** passes `visibleContentIds` — §4.9's tiers, the same rule the
 *   library list and the session page apply. A caller who may not see the item
 *   receives `404`, never an empty list: an empty list would confirm the id
 *   exists (§20 rule 17).
 * * **The sessions** pass R109's tier — `sessionTierWhere`, the same fragment
 *   `GET /calendar` composes — so this returns exactly the occurrences the
 *   caller could already have read by opening the calendar, and no more. Before
 *   R109 a حصة had no tier and the sentence here was *"the sessions are the
 *   public timetable"*; a hidden occurrence would have leaked through this
 *   projection the moment the tier existed, which is why the gate is added in
 *   the same revision that adds the column.
 *
 * That asymmetry is the specification's, not this function's: *"an anonymous
 * visitor sees a public session's existence and details, never its private
 * recordings."*
 *
 * ## Not paginated
 *
 * A content item is referenced by the sessions of the schedules that use it —
 * tens at most, bounded by a term. The question is *which sessions*, and a page
 * boundary through that answer would hide the ones a reader is looking for.
 */
export async function listSessionsForContent(
  prisma: PrismaClient,
  actor: CalendarActor | null,
  contentId: string,
): Promise<Occurrence[]> {
  // The content itself must be visible before its references are named. A caller
  // who may not see it gets the same 404 a nonexistent id gets.
  const visible = await visibleContentIds(prisma, actor, [contentId]);
  if (!visible.has(contentId))
    throw new AppError("NOT_FOUND", "no such content");

  const links = await prisma.sessionContent.findMany({
    where: {
      contentId,
      deletedAt: null,
      session: {
        deletedAt: null,
        schedule: { deletedAt: null },
        // R109 — a hidden occurrence is not named here to a caller who may not
        // see it. Naming it would report that it exists (§20 rule 17), which is
        // precisely what the tier exists to prevent.
        ...sessionTierWhere(actor),
      },
    },
    select: { session: { include: SESSION_OCCURRENCE_INCLUDE } },
    // Most recent first: a reader asking *where was this used* is usually asking
    // about the last time before the first.
    orderBy: { session: { date: "desc" } },
  });
  if (links.length === 0) return [];

  const dates = links.map((l) => l.session.date);
  const monthStarts = await publishedMonthStarts(
    prisma,
    new Date(Math.min(...dates.map((d) => d.getTime()))),
    new Date(Math.max(...dates.map((d) => d.getTime()))),
  );

  return links.map((l) => sessionOccurrence(l.session, monthStarts));
}

export async function readSessionPage(
  prisma: PrismaClient,
  actor: CalendarActor | null,
  sessionId: string,
): Promise<SessionPage> {
  const session = await prisma.session.findFirst({
    where: {
      id: sessionId,
      deletedAt: null,
      schedule: { deletedAt: null },
      // **R109 — the tier is part of the lookup, not a check after it.** A
      // caller who may not read this occurrence gets the same `404` a
      // nonexistent id gets: a distinguishable `403` would confirm that the
      // hidden class exists, which §20 rule 17 forbids and which is the whole
      // point of the tier.
      ...sessionTierWhere(actor),
    },
    include: SESSION_OCCURRENCE_INCLUDE,
  });
  if (!session) throw new AppError("NOT_FOUND", "no such session");

  const monthStarts = await publishedMonthStarts(
    prisma,
    session.date,
    session.date,
  );

  const links = await prisma.sessionContent.findMany({
    where: { sessionId, deletedAt: null, content: { deletedAt: null } },
    select: {
      content: {
        select: {
          id: true,
          title: true,
          subjectId: true,
          levelId: true,
          mimeType: true,
          origin: true,
        },
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
      origin: c.origin,
    }));

  const occurrence = sessionOccurrence(session, monthStarts);

  return {
    occurrence,
    notes: null,
    /**
     * **«التسجيلات» is decided by the ORIGIN MARKER, never by the MIME type**
     * (R99.10).
     *
     * The rule this replaces — *linked content whose MIME begins `audio/` is a
     * recording* — called every attached audio file a recording whether or not
     * it was one, and made a video recording unrepresentable. `origin` is a fact
     * about the association's own world: an ordinary uploaded audio file is a
     * material, an OGG or MP4 produced by recording a class is a recording, and
     * the MIME type now decides only which player and which download the reader
     * gets.
     */
    recordings: items.filter((c) => c.origin === "session_recording"),
    linkedContent: items.filter((c) => c.origin !== "session_recording"),
    suggestedRecordingName: nextRecordingName(
      recordingBaseName({
        title: occurrence.title,
        description: occurrence.description,
        date: occurrence.date,
      }),
      items.map((c) => c.title),
    ),
  };
}
