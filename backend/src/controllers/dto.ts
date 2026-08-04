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

/* ── Approval queue (§5.6, §14.2) ────────────────────────────────────────── */

export interface ApprovalDto {
  id: string;
  type: 'registration' | 'family-link';
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
