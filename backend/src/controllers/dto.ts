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

import type { Prisma } from "../generated/prisma/client.js";
import { splitComposedName } from '../lib/person-name.js';
import { toNumber } from "../policies/grading.js";
import type { Page } from "../lib/pagination.js";

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
  /** NEW I — the second published number. `null` is the ordinary one-number
   *  branch, never a gap. */
  phone_secondary: string | null;
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
  phoneSecondary: string | null;
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
    phone_secondary: row.phoneSecondary,
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
  return {
    id: row.id,
    name: row.name,
    branch_id: row.branchId,
    version: row.version,
  };
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
  /**
   * How many live enrolments the group holds — **derived per request, never
   * stored.** A stored count drifts the moment an enrolment is added from
   * anywhere else, and this one has a management table depending on it.
   */
  member_count: number;
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
  memberCount: number;
}): AdministrativeGroupDto {
  return {
    id: row.id,
    name: row.name,
    level_id: row.levelId,
    branch_id: row.branchId,
    display_order: row.displayOrder,
    member_count: row.memberCount,
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
  /** R66 — `null` when the student is enrolled directly in a Level. */
  administrative_group_id: string | null;
  branch_id: string;
  enrolled_at: string;
}

export function enrollmentDto(row: {
  id: string;
  studentId: string;
  levelId: string;
  administrativeGroupId: string | null;
  branchId: string;
  enrolledAt: Date;
}): EnrollmentDto {
  return {
    id: row.id,
    student_id: row.studentId,
    level_id: row.levelId,
    administrative_group_id: row.administrativeGroupId,
    // R66 — where the student actually is. It used to be reachable only by
    // following the group, so a client had no way to ask it of a student in a
    // Level nobody had subdivided.
    branch_id: row.branchId,
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
 * One student's seat in a circle — the roster row.
 *
 * The same three facts `rosterEntryDto` publishes for an Administrative Group, and
 * deliberately not more: the screen's question is *who is in this circle*, and a
 * roster is not a place to widen what is known about a person.
 *
 * **`student_id` is the key, not a seat id.** Removal is
 * `DELETE …/members/{studentId}` — the path names the student, so publishing a
 * join-row id would be publishing an identifier nothing takes.
 */
export interface CircleMemberDto {
  student_id: string;
  /** The staff-facing legal name; a roster is not a public surface (§7). */
  name: string | null;
  /** An instant, correctly — a placement happens at a moment (cf. TD-11). */
  added_at: string;
}

export function circleMemberDto(row: {
  studentId: string;
  name: string | null;
  addedAt: Date;
}): CircleMemberDto {
  return {
    student_id: row.studentId,
    name: row.name,
    added_at: row.addedAt.toISOString(),
  };
}

/**
 * A circle **listed across Levels and Subjects**, for the `حلقات المواد` table.
 *
 * `TeachingGroupDto` carries only the two ids, which is right for the read
 * addressed *by* that pair — the caller already knows them. A flat table does
 * not, so the row names them, and the Level is named as
 * `{Category} — {Level}`'s two parts rather than as one pre-joined string: the
 * client owns that label (`levelLabel`), and a second implementation of it on
 * the server is exactly the drift the shared component exists to prevent.
 *
 * **Still no `branch_id`, and still no مؤطرة** — see the note above
 * `teachingGroupDto` for the first, and §4.4c for the second: staffing is a
 * property of a `CourseSchedule`, not of the audience it teaches.
 */
export interface TeachingGroupRowDto extends TeachingGroupDto {
  level_name: string;
  category_name: string;
  subject_name: string;
}

export function teachingGroupRowDto(row: {
  id: string;
  name: string;
  levelId: string;
  levelName: string;
  categoryName: string;
  subjectId: string;
  subjectName: string;
  displayOrder: number | null;
  memberCount: number;
  version: number;
}): TeachingGroupRowDto {
  // **Field by field, not `...teachingGroupDto(row)`** (§16.2, R38). The spread
  // read as harmless reuse and is exactly what the rule forbids: it makes this
  // contract inherit whatever the other one grows, so a field added there
  // appears on the flat read without anyone deciding it should. The `interface
  // extends` above is the right place to share the shape — a type cannot leak a
  // value.
  return {
    id: row.id,
    name: row.name,
    level_id: row.levelId,
    subject_id: row.subjectId,
    display_order: row.displayOrder,
    member_count: row.memberCount,
    version: row.version,
    level_name: row.levelName,
    category_name: row.categoryName,
    subject_name: row.subjectName,
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
  administrative_group_id: string | null;
  branch_id: string;
}

export function unassignedStudentDto(row: {
  studentId: string;
  nameArabic: string | null;
  /** R66 — `null` for a student enrolled directly in an unsubdivided Level. */
  administrativeGroupId: string | null;
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
  /** R57 — what the class is CALLED. A label, never an identifier: not unique,
   *  and no part of scheduling logic. `subject_id` remains the identifier. */
  title: string;
  description: string | null;
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
  /**
   * **Which Level this class is for**, whatever the mode names.
   *
   * `target_id` answers *who is it for*; this answers *which Level*, and for
   * `entire_level` the two coincide. For the other two modes the Level is a
   * fact about the target — an Administrative Group and a Teaching Group each
   * belong to one — and the server already knows it, so a client that had to
   * re-derive it would be re-deriving something it cannot see: `§2.2` scopes
   * the Group to its Level and no field on this response carried that link.
   *
   * The edit form is what made the gap concrete. A class taught to a Group has
   * `level_id IS NULL` on its own row (`course_schedule_mode_target_check`
   * allows exactly one target per mode), so a form seeding itself from this
   * response had no Level to seed — and the Group list, which §4.4c narrows by
   * Level **and** Branch together, then came back empty and dropped the very
   * Group the class already had.
   *
   * `null` on a **write** response, for the same reason the labels above are:
   * a narrower projection, and a caller that just submitted knows the Level.
   */
  level_id: string | null;
  branch_id: string;
  room_id: string | null;
  /**
   * **R97 — how the class is delivered.** `in_person` | `online`, with
   * `online_media_mode` non-null exactly when it is `online`.
   *
   * Provider-independent by design: no room name, URL, token or vendor
   * identifier belongs on this contract. A client renders *«حضوري»* or *«عن
   * بُعد»* from these two fields alone.
   */
  delivery_mode: string;
  online_media_mode: string | null;
  /**
   * **R109 — the visibility tier.** `public` | `private` | `hidden`, the same
   * three §4.4 gives an `Event`. Published so a client can render *«من يرى
   * هذا؟»* without a second request, and so an edit form can hydrate from the
   * row rather than from a hardcoded default — the defect NEW B §A found.
   */
  visibility: string;
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
  /** R91 — each assignment with its inclusive effective period. `null` at
   *  either end is open-ended there. */
  staff: {
    user_id: string;
    position: string;
    effective_from: string | null;
    effective_until: string | null;
  }[];
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
    case "entire_level":
      return row.levelId ?? "";
    case "administrative_group":
      return row.administrativeGroupId ?? "";
    default:
      return row.teachingGroupId ?? "";
  }
}

export function courseScheduleDto(row: {
  id: string;
  title: string;
  description: string | null;
  subjectId: string;
  teachingMode: string;
  levelId: string | null;
  administrativeGroupId: string | null;
  teachingGroupId: string | null;
  branchId: string;
  roomId: string | null;
  /** R97 — the schedule's DEFAULT delivery for the Sessions it materializes. */
  deliveryMode: string;
  onlineMediaMode: string | null;
  /** R109 — the schedule's DEFAULT tier for the Sessions it materializes. */
  visibility: string;
  startTime: Date;
  endTime: Date;
  recurrence: string;
  weekdays: string[];
  dayOfMonth: number | null;
  monthOfYear: number | null;
  anchorDate: Date | null;
  effectiveUntil: Date | null;
  academicYearId: string;
  staff: {
    userId: string;
    position: string;
    effectiveFrom?: Date | null;
    effectiveUntil?: Date | null;
  }[];
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
  // `levelId` travels beside the name because §2.2 scopes each of these to one
  // Level, and that link is what `level_id` publishes.
  administrativeGroup?: { name: string; levelId: string } | null;
  teachingGroup?: { name: string; levelId: string } | null;
}): CourseScheduleDto {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    subject_id: row.subjectId,
    subject_name: row.subject?.name ?? null,
    teaching_mode: row.teachingMode,
    target_id: targetOf(row),
    // Resolved rather than read from one column: only `entire_level` carries a
    // `level_id` of its own, and the other two reach theirs through the target.
    level_id:
      row.levelId ??
      row.administrativeGroup?.levelId ??
      row.teachingGroup?.levelId ??
      null,
    // Whichever of the three the mode names (§4.4c) — the timetable reads *who
    // this class is for*, and the caller should not have to resolve that from
    // three nullable ids.
    target_name:
      row.level?.name ??
      row.administrativeGroup?.name ??
      row.teachingGroup?.name ??
      null,
    branch_id: row.branchId,
    branch_name: row.branch?.name ?? null,
    room_id: row.roomId,
    room_name: row.room?.name ?? null,
    delivery_mode: row.deliveryMode,
    online_media_mode: row.onlineMediaMode,
    visibility: String(row.visibility),
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
    staff: row.staff.map((s) => ({
      user_id: s.userId,
      position: s.position,
      effective_from: dateOnly(s.effectiveFrom ?? null),
      effective_until: dateOnly(s.effectiveUntil ?? null),
    })),
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
  return {
    schedule: courseScheduleDto(row),
    materialization: materializationDto(materialized),
  };
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
  /**
   * **R97 — this occurrence's OWN delivery**, snapshotted at materialization
   * and overridable for one date. `online_media_mode` is non-null exactly when
   * `delivery_mode` is `'online'`, and an online occurrence carries no
   * `room_id` at all.
   */
  delivery_mode: string;
  online_media_mode: string | null;
  /**
   * **R109 — the visibility tier.** `public` | `private` | `hidden`, the same
   * three §4.4 gives an `Event`. Published so a client can render *«من يرى
   * هذا؟»* without a second request, and so an edit form can hydrate from the
   * row rather than from a hardcoded default — the defect NEW B §A found.
   */
  visibility: string;
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
  /** R97 — this occurrence's OWN delivery, snapshotted at materialization. */
  deliveryMode: string;
  onlineMediaMode: string | null;
  /** R109 — this occurrence's OWN tier, snapshotted at materialization. */
  visibility: string;
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
    delivery_mode: row.deliveryMode,
    online_media_mode: row.onlineMediaMode,
    visibility: String(row.visibility),
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
  return {
    id: row.id,
    session_id: row.sessionId,
    educational_content_id: row.contentId,
  };
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
  return {
    id: row.id,
    name: row.name,
    display_order: row.displayOrder,
    version: row.version,
  };
}

/**
 * A Subject **with the Levels that teach it** — `/admin/subjects` only.
 *
 * ## Why the wider shape is a separate DTO
 *
 * `subjectRefDto` serves both the global Subject list **and** a Level's own
 * subjects, and the second has no use for a reverse join. Widening the shared
 * projection would have put every Level of every Subject onto a read whose whole
 * question is *which subjects does THIS Level teach* — so the two are separate
 * projections of one service result rather than two reads of one table.
 *
 * ## Why it exists at all
 *
 * A Subject paired with any Level **cannot be deleted** — the rule is unchanged
 * and stays enforced in the service. What was missing is that an administrator
 * meeting that refusal could not see what it was about, or which Levels to unpair
 * on `مواد المستوى`. The dependency is now visible before the attempt rather than
 * explained after it.
 *
 * **The Category travels beside the Level, not joined into it.** §4.4b makes Level
 * names non-unique across Categories, so the client's `levelLabel` needs both
 * halves — and a pre-joined `«الفئة — المستوى»` string here would be a second
 * implementation of a format the client owns.
 *
 * Field by field, never a spread (§16.2, R38).
 */
export interface SubjectWithLevelsDto extends SubjectRefDto {
  levels: { id: string; name: string; category_name: string }[];
}

export function subjectWithLevelsDto(row: {
  id: string;
  name: string;
  displayOrder: number | null;
  version: number;
  levels: { id: string; name: string; categoryName: string }[];
}): SubjectWithLevelsDto {
  return {
    id: row.id,
    name: row.name,
    display_order: row.displayOrder,
    version: row.version,
    levels: row.levels.map((level) => ({
      id: level.id,
      name: level.name,
      category_name: level.categoryName,
    })),
  };
}

/* ── Curriculum taxonomy (§5.6 Categories & Subjects, §14.1) ─────────────── */

export interface CategoryDto {
  id: string;
  name: string;
  /**
   * NEW K/L — the short description shown under the name. **`null` is ordinary,
   * not a gap**: a row without one is the common case, and clients render the
   * absence rather than inventing filler.
   */
  description: string | null;
  display_order: number | null;
  /** Live Levels in this Category — what says whether deleting it is possible
   *  at all, without a request per row. */
  level_count: number;
  version: number;
}

export function categoryDto(row: {
  id: string;
  name: string;
  description: string | null;
  displayOrder: number | null;
  levelCount: number;
  version: number;
}): CategoryDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
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
  /** NEW L — see `CategoryDto.description`. `null` is ordinary. */
  description: string | null;
  category_id: string;
  /** §4.4b / Revision 27 — `any | girls_only | boys_only`. */
  gender_restriction: string;
  display_order: number | null;
  version: number;
}

export function levelCoreDto(row: {
  id: string;
  name: string;
  description: string | null;
  categoryId: string;
  genderRestriction: string;
  displayOrder: number | null;
  version: number;
}): LevelCoreDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
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
  /** §4.9's default content visibility for this Level, through its Category
   *  (§15.1). §14.1's upload screen preselects it. */
  default_visibility: string;
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
  description: string | null;
  categoryId: string;
  categoryName: string;
  genderRestriction: string;
  displayOrder: number | null;
  groupCount: number;
  subjectCount: number;
  enrollmentCount: number;
  defaultVisibility: string;
  version: number;
}): LevelDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category_id: row.categoryId,
    category_name: row.categoryName,
    gender_restriction: row.genderRestriction,
    display_order: row.displayOrder,
    group_count: row.groupCount,
    subject_count: row.subjectCount,
    enrollment_count: row.enrollmentCount,
    default_visibility: row.defaultVisibility,
    version: row.version,
  };
}

/**
 * `POST /admin/levels` — the Level **and** the المجموعة 1 created with it
 * (TD-4.6b). The group is reported rather than left implicit: it was created by
 * this request, at a branch the caller named, and a client that never sees it
 * cannot tell an administrator where their new Level's first group went.
 */
/** Revision 66 — no `first_group`: creating a Level creates only a Level. */
export type CreatedLevelDto = LevelCoreDto;

/** Revision 66 — no `first_group`: creating a Level creates only a Level. */
export function createdLevelDto(level: {
  id: string;
  name: string;
  description: string | null;
  categoryId: string;
  genderRestriction: string;
  displayOrder: number | null;
  version: number;
}): CreatedLevelDto {
  return {
    id: level.id,
    name: level.name,
    description: level.description,
    category_id: level.categoryId,
    gender_restriction: level.genderRestriction,
    display_order: level.displayOrder,
    version: level.version,
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
  type:
    "registration" | "family-link" | "child-application" | "identity-review";
  /**
   * What a self-service applicant asked to become (Revision 49) — `'teacher'`
   * or `null`. **A hint, never an authority**: it is what makes a staff request
   * distinguishable in the queue, and the role itself is granted only by the
   * assignment the approver states.
   */
  requested_role: string | null;
  framing: {
    mode: 'in_person' | 'online' | 'both';
    all_branches: boolean;
    branches: { id: string; name: string }[];
  } | null;
  /**
   * The educational stage the applicant asked for (Revision 49) — what §4.1
   * step 1 preselects the first Level from. A request, never a placement.
   */
  category: { id: string; name: string } | null;
  /** §14.2 column: Applicant(s). */
  applicants: {
    id: string;
    name: string;
    role: "applicant" | "child" | "parent";
  }[];
  /** An instant, correctly — a submission is a moment, not a calendar date. */
  submitted_at: string;
  /** §14.2 column: Bundle contents — what approving this will actually change. */
  bundle: { child_count: number; link_count: number };
  /**
   * R62 — the children in this request, one decidable block each.
   *
   * `[]` on every other type. Each block carries its own `application_id`,
   * which is what `POST /admin/child-applications/{id}/decide` acts on: R62.2
   * decides a child alone, so an approver can accept one sibling and refuse
   * another in the same visit.
   */
  children: {
    application_id: string;
    name: string;
    status: string;
    schooling_stage: string | null;
  }[];
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
  type:
    "registration" | "family-link" | "child-application" | "identity-review";
  applicants: {
    id: string;
    nameArabic: string;
    role: "applicant" | "child" | "parent";
  }[];
  submittedAt: Date;
  bundle: { childCount: number; linkCount: number };
  children: {
    applicationId: string;
    nameArabic: string;
    status: string;
    schoolingStage: string | null;
  }[];
  branch: { id: string; name: string } | null;
  requestedRole: string | null;
  framing: {
    mode: 'in_person' | 'online' | 'both';
    allBranches: boolean;
    branches: { id: string; name: string }[];
  } | null;
  category: { id: string; name: string } | null;
}): ApprovalDto {
  return {
    id: row.id,
    type: row.type,
    applicants: row.applicants.map((a) => ({
      id: a.id,
      name: a.nameArabic,
      role: a.role,
    })),
    submitted_at: row.submittedAt.toISOString(),
    bundle: {
      child_count: row.bundle.childCount,
      link_count: row.bundle.linkCount,
    },
    children: row.children.map((c) => ({
      application_id: c.applicationId,
      name: c.nameArabic,
      status: c.status,
      schooling_stage: c.schoolingStage,
    })),
    // Field by field, never a spread — the branch is projected to exactly the
    // two fields the screen renders (§16.2).
    branch: row.branch ? { id: row.branch.id, name: row.branch.name } : null,
    requested_role: row.requestedRole,
    framing: row.framing
      ? {
          mode: row.framing.mode,
          all_branches: row.framing.allBranches,
          branches: row.framing.branches.map((branch) => ({
            id: branch.id,
            name: branch.name,
          })),
        }
      : null,
    // Field by field, never a spread — two fields, the same as the branch.
    category: row.category
      ? { id: row.category.id, name: row.category.name }
      : null,
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
  /**
   * **How the screen should render the control** (2026-08-17).
   *
   * The allow-list gained integer settings — the grading scale — and a number
   * typed into a free-text box is a number the server has to refuse after the
   * fact. Publishing the *kind* lets the form offer the right control, and keeps
   * that decision on the server where the allow-list already lives: a client
   * inferring it from the key would be a second copy of the same knowledge.
   *
   * `value` stays a **string** whatever the kind, so one control and one audit
   * format serve both. The storage keeps a number a number.
   */
  kind: "text" | "integer";
  /** TD-15: sent back on save; a stale one is a `409`. */
  version: number;
}

export function settingDto(row: {
  key: string;
  label_key: string;
  hint_key: string;
  value: string | null;
  kind: "text" | "integer";
  version: number;
}): SettingDto {
  return {
    key: row.key,
    label_key: row.label_key,
    hint_key: row.hint_key,
    value: row.value,
    kind: row.kind,
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
  is_platform_owner: boolean;
  name_arabic: string;
  /**
   * The stored name parts, sex and notes — what the §5.6 edit form hydrates
   * from. The composed `name_arabic` above is what a table renders; these are
   * what was collected, and §1.1 composes the first from the last.
   */
  first_name_arabic: string | null;
  last_name_arabic: string | null;
  first_name_french: string | null;
  last_name_french: string | null;
  /**
   * **R80 point 6 AMENDED by the Document Owner, 2026-08-28.**
   *
   * It read *«the field stays off every contract … no response publishes it»*,
   * written when `/admin/users` was reachable by any Admin. **R112 made this
   * read Super-Admin-only**, and the Owner's decision is that a Super Admin
   * reads and edits everything about an account — including الجنس, which §5.6's
   * edit form must hydrate to be usable.
   *
   * **The narrowing is exact**: published here and **nowhere else**.
   * `/admin/directory`, the Admin-reachable people surface, carries id, name,
   * nickname and roles and does not carry this — so nothing widens to an Admin,
   * a Teacher or any public surface. R80.3/R80.4 are untouched: the write still
   * COMPLETES a missing value and refuses a change.
   */
  sex: string | null;
  notes: string | null;
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
  roles: {
    role: string;
    branch_id: string | null;
    branch_name: string | null;
  }[];
  /** TD-15 — what the edit dialog sends back. Its presence here is why there is
   *  no separate single-user read. */
  version: number;
}

export function userDto(row: {
  id: string;
  isPlatformOwner: boolean;
  nameArabic: string;
  firstNameArabic: string | null;
  lastNameArabic: string | null;
  firstNameFrench: string | null;
  lastNameFrench: string | null;
  sex: string | null;
  notes: string | null;
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
    is_platform_owner: row.isPlatformOwner,
    name_arabic: row.nameArabic,
    /**
     * **Derived when they were never recorded** (2026-08-28). Rows predating
     * Revisions 40–41, and every path that writes only the composed column,
     * carry a name and no parts — so §5.6's edit form opened blank on them and
     * then refused to save, because both parts are required. The stored row is
     * untouched: the split is shown, and becomes real only if she saves it.
     */
    first_name_arabic: row.firstNameArabic ?? splitComposedName(row.nameArabic).first,
    last_name_arabic: row.lastNameArabic ?? splitComposedName(row.nameArabic).last,
    first_name_french: row.firstNameFrench,
    last_name_french: row.lastNameFrench,
    sex: row.sex,
    notes: row.notes,
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
  /**
   * **R97 — how the class is delivered.** `in_person` | `online`, with
   * `online_media_mode` non-null exactly when it is `online`.
   *
   * Provider-independent by design: no room name, URL, token or vendor
   * identifier belongs on this contract. A client renders *«حضوري»* or *«عن
   * بُعد»* from these two fields alone.
   */
  delivery_mode: string;
  online_media_mode: string | null;
  /**
   * **R109 — the visibility tier.** `public` | `private` | `hidden`, the same
   * three §4.4 gives an `Event`. Published so a client can render *«من يرى
   * هذا؟»* without a second request, and so an edit form can hydrate from the
   * row rather than from a hardcoded default — the defect NEW B §A found.
   */
  visibility: string;
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
  deliveryMode: string;
  onlineMediaMode: string | null;
  visibility: string;
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
    delivery_mode: row.deliveryMode,
    online_media_mode: row.onlineMediaMode,
    visibility: String(row.visibility),
    version: row.version,
    staff: row.staff.map((s) => ({ user_id: s.userId, position: s.position })),
    protected_reasons: row.protectedReasons,
  };
}

/* ── `/me/scope-options` — the caller's own filter vocabulary (NEW D) ────── */

export interface ScopeOptionsDto {
  categories: { id: string; name: string }[];
  levels: {
    id: string;
    name: string;
    category_id: string;
    /** A label for grouping, never an identifier — `{Category} — {Level}` is
     *  how §4.4b's non-unique Level names are disambiguated (rule D). */
    category_name: string;
    /** §4.9's default content tier for this Level, through its Category (§15.1). */
    default_visibility: string;
    /** The Subjects this Level teaches (§4.4b). Inline so narrowing needs no
     *  second request — and that request was itself Admin-only. */
    subject_ids: string[];
  }[];
  subjects: { id: string; name: string }[];
  academic_years: { id: string; label: string; is_current: boolean }[];
  branches: { id: string; name: string }[];
}

export function scopeOptionsDto(row: {
  categories: { id: string; name: string }[];
  levels: {
    id: string;
    name: string;
    categoryId: string;
    categoryName: string;
    defaultVisibility: string;
    subjectIds: string[];
  }[];
  subjects: { id: string; name: string }[];
  academicYears: { id: string; label: string; isCurrent: boolean }[];
  branches: { id: string; name: string }[];
}): ScopeOptionsDto {
  return {
    categories: row.categories,
    levels: row.levels.map((l) => ({
      id: l.id,
      name: l.name,
      category_id: l.categoryId,
      category_name: l.categoryName,
      default_visibility: l.defaultVisibility,
      subject_ids: l.subjectIds,
    })),
    subjects: row.subjects,
    academic_years: row.academicYears.map((y) => ({
      id: y.id,
      label: y.label,
      is_current: y.isCurrent,
    })),
    branches: row.branches,
  };
}

/* ── The scheduling-type catalogue (R110, NEW H) ─────────────────────────── */

export interface SchedulingTypeDto {
  id: string;
  /** The administrator-facing label — «حصة دراسية», «عطلة». */
  name: string;
  /**
   * **Which entity this type routes to** — `class` | `activity` | `exam`.
   *
   * Published because the client has to know which form to open, and R56 settled
   * that those three branches are the ones that mean something. **Stored, never
   * inferred from `name`**: §4.4b forbids reading a rule off a label, and a
   * catalogue whose behaviour depended on its wording could not be renamed.
   */
  structural_kind: string;
  /**
   * **Whether attendance is taken for this type** (OD-03).
   *
   * The form presents attendance-specific controls only where this is true, so
   * it travels on the contract rather than being re-decided per client — which
   * is what makes it a column and not display text.
   */
  attendance_required: boolean;
  /** The Owner's canonical order, changed through `PATCH .../order` (R76). */
  display_order: number;
  /** Live activities already using it — what makes a blocked deletion legible
   *  before the administrator meets it (rule AZ.1). */
  event_count: number;
  /** TD-15: the editor sends it back; a stale one is a `409`. */
  version: number;
}

export function schedulingTypeDto(row: {
  id: string;
  name: string;
  structuralKind: string;
  attendanceRequired: boolean;
  displayOrder: number;
  eventCount: number;
  version: number;
}): SchedulingTypeDto {
  return {
    id: row.id,
    name: row.name,
    structural_kind: String(row.structuralKind),
    attendance_required: row.attendanceRequired,
    display_order: row.displayOrder,
    event_count: row.eventCount,
    version: row.version,
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
  /**
   * **R59.1 — whether a Super Admin may destroy it.** Server-decided for the
   * same reason `restorable` is, and more sharply: this action is irreversible,
   * so a client guessing would offer a button that destroys what it should not.
   * Publishing it is a *rendering* aid only — the authority is asserted again on
   * the endpoint, so a caller who ignores this field is still refused.
   */
  purgeable: boolean;
  /** A stable code when `purgeable` is false. */
  purge_blocked_reason: string | null;
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
  purgeable: boolean;
  purgeBlockedReason: string | null;
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
    purgeable: row.purgeable,
    purge_blocked_reason: row.purgeBlockedReason,
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
  /**
   * **R110 — which catalogue type this activity is** (محاضرة, حفل, عطلة).
   *
   * `null` for every activity created before R110: R56 told administrators to
   * write عطلة in the title, so those rows record their type nowhere a query can
   * reach. `null` is *"nobody recorded one"* — a real state, and deliberately
   * not the same as any type.
   */
  scheduling_type_id: string | null;
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
  /** R71 — who answers for it. Empty for every event created before R71 and for
   *  any an Admin has not assigned, which is a real state rather than a gap. */
  staff: { user_id: string; position: string }[];
  version: number;
}

export function eventDefinitionDto(row: {
  id: string;
  title: string;
  description: string | null;
  schedulingTypeId: string | null;
  visibility: string;
  startDate: Date;
  endDate: Date | null;
  startTime: Date | null;
  endTime: Date | null;
  recurrenceType: string;
  recurrenceEndDate: Date | null;
  branchScopes: { branchId: string }[];
  staff: { userId: string; position: string }[];
  version: number;
}): EventDefinitionDto {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    scheduling_type_id: row.schedulingTypeId,
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
    staff: row.staff.map((x) => ({
      user_id: x.userId,
      position: String(x.position),
    })),
    version: row.version,
  };
}

/**
 * One scheduled exam (§4.6, SRS Revision 58).
 *
 * **Names beside every id**, for the reason `libraryItemDto` states and R55.1
 * applied to schedules: a timetable cannot be rendered from ids, and the exam
 * list sits beside classes and activities on one screen.
 *
 * `mode` is published so a client can render the distinction without inferring
 * it from which columns happen to be null.
 */
export interface ExamDto {
  id: string;
  mode: string;
  title: string;
  description: string | null;
  /** TD-11 calendar date and wall-clock times — never instants. */
  date: string;
  start_time: string | null;
  end_time: string | null;
  level_id: string;
  level_name: string | null;
  subject_id: string | null;
  subject_name: string | null;
  academic_year_id: string | null;
  branch_id: string | null;
  branch_name: string | null;
  room_id: string | null;
  room_name: string | null;
  /** `null` is **the whole Level** (R58), never "no target". */
  administrative_group_id: string | null;
  administrative_group_name: string | null;
  /**
   * R81 — **the exam's own maximum grade**, the number every score on it is out
   * of. There is no platform-wide scale to fall back to, so this travels with
   * the exam rather than being looked up: a client rendering `15 / 20` must not
   * have to ask a second endpoint what the 20 is.
   */
  max_grade: number;
  /**
   * **R109 — the visibility tier.** `public` | `private` | `hidden`, the same
   * three §4.4 gives an `Event`. Published so a client can render *«من يرى
   * هذا؟»* without a second request, and so an edit form can hydrate from the
   * row rather than from a hardcoded default — the defect NEW B §A found.
   */
  visibility: string;
  staff: { user_id: string; position: string }[];
  version: number;
}

export function examDto(row: {
  id: string;
  mode: string;
  title: string;
  description: string | null;
  date: Date;
  startTime: Date | null;
  endTime: Date | null;
  levelId: string;
  level?: { name: string } | null;
  subjectId: string | null;
  subject?: { name: string } | null;
  academicYearId: string | null;
  branchId: string | null;
  branch?: { name: string } | null;
  roomId: string | null;
  room?: { name: string } | null;
  administrativeGroupId: string | null;
  administrativeGroup?: { name: string } | null;
  maxGrade: Prisma.Decimal;
  visibility: string;
  staff: { userId: string; position: string }[];
  version: number;
}): ExamDto {
  return {
    id: row.id,
    mode: String(row.mode),
    title: row.title,
    description: row.description,
    date: dateOnly(row.date)!,
    start_time: row.startTime ? timeOnly(row.startTime) : null,
    end_time: row.endTime ? timeOnly(row.endTime) : null,
    level_id: row.levelId,
    level_name: row.level?.name ?? null,
    subject_id: row.subjectId,
    subject_name: row.subject?.name ?? null,
    academic_year_id: row.academicYearId,
    branch_id: row.branchId,
    branch_name: row.branch?.name ?? null,
    room_id: row.roomId,
    room_name: row.room?.name ?? null,
    administrative_group_id: row.administrativeGroupId,
    administrative_group_name: row.administrativeGroup?.name ?? null,
    max_grade: toNumber(row.maxGrade),
    visibility: String(row.visibility),
    staff: row.staff.map((s) => ({
      user_id: s.userId,
      position: String(s.position),
    })),
    version: row.version,
  };
}

/**
 * **R92 — the occurrence's roster, with venue and audience kept apart.**
 *
 * `venue` says *where*; `audience_branches` says *who from where*. A single
 * `branch` would make the combined case unsayable, which is the whole reason the
 * revision exists.
 */
export function sessionRosterDto(row: {
  sessionId: string;
  venue: { branchId: string; branchName: string; roomName: string | null };
  audienceBranches: { id: string; name: string }[];
  overridden: boolean;
  students: { id: string; name: string; branchId: string | null }[];
}): {
  session_id: string;
  venue: { branch_id: string; branch_name: string; room_name: string | null };
  audience_branches: { id: string; name: string }[];
  overridden: boolean;
  students: { id: string; name: string; branch_id: string | null }[];
} {
  return {
    session_id: row.sessionId,
    venue: {
      branch_id: row.venue.branchId,
      branch_name: row.venue.branchName,
      room_name: row.venue.roomName,
    },
    audience_branches: row.audienceBranches,
    overridden: row.overridden,
    students: row.students.map((s) => ({
      id: s.id,
      name: s.name,
      branch_id: s.branchId,
    })),
  };
}

/**
 * **R98 — the credentials for one online class, and nothing else.**
 *
 * Four rules decided this shape, each by exclusion:
 *
 * 1. **No API key and no secret.** They never leave the API process. What the
 *    browser receives is a participant token derived from them, bounded in time,
 *    naming one room and one identity.
 * 2. **No room name.** The client does not need it — the room is inside the
 *    token — and R97.9's posture is that a provider identifier belongs on no
 *    projection the platform hands out. Withholding it costs nothing and keeps
 *    the vendor's vocabulary out of the client contract.
 * 3. **No room-management capability.** The token carries `roomJoin` for one
 *    room; nothing here can list, create or record anything.
 * 4. **`role` and `media_mode` because the ONE classroom adapts to them** — the
 *    moderation controls and the audio-only surface are decided from these two
 *    fields rather than from a second component per portal (rule C).
 *
 * `expires_at` is reported so the classroom can say «انتهت صلاحية الدخول» and
 * offer to ask again, instead of showing a connection that silently stops
 * working.
 */
export function onlineJoinDto(result: {
  url: string;
  token: string;
  expiresAt: Date;
  authorization: {
    sessionId: string;
    displayName: string;
    role: string;
    mediaMode: string;
    closesAt: Date;
  };
}): {
  session_id: string;
  url: string;
  token: string;
  expires_at: string;
  media_mode: string;
  role: string;
  display_name: string;
  closes_at: string;
} {
  return {
    session_id: result.authorization.sessionId,
    url: result.url,
    token: result.token,
    expires_at: result.expiresAt.toISOString(),
    media_mode: result.authorization.mediaMode,
    role: result.authorization.role,
    display_name: result.authorization.displayName,
    closes_at: result.authorization.closesAt.toISOString(),
  };
}


/**
 * **R99 — the recording state, as every participant sees it.**
 *
 * **No provider identifier** (R97.9): the egress job id, the staging bucket and
 * the staging key are integration state and appear on no projection the
 * platform hands out. A client needs to know whether the class is being
 * recorded and how that is going — nothing about who is recording it.
 *
 * **`live` is computed server-side** rather than left to the client to infer
 * from `status`, so «جاري التسجيل» cannot disagree between two screens.
 */
export function recordingStateDto(state: {
  id: string;
  status: string;
  startedAt: Date;
  stoppedAt: Date | null;
  live: boolean;
  availability: string;
  educationalContentId: string | null;
}): {
  id: string;
  status: string;
  started_at: string;
  stopped_at: string | null;
  live: boolean;
  availability: string;
  educational_content_id: string | null;
} {
  return {
    id: state.id,
    status: state.status,
    started_at: state.startedAt.toISOString(),
    stopped_at: state.stoppedAt ? state.stoppedAt.toISOString() : null,
    live: state.live,
    /**
     * **R99.14 — where the recording is from the ASSOCIATION's point of view.**
     *
     * `status` is the PROVIDER's state and stays exactly what it was; this is
     * the platform's, and the two genuinely differ: `status = completed` means
     * an object exists in a staging bucket, which is not «متاح». Both ship,
     * because a client that had only the provider's word would have to invent
     * the distinction R99.14 requires it to make.
     */
    availability: state.availability,
    /**
     * The library item, once there is one. **This is what «متاح» means** — the
     * client opens the recording through the ordinary content path, and there is
     * deliberately no provider URL anywhere on this DTO (R99.13).
     */
    educational_content_id: state.educationalContentId,
  };
}
