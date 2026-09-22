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
import { composeItemTitle } from "../lib/item-title.js";
import { baseHijri, sortMonthStarts, type MonthStart } from "../lib/hijri.js";
import * as scope from "../policies/branch-scope.js";
import { effectiveOn } from "../policies/effective-staffing.js";
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
  audienceForSession,
  audienceWhere,
  examAudienceWhere,
  teacherEventScope,
} from "../policies/roster-resolution.js";
import {
  eventResponsibleWhere,
  examTierWhere,
  sessionTierWhere,
  teacherEventVisibility,
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
  /**
   * **R123 — whether this occurrence has an attendance sheet, and who may mark
   * on it.**
   *
   * Published for the same reason `delivery_mode` is: it is a fact about the
   * arrangement, and without it the details dialog would have to either probe
   * the server for every occurrence anybody merely *looked* at, or offer
   * «الحضور» on a عطلة and lead the reader to a refusal. `attendanceMode` is
   * `disabled` — never `null` — on a row whose type is unrecorded, which is the
   * same answer the attendance service gives such a row.
   */
  attendanceMode: string;
  attendanceMarking: string;
  /**
   * **SRS Revision 163 §3 — may THIS reader open the attendance sheet.**
   *
   * Advisory, and only ever a rendering hint: `attendance.service.ts`'s
   * `assertMayMark` remains the authority on every read and write, and this
   * states the same rule in batch form (`flagAttendanceAuthority`) so the
   * details dialog can decline to offer «الحضور» to somebody the sheet would
   * only refuse. `false` for an anonymous reader and for every occurrence
   * whose type keeps no register.
   */
  viewerMayMarkAttendance: boolean;
  id: string;
  title: string;
  /**
   * **SRS Revision 163 §2 — the item's OWN typed title («العنوان»).**
   *
   * `title` above is what a calendar chip shows, and for a class that is its
   * Subject's name (R43). The title somebody actually typed (R57; snapshotted
   * per occurrence by R138) reached no reader at all. An Event and an Exam
   * carry the same value in both fields, because their chip already is their
   * own title.
   */
  itemTitle: string;
  /**
   * R165 §2 — **the Surah(s) this occurrence is about**, by name, in Mushaf
   * order. A class's own (one occurrence may name its own, which REPLACE the
   * class's for that date), or an exam's one Surah. Empty wherever the Subject
   * is not taught by Surah, and always for an Event.
   */
  surahNames: string[];
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
  /**
   * **R139 — the WHOLE scope, not just its first row.** An Event's own
   * `EventBranch`/`EventCategory`/`EventLevel` join tables have always
   * accepted more than one row each (§4.4's four-way scope joins); the read
   * side only ever surfaced the first one, through `branchId`/`categoryId`/
   * `levelId` above — correct for authorization (those already resolve
   * against every row, never only the first) but silently wrong for
   * DISPLAY: an event scoped to three Levels showed one and dropped two with
   * nothing saying so. These carry every attached row; `branchId` etc. stay
   * exactly as they were — the first entry of the SAME list — so an existing
   * reader asking "which one" keeps the answer it always got. A Session and
   * an Exam have exactly one branch/Level by their own different mechanism
   * (`RecurringCourseSchedule`'s single mandatory target, §4.4c, unchanged by
   * this revision), so these are always a single-element array for them —
   * never empty, since both kinds always carry a branch and a Session always
   * resolves a Level through its teaching mode.
   */
  branchIds: string[];
  branchNames: string[];
  categoryIds: string[];
  categoryNames: string[];
  levelIds: string[];
  levelNames: string[];
  /** Revision 36.1: `displayName` is ALREADY RESOLVED — clients render it
   *  verbatim and implement no fallback. */
  instructors: { id: string; displayName: string }[];
  /**
   * **Exam only (Owner-reported, 2026-09-16) — `ExamStaff`, never folded
   * into `instructors` above.** §4.6's own distinction stands: an exam's
   * staff are supervisors/assistants, not instructors, so this is its own
   * field with its own label rather than a value that would misstate what
   * the row means for every other kind. Empty for a Session/Event — the
   * same "absent, never invented" discipline every other kind-specific
   * field on this interface follows.
   */
  supervisors: { id: string; displayName: string }[];
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
   * **Exam (online) only — R136 clause 16/17.** ISO instant, or `null` when
   * there is no access gate beyond `visibility` (every non-exam kind, a
   * physical sitting, or a remote one still on manual opening). Publication
   * (this row exists and is calendar-visible) and Student access are separate
   * facts; this is the second one, read alongside `visibility` rather than
   * folded into it.
   */
  availableFrom: string | null;
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
    // The ONE definition of what reaches her (§4.4c, R71.2, R109, R169 §6) —
    // shared with `GET /events` since R170 §5, so her قائمة and her calendar
    // cannot disagree. See `teacherEventVisibility`.
    return teacherEventVisibility(prisma, actor);
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
  // **Codex review, 2026-09-20 — the occurrence's OWN Subject override**
  // (Revision 161), read alongside the schedule's so `sessionOccurrence`
  // below can prefer it. Without this the calendar showed and filtered by
  // the SCHEDULE's Subject unconditionally, silently ignoring an override
  // meant to change exactly what a reader sees this class as teaching.
  subject: { select: { id: true, name: true } },
  // R165 §2/§5 — this occurrence's own Surahs; none means the class's.
  surahs: {
    select: { surah: { select: { surahId: true, nameArabic: true } } },
    orderBy: { surahId: 'asc' },
  },
  staff: {
    where: { deletedAt: null },
    select: {
      // R166 §3 — the position is what says which of them LEADS this date, and
      // so whose name the composed title carries.
      position: true,
      user: { select: { id: true, nameArabic: true, publicDisplayName: true } },
    },
    orderBy: { createdAt: 'asc' },
  },
  schedule: {
    select: {
      branchId: true,
      /* R110 (Owner 2026-09-02) — carried so a reader can tell a عطلة from an
         ordinary activity; `kind` says `event` for both. */
      schedulingType: { select: { id: true, name: true, structuralKind: true, attendanceMode: true } },
      /** R123 — who may mark at this class's occurrences. */
      attendanceMarking: true,

      branch: { select: { name: true } },
      subject: { select: { id: true, name: true } },
      // R165 §2 — the Surahs the class is about.
      surahs: {
        select: { surah: { select: { surahId: true, nameArabic: true } } },
        orderBy: { surahId: 'asc' },
      },
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
  // **Codex review, 2026-09-20 — the occurrence's own Subject override
  // (Revision 161) wins over the schedule's**, exactly as every other
  // per-occurrence override already does (room, delivery, visibility). A
  // session with no override carries `subject: null` and falls back to the
  // schedule's, unchanged.
  const subject = session.subject ?? sch.subject;
  const surahNames = (session.surahs.length > 0 ? session.surahs : sch.surahs).map(
    (row) => row.surah.nameArabic,
  );
  const lead = session.staff.find((person) => person.position === "teacher");
  return {
    kind: "session",
    schedulingTypeId: sch.schedulingType?.id ?? null,
    schedulingTypeName: sch.schedulingType?.name ?? null,
    structuralKind: sch.schedulingType?.structuralKind ?? null,
    // `disabled` for an unrecorded type, which is exactly what the attendance
    // service answers such a row — one rule, two places that must agree.
    attendanceMode: sch.schedulingType?.attendanceMode ?? 'disabled',
    attendanceMarking: sch.attendanceMarking,
    viewerMayMarkAttendance: false,
    id: session.id,
    title: subject.name,
    // **R166 §3 — COMPOSED, never a stored name**: this occurrence's own
    // Subject, Surahs and main teacher where it has its own, and its own date.
    // A cover teacher or a Surah changed for one date is therefore in the
    // title the moment it is saved, with nothing to keep in step.
    itemTitle: composeItemTitle({
      typeName: sch.schedulingType?.name ?? null,
      subjectName: subject.name,
      surahNames,
      leadName: lead === undefined ? null : publicDisplayName(lead.user),
      date: iso(session.date),
      time: hhmm(session.startTime),
    }),
    surahNames,
    date: iso(session.date),
    startTime: hhmm(session.startTime),
    endTime: hhmm(session.endTime),
    // R109 — the occurrence's OWN tier, snapshotted at materialization. It was
    // `null` because a حصة had no tier at all; it is never `null` now.
    visibility: session.visibility,
    branchId: sch.branchId,
    // A Session has no description of its own; the audience label that used to
    // be smuggled in here now has its own field.
    // **R166 §3 — «الوصف» is where somebody adds what the composed title
    // cannot say, so it has to reach the dialog.** This sent `null` on the
    // reasoning that *a Session has no description of its own* — true until
    // R138 gave every occurrence one, and never revisited.
    description: session.description,
    subjectId: subject.id,
    subjectName: subject.name,
    teachingMode: sch.teachingMode,
    audienceLabel:
      sch.administrativeGroup?.name ??
      sch.teachingGroup?.name ??
      level?.name ??
      null,
    status: session.status,
    // R136 clause 16/17 — the access gate is an Exam fact only.
    availableFrom: null,
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
    // A Session always resolves exactly one branch and (through its
    // schedule's teaching mode) at most one Level — R139's plural fields are
    // single-element/empty here, never a second source for what `branchId`/
    // `levelId` above already answer.
    branchIds: [sch.branchId],
    branchNames: [sch.branch.name],
    categoryIds: level ? [level.category.id] : [],
    categoryNames: level ? [level.category.name] : [],
    levelIds: level ? [level.id] : [],
    levelNames: level ? [level.name] : [],
    // From the session's OWN snapshot, never the schedule's (Revision 43.4).
    instructors: session.staff.map((assignment) => ({
      id: assignment.user.id,
      displayName: publicDisplayName(assignment.user),
    })),
    supervisors: [],
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
  /** Whether `userId` holds any live enrolment — the same signal that already
   *  decides every arm above. A pure staff actor (no enrolments) is left
   *  exactly as coarse-tier visibility (`examTierWhere`) already shows her —
   *  narrowing her own تقويمي by an audience rule that only ever matches a
   *  beneficiary would hide sittings she has always seen. */
  isBeneficiary: boolean;
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
  const groupIds = enrolments
    .map((e) => e.administrativeGroupId)
    .filter((id): id is string => id !== null);
  const circleIds = seats.map((s) => s.teachingGroupId);
  // **Codex review, 2026-09-20** — her own branches and categories, needed
  // below for the `multi_dimension` and R161-override arms the Session
  // predicate did not previously reach at all.
  const branchIds = [...new Set(enrolments.map((e) => e.branchId))];
  const categoryIds = [...new Set(enrolments.map((e) => e.level.categoryId))];

  /**
   * **§3, Revision 140 — an event concerns her only where ONE enrolment
   * satisfies EVERY dimension the event actually names, mirroring
   * `eventAudienceWhere`'s own rule** (`roster-resolution.ts`: *"scopes of
   * different kinds intersect and scopes of the same kind union… naming a
   * Category alongside a Branch narrows the Branch, it does not add a second,
   * unrelated population"*). The version this replaces checked each dimension
   * as an INDEPENDENT `OR` arm — a student enrolled in Level Y at branch B3
   * matched an event scoped to *"branch B1 AND level Y"* through the level
   * arm alone, never checking that her branch was B1. That is exactly the
   * accidentally-broadening `OR` this revision's own audit was told to find:
   * the notification audience for the identical event already excluded her
   * correctly, so her personal calendar disagreed with who the event
   * actually notifies.
   *
   * Still a union ACROSS enrolments (she may hold several), never a union
   * across dimensions WITHIN one enrolment — `eventAudienceWhere` reads the
   * same way from the opposite direction (one `User` predicate; this is one
   * `Event` predicate per enrolment, `OR`-ed together).
   *
   * A **global** event (no scope rows at all) is on everybody's calendar,
   * which is exactly where R82.7 puts it: visible to all, notified to none.
   */
  const dimensionMatch = (
    field: "branchScopes" | "categoryScopes" | "levelScopes" | "administrativeGroupScopes",
    idField: "branchId" | "categoryId" | "levelId" | "administrativeGroupId",
    value: string | null,
  ): Prisma.EventWhereInput => ({
    OR: [
      { [field]: { none: {} } },
      ...(value ? [{ [field]: { some: { [idField]: value } } }] : []),
    ],
  });

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
      ...enrolments.map((e) => ({
        AND: [
          dimensionMatch("branchScopes", "branchId", e.branchId),
          dimensionMatch("categoryScopes", "categoryId", e.level.categoryId),
          dimensionMatch("levelScopes", "levelId", e.levelId),
          dimensionMatch(
            "administrativeGroupScopes",
            "administrativeGroupId",
            e.administrativeGroupId,
          ),
        ],
      })),
      // Her own assignments, whatever the scope says.
      { staff: { some: { userId, deletedAt: null } } },
    ],
  };

  /**
   * **Codex review, 2026-09-20 — a `multi_dimension` schedule reaching her**,
   * per enrolment, with the identical AND-across-kind/empty-means-
   * unconstrained rule `audienceWhere`'s own `multi_dimension` arm applies
   * (`dimensionMatch` above, restated for `RecurringCourseSchedule`'s own
   * scope relations — same field and id names, a different model).
   *
   * **Deliberately a SUPERSET, not the exact rule.** An override can now
   * replace just ONE of five dimensions while the others still constrain
   * naturally (Revision 161), which is not expressible as a single static
   * Prisma `where` — reconstructing that algebra a second time here would be
   * exactly the drift `roster-resolution.ts`'s own docstring warns every
   * arm about. This half only has to not MISS a real candidate; precision is
   * restored by `filterSessionsByPersonalAudience` below, through the SAME
   * canonical `audienceForSession`/`audienceWhere` every other reader
   * composes.
   */
  const scheduleDimensionMatch = (
    field: "branchScopes" | "categoryScopes" | "levelScopes" | "administrativeGroupScopes",
    idField: "branchId" | "categoryId" | "levelId" | "administrativeGroupId",
    value: string | null,
  ): Prisma.RecurringCourseScheduleWhereInput => ({
    OR: [
      { [field]: { none: {} } },
      ...(value ? [{ [field]: { some: { [idField]: value } } }] : []),
    ],
  });

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
               * not overridden it (R92, generalised by Revision 161 to five
               * dimensions).
               *
               * Excluding every `audience*` table is the whole of *inherit*:
               * an occurrence that states its own override on ANY dimension
               * is answered by the broader arm below instead, so a combined
               * class does not appear twice and, more importantly, does not
               * still appear for somebody an override removed.
               */
              audienceBranches: { none: {} },
              audienceCategories: { none: {} },
              audienceLevels: { none: {} },
              audienceAdministrativeGroups: { none: {} },
              audienceTeachingGroups: { none: {} },
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
                  // `multi_dimension` — a schedule this codebase's own
                  // Revision 155 could resolve for her but this predicate,
                  // built for the three legacy modes alone, never reached
                  // (codex review, 2026-09-20): a beneficiary of such a
                  // class could miss its Sessions entirely.
                  {
                    teachingMode: "multi_dimension" as const,
                    OR: [
                      ...enrolments.map((e) => ({
                        AND: [
                          scheduleDimensionMatch("branchScopes", "branchId", e.branchId),
                          scheduleDimensionMatch("categoryScopes", "categoryId", e.level.categoryId),
                          scheduleDimensionMatch("levelScopes", "levelId", e.levelId),
                          scheduleDimensionMatch(
                            "administrativeGroupScopes",
                            "administrativeGroupId",
                            e.administrativeGroupId,
                          ),
                        ],
                      })),
                      ...(circleIds.length
                        ? [{ teachingGroupScopes: { some: { teachingGroupId: { in: circleIds } } } }]
                        : []),
                    ],
                  },
                ],
              },
            },
            /**
             * **R92, generalised by Revision 161 — the occurrence's own
             * override names one of her ids directly, in ANY of the five
             * tables, whatever the schedule's mode.**
             *
             * One lesson delivered once instead of twice: the second
             * population's beneficiaries see the SAME Session. Without this
             * arm an override would be honoured by notifications and
             * invisible on the calendar — told about a class she cannot
             * see, the single failure R92's shared resolver exists to
             * prevent, and exactly the gap codex's review found: only the
             * branch table was ever consulted here, so the four dimensions
             * Revision 161 added were invisible to every beneficiary's
             * personal calendar.
             */
            ...(branchIds.length ||
            categoryIds.length ||
            levelIds.length ||
            groupIds.length ||
            circleIds.length
              ? [
                  {
                    OR: [
                      ...(branchIds.length
                        ? [{ audienceBranches: { some: { branchId: { in: branchIds } } } }]
                        : []),
                      ...(categoryIds.length
                        ? [{ audienceCategories: { some: { categoryId: { in: categoryIds } } } }]
                        : []),
                      ...(levelIds.length
                        ? [{ audienceLevels: { some: { levelId: { in: levelIds } } } }]
                        : []),
                      ...(groupIds.length
                        ? [
                            {
                              audienceAdministrativeGroups: {
                                some: { administrativeGroupId: { in: groupIds } },
                              },
                            },
                          ]
                        : []),
                      ...(circleIds.length
                        ? [{ audienceTeachingGroups: { some: { teachingGroupId: { in: circleIds } } } }]
                        : []),
                    ],
                  },
                ]
              : []),
          ]
        : []),
    ],
  };

  return { event, session, isBeneficiary: enrolments.length > 0 };
}

/**
 * **A beneficiary's own exam occurrences, narrowed to the ones she is
 * actually the audience of** — see the call site's comment for why. One row
 * at a time through `examAudienceWhere` (its shape depends on that row's own
 * `targetKind`, so no single static `where` could express all five arms across
 * a mixed list at once); a month's worth of sittings is never large enough for
 * this to matter.
 */
async function filterExamsByAudience<
  T extends {
    id: string;
    targetKind: string;
    levelId: string;
    branchId: string | null;
    administrativeGroupId: string | null;
    sessionId: string | null;
    teachingGroupId: string | null;
    studentId: string | null;
    date: Date;
  },
>(prisma: PrismaClient, userId: string, exams: T[]): Promise<T[]> {
  const kept: T[] = [];
  for (const exam of exams) {
    const audience = await examAudienceWhere(prisma, {
      targetKind: exam.targetKind,
      levelId: exam.levelId,
      branchId: exam.branchId,
      administrativeGroupId: exam.administrativeGroupId,
      sessionId: exam.sessionId,
      teachingGroupId: exam.teachingGroupId,
      studentId: exam.studentId,
      on: exam.date,
    });
    if (audience === null) continue;
    // `deletedAt: null` is redundant — every arm `examAudienceWhere` returns
    // already states it — but kept explicit here anyway, matching the trash-
    // coverage guard's own convention for a `where` composed from a variable
    // it cannot trace into another file.
    const member = await prisma.user.count({
      where: { AND: [audience, { id: userId, deletedAt: null }] },
    });
    if (member > 0) kept.push(exam);
  }
  return kept;
}

/**
 * **Codex review, 2026-09-20 — restores exact precision after
 * `personalFilters`'s necessarily over-inclusive Session `where`.**
 *
 * A `multi_dimension` schedule's own AND-across-kind rule and Revision 161's
 * per-dimension REPLACEMENT overrides are not expressible as one static
 * Prisma filter (see the long comment beside `personalFilters`'s own
 * `session` predicate), so that predicate is a SUPERSET: it can include a
 * session her audience does not actually reach. This resolves each surviving
 * candidate through the SAME `audienceForSession` + `audienceWhere` every
 * other reader composes (R92 §B7) — never a second hand-written evaluation
 * of the override/combination rules, which is exactly the drift
 * `roster-resolution.ts`'s own module docstring warns every arm about.
 *
 * Mirrors `filterExamsByAudience` immediately above: one row at a time,
 * because a month's worth of occurrences is never large enough for the extra
 * round trip to matter, and because reconstructing the resolver's own
 * algebra a second time in SQL is the actual risk.
 */
async function filterSessionsByPersonalAudience<T extends { id: string; staff: { user: { id: string } }[] }>(
  prisma: PrismaClient,
  userId: string,
  sessions: T[],
): Promise<T[]> {
  const kept: T[] = [];
  for (const session of sessions) {
    // Staffed directly — already exact, no audience override to resolve.
    if (session.staff.some((s) => s.user.id === userId)) {
      kept.push(session);
      continue;
    }
    const spec = await audienceForSession(prisma, session.id);
    if (spec === null) continue;
    // `deletedAt: null` is redundant — every arm `audienceWhere` returns
    // already states it — but kept explicit here anyway, matching
    // `filterExamsByAudience`'s own convention just above: the trash-
    // coverage guard cannot trace a `where` composed from a variable into
    // another file.
    const member = await prisma.user.count({
      where: { AND: [audienceWhere(spec), { id: userId, deletedAt: null }] },
    });
    if (member > 0) kept.push(session);
  }
  return kept;
}

export interface PersonalCalendarOptions {
  branches: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  levels: { id: string; name: string; category_id: string }[];
  subjects: { id: string; name: string }[];
  groups: { id: string; name: string }[];
  circles: { id: string; name: string }[];
}

/**
 * **What تقويمي may narrow by — her own vocabulary, never the association's**
 * (Owner-reported, 2026-09-15).
 *
 * `PersonalCalendar` fed `CalendarFilters` the same public
 * `GET /calendar/bootstrap` chrome the anonymous timetable uses for its
 * Category/Level options — every Category and every Level in the
 * association, regardless of who is asking. The occurrence QUERY was already
 * correctly scoped (`personalFilters`, R140 §3); only the OPTIONS a reader
 * could pick from were not, so a beneficiary's own filter row offered her a
 * choice she had no enrolment in and could only ever narrow to nothing —
 * exactly the *"a control that implies a scope she does not have... the
 * control would be a lie"* rule/O already states for branch and category.
 *
 * **The same union `personalFilters` itself reads by** (above): a beneficiary
 * contributes her enrolments and seats, a مؤطرة contributes what she
 * currently teaches (`teacherEventScope`, R91-dated) and its Subjects, and
 * somebody who is both gets both. No role check decides which branch runs —
 * either resolution is simply empty when it does not apply, matching
 * `personalFilters`'s own reasoning exactly.
 */
export async function personalCalendarOptions(
  prisma: PrismaClient,
  userId: string,
): Promise<PersonalCalendarOptions> {
  const enrolments = await prisma.enrollment.findMany({
    where: { studentId: userId, deletedAt: null },
    select: {
      levelId: true,
      administrativeGroupId: true,
      level: { select: { id: true, name: true, categoryId: true, category: { select: { name: true } } } },
    },
  });
  const seats = await prisma.studentTeachingGroup.findMany({
    where: { studentId: userId, deletedAt: null, teachingGroup: { deletedAt: null } },
    select: { teachingGroup: { select: { id: true, name: true } } },
  });

  const taught = await teacherEventScope(prisma, userId);
  const taughtSchedules = await prisma.recurringCourseSchedule.findMany({
    where: { deletedAt: null, staff: { some: { userId, ...effectiveOn(new Date()) } } },
    select: {
      subjectId: true,
      subject: { select: { id: true, name: true } },
      teachingGroupId: true,
      teachingGroup: { select: { id: true, name: true } },
    },
  });

  const levelIds = new Set<string>([...enrolments.map((e) => e.levelId), ...taught.levelIds]);
  const categoryIds = new Set<string>([
    ...enrolments.map((e) => e.level.categoryId),
    ...taught.categoryIds,
  ]);
  const groupIds = new Set<string>([
    ...enrolments.map((e) => e.administrativeGroupId).filter((id): id is string => id !== null),
    ...taught.administrativeGroupIds,
  ]);
  const circles = new Map<string, string>();
  for (const seat of seats) circles.set(seat.teachingGroup.id, seat.teachingGroup.name);
  for (const s of taughtSchedules) {
    if (s.teachingGroup) circles.set(s.teachingGroup.id, s.teachingGroup.name);
  }
  const subjects = new Map<string, string>();
  for (const s of taughtSchedules) {
    if (s.subject) subjects.set(s.subject.id, s.subject.name);
  }
  // Her own enrolled Levels' curriculum — مواد المستوى, the same subjects the
  // library already shows her (§5.3) — so filtering سجّلها by a Subject
  // offers exactly what she is actually taught, not the association's whole
  // catalogue.
  if (enrolments.length > 0) {
    const levelSubjects = await prisma.levelSubject.findMany({
      where: { levelId: { in: [...levelIds] }, deletedAt: null },
      select: { subject: { select: { id: true, name: true } } },
    });
    for (const ls of levelSubjects) subjects.set(ls.subject.id, ls.subject.name);
  }

  const categoryNames = new Map<string, string>();
  for (const e of enrolments) categoryNames.set(e.level.categoryId, e.level.category.name);
  const levelNames = new Map<string, { name: string; categoryId: string }>();
  for (const e of enrolments) {
    levelNames.set(e.levelId, { name: e.level.name, categoryId: e.level.categoryId });
  }
  // Fill in whatever the enrolment loop above did not already carry — her own
  // taught Levels/Categories/Branches, which have names to resolve.
  const missingLevelIds = [...levelIds].filter((id) => !levelNames.has(id));
  const missingCategoryIds = [...categoryIds].filter((id) => !categoryNames.has(id));
  const [extraLevels, extraCategories, groupRows, branchRows] = await Promise.all([
    missingLevelIds.length
      ? prisma.level.findMany({
          where: { id: { in: missingLevelIds }, deletedAt: null },
          select: { id: true, name: true, categoryId: true },
        })
      : Promise.resolve([]),
    missingCategoryIds.length
      ? prisma.category.findMany({
          where: { id: { in: missingCategoryIds }, deletedAt: null },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    groupIds.size
      ? prisma.administrativeGroup.findMany({
          where: { id: { in: [...groupIds] }, deletedAt: null },
          select: { id: true, name: true, level: { select: { name: true } } },
        })
      : Promise.resolve([]),
    taught.branchIds.length
      ? prisma.branch.findMany({
          where: { id: { in: taught.branchIds }, deletedAt: null },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);
  for (const l of extraLevels) levelNames.set(l.id, { name: l.name, categoryId: l.categoryId });
  for (const c of extraCategories) categoryNames.set(c.id, c.name);

  return {
    branches: branchRows.map((b) => ({ id: b.id, name: b.name })),
    categories: [...categoryNames.entries()].map(([id, name]) => ({ id, name })),
    levels: [...levelNames.entries()].map(([id, v]) => ({
      id,
      name: v.name,
      category_id: v.categoryId,
    })),
    subjects: [...subjects.entries()].map(([id, name]) => ({ id, name })),
    // **`{Level} — {Group}`** (rule D): a group's name is not unique across
    // Levels, so a bare one does not identify it.
    groups: groupRows.map((g) => ({ id: g.id, name: `${g.level.name} — ${g.name}` })),
    circles: [...circles.entries()].map(([id, name]) => ({ id, name })),
  };
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
  /**
   * **R169 §6 — «show me the calendar of Level X» means every activity that
   * CONCERNS Level X**, and an activity concerns it when each dimension it names
   * admits it — an empty dimension is «الكل». Only `branch_id` read that way
   * before: asking for a Level returned the activities that NAMED the Level and
   * dropped one addressed to its whole Category, or to its branch. Each filter
   * now asks the same question of every dimension, through the taxonomy's own
   * relations (a Level has a Category; a group has a Level and a branch), so an
   * activity for *Category B* is still correctly absent from *Level X of
   * Category A*.
   */
  const open = (
    field: "branchScopes" | "categoryScopes" | "levelScopes" | "administrativeGroupScopes",
  ): Prisma.EventWhereInput => ({ [field]: { none: {} } });
  const scopeFilters: Prisma.EventWhereInput[] = [];
  if (query.branchId) {
    scopeFilters.push({
      OR: [open("branchScopes"), { branchScopes: { some: { branchId: query.branchId } } }],
    });
  }
  if (query.levelId) {
    const levelId = query.levelId;
    scopeFilters.push(
      { OR: [open("levelScopes"), { levelScopes: { some: { levelId } } }] },
      {
        OR: [
          open("categoryScopes"),
          { categoryScopes: { some: { category: { levels: { some: { id: levelId } } } } } },
        ],
      },
      {
        OR: [
          open("administrativeGroupScopes"),
          { administrativeGroupScopes: { some: { administrativeGroup: { levelId } } } },
        ],
      },
    );
  }
  if (query.categoryId) {
    const categoryId = query.categoryId;
    scopeFilters.push(
      { OR: [open("categoryScopes"), { categoryScopes: { some: { categoryId } } }] },
      { OR: [open("levelScopes"), { levelScopes: { some: { level: { categoryId } } } }] },
      {
        OR: [
          open("administrativeGroupScopes"),
          { administrativeGroupScopes: { some: { administrativeGroup: { level: { categoryId } } } } },
        ],
      },
    );
  }
  if (query.administrativeGroupId) {
    const id = query.administrativeGroupId;
    scopeFilters.push(
      {
        OR: [
          open("administrativeGroupScopes"),
          { administrativeGroupScopes: { some: { administrativeGroupId: id } } },
        ],
      },
      {
        OR: [
          open("levelScopes"),
          { levelScopes: { some: { level: { administrativeGroups: { some: { id } } } } } },
        ],
      },
      {
        OR: [
          open("categoryScopes"),
          {
            categoryScopes: {
              some: { category: { levels: { some: { administrativeGroups: { some: { id } } } } } },
            },
          },
        ],
      },
      {
        OR: [
          open("branchScopes"),
          { branchScopes: { some: { branch: { administrativeGroups: { some: { id } } } } } },
        ],
      },
    );
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
              select: { id: true, name: true, structuralKind: true, attendanceMode: true },
            },
            /**
             * **R139 — every scoped row, not only the first.** These three
             * joins have always accepted more than one row each (§4.4); this
             * read used to `take: 1`, correct for nothing downstream except
             * the DISPLAY fields below, which is exactly what silently
             * dropped a Level or a branch from an event scoped to several.
             * The audience-matching reads elsewhere in this file (`some`/
             * `none`) were never limited this way — only this projection was.
             */
            branchScopes: {
              select: { branch: { select: { id: true, name: true } } },
            },
            categoryScopes: {
              select: { category: { select: { id: true, name: true } } },
            },
            levelScopes: {
              select: { level: { select: { id: true, name: true } } },
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
        attendanceMode: event.schedulingType?.attendanceMode ?? 'disabled',
        attendanceMarking: event.attendanceMarking,
        viewerMayMarkAttendance: false,
        itemTitle: event.title,
        surahNames: [],
        subjectId: null,
        subjectName: null,
        teachingMode: null,
        audienceLabel: null,
        status: null,
        // R136 clause 16/17 — the access gate is an Exam fact only.
        availableFrom: null,
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
        // R139 — the whole scope. Empty on every dimension the event carries
        // no restriction on (never "all rows dropped but one"), matching the
        // SAME "no row = no restriction on this dimension" reading the
        // audience-matching queries in this file already use.
        branchIds: event.branchScopes.map((s) => s.branch.id),
        branchNames: event.branchScopes.map((s) => s.branch.name),
        categoryIds: event.categoryScopes.map((s) => s.category.id),
        categoryNames: event.categoryScopes.map((s) => s.category.name),
        levelIds: event.levelScopes.map((s) => s.level.id),
        levelNames: event.levelScopes.map((s) => s.level.name),
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
        supervisors: [],
        ...hijri(date, monthStarts),
      });
    }
  }

  // ── Exams: scheduled occurrences, physical or remote (§4.6 as amended by
  // R58, then R136).
  //
  // **Read, not expanded.** An exam is one dated occurrence — it produces no
  // Sessions and follows no recurrence rule — so there is nothing to expand and
  // the date on the row is the date on the grid.
  //
  // **`mode: 'online'` used to be excluded outright**, on the reasoning that it
  // has no place and no clock window and so is not a thing that happens
  // *somewhere at a time*. R136 makes وقت/تاريخ authoritative for a remote
  // occurrence too (a place still is not — `exam_online_has_no_room_check`
  // still forbids one), so an online sitting is exactly as much a dated thing
  // on this grid as a physical one; only its room/branch columns stay null.
  //
  // **`status IN ('published', 'closed')`, not `mode`, is what excludes a
  // paper.** بناء الاختبارات's own reusable `draft` content — physical or
  // online — is not an arrangement anybody attends and must never appear here;
  // `listAssessments`'s own library screen is where it is browsed (R136 §2, the
  // same status-is-the-source/occurrence-line discipline `listExams` now
  // applies for the same reason, Codex H1).
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
            status: { in: ["published", "closed"] },
            date: { gte: from, lte: query.to },
            // R109 — the same tier model the Events above pass, at the caller's
            // own tier. An anonymous visitor reads public sittings and nothing
            // else. Already branch-null-aware for an online row (`examTierWhere`'s
            // own "a branchless exam belongs to every branch" reading).
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
            // R165 §2 — the one Surah this sitting examines, by name.
            surah: { select: { nameArabic: true } },
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
            // R136 — the two arms `administrativeGroup`/`level` never named:
            // a `teaching_group` target has its own group to show rather than
            // falling back to the whole Level's name.
            teachingGroup: { select: { name: true } },
            schedulingType: {
              select: { id: true, name: true, structuralKind: true, attendanceMode: true },
            },
            // Owner-reported, 2026-09-16 — the dialog names no one; §4.6's own
            // ExamStaff (supervisor/assistant) is the "who" the reader asked for.
            staff: {
              where: { deletedAt: null },
              select: {
                user: { select: { id: true, publicDisplayName: true, nameArabic: true } },
              },
            },
          },
        });

  /**
   * **Owner-reported, 2026-09-15 — تقويمي showed a sitting «بدء الاختبار»
   * opened and could not load.**
   *
   * The block above filters an exam occurrence by `examTierWhere` alone — the
   * coarse *"is this branch/tier announced to her at all"* question §4.6/R109
   * asks. It never asked R124's finer one — *is SHE this sitting's audience* —
   * which is exactly `studentPaper`'s `eligible()` check on open. A beneficiary
   * could see and open a sitting targeted at a Level/group/session/student she
   * was never part of, and the paper endpoint correctly refused it — just too
   * late, behind a button that should never have offered it.
   *
   * Narrowed here, on her PERSONAL calendar only (`isBeneficiary` — a pure
   * staff actor has no enrolments and keeps the tier-only visibility she
   * already had), through the SAME `examAudienceWhere` `eligible()` itself
   * calls — one audience rule, not a second guess of it (§4.4c).
   */
  const examsForActor =
    query.mine === true && personal?.isBeneficiary === true && actor !== null
      ? await filterExamsByAudience(prisma, actor.userId, exams)
      : exams;

  for (const exam of examsForActor) {
    out.push({
      kind: "exam",
      schedulingTypeId: exam.schedulingType?.id ?? null,
      schedulingTypeName: exam.schedulingType?.name ?? null,
      structuralKind: exam.schedulingType?.structuralKind ?? null,
      attendanceMode: exam.schedulingType?.attendanceMode ?? 'disabled',
      // An exam sitting is invigilated — no column, and none is wanted (R123).
      attendanceMarking: 'staff_only',
      viewerMayMarkAttendance: false,
      id: exam.id,
      title: exam.title,
      itemTitle: exam.title,
      surahNames: exam.surah ? [exam.surah.nameArabic] : [],
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
      // **R136 — a remote occurrence now has a real delivery model.**
      // `onlineMediaMode` stays null regardless: R97's provider-independence
      // applies here exactly as it does to a Session, and an exam has no
      // join/provider column to report one from — the reader learns *this is
      // remote*, never *through what*.
      deliveryMode: exam.mode === "online" ? "online" : null,
      onlineMediaMode: null,
      categoryId: exam.level.category.id,
      categoryName: exam.level.category.name,
      levelId: exam.levelId,
      levelName: exam.level.name,
      // An exam sitting always names exactly one Level/Category (R136); its
      // branch is nullable (a remote sitting may carry none at all).
      branchIds: exam.branchId ? [exam.branchId] : [],
      branchNames: exam.branch ? [exam.branch.name] : [],
      categoryIds: [exam.level.category.id],
      categoryNames: [exam.level.category.name],
      levelIds: [exam.levelId],
      levelNames: [exam.level.name],
      subjectId: exam.subjectId,
      subjectName: exam.subject?.name ?? null,
      teachingMode: null,
      /**
       * **R136 — the two arms this label always knew (a named Administrative
       * Group, or the whole Level) are joined by three more (R125).**
       * `teaching_group` gets its own group's name, exactly like
       * `administrativeGroup` above. `session` and `student` are deliberately
       * generic rather than naming the occurrence or the beneficiary: this
       * row is read by everybody the calendar's own tier admits (§4.6/R109),
       * which is wider than *this specific student's* or *this specific
       * class's* audience, and naming either here would be exactly the kind
       * of exposure `assertMayAuthor`'s `student`/`session` arms exist to
       * bound on the write side. The occurrence dialog, opened by someone
       * `assertMayAuthor`/`loadForGrading` already admits, is where the exact
       * beneficiary is named.
       */
      audienceLabel:
        exam.targetKind === "teaching_group"
          ? (exam.teachingGroup?.name ?? null)
          : exam.targetKind === "session"
            ? "حصة محددة"
            : exam.targetKind === "student"
              ? "طالب واحد"
              : (exam.administrativeGroup?.name ?? exam.level.name),
      status: null,
      // §4.6 exam staff are supervisors, not instructors. The calendar's
      // `instructors` slot means *who teaches this*, and nobody teaches an
      // exam — inventing a value here would misstate what the row is.
      instructors: [],
      // Owner-reported, 2026-09-16 — named in their own field, `supervisors`,
      // rather than folded into `instructors` above.
      supervisors: exam.staff.map((assignment) => ({
        id: assignment.user.id,
        displayName: publicDisplayName(assignment.user),
      })),
      // **R136 clause 16/17 — publication ≠ Student access.** `visibility`
      // above already says whether this row is announced at all; `null` here
      // means *no gate beyond that* (a physical sitting, or a manually-opened
      // remote one), and a timestamp means the occurrence exists and is
      // calendar-visible but not yet reachable — the dialog computes
      // `now >= availableFrom` itself rather than the server pre-deciding it
      // and going stale between the read and the reader's next click.
      availableFrom: exam.availableFrom ? exam.availableFrom.toISOString() : null,
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
        // **Codex review, 2026-09-20 — every independent OR-bearing
        // condition now lives in ONE `AND` array, never spread as sibling
        // top-level `OR` keys.** `sessionTierWhere(actor)` returns its own
        // `{ OR: [...] }` for an Admin/Teacher/Student/Parent actor; the new
        // Subject-override arm below needs an `OR` of its own too, and a
        // second `...{ OR: [...] }` spread onto the SAME object SILENTLY
        // OVERWRITES the first — which would have dropped R109's
        // visibility-tier filter entirely (public/private/hidden-if-
        // responsible) the moment a caller also passed `subject_id`, a
        // visibility bypass this fix must not introduce while fixing
        // something else. `AND` composes them safely as separate fragments.
        AND: [
          // R109 — at the caller's tier, exactly as the Events and Exams
          // above. The tier still applies on a personal calendar: being
          // enrolled in the class does not widen what she may see of it.
          sessionTierWhere(actor),
          ...(personal ? [personal.session] : []),
          // An occurrence's own Subject override (Revision 161) answers
          // this filter when it has one, not only the schedule's: filtering
          // by the Subject a session was RETAUGHT as must find it, and
          // filtering by the schedule's ordinary Subject must not still
          // find a session retaught away from it. `subjectId: null` is the
          // ordinary case, *inherit*.
          ...(query.subjectId
            ? [
                {
                  OR: [
                    { subjectId: query.subjectId },
                    { subjectId: null, schedule: { subjectId: query.subjectId } },
                  ],
                },
              ]
            : []),
        ],
        // **R83.1** — the ordinary projection is what is ON. A history screen
        // passes `include_cancelled` and gets them back; nothing else does.
        ...(query.includeCancelled === true
          ? {}
          : { status: { not: "cancelled" } }),
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

    // **Codex review, 2026-09-20 — restores exact personal-audience
    // precision** after the necessarily over-inclusive `personal.session`
    // filter above (see `personalFilters`'s own comment). A pure staff actor
    // is left untouched: her sessions already match exactly through the
    // `staff` arm alone, with no override ambiguity to resolve — the same
    // `isBeneficiary` gate `filterExamsByAudience`'s own call site uses.
    const sessionsForActor =
      personal !== null && personal.isBeneficiary && actor !== null
        ? await filterSessionsByPersonalAudience(prisma, actor.userId, sessions)
        : sessions;

    for (const session of sessionsForActor) {
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

  await flagAttendanceAuthority(prisma, actor, out);

  // Deterministic order: date, then time, then id (TD-10's tiebreaker habit).
  return out.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.startTime ?? "").localeCompare(b.startTime ?? "") ||
      a.id.localeCompare(b.id),
  );
}

/**
 * **SRS Revision 163 §3 — who is offered «الحضور», decided once per read.**
 *
 * `attendance.service.ts`'s `assertMayMark` is the authority and stays it; this
 * is the same rule over rows this read has already loaded, so the dialog need
 * neither probe the sheet for every occurrence anybody merely looked at nor
 * offer a control that can only refuse (rule O, read the way R123's own
 * `attendance_mode` note reads it). Three arms, as there:
 *
 * 1. **Super Admin** — every occurrence that keeps a register.
 * 2. **An Admin in scope** — the Session's or sitting's own branch inside her
 *    reach; an Event only when EVERY branch it names is, and never one naming
 *    no branch at all (`event.service.ts` `assertMayEdit`).
 * 3. **Whoever staffs it** — a Session's snapshot, then its schedule as it
 *    stands on that date (`staffsSession`'s two arms, in the same order); any
 *    `EventStaff` or `ExamStaff` position; and R72's older rule, a مؤطِّرة's
 *    event scoped to nothing but groups she teaches.
 *
 * `attendance-authority.integration.test.ts` holds this to the service's own
 * answer, occurrence by occurrence, so the two cannot drift silently.
 */
async function flagAttendanceAuthority(
  prisma: PrismaClient,
  actor: CalendarActor | null,
  occurrences: Occurrence[],
): Promise<void> {
  if (actor === null) return;
  const candidates = occurrences.filter((o) => o.attendanceMode !== "disabled");
  if (candidates.length === 0) return;
  if (isSuperAdmin(actor)) {
    for (const o of candidates) o.viewerMayMarkAttendance = true;
    return;
  }

  if (scope.hasRole(actor.roleScopes, "admin")) {
    const reachable = scope.reachableBranches(actor.roleScopes, ["admin"]);
    const within = (branchId: string) => reachable === null || reachable.includes(branchId);
    for (const o of candidates) {
      o.viewerMayMarkAttendance =
        o.kind === "event"
          ? reachable === null || (o.branchIds.length > 0 && o.branchIds.every(within))
          : o.branchId !== null && within(o.branchId);
    }
  }

  const pending = candidates.filter((o) => !o.viewerMayMarkAttendance);
  for (const o of pending) {
    if (o.kind === "session" && o.instructors.some((i) => i.id === actor.userId)) {
      o.viewerMayMarkAttendance = true;
    }
    if (o.kind === "exam" && o.supervisors.some((i) => i.id === actor.userId)) {
      o.viewerMayMarkAttendance = true;
    }
  }

  // A Session with no snapshot row for her yet: the schedule's own assignment,
  // effective on THAT occurrence's date (`effectiveOn`'s inclusive bounds).
  const unsnapshotted = pending.filter((o) => o.kind === "session" && !o.viewerMayMarkAttendance);
  if (unsnapshotted.length > 0) {
    const rows = await prisma.session.findMany({
      where: {
        id: { in: unsnapshotted.map((o) => o.id) },
        deletedAt: null,
        schedule: { deletedAt: null, staff: { some: { userId: actor.userId, deletedAt: null } } },
      },
      select: {
        id: true,
        date: true,
        schedule: {
          select: {
            staff: {
              where: { userId: actor.userId, deletedAt: null },
              select: { effectiveFrom: true, effectiveUntil: true },
            },
          },
        },
      },
    });
    const staffed = new Set(
      rows
        .filter((row) =>
          row.schedule.staff.some(
            (a) =>
              (a.effectiveFrom === null || a.effectiveFrom <= row.date) &&
              (a.effectiveUntil === null || a.effectiveUntil >= row.date),
          ),
        )
        .map((row) => row.id),
    );
    for (const o of unsnapshotted) if (staffed.has(o.id)) o.viewerMayMarkAttendance = true;
  }

  const events = pending.filter((o) => o.kind === "event" && !o.viewerMayMarkAttendance);
  if (events.length > 0) {
    const eventIds = [...new Set(events.map((o) => o.id))];
    const staffedRows = await prisma.eventStaff.findMany({
      where: { eventId: { in: eventIds }, userId: actor.userId, deletedAt: null },
      select: { eventId: true },
    });
    const allowed = new Set(staffedRows.map((r) => r.eventId));
    if (scope.hasRole(actor.roleScopes, "teacher")) {
      const own = (await teacherEventScope(prisma, actor.userId)).administrativeGroupIds;
      if (own.length > 0) {
        const groupOnly = await prisma.event.findMany({
          where: {
            id: { in: eventIds.filter((id) => !allowed.has(id)) },
            deletedAt: null,
            branchScopes: { none: {} },
            categoryScopes: { none: {} },
            levelScopes: { none: {} },
            administrativeGroupScopes: {
              some: {},
              every: { administrativeGroupId: { in: own } },
            },
          },
          select: { id: true },
        });
        for (const row of groupOnly) allowed.add(row.id);
      }
    }
    for (const o of events) if (allowed.has(o.id)) o.viewerMayMarkAttendance = true;
  }
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
    where: { isCurrent: true, deletedAt: null },
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

/* ── Focused §5.2 Session details (`GET /calendar/sessions/{id}`) ───────── */

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
   * §5.2 lists them in the detail surface, but §7 gives `Session` no notes column and
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
  /**
   * **R137 — a scheduled exam addressed to THIS session** (`target_kind =
   * 'session'`), so a lesson can gain a linked quick test days after it
   * happened without pretending it occurred today. Same tier discipline as
   * every other cross-reference here: `examTierWhere(actor)`, the identical
   * gate the calendar grid itself applies to an exam row — a linked exam
   * this caller could not otherwise see on the calendar is not listed here
   * either. Usually one row; not constrained to exactly one, since nothing
   * in R125's target model forbids a second quiz for the same lesson.
   */
  linkedExams: SessionLinkedExam[];
}

export interface SessionLinkedExam {
  id: string;
  title: string;
  mode: 'physical' | 'online';
  /** `null` for physical (R136 clause 5 — no separate access gate) and for
   *  a still-manual online exam nobody has opened yet. */
  availableFrom: Date | null;
}

/**
 * Focused §5.2 Session data: the calendar occurrence plus what is attached.
 *
 * **Public at the caller's tier, not public by identity.** R109 gates the
 * occurrence through the same Session predicate as the calendar; attached
 * content separately passes §4.9 through `visibleContentIds`, the *same* rule
 * the library list applies. An anonymous visitor can therefore see a public
 * Session's details and public materials, never a restricted Session or its
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
 * ## Visibility: the content and Sessions gate independently
 *
 * The two are gated by different rules and conflating them would leak in one
 * direction or hide in the other:
 *
 * * **The content** passes `visibleContentIds` — §4.9's tiers, the same rule the
 *   library list and focused Session read apply. A caller who may not see the item
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
        // R169 §4 — a CANCELLED occurrence is not named here. The ordinary
        // projection is what is ON (R83.1): the day read this list links into
        // excludes cancelled occurrences, so naming one offered a link that
        // opened «غير متاح» — and a class that did not happen is not where a
        // content «was used». Its record, retention and visibility are
        // untouched; `include_cancelled=true` on the calendar still finds it.
        status: { not: "cancelled" },
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

  // R137 — a scheduled (never a reusable draft) exam addressed to this
  // session, at the caller's own tier — the identical gate the calendar
  // grid applies to an exam row (`examTierWhere`), so this never names an
  // occurrence the caller could not otherwise discover on the calendar.
  const linkedExamRows = await prisma.exam.findMany({
    where: {
      deletedAt: null,
      status: { in: ['published', 'closed'] },
      targetKind: 'session',
      sessionId,
      ...examTierWhere(actor),
    },
    select: { id: true, title: true, mode: true, availableFrom: true },
    orderBy: { date: 'asc' },
  });

  return {
    occurrence,
    notes: null,
    linkedExams: linkedExamRows.map((e) => ({
      id: e.id,
      title: e.title,
      mode: e.mode,
      availableFrom: e.availableFrom,
    })),
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
