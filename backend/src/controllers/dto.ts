/**
 * Contract DTOs — the **wire shape** of every response (§16.2, Revision 38).
 *
 * **No endpoint may expose an ORM entity directly.** The API contract is an
 * intentional interface, never an accidental serialisation of database models,
 * and this module is where that intention is written down.
 *
 * Three rules, all enforced by building the object **field by field** rather
 * than by spreading a row:
 *
 * 1. **Allow-list projection.** A column added to a Prisma model must never
 *    appear in a response by default — it appears when someone adds it here,
 *    deliberately. Revision 35 established this for the public branch directory
 *    (*"an endpoint that returns everything except what we remembered to strip
 *    is one careless `select` away from leaking"*) and Revision 38 generalised
 *    it: a staff endpoint leaking `deleted_by` is not a privacy breach, but it
 *    is still a contract nobody designed.
 * 2. **`snake_case`**, matching the field names TD-3 uses throughout. One wire
 *    convention, not one per endpoint.
 * 3. **A TD-11 calendar date is `YYYY-MM-DD`**, never an instant — an instant
 *    invites a timezone conversion in a client, which is the exact class of bug
 *    TD-11 exists to prevent.
 *
 * **Never `...row` in this file.** A spread is how an allow-list silently stops
 * being one.
 */

import type { Page } from '../lib/pagination.js';

/**
 * A `Date` column rendered as a TD-11 calendar date.
 *
 * `toISOString().slice(0, 10)` is correct here specifically because these
 * columns are written as UTC midnight: the date part is the calendar date, with
 * no local-time reinterpretation to get wrong.
 */
function dateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/** Applies a DTO across a TD-10 page, leaving `meta` untouched. */
export function pageOf<T, U>(input: Page<T>, project: (row: T) => U): Page<U> {
  return { data: input.data.map(project), meta: input.meta };
}

/* ── Branch (§7, Revision 35 public fields) ──────────────────────────────── */

export interface BranchDto {
  id: string;
  name: string;
  /** TD-11 calendar date, never an instant. */
  operational_start_date: string | null;
  display_order: number | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  opening_hours_ar: string | null;
  google_maps_url: string | null;
  /** TD-15: the client sends this back on edit; a stale one is a `409`. */
  version: number;
}

/**
 * Deliberately **absent**: `created_at`, `updated_at`, `deleted_at`,
 * `deleted_by`. They are operational metadata with no consumer, and the staff
 * screens have never asked for them — the reason they used to ship is that
 * nobody chose the shape at all.
 */
export function branchDto(row: {
  id: string;
  name: string;
  operationalStartDate: Date | null;
  displayOrder: number | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  openingHoursAr: string | null;
  googleMapsUrl: string | null;
  version: number;
}): BranchDto {
  return {
    id: row.id,
    name: row.name,
    operational_start_date: dateOnly(row.operationalStartDate),
    display_order: row.displayOrder,
    address: row.address,
    phone: row.phone,
    email: row.email,
    opening_hours_ar: row.openingHoursAr,
    google_maps_url: row.googleMapsUrl,
    version: row.version,
  };
}

/* ── Room (§7) ───────────────────────────────────────────────────────────── */

export interface RoomDto {
  id: string;
  name: string;
  branch_id: string;
  version: number;
}

export function roomDto(row: {
  id: string;
  name: string;
  branchId: string;
  version: number;
}): RoomDto {
  return { id: row.id, name: row.name, branch_id: row.branchId, version: row.version };
}

/* ── Administrative Group (§4.4c, Revision 43) ───────────────────────────── */

export interface AdministrativeGroupDto {
  id: string;
  name: string;
  /** The Level this group organises. Not editable — see the service. */
  level_id: string;
  /**
   * **Load-bearing, not decorative** (§4.4c). This is the single answer to
   * *"which branch is this person at"* — the answer `User.intended_branch_id`
   * deliberately does not give, since that records only what an applicant asked
   * for (§4.1, R39). A client resolving a student's branch reads it from here.
   */
  branch_id: string;
  display_order: number | null;
  /** TD-15: the client sends this back on edit; a stale one is a `409`. */
  version: number;
}

/**
 * Deliberately **absent**: every field the retired `Group` carried and §20 rule
 * 22 forbids re-adding — `room_id`, `teacher_id`, `assistant_id`, the weekly
 * schedule and **`max_students`**. They belong to delivery, and a DTO that
 * offered them would invite a client to display an organisational unit as
 * though it had a timetable. **No `capacity` exists anywhere** (BR-23): the
 * column is gone, not merely unexposed.
 *
 * Also absent, as everywhere: `created_at`, `updated_at`, `deleted_at`,
 * `deleted_by`.
 */
export function administrativeGroupDto(row: {
  id: string;
  name: string;
  levelId: string;
  branchId: string;
  displayOrder: number | null;
  version: number;
}): AdministrativeGroupDto {
  return {
    id: row.id,
    name: row.name,
    level_id: row.levelId,
    branch_id: row.branchId,
    display_order: row.displayOrder,
    version: row.version,
  };
}

/* ── Roster entry (§5.6 enrollment screen, Revision 43) ──────────────────── */

export interface RosterEntryDto {
  /** The **enrolment** id, not the student's — this is what `DELETE` targets. */
  id: string;
  student_id: string;
  /**
   * The staff-facing legal name, as in the approval queue. The §7 public
   * display-identity rule governs **public** surfaces; a roster is neither, and
   * a kunya here would be wrong.
   */
  name: string | null;
  /** An instant, correctly — an enrolment happens at a moment (cf. TD-11). */
  enrolled_at: string;
}

export function rosterEntryDto(row: {
  id: string;
  studentId: string;
  nameArabic: string | null;
  enrolledAt: Date;
}): RosterEntryDto {
  return {
    id: row.id,
    student_id: row.studentId,
    name: row.nameArabic,
    enrolled_at: row.enrolledAt.toISOString(),
  };
}

/**
 * The enrolment as written, returned from `POST`.
 *
 * `level_id` travels even though the caller never sent it: the service reads it
 * **from the group** (never from the request), and echoing it is how the client
 * learns which Level the student was thereby enrolled into.
 */
export interface EnrollmentDto {
  id: string;
  student_id: string;
  level_id: string;
  administrative_group_id: string;
  enrolled_at: string;
}

export function enrollmentDto(row: {
  id: string;
  studentId: string;
  levelId: string;
  administrativeGroupId: string;
  enrolledAt: Date;
}): EnrollmentDto {
  return {
    id: row.id,
    student_id: row.studentId,
    level_id: row.levelId,
    administrative_group_id: row.administrativeGroupId,
    enrolled_at: row.enrolledAt.toISOString(),
  };
}

/* ── Teaching Group (§4.4c, BR-22, Revision 43) ──────────────────────────── */

export interface TeachingGroupDto {
  id: string;
  name: string;
  /** The pair that identifies *which split of which subject*. Not editable. */
  level_id: string;
  subject_id: string;
  display_order: number | null;
  /**
   * Live members. Present because the §5.6 screen's only question about a split
   * is *how many are in it*, and a list endpoint that forced one request per
   * group to answer it would be an N+1 by contract.
   */
  member_count: number;
  /** TD-15: the client sends this back on edit; a stale one is a `409`. */
  version: number;
}

/**
 * Deliberately **absent**: `branch_id`. A Teaching Group has none — it belongs
 * to a Subject and a Level, and a Level spans branches (§4.4b). That absence is
 * the structural reason Revision 43.3 split the authority over these groups
 * (Super Admin) from the authority over their membership (Admin, scoped by the
 * branch the *student* is enrolled at). A `branch_id` here would invite exactly
 * the scope check that has no referent.
 */
export function teachingGroupDto(row: {
  id: string;
  name: string;
  levelId: string;
  subjectId: string;
  displayOrder: number | null;
  memberCount: number;
  version: number;
}): TeachingGroupDto {
  return {
    id: row.id,
    name: row.name,
    level_id: row.levelId,
    subject_id: row.subjectId,
    display_order: row.displayOrder,
    member_count: row.memberCount,
    version: row.version,
  };
}

/**
 * A student enrolled in the Level who holds no seat in this split Subject
 * (BR-22).
 *
 * `administrative_group_id` and `branch_id` travel because the screen's next
 * action is *place this student*, and both are the context needed to decide
 * where — without them the list names a problem and withholds what is required
 * to fix it.
 */
export interface UnassignedStudentDto {
  student_id: string;
  /** Staff-facing legal name, as on the roster — not a public display identity. */
  name: string | null;
  administrative_group_id: string;
  branch_id: string;
}

export function unassignedStudentDto(row: {
  studentId: string;
  nameArabic: string | null;
  administrativeGroupId: string;
  branchId: string;
}): UnassignedStudentDto {
  return {
    student_id: row.studentId,
    name: row.nameArabic,
    administrative_group_id: row.administrativeGroupId,
    branch_id: row.branchId,
  };
}

/**
 * The whole split for one `(Level, Subject)`, in one read.
 *
 * **`split` is not redundant with `groups.length`.** A Subject with no Teaching
 * Groups is taught to the entire Level (§4.4c), so nobody is unassigned and the
 * empty `unassigned` means *the question does not apply*. A **split** Subject
 * with an empty `unassigned` means *everyone is placed*. The two states render
 * identically without this flag, and one of them is an alarm.
 */
export interface TeachingGroupListDto {
  groups: TeachingGroupDto[];
  split: boolean;
  unassigned: UnassignedStudentDto[];
}

/** The seat as written, returned from `POST /members`. */
export interface TeachingGroupMemberDto {
  id: string;
  student_id: string;
  teaching_group_id: string;
}

export function teachingGroupMemberDto(row: {
  id: string;
  studentId: string;
  teachingGroupId: string;
}): TeachingGroupMemberDto {
  return {
    id: row.id,
    student_id: row.studentId,
    teaching_group_id: row.teachingGroupId,
  };
}

/**
 * What a deletion released (BR-22).
 *
 * A `204` would be the conventional answer and is **wrong here**: deleting a
 * split returns its members to the `unassigned` list, and BR-22 requires that to
 * be visible rather than silent. This count is the only place the number is ever
 * available — afterwards the list has been worked through and cannot be
 * distinguished from students who were never placed.
 */
export interface TeachingGroupDeletionDto {
  released_students: number;
}

export function teachingGroupDeletionDto(row: {
  releasedStudents: number;
}): TeachingGroupDeletionDto {
  return { released_students: row.releasedStudents };
}

/* ── Recurring Course Schedule (§4.4, TD-3.12, Revision 43) ──────────────── */

/**
 * A `TIME(0)` column rendered as a TD-11 **wall-clock time**.
 *
 * `HH:MM`, never an instant. The column has no date and no zone: a class starts
 * at 15:00 at its branch, and an ISO instant here would invite a client to shift
 * it, which is the precise bug TD-11 separates the two kinds of value to
 * prevent. Prisma hands back a `Date` on the UTC epoch day, so the UTC clock
 * fields are the stored ones.
 */
function timeOnly(value: Date): string {
  return value.toISOString().slice(11, 16);
}

export interface CourseScheduleDto {
  id: string;
  subject_id: string;
  /**
   * **Labels, never identifiers** — the ids remain what a client filters and
   * links by. Resolved server-side for the same reason `libraryItemDto` resolves
   * its own: a timetable cannot be rendered from ids, and this list was showing
   * raw UUIDs where every other back-office screen shows a name.
   *
   * `null` on a **write** response, which is built from a narrower projection
   * and whose caller already knows the names it just submitted.
   */
  subject_name: string | null;
  /** Whichever of the three the mode names (§4.4c). */
  target_name: string | null;
  branch_name: string | null;
  room_name: string | null;
  /**
   * **One mode, one target** (§4.4c). The three nullable columns behind this are
   * deliberately not exposed as three fields: a response carrying two of them
   * would have no correct reading, and the pair below cannot express that state
   * at all.
   */
  teaching_mode: string;
  target_id: string;
  branch_id: string;
  room_id: string | null;
  /** TD-11 wall-clock, `HH:MM`. */
  start_time: string;
  end_time: string;
  recurrence: string;
  weekdays: string[];
  day_of_month: number | null;
  month_of_year: number | null;
  /** TD-11 calendar date, `YYYY-MM-DD`. */
  anchor_date: string | null;
  /** R50's bound, published by R55. `null` is open-ended. */
  effective_until: string | null;
  academic_year_id: string;
  staff: { user_id: string; position: string }[];
  /** TD-15: the client sends this back on edit; a stale one is a `409`. */
  version: number;
}

/**
 * The mode's target, collapsed from the three columns the schema keeps.
 *
 * The database CHECK guarantees exactly one is set for the mode, so this reads
 * the one the mode names. A `null` would mean the constraint had been bypassed —
 * `roster-resolution.ts` treats the same state as a corrupted schema rather than
 * bad input, and it is not this function's job to invent a different answer.
 */
function targetOf(row: {
  teachingMode: string;
  levelId: string | null;
  administrativeGroupId: string | null;
  teachingGroupId: string | null;
}): string {
  switch (row.teachingMode) {
    case 'entire_level':
      return row.levelId ?? '';
    case 'administrative_group':
      return row.administrativeGroupId ?? '';
    default:
      return row.teachingGroupId ?? '';
  }
}

export function courseScheduleDto(row: {
  id: string;
  subjectId: string;
  teachingMode: string;
  levelId: string | null;
  administrativeGroupId: string | null;
  teachingGroupId: string | null;
  branchId: string;
  roomId: string | null;
  startTime: Date;
  endTime: Date;
  recurrence: string;
  weekdays: string[];
  dayOfMonth: number | null;
  monthOfYear: number | null;
  anchorDate: Date | null;
  effectiveUntil: Date | null;
  academicYearId: string;
  staff: { userId: string; position: string }[];
  version: number;
  /**
   * **The labels the ids stand for**, resolved server-side — optional because
   * the write paths build their response from a narrower projection, and a
   * write's caller already knows the names it just submitted.
   */
  subject?: { name: string } | null;
  branch?: { name: string } | null;
  room?: { name: string } | null;
  level?: { name: string } | null;
  administrativeGroup?: { name: string } | null;
  teachingGroup?: { name: string } | null;
}): CourseScheduleDto {
  return {
    id: row.id,
    subject_id: row.subjectId,
    subject_name: row.subject?.name ?? null,
    teaching_mode: row.teachingMode,
    target_id: targetOf(row),
    // Whichever of the three the mode names (§4.4c) — the timetable reads *who
    // this class is for*, and the caller should not have to resolve that from
    // three nullable ids.
    target_name:
      row.level?.name ?? row.administrativeGroup?.name ?? row.teachingGroup?.name ?? null,
    branch_id: row.branchId,
    branch_name: row.branch?.name ?? null,
    room_id: row.roomId,
    room_name: row.room?.name ?? null,
    start_time: timeOnly(row.startTime),
    end_time: timeOnly(row.endTime),
    recurrence: row.recurrence,
    weekdays: row.weekdays,
    day_of_month: row.dayOfMonth,
    month_of_year: row.monthOfYear,
    anchor_date: dateOnly(row.anchorDate),
    // R50's bound, published by R55 so a client can render *until when* rather
    // than presenting an open-ended class that is not one.
    effective_until: dateOnly(row.effectiveUntil),
    academic_year_id: row.academicYearId,
    staff: row.staff.map((s) => ({ user_id: s.userId, position: s.position })),
    version: row.version,
  };
}

/**
 * What a write did to the timetable (§4.4, Revision 43.4/43.6).
 *
 * **`protected_sessions` is the load-bearing field.** A session holding data
 * whose loss would change historical truth is left alone, and this is where the
 * administrator learns *which* and *why* — with every applicable reason, since
 * someone deciding whether to override one deserves all of them. A write that
 * reported only `created` would claim a timetable is now consistent when part of
 * it deliberately is not.
 */
export interface MaterializationDto {
  created: number;
  existing: number;
  resynced: number;
  protected_sessions: { id: string; date: string; reasons: string[] }[];
}

export function materializationDto(row: {
  created: number;
  existing: number;
  resynced: number;
  protectedSessions: { id: string; date: Date; reasons: string[] }[];
}): MaterializationDto {
  return {
    created: row.created,
    existing: row.existing,
    resynced: row.resynced,
    protected_sessions: row.protectedSessions.map((p) => ({
      id: p.id,
      // A session's date is a TD-11 calendar date, not an instant.
      date: p.date.toISOString().slice(0, 10),
      reasons: p.reasons,
    })),
  };
}

/**
 * What a write returns: the schedule as **stored**, beside what it did to the
 * timetable.
 *
 * **Nested rather than flattened**, for two reasons. The schedule keeps exactly
 * the shape it has everywhere else, so one renderer serves a list row and a
 * write response — flattening would make the write a near-copy that drifts. And
 * it needs no spread: a spread of a DTO is safe, but `check-contract-dto.sh`
 * cannot tell it from a spread of a row, and a guard that has to be argued with
 * is one somebody eventually silences.
 */
export interface CourseScheduleWriteDto {
  schedule: CourseScheduleDto;
  materialization: MaterializationDto;
}

export function courseScheduleWriteDto(
  row: Parameters<typeof courseScheduleDto>[0],
  materialized: Parameters<typeof materializationDto>[0],
): CourseScheduleWriteDto {
  return { schedule: courseScheduleDto(row), materialization: materializationDto(materialized) };
}

/** What deleting a schedule removed, and what it deliberately kept (§4.4). */
export interface ScheduleDeletionDto {
  future_removed: number;
  /**
   * Sessions holding data whose loss would change historical truth. **They
   * survive the schedule that created them**, so an administrator expecting a
   * clear timetable needs the count — and it is unavailable afterwards.
   */
  retained: number;
}

export function scheduleDeletionDto(row: {
  futureRemoved: number;
  retained: number;
}): ScheduleDeletionDto {
  return { future_removed: row.futureRemoved, retained: row.retained };
}

/** One overlap an administrator has to resolve (TD-4.6c). */
export interface ScheduleConflictDto {
  kind: string;
  /** TD-11 calendar date. */
  date: string;
  session_id: string;
  schedule_id: string;
  /** The person or room both classes want. */
  resource_id: string;
}

export function scheduleConflictDto(row: {
  kind: string;
  date: string;
  sessionId: string;
  scheduleId: string;
  resourceId: string;
}): ScheduleConflictDto {
  return {
    kind: row.kind,
    date: row.date,
    session_id: row.sessionId,
    schedule_id: row.scheduleId,
    resource_id: row.resourceId,
  };
}

/** A student in a schedule's **resolved** audience — computed live, never stored. */
export interface ScheduleRosterEntryDto {
  student_id: string;
  name: string | null;
}

export function scheduleRosterEntryDto(row: {
  id: string;
  nameArabic: string | null;
}): ScheduleRosterEntryDto {
  return { student_id: row.id, name: row.nameArabic };
}

/* ── Session (§4.4, TD-1, TD-3.12, Revision 43) ──────────────────────────── */

export interface SessionDto {
  id: string;
  schedule_id: string;
  /** TD-11 calendar date — a class happens on a day, not at an instant. */
  date: string;
  /** TD-11 wall-clock, `HH:MM`. */
  start_time: string;
  end_time: string;
  room_id: string | null;
  /** TD-1 lifecycle. Moved only by `/cancel` and `/restore`, never by `PATCH`. */
  status: string;
  /**
   * **A human decided about this occurrence** (Revision 43.4) — not "differs
   * from the schedule". The flag is set by any override, even one whose values
   * happen to match the schedule, because inferring it from a difference would
   * silently un-protect a session whose schedule later moved to match it. This
   * is what survives the next schedule edit.
   */
  overridden: boolean;
  /**
   * Present only on a cancelled session. **The only record of why a class did
   * not happen** — §4.4 makes it mandatory at cancellation for that reason.
   */
  cancellation_reason: string | null;
  /** TD-15: the client sends this back; a stale one is a `409`. */
  version: number;
}

/**
 * Deliberately **absent**: `created_at`, `updated_at`, `deleted_at`,
 * `deleted_by`, and the staffing snapshot. Staffing is written through the
 * override verb and read from the schedule's roster surfaces; a session DTO
 * carrying a partial copy would be a second place to look for it.
 */
export function sessionDto(row: {
  id: string;
  scheduleId: string;
  date: Date;
  startTime: Date;
  endTime: Date;
  roomId: string | null;
  status: string;
  overridden: boolean;
  cancellationReason: string | null;
  version: number;
}): SessionDto {
  return {
    id: row.id,
    schedule_id: row.scheduleId,
    date: row.date.toISOString().slice(0, 10),
    start_time: timeOnly(row.startTime),
    end_time: timeOnly(row.endTime),
    room_id: row.roomId,
    status: row.status,
    overridden: row.overridden,
    cancellation_reason: row.cancellationReason,
    version: row.version,
  };
}

/**
 * A content link, returned from `POST /sessions/{id}/content`.
 *
 * The link is its own row: `DELETE` **unlinks and never deletes the file**
 * (TD-3.12), so this id addresses the association rather than the content.
 */
export interface SessionContentLinkDto {
  id: string;
  session_id: string;
  /** Named as TD-3.12 names it on the way in — one vocabulary per concept. */
  educational_content_id: string;
}

export function sessionContentLinkDto(row: {
  id: string;
  sessionId: string;
  contentId: string;
}): SessionContentLinkDto {
  return { id: row.id, session_id: row.sessionId, educational_content_id: row.contentId };
}

/* ── Educational Library (§5.2, §4.9, TD-3.13, Revision 43) ──────────────── */

export interface LibraryItemDto {
  id: string;
  title: string;
  description: string | null;
  /** §4.9 tier. Present so a client can badge a restricted item **before** the
   *  reader asks for it — the download is what requires login, not the listing. */
  visibility: string;
  level_id: string;
  subject_id: string;
  academic_year_id: string;
  /** `null` is **Global**, not unknown (§7) — it renders as its own container. */
  branch_id: string | null;
  mime_type: string;
  size_bytes: number;
  /** An instant, correctly — an upload happens at a moment (cf. TD-11). */
  created_at: string;
  /**
   * §5.2's headings, resolved server-side.
   *
   * The library groups **Category → Level → Academic Year → Branch**, and no
   * public endpoint publishes Subject or Academic Year names — `/admin/*` is
   * Admin-only by design (R30). Carrying them makes the response
   * self-sufficient, which is what TD-3.4 already requires of the calendar.
   * **Labels, never identifiers:** the ids above stay what a client filters by.
   */
  category_id: string;
  category_name: string;
  level_name: string;
  subject_name: string;
  academic_year_label: string;
  /** `null` is **Global / بدون فرع**, not unknown — it renders as its own
   *  container (§4.9, BR-20). */
  branch_name: string | null;
}

/**
 * Deliberately **absent**: `storage_bucket`, `storage_key`, `original_filename`
 * and `consent_forced_private`.
 *
 * The first three are the object's location, and TD-3.5 mints a short-lived
 * presigned URL through `GET /content/{id}/download-url` after a permission
 * check — publishing the key on a **public** endpoint would hand every
 * anonymous visitor the one input that check exists to protect. The fourth is
 * the consent gate's internal state: it says *a student in this recording's
 * audience has no media release*, which is a fact about a child, and BR-2 needs
 * it enforced, not broadcast.
 */
export function libraryItemDto(row: {
  id: string;
  title: string;
  description: string | null;
  visibility: string;
  levelId: string;
  subjectId: string;
  academicYearId: string;
  branchId: string | null;
  mimeType: string;
  sizeBytes: bigint;
  createdAt: Date;
  categoryId: string;
  categoryName: string;
  levelName: string;
  subjectName: string;
  academicYearLabel: string;
  branchName: string | null;
}): LibraryItemDto {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    visibility: row.visibility,
    level_id: row.levelId,
    subject_id: row.subjectId,
    academic_year_id: row.academicYearId,
    branch_id: row.branchId,
    mime_type: row.mimeType,
    // `BigInt` has no JSON representation and would throw on serialisation;
    // a file size fits a double long before it reaches the TD-9 cap.
    size_bytes: Number(row.sizeBytes),
    created_at: row.createdAt.toISOString(),
    category_id: row.categoryId,
    category_name: row.categoryName,
    level_name: row.levelName,
    subject_name: row.subjectName,
    academic_year_label: row.academicYearLabel,
    branch_name: row.branchName,
  };
}

/* ── Reference-data selectors (TD-3 extension, 2026-08-05) ───────────────── */

export interface SubjectRefDto {
  id: string;
  name: string;
  display_order: number | null;
  /** TD-15 — see the note below on why this one field is present. */
  version: number;
}

/**
 * Deliberately **absent**: `created_at`, `updated_at`, `deleted_at`,
 * `deleted_by`.
 *
 * A selector needs an id, a label and what it sorts by. A reference list is
 * exactly where *"just return the row"* is most tempting and least noticed.
 *
 * **`version` is the one addition, and it is what avoided a second list.** When
 * Subject gained create/edit/delete, the الفئات والمواد screen needed the TD-15
 * version to send back on an edit. Publishing it here let that screen reuse this
 * endpoint; the alternative was a parallel `GET` over the same table with a
 * wider projection — two reads of one concept, kept in step by hand.
 */
export function subjectRefDto(row: {
  id: string;
  name: string;
  displayOrder: number | null;
  version: number;
}): SubjectRefDto {
  return { id: row.id, name: row.name, display_order: row.displayOrder, version: row.version };
}

/* ── Curriculum taxonomy (§5.6 Categories & Subjects, §14.1) ─────────────── */

export interface CategoryDto {
  id: string;
  name: string;
  display_order: number | null;
  /** Live Levels in this Category — what says whether deleting it is possible
   *  at all, without a request per row. */
  level_count: number;
  version: number;
}

export function categoryDto(row: {
  id: string;
  name: string;
  displayOrder: number | null;
  levelCount: number;
  version: number;
}): CategoryDto {
  return {
    id: row.id,
    name: row.name,
    display_order: row.displayOrder,
    level_count: row.levelCount,
    version: row.version,
  };
}

/**
 * A Level's own fields — the shape a write answers with.
 *
 * Split from the list projection below on purpose: a create or an edit knows the
 * Level, and **counting its groups and enrolments to answer it would be
 * inventing work the caller did not ask for**. The list is where those counts
 * earn their query.
 */
export interface LevelCoreDto {
  id: string;
  name: string;
  category_id: string;
  /** §4.4b / Revision 27 — `any | girls_only | boys_only`. */
  gender_restriction: string;
  display_order: number | null;
  version: number;
}

export function levelCoreDto(row: {
  id: string;
  name: string;
  categoryId: string;
  genderRestriction: string;
  displayOrder: number | null;
  version: number;
}): LevelCoreDto {
  return {
    id: row.id,
    name: row.name,
    category_id: row.categoryId,
    gender_restriction: row.genderRestriction,
    display_order: row.displayOrder,
    version: row.version,
  };
}

/**
 * A Level as the back office lists it.
 *
 * `category_name` travels because a Levels screen groups by Category, and
 * resolving 21 names client-side from a second list is how two lists get out of
 * step. It is a **label**, never an identifier: `category_id` is the identifier.
 */
export interface LevelDto extends LevelCoreDto {
  category_name: string;
  group_count: number;
  subject_count: number;
  enrollment_count: number;
}

/**
 * Written out field by field rather than spread over `levelCoreDto` — the
 * §16.2 (Revision 38) rule is *build the object field by field*, and a spread
 * of a DTO is indistinguishable from a spread of a database row at the point
 * where it matters. The guard is blunt on purpose and the honest response is to
 * satisfy it, not to exempt it.
 */
export function levelDto(row: {
  id: string;
  name: string;
  categoryId: string;
  categoryName: string;
  genderRestriction: string;
  displayOrder: number | null;
  groupCount: number;
  subjectCount: number;
  enrollmentCount: number;
  version: number;
}): LevelDto {
  return {
    id: row.id,
    name: row.name,
    category_id: row.categoryId,
    category_name: row.categoryName,
    gender_restriction: row.genderRestriction,
    display_order: row.displayOrder,
    group_count: row.groupCount,
    subject_count: row.subjectCount,
    enrollment_count: row.enrollmentCount,
    version: row.version,
  };
}

/**
 * `POST /admin/levels` — the Level **and** the المجموعة 1 created with it
 * (TD-4.6b). The group is reported rather than left implicit: it was created by
 * this request, at a branch the caller named, and a client that never sees it
 * cannot tell an administrator where their new Level's first group went.
 */
export interface CreatedLevelDto extends LevelCoreDto {
  first_group: { id: string; name: string; branch_id: string };
}

export function createdLevelDto(
  level: {
    id: string;
    name: string;
    categoryId: string;
    genderRestriction: string;
    displayOrder: number | null;
    version: number;
  },
  firstGroup: { id: string; name: string; branchId: string },
): CreatedLevelDto {
  return {
    id: level.id,
    name: level.name,
    category_id: level.categoryId,
    gender_restriction: level.genderRestriction,
    display_order: level.displayOrder,
    version: level.version,
    first_group: { id: firstGroup.id, name: firstGroup.name, branch_id: firstGroup.branchId },
  };
}

export interface AcademicYearRefDto {
  id: string;
  /** `YYYY-YYYY` (§4.10, TD-6). */
  label: string;
  /** What lets a form default to the live year rather than asking someone to
   *  remember which it is. */
  is_current: boolean;
}

export function academicYearRefDto(row: {
  id: string;
  label: string;
  isCurrent: boolean;
}): AcademicYearRefDto {
  return { id: row.id, label: row.label, is_current: row.isCurrent };
}

/* ── Approval queue (§5.6, §14.2) ────────────────────────────────────────── */

export interface ApprovalDto {
  id: string;
  type: 'registration' | 'family-link';
  /**
   * What a self-service applicant asked to become (Revision 49) — `'teacher'`
   * or `null`. **A hint, never an authority**: it is what makes a staff request
   * distinguishable in the queue, and the role itself is granted only by the
   * assignment the approver states.
   */
  requested_role: string | null;
  /**
   * The educational stage the applicant asked for (Revision 49) — what §4.1
   * step 1 preselects the first Level from. A request, never a placement.
   */
  category: { id: string; name: string } | null;
  /** §14.2 column: Applicant(s). */
  applicants: { id: string; name: string; role: 'applicant' | 'child' | 'parent' }[];
  /** An instant, correctly — a submission is a moment, not a calendar date. */
  submitted_at: string;
  /** §14.2 column: Bundle contents — what approving this will actually change. */
  bundle: { child_count: number; link_count: number };
  /**
   * §14.2 column: Branch requested (Revision 39) — **what the applicant asked
   * for**, never where they will be placed. `null` on a family-link item, and
   * `null` on any account registered before R39, where it means *not stated*
   * rather than *no branch*.
   */
  branch: { id: string; name: string } | null;
}

/**
 * The approval queue never returned an ORM model — it returned a hand-built
 * shape in `camelCase`. That is a convention violation rather than a leak, and
 * Revision 38 corrected it in the same pass, because a contract that is *mostly*
 * consistent is the harder kind to remember.
 *
 * `name` rather than `name_arabic`: the field is *the name to display*, and the
 * queue shows staff-facing legal names. The public display-identity invariant
 * (§7) governs **public** surfaces; the approval queue is neither public nor a
 * place where a kunya would be correct.
 */
export function approvalDto(row: {
  id: string;
  type: 'registration' | 'family-link';
  applicants: { id: string; nameArabic: string; role: 'applicant' | 'child' | 'parent' }[];
  submittedAt: Date;
  bundle: { childCount: number; linkCount: number };
  branch: { id: string; name: string } | null;
  requestedRole: string | null;
  category: { id: string; name: string } | null;
}): ApprovalDto {
  return {
    id: row.id,
    type: row.type,
    applicants: row.applicants.map((a) => ({ id: a.id, name: a.nameArabic, role: a.role })),
    submitted_at: row.submittedAt.toISOString(),
    bundle: { child_count: row.bundle.childCount, link_count: row.bundle.linkCount },
    // Field by field, never a spread — the branch is projected to exactly the
    // two fields the screen renders (§16.2).
    branch: row.branch ? { id: row.branch.id, name: row.branch.name } : null,
    requested_role: row.requestedRole,
    // Field by field, never a spread — two fields, the same as the branch.
    category: row.category ? { id: row.category.id, name: row.category.name } : null,
  };
}

/* ── Platform setting (§5.6, TD-3.11, Revision 42) ───────────────────────── */

export interface SettingDto {
  key: string;
  /** An i18n KEY, not copy: which settings are writable is a server decision,
   *  and a client holding its own labels would drift from the allow-list. */
  label_key: string;
  hint_key: string;
  /** `null` when never configured — deliberately distinct from an empty string,
   *  which the write path refuses. For the consent version, null is the state
   *  in which no registration can be accepted at all (§4.1a). */
  value: string | null;
  /** TD-15: sent back on save; a stale one is a `409`. */
  version: number;
}

export function settingDto(row: {
  key: string;
  label_key: string;
  hint_key: string;
  value: string | null;
  version: number;
}): SettingDto {
  return {
    key: row.key,
    label_key: row.label_key,
    hint_key: row.hint_key,
    value: row.value,
    version: row.version,
  };
}

/* ── Users (§5.6 /admin/users, §14.2) ────────────────────────────────────── */

/**
 * A user as the §14.2 Users screen lists them — **and as every write answers**.
 *
 * One shape for the list and for edit, suspend, reactivate and role assignment,
 * so a screen renders the result of an action with the renderer it already has
 * and never re-fetches a page to see one row change.
 *
 * Deliberately **absent**: `pre_provisioned_email` (an authorisation to claim an
 * account, not a contact detail), `notes`, `sex`, `intended_branch_id`, and
 * anything from `StudentSocialProfile` — §4.10 restricts those to assigned
 * teachers, so a back-office list is the last place they belong.
 */
export interface UserDto {
  id: string;
  name_arabic: string;
  nickname: string | null;
  public_display_name: string | null;
  phone: string | null;
  account_status: string;
  /**
   * The bound Google address, or the pre-provisioned one for an account not yet
   * claimed (R15). **`null` is a fact, not a gap**: minor students are
   * login-less `User` rows with no address at all (§4.3), and showing an empty
   * cell for them is correct.
   *
   * Not a *display identity* and therefore outside §20 rule 21: that rule
   * governs the name shown to the public, and this is an administrative
   * identifier on a staff-only screen (TD-2).
   */
  email: string | null;
  roles: { role: string; branch_id: string | null; branch_name: string | null }[];
  /** TD-15 — what the edit dialog sends back. Its presence here is why there is
   *  no separate single-user read. */
  version: number;
}

export function userDto(row: {
  id: string;
  nameArabic: string;
  nickname: string | null;
  publicDisplayName: string | null;
  phone: string | null;
  accountStatus: string;
  email?: string | null;
  roles: { role: string; branchId: string | null; branchName: string | null }[];
  version: number;
}): UserDto {
  return {
    id: row.id,
    name_arabic: row.nameArabic,
    nickname: row.nickname,
    public_display_name: row.publicDisplayName,
    phone: row.phone,
    account_status: row.accountStatus,
    email: row.email ?? null,
    roles: row.roles.map((r) => ({
      role: r.role,
      branch_id: r.branchId,
      branch_name: r.branchName,
    })),
    version: row.version,
  };
}

/* ── A schedule's materialized occurrences (§4.4, Revision 50) ───────────── */

/**
 * One occurrence, as the scope dialog lists them.
 *
 * **`protected_reasons` is the load-bearing field.** §4.4 requires the dialog to
 * state which occurrences are about to change, and that is unanswerable without
 * saying which will be spared. The codes come from the R43.6 rule set and are
 * part of the contract — renaming one changes an administrator's record of why
 * something was left alone.
 */
export interface ScheduleSessionDto {
  id: string;
  /** TD-11 calendar date, never an instant. */
  date: string;
  /** Wall-clock `HH:MM` (TD-11). */
  start_time: string;
  end_time: string;
  status: string;
  /** R43.4 — *a human decided about this occurrence*. */
  overridden: boolean;
  room_id: string | null;
  /** TD-15: sent back on a "this session only" edit. */
  version: number;
  staff: { user_id: string; position: string }[];
  protected_reasons: string[];
}

export function scheduleSessionDto(row: {
  id: string;
  date: Date;
  startTime: Date;
  endTime: Date;
  status: string;
  overridden: boolean;
  roomId: string | null;
  version: number;
  staff: { userId: string; position: string }[];
  protectedReasons: string[];
}): ScheduleSessionDto {
  return {
    id: row.id,
    date: row.date.toISOString().slice(0, 10),
    start_time: row.startTime.toISOString().slice(11, 16),
    end_time: row.endTime.toISOString().slice(11, 16),
    status: row.status,
    overridden: row.overridden,
    room_id: row.roomId,
    version: row.version,
    staff: row.staff.map((s) => ({ user_id: s.userId, position: s.position })),
    protected_reasons: row.protectedReasons,
  };
}

/* ── Trash (§7, TD-5, BR-15, Revision 52) ────────────────────────────────── */

export interface TrashEntryDto {
  id: string;
  target_entity: string;
  target_id: string;
  /** A name pulled from the snapshot — without it the list is a page of UUIDs. */
  label: string | null;
  /** An instant: a deletion happens at a moment (cf. TD-11). */
  deleted_at: string;
  deleted_by_id: string | null;
  /** The staff-facing legal name, as everywhere in the back office. */
  deleted_by_name: string | null;
  /** BR-15's 90-day window. */
  purge_after: string;
  /**
   * **Decided by the server, per entity type.** A client cannot know which
   * deletions cascade, and one that guessed would offer a button that silently
   * half-restores a person (§7).
   */
  restorable: boolean;
  /** A stable code when `restorable` is false — rendered, so renaming one
   *  changes what an administrator is told about their own data. */
  restore_blocked_reason: string | null;
}

/**
 * Deliberately **absent: `snapshot`**.
 *
 * It is the whole row as it was — every column, including ones no screen is
 * entitled to (a person's phone, notes, `pre_provisioned_email`). The Trash
 * screen's question is *what was deleted, by whom, and when*, and the snapshot
 * answers a different and far more sensitive one. Restoration reads it
 * server-side; nothing needs it on the wire.
 */
export function trashEntryDto(row: {
  id: string;
  targetEntity: string;
  targetId: string;
  label: string | null;
  deletedAt: Date;
  deletedById: string | null;
  deletedByName: string | null;
  purgeAfter: Date;
  restorable: boolean;
  restoreBlockedReason: string | null;
}): TrashEntryDto {
  return {
    id: row.id,
    target_entity: row.targetEntity,
    target_id: row.targetId,
    label: row.label,
    deleted_at: row.deletedAt.toISOString(),
    deleted_by_id: row.deletedById,
    deleted_by_name: row.deletedByName,
    purge_after: row.purgeAfter.toISOString(),
    restorable: row.restorable,
    restore_blocked_reason: row.restoreBlockedReason,
  };
}

/**
 * One stored event **definition** (TD-3.4, R56) — the rule, never its expansion.
 *
 * Deliberately close in shape to `CourseScheduleDto`: the unified Scheduling
 * list shows both side by side, and two lists answering the same *kind* of
 * question must publish the same *kind* of row. The fields each has no source
 * for are simply absent rather than invented — an Event has no subject, room or
 * staff, which is exactly what §4.4 says about it.
 */
export interface EventDefinitionDto {
  id: string;
  title: string;
  description: string | null;
  visibility: string;
  /** TD-11 calendar dates and wall-clock times — never instants. `null` times
   *  mean an ALL-DAY event, which is a real state and not a missing value. */
  start_date: string;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  recurrence: string;
  /** The bound. `null` is open-ended, exactly as `effective_until` is for a
   *  schedule — one vocabulary across the two halves of the screen. */
  recurrence_end_date: string | null;
  /** Empty means the **Global** scope (§4.4): the event belongs to every branch
   *  rather than to none, which is why it is a list and not a nullable id. */
  branch_ids: string[];
  version: number;
}

export function eventDefinitionDto(row: {
  id: string;
  title: string;
  description: string | null;
  visibility: string;
  startDate: Date;
  endDate: Date | null;
  startTime: Date | null;
  endTime: Date | null;
  recurrenceType: string;
  recurrenceEndDate: Date | null;
  branchScopes: { branchId: string }[];
  version: number;
}): EventDefinitionDto {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    visibility: String(row.visibility),
    start_date: dateOnly(row.startDate)!,
    end_date: dateOnly(row.endDate),
    // `null` is ALL-DAY, a real state — so the guard is here rather than in
    // `timeOnly`, whose other caller has a non-null column.
    start_time: row.startTime ? timeOnly(row.startTime) : null,
    end_time: row.endTime ? timeOnly(row.endTime) : null,
    recurrence: String(row.recurrenceType),
    recurrence_end_date: dateOnly(row.recurrenceEndDate),
    branch_ids: row.branchScopes.map((b) => b.branchId),
    version: row.version,
  };
}
