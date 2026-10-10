import { calendarDay } from '../policies/effective-staffing.js';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { page, pageWindow, type Page, type PageParams } from '../lib/pagination.js';
import { resolveSort, type SortParams, type SortableFields } from '../lib/sorting.js';
import { applyHoliday } from './holiday-cancellation.service.js';
import * as scope from '../policies/branch-scope.js';
import { assertFreshActive } from '../policies/freshness.policy.js';
import * as audit from '../repositories/audit.repository.js';
import { lockUser } from '../repositories/user.repository.js';
import { snapshot as snapshotToTrash } from '../repositories/trash.repository.js';
import { requireRetirement } from '../repositories/storage-retirement.repository.js';
import { lockEducationalContent } from '../repositories/consent-safeguarding.repository.js';
import type { Actor } from '../policies/actor.js';
import { assertStaffAccountsAvailable } from './staffing-integrity.service.js';
import {
  enqueueConsentReevaluationForSessions,
  enqueueConsentReevaluationForStudent,
} from './consent-reevaluation.service.js';
import { deIdentifyAccountSystem, purgeUserAccount } from './account-deletion.service.js';
import { recalculateFor } from './quran.service.js';
import { assertOccurrenceFree, findConflicts } from './course-schedule.service.js';

/**
 * The Trash — **soft-deleted records, browsable; every one of them restorable
 * and every one of them destroyable** (§7, TD-5, BR-15, SRS Revision 52, R59,
 * **Revision 191**).
 *
 * ## Why restoration is per entity type rather than a single button
 *
 * §7 states the hazard and this service exists to respect it:
 *
 * > the runbook **must explicitly capture and reinstate the relationship rows the
 * > TD-5 cascade removed** — `FamilyLink`, `Enrollment`, `StudentTeachingGroup`,
 * > `CourseScheduleStaff`, `UserBranchRole` and `UserIdentity` deactivations —
 * > **a User restored without their links, enrollments and roles is a
 * > half-restored, silently broken account.**
 *
 * Clearing `deleted_at` is the easy tenth of the problem, and every failure of
 * the other nine is **silent**: the row returns, every screen looks right, and
 * the person is enrolled in nothing.
 *
 * So the capability is decided **here, per entity type, and published on every
 * row** — never inferred by a client. A screen cannot know which deletions
 * cascade, and one that guessed would offer a button that quietly breaks people.
 *
 * ## R191 — the Owner (2026-10-01): «any element in the Trash can be deleted
 * permanently, and any element can be restored»
 *
 * Until this revision a type joined `RESTORABLE` only once its reinstatement
 * was written and tested, and the rest were listed with a reason
 * (`CASCADE_RELATIONSHIPS`, `CASCADE_CHILDREN`, `NOT_YET_SUPPORTED`). The
 * standard is unchanged — a restore brings back what the deletion took, or
 * says what it could not — but it is now MET for every type that reaches the
 * Trash: an activity's audience is re-created from its snapshot, a group's
 * activities re-addressed, an enrolment's circle seats given back where they
 * still fit, a rejected family link re-opened as a request, a library item's
 * file brought back from quarantine (`restore_quarantined_object`), a
 * question's options returned and its place on the paper kept or appended.
 * What a restore cannot force — a parent that is itself deleted, a slot a
 * live row has since taken — is refused by name (`PARENT_DELETED`,
 * `DUPLICATE_LIVE`), never silently half-done.
 *
 * A purge likewise exists for every type: an account is DE-IDENTIFIED (R111,
 * the row stays for the audit trail), everything else is destroyed with what
 * exists only because of it — the notices sent about an activity, the
 * presence recorded at it, the staffing it carried, a class's occurrences
 * with their attendance, recordings and the quick tests sat in them — and
 * with the Trash entries of its own deleted dependents (`TRASHED_DEPENDENTS`:
 * a Level goes with the deleted enrolments still under it). What a purge
 * never does is destroy a record that was never deleted: a LIVE row that
 * still uses the entry keeps it, and the refusal names which (`DEPENDENTS_
 * EXIST`, `blocking_entity`).
 */
/** The delegate names on a transaction client — `keyof PrismaClient` would
 *  include `$connect` and friends, which are not models. */
type ModelName =
  | 'branch'
  | 'category'
  | 'subject'
  | 'room'
  | 'exam'
  | 'hijriMonthStart'
  | 'partner'
  | 'user'
  // R169 §8 — the circle, its Level, and what a class schedule hangs from.
  | 'teachingGroup'
  | 'level'
  | 'recurringCourseSchedule'
  | 'academicYear'
  | 'administrativeGroup'
  // R172 §9 — one occurrence deleted on its own.
  | 'session'
  // R191 — every remaining type that reaches the Trash.
  | 'event'
  | 'schedulingType'
  | 'enrollment'
  | 'studentTeachingGroup'
  | 'familyLink'
  | 'educationalContent'
  | 'quranProgressLog'
  | 'levelSubject'
  | 'categorySubject'
  | 'levelSurah'
  | 'sessionContent'
  | 'examQuestion'
  | 'attendance';

/** Delegates a purge plan may destroy. Separate from `ModelName` because the
 *  restorable set and the purgeable set are different questions. */
type PurgeModel =
  | ModelName
  | 'examStaff'
  | 'courseScheduleStaff'
  | 'sessionStaff'
  | 'eventBranch'
  | 'educationalContentBranch'
  | 'eventCategory'
  | 'eventLevel'
  | 'eventAdministrativeGroup'
  | 'eventStaff'
  | 'examQuestionOption'
  | 'notification';

/**
 * Compile-time bridge from each declared owned-child delegate to its generated
 * Prisma filter fields. Purge plans are necessarily dynamic, but their FK names
 * must not be untyped strings: `SessionContent` maps the database column
 * `educational_content_id` to the Prisma field `contentId`, and the former
 * `educationalContentId` assumption made every content purge fail at runtime.
 */
interface ChildWhereByModel {
  administrativeGroup: Prisma.AdministrativeGroupWhereInput;
  eventBranch: Prisma.EventBranchWhereInput;
  // R198 §2 — an item's additional branch, a link that goes with the Branch.
  educationalContentBranch: Prisma.EducationalContentBranchWhereInput;
  eventCategory: Prisma.EventCategoryWhereInput;
  eventLevel: Prisma.EventLevelWhereInput;
  eventAdministrativeGroup: Prisma.EventAdministrativeGroupWhereInput;
  // R191 — who answered for an activity, and the presence recorded at it.
  eventStaff: Prisma.EventStaffWhereInput;
  attendance: Prisma.AttendanceWhereInput;
  levelSubject: Prisma.LevelSubjectWhereInput;
  // R172 §1 — the whole-Category curriculum link, owned like `levelSubject`.
  categorySubject: Prisma.CategorySubjectWhereInput;
  levelSurah: Prisma.LevelSurahWhereInput;
  studentTeachingGroup: Prisma.StudentTeachingGroupWhereInput;
  sessionStaff: Prisma.SessionStaffWhereInput;
  sessionContent: Prisma.SessionContentWhereInput;
  examStaff: Prisma.ExamStaffWhereInput;
  // A schedule's staffing has no life of its own: R91 makes an assignment a row
  // ON the schedule, so it is destroyed with one and never independently.
  courseScheduleStaff: Prisma.CourseScheduleStaffWhereInput;
  // R136 (Codex H2) — the exam's own questions (grandchild options are
  // removed separately, above the loop) and its notifications. Neither is
  // evidence on its own; `Grade`/`StudentExamSubmission`/`Attendance` are,
  // and go with the exam under R172 §6 (`purgeExamEvidence`).
  examQuestion: Prisma.ExamQuestionWhereInput;
  // R191 — a question's own options, when the question is the entry.
  examQuestionOption: Prisma.ExamQuestionOptionWhereInput;
  notification: Prisma.NotificationWhereInput;
}

type DeclaredChild = {
  [Model in keyof ChildWhereByModel]: {
    model: Model;
    fk: Extract<keyof ChildWhereByModel[Model], string>;
    /**
     * Consequence rows that have their own soft-delete lifecycle are destroyed
     * only when the parent's snapshot names their exact ids. Without this,
     * purging a Level could sweep a LevelSubject that an administrator had
     * independently removed earlier, leaving that row's own Trash entry stale.
     * Legacy snapshots without the key delete nothing and therefore fail closed
     * on the FK rather than guessing ownership.
     */
    snapshotIdsKey?: string;
    /**
     * The key was introduced AFTER snapshots of this entity already existed
     * (R172 §1's `cascaded_category_subject_ids`): absent means «none
     * followed this deletion», never «the snapshot is incomplete». A key that
     * has existed since the entity became restorable stays required.
     */
    legacyOptional?: boolean;
  };
}[keyof ChildWhereByModel];

type ParentRef = { field: string; model: ModelName };

const RESTORABLE: Record<
  string,
  {
    model: ModelName;
    parent?: ParentRef;
    /**
     * R169 §8 — a record that hangs from SEVERAL things (a circle from its Level
     * AND its Subject). Each named foreign key must point at a LIVE row, or the
     * restore is refused with `PARENT_DELETED` naming which. A `null` key is
     * «none» and is skipped.
     */
    parents?: ParentRef[];
    /** Rows soft-deleted WITH the record, un-deleted with it. Only where the
     *  reinstatement is a single well-defined statement (R59.3). */
    children?: DeclaredChild[];
  }
> = {
  /**
   * R111 is the deliberate exception to the older User-cascade warning below.
   * Account soft deletion removes no relationship row: it stamps `deleted_at`,
   * revokes sessions and keeps identity, roles, family and educational history
   * intact during the seven-day window. Clearing the tombstone is therefore a
   * complete restoration; revoked credentials stay revoked and the person signs
   * in again. Permanent de-identification removes the Trash row transactionally,
   * so this path can never reconstruct an already-erased identity.
   */
  User: { model: 'user' },
  // No parent: nothing above them can be missing.
  Branch: { model: 'branch' },
  Category: { model: 'category' },
  Partner: { model: 'partner' },
  Subject: {
    model: 'subject',
    children: [
      {
        model: 'levelSubject',
        fk: 'id',
        snapshotIdsKey: 'cascaded_level_subject_ids',
      },
      // R172 §1 — the whole-Category link, owned the same way. Optional in a
      // snapshot older than the link itself.
      {
        model: 'categorySubject',
        fk: 'id',
        snapshotIdsKey: 'cascaded_category_subject_ids',
        legacyOptional: true,
      },
    ],
  },
  // A Room belongs to a Branch, and restoring one into a deleted Branch would
  // produce a room nobody can reach — see `restoreEntry`.
  Room: { model: 'room', parent: { field: 'branchId', model: 'branch' } },
  /**
   * R172 §9 — one occurrence deleted on its own (`deleteSession`). Its staff,
   * content links and audience rows were never touched, so the row alone comes
   * back; it needs its class to be live, and a future one is checked against
   * the room and staff it would re-occupy (`restoreEntry`, as R171 §6 does
   * for a cancellation's restore).
   */
  Session: {
    model: 'session',
    parent: { field: 'scheduleId', model: 'recurringCourseSchedule' },
    parents: [
      { field: 'roomId', model: 'room' },
      { field: 'subjectId', model: 'subject' },
    ],
  },
  /**
   * **R59.3 — the first CASCADING type to join the set**, and it qualifies for
   * the reason the standard has always named: its reinstatement is *written and
   * tested*, not assumed. Deleting an exam soft-deletes exactly one child table,
   * `ExamStaff`, and bringing those rows back is one statement — unlike a `User`,
   * whose six relationship types are the hazard §7 describes. R191 — what it
   * hangs from must be live: its Level, its Branch, the room, the year, the
   * group, circle or occurrence it is addressed to, its catalogue type.
   */
  Exam: {
    model: 'exam',
    parents: [
      { field: 'levelId', model: 'level' },
      { field: 'branchId', model: 'branch' },
      { field: 'roomId', model: 'room' },
      { field: 'academicYearId', model: 'academicYear' },
      { field: 'administrativeGroupId', model: 'administrativeGroup' },
      { field: 'teachingGroupId', model: 'teachingGroup' },
      { field: 'sessionId', model: 'session' },
      { field: 'schedulingTypeId', model: 'schedulingType' },
    ],
    children: [{ model: 'examStaff', fk: 'examId' }],
  },
  /**
   * R59.5 — nothing cascades, so restoration is the tombstone and nothing else.
   * The withdrawal rule means the run is contiguous when it is put back: only
   * the last month can be withdrawn, so restoring it appends rather than fills.
   */
  HijriMonthStart: { model: 'hijriMonthStart' },
  /**
   * **R169 §8 — a Subject circle (حلقة) comes back with its seats.**
   *
   * Deleting one stamps the circle and every member's seat from ONE clock
   * reading, so the generic «children removed BY this deletion» scoping would
   * be enough — except that a released student may since have been SEATED
   * ELSEWHERE, and one live seat per (student, Subject, Level) is an index the
   * database enforces. So the seats are reinstated by `restoreCircleSeats`
   * below, not declared here: a seat returns only to a student who is still
   * enrolled at the Level and holds no other circle for the Subject. The rest
   * are counted and said, never forced.
   */
  TeachingGroup: {
    model: 'teachingGroup',
    parents: [
      { field: 'levelId', model: 'level' },
      { field: 'subjectId', model: 'subject' },
      { field: 'branchId', model: 'branch' },
    ],
  },
  /**
   * **R169 §8 — a Level comes back with what its deletion took.** Its
   * curriculum links, its «مقرر الحفظ» and its Administrative Groups are
   * soft-deleted with it and named by id in the snapshot, so they return through
   * the declared-children path, scoped to the rows THIS deletion removed. The
   * activities that were addressed to it (or to its groups) are different: those
   * joins are HARD-deleted, so they are re-created from the snapshot
   * (`restoreLevelEventLinks`) — for an activity that is still live. A Level
   * deleted BEFORE this revision recorded none, restores without them, and the
   * result says so (`event_links_unknown`).
   */
  Level: {
    model: 'level',
    parents: [{ field: 'categoryId', model: 'category' }],
    children: [
      { model: 'levelSubject', fk: 'id', snapshotIdsKey: 'cascaded_level_subject_ids' },
      { model: 'levelSurah', fk: 'id', snapshotIdsKey: 'cascaded_level_surah_ids' },
      { model: 'administrativeGroup', fk: 'id', snapshotIdsKey: 'cascaded_administrative_group_ids' },
    ],
  },
  /**
   * **R169 §8 — a class schedule comes back with the occurrences its deletion
   * removed — the ones still AHEAD — or not at all.**
   *
   * The deletion stamps the unprotected future Sessions and records their ids
   * (`removed_session_ids`); protected ones were never touched. So a restore
   * reinstates exactly those ids and nothing `session.materialize` would invent.
   * Two things have moved on since, and both are respected: occurrences whose
   * date has PASSED stay deleted (a class nobody held is not history), and the
   * room and the staff may have been booked — `findConflicts`, the scheduling
   * form's own check, refuses the restore (`SCHEDULE_CONFLICT`) rather than
   * double-book. See `restoreScheduleSessions`.
   */
  RecurringCourseSchedule: {
    model: 'recurringCourseSchedule',
    parents: [
      { field: 'branchId', model: 'branch' },
      { field: 'roomId', model: 'room' },
      { field: 'subjectId', model: 'subject' },
      { field: 'academicYearId', model: 'academicYear' },
      { field: 'levelId', model: 'level' },
      { field: 'administrativeGroupId', model: 'administrativeGroup' },
      { field: 'teachingGroupId', model: 'teachingGroup' },
      { field: 'schedulingTypeId', model: 'schedulingType' },
    ],
  },

  /* ── R191 — the types that used to be listed with a reason ──────────────── */

  /**
   * **An activity comes back with its audience.** `deleteEvent` hard-deletes
   * the four scope joins but writes their ids into the snapshot (`scope`), so
   * they are re-created for every audience row that is still live
   * (`restoreEventScope`); an activity deleted before the snapshot carried
   * them restores and SAYS so (`scope_links_unknown`). Its staff, the presence
   * recorded at it and the notices sent about it were never touched.
   */
  Event: { model: 'event', parents: [{ field: 'schedulingTypeId', model: 'schedulingType' }] },
  /**
   * **A group comes back re-addressed.** Deleting one hard-deletes the
   * `EventAdministrativeGroup` joins; since R191 the deletion records the
   * activities' ids (`removed_event_ids`), and a restore re-creates the join
   * for each that is still live (`restoreGroupEventLinks`).
   */
  AdministrativeGroup: {
    model: 'administrativeGroup',
    parents: [
      { field: 'levelId', model: 'level' },
      { field: 'branchId', model: 'branch' },
    ],
  },
  // Reference rows: the tombstone is the whole deletion. A live row with the
  // same label (`academic_year_label_live_key`, `scheduling_type_name_live_key`)
  // refuses the return by name — `DUPLICATE_LIVE`.
  AcademicYear: { model: 'academicYear' },
  SchedulingType: { model: 'schedulingType' },
  // Curriculum links: the pair is unique whether live or deleted, so nothing
  // can have taken the place; the Level/Category and the Subject must be live.
  LevelSubject: {
    model: 'levelSubject',
    parents: [
      { field: 'levelId', model: 'level' },
      { field: 'subjectId', model: 'subject' },
    ],
  },
  CategorySubject: {
    model: 'categorySubject',
    parents: [
      { field: 'categoryId', model: 'category' },
      { field: 'subjectId', model: 'subject' },
    ],
  },
  LevelSurah: { model: 'levelSurah', parents: [{ field: 'levelId', model: 'level' }] },
  /**
   * **An enrolment comes back with the circle seats its ending released**
   * (`teachingGroupSeats` in the snapshot), each where it still fits — the
   * circle live, no other live seat for that Subject (`restoreEnrollmentSeats`)
   * — and consent is re-evaluated for the student, as the ending did. A live
   * enrolment of the same student at the same Level (`enrollment_student_
   * level_unique`) refuses the return by name.
   */
  Enrollment: {
    model: 'enrollment',
    parents: [
      { field: 'studentId', model: 'user' },
      { field: 'levelId', model: 'level' },
      { field: 'administrativeGroupId', model: 'administrativeGroup' },
      { field: 'branchId', model: 'branch' },
    ],
  },
  /**
   * **A circle seat comes back** when the student is still enrolled at the
   * Level (`NOT_ENROLLED` otherwise — the same rule a circle's restore applies
   * to each seat) and holds no other live seat for the Subject.
   */
  StudentTeachingGroup: {
    model: 'studentTeachingGroup',
    parents: [
      { field: 'studentId', model: 'user' },
      { field: 'teachingGroupId', model: 'teachingGroup' },
      { field: 'levelId', model: 'level' },
      { field: 'subjectId', model: 'subject' },
    ],
  },
  /**
   * **A family link comes back as what its deletion took.** A revoked approved
   * link returns approved; a REJECTED link — whose rejection was the deletion
   * — returns as a PENDING request, never into authority (§4.3): the reviewer
   * decides it again. Consent is re-evaluated for the child.
   */
  FamilyLink: {
    model: 'familyLink',
    parents: [
      { field: 'parentId', model: 'user' },
      { field: 'studentId', model: 'user' },
    ],
  },
  /**
   * **A library item comes back with its file.** Deletion moved the object to
   * `quarantine/<id>/…` through an exact storage obligation; the restore
   * records the reverse obligation (`restore_quarantined_object`) in the same
   * transaction, and TD-7's worker moves the bytes back to the canonical key
   * — idempotently, so an object the quarantine job never moved is simply
   * found in place.
   */
  EducationalContent: {
    model: 'educationalContent',
    parents: [
      { field: 'branchId', model: 'branch' },
      { field: 'subjectId', model: 'subject' },
      { field: 'levelId', model: 'level' },
      { field: 'academicYearId', model: 'academicYear' },
    ],
  },
  // A corrected range returns; coverage is recomputed from the live logs as
  // every log mutation does (§4.5).
  QuranProgressLog: { model: 'quranProgressLog', parents: [{ field: 'studentId', model: 'user' }] },
  // The link between a lesson and its material: both ends must be live.
  SessionContent: {
    model: 'sessionContent',
    parents: [
      { field: 'sessionId', model: 'session' },
      { field: 'contentId', model: 'educationalContent' },
    ],
  },
  /**
   * **A question comes back with its options**, into a live exam, keeping its
   * place on the paper when the place is free and taking the last one
   * otherwise (`exam_question_order_unique`; the removal closed the gap).
   */
  ExamQuestion: {
    model: 'examQuestion',
    parent: { field: 'examId', model: 'exam' },
    children: [{ model: 'examQuestionOption', fk: 'questionId' }],
  },
  // A presence record returns to its occurrence; a live record for the same
  // student and occurrence (`attendance_occurrence_student_unique`) refuses it.
  Attendance: {
    model: 'attendance',
    parents: [
      { field: 'studentId', model: 'user' },
      { field: 'sessionId', model: 'session' },
      { field: 'eventId', model: 'event' },
      { field: 'examId', model: 'exam' },
    ],
  },
};

/**
 * **What destroying a record actually removes** (R59.1).
 *
 * A purge is irreversible, so the plan is **declared per entity type rather than
 * inferred**, on exactly the reasoning `RESTORABLE` uses above: a generic
 * "delete the row and let the database sort it out" would either fail on a
 * foreign key nobody anticipated, or — worse, if any relation were ever
 * `Cascade` — silently take rows the entry does not describe.
 *
 * ## Owned children and consequences versus independent referrers
 *
 * Every plan below lists the rows that **exist as part of** the record or
 * **only because of it**: an Event's four scope joins, who answered for it,
 * the presence recorded at it and the notices sent about it (R191); a
 * Schedule's staffing and its Sessions; an Exam's supervisors, paper and
 * evidence. They have no life of their own, and a purge that left them would
 * leave rows pointing at nothing — or, with `Restrict` everywhere, could not
 * happen at all (the Owner met `notification_event_id_fkey` on an activity,
 * R191).
 *
 * Everything else that references the record is a **record in its own right**.
 * When it is itself DELETED, it goes with the purge through its own Trash entry
 * (`TRASHED_DEPENDENTS` — the Owner's «any element», R191: a Level does not wait
 * for the deleted enrolments under it to be purged one by one). When it is
 * LIVE, the purge does not touch it and does not need to enumerate it either:
 * the foreign keys are `Restrict`, so PostgreSQL refuses, and `purgeEntry`
 * turns that refusal into `DEPENDENTS_EXIST` naming the holder. **The database
 * is the authority on what still points at a row** — a hand-maintained list of
 * blockers would be a second copy of the schema, and it would drift.
 *
 * ## `User` has no plan here, and is not an oversight
 *
 * A person's row is referenced by `AuditLog` and `Trash` themselves. Destroying
 * it would take the accountability record BR-15 exists to preserve — *who
 * deleted what, and when*. The Trash's «حذف نهائي» on an account is therefore
 * R111's DE-IDENTIFICATION (`purgeUserAccount`, the same act as
 * `DELETE /admin/users/{id}?permanent=true`): the personal fields, credentials
 * and snapshot go, a non-identifying tombstone stays. Dispatched in `purgeEntry`.
 */
const PURGEABLE: Record<string, { model: PurgeModel; children?: DeclaredChild[] }> = {
  // No owned children: a Branch's rooms, groups and schedules are all records of
  // their own, so a Branch with any of them left LIVE is refused rather than emptied.
  // R198 §2 — an item's ADDITIONAL branch is a link, not a record: it goes
  // with the Branch and the item keeps its home branch.
  Branch: {
    model: 'branch',
    children: [
      { model: 'eventBranch', fk: 'branchId' },
      { model: 'educationalContentBranch', fk: 'branchId' },
    ],
  },
  /**
   * **A curriculum link is PART of what it links** (R192 §1). `LevelSubject`,
   * `LevelSurah` and `CategorySubject` say «this Level teaches that Subject /
   * memorises that Surah»; none is a record of something that happened, and
   * none can be in use once its Level, Category or Subject is destroyed. They
   * go with the parent WHOLESALE — live or tombstoned, named by the snapshot
   * or not — once the dependents pass has purged the ones with entries of
   * their own. Scoping them to the snapshot's ids (R59) left the Owner's
   * Level in the Production Trash held by `level_surah_level_id_fkey`: a link
   * tombstoned before the Level's deletion listed ids, or still live under a
   * deleted Level, blocked a purge nothing else could ever perform.
   */
  Category: {
    model: 'category',
    children: [
      { model: 'eventCategory', fk: 'categoryId' },
      { model: 'categorySubject', fk: 'categoryId' },
    ],
  },
  Subject: {
    model: 'subject',
    children: [
      { model: 'levelSubject', fk: 'subjectId' },
      { model: 'categorySubject', fk: 'subjectId' },
    ],
  },
  Room: { model: 'room' },

  /**
   * **A class goes with everything it held** — R170 §8 (the Owner, 2026-09-21,
   * completed 2026-09-22) and R191 (2026-10-01). Its staffing rows are owned
   * by it (`CourseScheduleStaff` has no life of its own); its occurrences —
   * every one of them, the past ones that went to the Trash with it AND the
   * ones protection kept live under it — are destroyed by
   * `purgeScheduleSessions` with their attendance, their recordings (which
   * become deleted library items with their own window) and, since R191, the
   * quick tests sat in them with their evidence (R172 §6's rule, applied to
   * what an occurrence carried). Until R191 an exam kept the class
   * (`SESSIONS_HAVE_EXAMS`), which left the Owner unable to empty the Trash.
   */
  RecurringCourseSchedule: {
    model: 'recurringCourseSchedule',
    children: [{ model: 'courseScheduleStaff', fk: 'scheduleId' }],
  },

  // The Level's curriculum mapping and calendar scope join go with it; its
  // groups, schedules and enrolments are records of their own: deleted ones go
  // with it through their own entries, live ones block.
  Level: {
    model: 'level',
    children: [
      {
        model: 'eventAdministrativeGroup',
        fk: 'administrativeGroupId',
        snapshotIdsKey: 'cascaded_administrative_group_ids',
      },
      // R192 §1 — the curriculum links go wholesale (see `Category` above).
      { model: 'levelSubject', fk: 'levelId' },
      { model: 'levelSurah', fk: 'levelId' },
      {
        model: 'administrativeGroup',
        fk: 'id',
        snapshotIdsKey: 'cascaded_administrative_group_ids',
      },
    ],
  },
  AdministrativeGroup: {
    model: 'administrativeGroup',
    children: [{ model: 'eventAdministrativeGroup', fk: 'administrativeGroupId' }],
  },
  // Its members ARE the group (§4.4c) — a split with nobody in it is not a
  // record somebody would want kept.
  TeachingGroup: {
    model: 'teachingGroup',
    children: [{ model: 'studentTeachingGroup', fk: 'teachingGroupId' }],
  },

  // An Event IS its audience: the four scope joins carry no information apart
  // from the event they scope. R191 — who answered for it, the presence
  // recorded at it and the notices sent about it exist only because of it
  // and go with it (the Owner met `notification_event_id_fkey`).
  Event: {
    model: 'event',
    children: [
      { model: 'eventBranch', fk: 'eventId' },
      { model: 'eventCategory', fk: 'eventId' },
      { model: 'eventLevel', fk: 'eventId' },
      { model: 'eventAdministrativeGroup', fk: 'eventId' },
      { model: 'eventStaff', fk: 'eventId' },
      { model: 'attendance', fk: 'eventId' },
      { model: 'notification', fk: 'eventId' },
    ],
  },

  // A Session's staffing and content links belong to the occurrence. The
  // Sessions themselves belong to the schedule that materialized them (TD-4.6c).
  Session: {
    model: 'session',
    children: [
      { model: 'sessionStaff', fk: 'sessionId' },
      { model: 'sessionContent', fk: 'sessionId' },
    ],
  },

  /**
   * R58/R124/R136 (Codex H2) — supervisors, the paper's own questions (their
   * options are removed first, above — a grandchild the flat mechanism here
   * cannot reach) and its notifications belong to the sitting/source and are
   * never evidence on their own. A `Grade`, a `StudentExamSubmission` or an
   * `Attendance` row against the exam IS academic record: since R172 §6 it
   * goes with the exam (`purgeExamEvidence`, before these children), having
   * been acknowledged at deletion and restorable for the seven days.
   */
  Exam: {
    model: 'exam',
    children: [
      { model: 'examStaff', fk: 'examId' },
      { model: 'examQuestion', fk: 'examId' },
      { model: 'notification', fk: 'examId' },
    ],
  },
  // R191 — a question removed from a paper nobody had yet answered
  // (`assertNotFrozen`): its options go with it.
  ExamQuestion: {
    model: 'examQuestion',
    children: [{ model: 'examQuestionOption', fk: 'questionId' }],
  },

  // The link rows belong to the content; the bytes are handled separately by the
  // caller, because they live outside the transaction (R59.1).
  EducationalContent: {
    model: 'educationalContent',
    children: [{ model: 'sessionContent', fk: 'contentId' }],
  },

  // A deleted Quran range is a correction, not the student's live source of
  // coverage. Its create/update/delete audits remain; explicit R59.1 purge may
  // remove the already-tombstoned row without changing current progress.
  QuranProgressLog: { model: 'quranProgressLog' },

  // Reference data with no owned children. A LIVE activity, exam or class that
  // still names the type or the year keeps it (PostgreSQL refuses; the holder
  // is named).
  SchedulingType: { model: 'schedulingType' },
  AcademicYear: { model: 'academicYear' },
  Partner: { model: 'partner' },

  // Join and leaf rows with nothing beneath them.
  HijriMonthStart: { model: 'hijriMonthStart' },
  Enrollment: { model: 'enrollment' },
  StudentTeachingGroup: { model: 'studentTeachingGroup' },
  LevelSubject: { model: 'levelSubject' },
  CategorySubject: { model: 'categorySubject' },
  LevelSurah: { model: 'levelSurah' },
  SessionContent: { model: 'sessionContent' },
  FamilyLink: { model: 'familyLink' },
  Attendance: { model: 'attendance' },
};

/**
 * **A record's DELETED dependents go with it** (R191 — the Owner: «delete
 * permanently any element in the trash»).
 *
 * A Level in the Trash may still be referenced by an enrolment that is ALSO in
 * the Trash. PostgreSQL refuses the Level while that row exists, which used to
 * mean purging the enrolment first, then the Level — one click per row, in
 * the right order, or `ops:empty-trash`'s passes. Both rows are deleted and
 * both are due for destruction within the window, so the purge of the parent
 * now purges each deleted dependent through ITS OWN Trash entry first
 * (`purgeTrashedDependents`: the same body, its own audit row, its own
 * consequences — a deleted class under a deleted Branch still goes with its
 * occurrences), then the record. A dependent that is LIVE is not here and is
 * never destroyed: it blocks, and the refusal names it.
 *
 * Each row names a referrer that reaches the Trash, its delegate and the
 * foreign key it points with — the same facts the schema states, listed here
 * only for the referrers that carry a tombstone.
 */
const TRASHED_DEPENDENTS: Record<string, { entity: string; model: PurgeModel; fk: string }[]> = {
  Branch: [
    { entity: 'Room', model: 'room', fk: 'branchId' },
    { entity: 'AdministrativeGroup', model: 'administrativeGroup', fk: 'branchId' },
    { entity: 'TeachingGroup', model: 'teachingGroup', fk: 'branchId' },
    { entity: 'Enrollment', model: 'enrollment', fk: 'branchId' },
    { entity: 'RecurringCourseSchedule', model: 'recurringCourseSchedule', fk: 'branchId' },
    { entity: 'Exam', model: 'exam', fk: 'branchId' },
    { entity: 'EducationalContent', model: 'educationalContent', fk: 'branchId' },
  ],
  Room: [
    { entity: 'RecurringCourseSchedule', model: 'recurringCourseSchedule', fk: 'roomId' },
    { entity: 'Session', model: 'session', fk: 'roomId' },
    { entity: 'Exam', model: 'exam', fk: 'roomId' },
  ],
  Category: [
    { entity: 'Level', model: 'level', fk: 'categoryId' },
    { entity: 'CategorySubject', model: 'categorySubject', fk: 'categoryId' },
  ],
  Subject: [
    { entity: 'LevelSubject', model: 'levelSubject', fk: 'subjectId' },
    { entity: 'CategorySubject', model: 'categorySubject', fk: 'subjectId' },
    { entity: 'TeachingGroup', model: 'teachingGroup', fk: 'subjectId' },
    { entity: 'StudentTeachingGroup', model: 'studentTeachingGroup', fk: 'subjectId' },
    { entity: 'RecurringCourseSchedule', model: 'recurringCourseSchedule', fk: 'subjectId' },
    { entity: 'Session', model: 'session', fk: 'subjectId' },
    { entity: 'EducationalContent', model: 'educationalContent', fk: 'subjectId' },
  ],
  Level: [
    { entity: 'LevelSubject', model: 'levelSubject', fk: 'levelId' },
    { entity: 'LevelSurah', model: 'levelSurah', fk: 'levelId' },
    { entity: 'AdministrativeGroup', model: 'administrativeGroup', fk: 'levelId' },
    { entity: 'TeachingGroup', model: 'teachingGroup', fk: 'levelId' },
    { entity: 'StudentTeachingGroup', model: 'studentTeachingGroup', fk: 'levelId' },
    { entity: 'Enrollment', model: 'enrollment', fk: 'levelId' },
    { entity: 'RecurringCourseSchedule', model: 'recurringCourseSchedule', fk: 'levelId' },
    { entity: 'Exam', model: 'exam', fk: 'levelId' },
    { entity: 'EducationalContent', model: 'educationalContent', fk: 'levelId' },
  ],
  AcademicYear: [
    { entity: 'RecurringCourseSchedule', model: 'recurringCourseSchedule', fk: 'academicYearId' },
    { entity: 'Exam', model: 'exam', fk: 'academicYearId' },
    { entity: 'EducationalContent', model: 'educationalContent', fk: 'academicYearId' },
  ],
  AdministrativeGroup: [
    { entity: 'Enrollment', model: 'enrollment', fk: 'administrativeGroupId' },
    { entity: 'RecurringCourseSchedule', model: 'recurringCourseSchedule', fk: 'administrativeGroupId' },
    { entity: 'Exam', model: 'exam', fk: 'administrativeGroupId' },
  ],
  TeachingGroup: [
    { entity: 'StudentTeachingGroup', model: 'studentTeachingGroup', fk: 'teachingGroupId' },
    { entity: 'RecurringCourseSchedule', model: 'recurringCourseSchedule', fk: 'teachingGroupId' },
    { entity: 'Exam', model: 'exam', fk: 'teachingGroupId' },
  ],
  RecurringCourseSchedule: [{ entity: 'Session', model: 'session', fk: 'scheduleId' }],
  Session: [
    { entity: 'SessionContent', model: 'sessionContent', fk: 'sessionId' },
    { entity: 'Exam', model: 'exam', fk: 'sessionId' },
    { entity: 'Attendance', model: 'attendance', fk: 'sessionId' },
  ],
  Exam: [
    { entity: 'ExamQuestion', model: 'examQuestion', fk: 'examId' },
    { entity: 'Attendance', model: 'attendance', fk: 'examId' },
  ],
  Event: [{ entity: 'Attendance', model: 'attendance', fk: 'eventId' }],
  SchedulingType: [
    { entity: 'Event', model: 'event', fk: 'schedulingTypeId' },
    { entity: 'Exam', model: 'exam', fk: 'schedulingTypeId' },
    { entity: 'RecurringCourseSchedule', model: 'recurringCourseSchedule', fk: 'schedulingTypeId' },
  ],
  EducationalContent: [{ entity: 'SessionContent', model: 'sessionContent', fk: 'contentId' }],
};

/**
 * Table → the domain thing that holds the record, for the refusal message.
 *
 * PostgreSQL names every foreign key `<table>_<column>_fkey`, so the holder is
 * read off the constraint it reports (`blockingEntityOf`): a translation of the
 * answer the database just gave, never a prediction. A table absent here falls
 * back to the generic sentence, which is why this map cannot drift into being
 * *wrong* — only into being less helpful, which the next UAT would surface.
 * Stable codes: the interface renders them.
 */
const TABLE_ENTITY: Record<string, string> = {
  academic_period: 'AcademicPeriod',
  administrative_group: 'AdministrativeGroup',
  attendance: 'Attendance',
  category_subject: 'CategorySubject',
  child_application: 'ChildApplication',
  circle_preference: 'CirclePreference',
  course_schedule_administrative_group: 'RecurringCourseSchedule',
  course_schedule_branch: 'RecurringCourseSchedule',
  course_schedule_category: 'RecurringCourseSchedule',
  course_schedule_level: 'RecurringCourseSchedule',
  course_schedule_staff: 'RecurringCourseSchedule',
  course_schedule_surah: 'RecurringCourseSchedule',
  course_schedule_teaching_group: 'RecurringCourseSchedule',
  educational_content: 'EducationalContent',
  educational_content_level: 'EducationalContent',
  educational_content_branch: 'EducationalContent',
  enrollment: 'Enrollment',
  event: 'Event',
  event_administrative_group: 'Event',
  event_branch: 'Event',
  event_category: 'Event',
  event_level: 'Event',
  event_staff: 'EventStaff',
  exam: 'Exam',
  exam_question: 'ExamQuestion',
  exam_question_option: 'ExamQuestion',
  exam_staff: 'Exam',
  family_link: 'FamilyLink',
  framing_preference: 'FramingPreference',
  framing_preference_branch: 'FramingPreference',
  framing_preference_level: 'FramingPreference',
  grade: 'Grade',
  grade_question_score: 'Grade',
  level: 'Level',
  level_completion_mark: 'LevelCompletionMark',
  level_subject: 'LevelSubject',
  level_surah: 'LevelSurah',
  notification: 'Notification',
  quran_progress_log: 'QuranProgressLog',
  recurring_course_schedule: 'RecurringCourseSchedule',
  room: 'Room',
  session: 'Session',
  session_audience_administrative_group: 'Session',
  session_audience_branch: 'Session',
  session_audience_category: 'Session',
  session_audience_level: 'Session',
  session_audience_teaching_group: 'Session',
  session_content: 'SessionContent',
  session_recording: 'SessionRecording',
  session_staff: 'Session',
  session_surah: 'Session',
  student_exam_answer: 'StudentExamSubmission',
  student_exam_answer_option: 'StudentExamSubmission',
  student_exam_submission: 'StudentExamSubmission',
  student_teaching_group: 'StudentTeachingGroup',
  teacher_category_capability: 'TeacherCapability',
  teacher_subject_capability: 'TeacherCapability',
  teaching_group: 'TeachingGroup',
  user: 'User',
  user_branch_role: 'UserBranchRole',
};

/** The holder named by a `<table>_<column>_fkey` constraint — the longest table
 *  name the constraint starts with, so `event_staff_event_id_fkey` is
 *  `EventStaff`, not `Event`. */
function blockingEntityOf(constraint: string | null): string | null {
  if (constraint === null || !constraint.endsWith('_fkey')) return null;
  const body = constraint.slice(0, -'_fkey'.length);
  let best: string | null = null;
  for (const table of Object.keys(TABLE_ENTITY)) {
    if (body.startsWith(`${table}_`) && (best === null || table.length > best.length)) best = table;
  }
  return best === null ? null : TABLE_ENTITY[best]!;
}

/** TD-2: the Trash is Super Admin only. It exposes every entity in the platform
 *  regardless of branch, so a branch-scoped Admin would see other branches'
 *  records — which no other surface allows. */
function assertSuperAdmin(actor: Actor): void {
  if (!scope.isSuperAdmin(actor.roleScopes)) {
    throw new AppError('FORBIDDEN', 'the Trash is Super Admin only (TD-2)');
  }
}

/**
 * **The two write verbs are TD-12 high-risk, and the token is not enough.**
 *
 * `assertSuperAdmin` above reads the JWT, which is a snapshot taken when the
 * token was minted. That is fine for reading the list, and it is *not* fine for
 * restore and permanent delete: a Super Admin whose role is revoked would go on
 * destroying records irreversibly until their access token expired — the exact
 * window TD-12's freshness rule exists to close, on the most destructive verb
 * the platform has.
 *
 * Measured, not assumed: `/admin/settings` already refuses a validly signed
 * token claiming `super_admin` for a user who does not hold it, because it
 * re-reads live rows. `/admin/trash` answered `200` to the same request. Same
 * platform, same claim, two answers — and the weaker one guarded the deletions.
 *
 * One indexed read on a low-frequency endpoint, exactly as the policy describes.
 */
async function assertFreshSuperAdmin(prisma: PrismaClient, actor: Actor): Promise<void> {
  assertSuperAdmin(actor);
  await assertFreshActive(prisma, actor.userId, [scope.SUPER_ADMIN], actor.activeRole);
}

export interface TrashRow {
  id: string;
  targetEntity: string;
  targetId: string;
  /** A human-readable identifier pulled from the snapshot — a name where the
   *  entity has one. Without it the list is a page of UUIDs. */
  label: string | null;
  deletedAt: Date;
  deletedById: string | null;
  deletedByName: string | null;
  /** BR-15: when the seven-day window purges it permanently. */
  purgeAfter: Date;
  /** Decided by the SERVER, per entity type. */
  restorable: boolean;
  /** `null` when restorable; otherwise a stable code saying why not. */
  restoreBlockedReason: string | null;
  /**
   * R59.1 — whether a Super Admin may destroy it. Decided by the SERVER for the
   * same reason `restorable` is: a client cannot know which destructions are
   * written, and one that guessed would offer an irreversible button.
   */
  purgeable: boolean;
  /** `null` when purgeable; otherwise a stable code saying why not. */
  purgeBlockedReason: string | null;
}

/**
 * What `/admin/trash` may be sorted by (R76.1; R198 §6 — every header sorts).
 * The record's own label lives in a per-entity JSONB key and is searched, not
 * sorted, on the server; the table sorts it when one page holds everything.
 */
export const TRASH_SORT_FIELDS: SortableFields = {
  entity: (dir) => [{ targetEntity: dir }],
  deleted_at: (dir) => [{ deletedAt: dir }],
  deleted_by: (dir) => [{ deletedBy: { nameArabic: dir } }],
  purge_after: (dir) => [{ purgeAfter: dir }],
};

export interface TrashFilters extends PageParams, SortParams {
  entity?: string;
  deletedById?: string;
  from?: Date;
  to?: Date;
  q?: string;
  /**
   * Which side of the Trash to read (Owner, 2026-09-02).
   *
   * `actionable` — the default — is what the Trash is for: rows a restore or a
   * purge can actually be performed on. `retained` is the history kept because
   * something references it, shown so it is reachable rather than hidden. `all`
   * is both. The stored rows are identical in every case.
   */
  view?: 'actionable' | 'retained' | 'all';
}

/**
 * **A name from the snapshot, not a second query.**
 *
 * The snapshot is the row exactly as it was, so the label is already in hand —
 * and reading it from there is also the only correct source: the live row may be
 * gone entirely once BR-15 purges, and a join would show nothing.
 */
function labelOf(snapshot: unknown): string | null {
  if (typeof snapshot !== 'object' || snapshot === null) return null;
  const row = snapshot as Record<string, unknown>;
  for (const key of ['name', 'nameArabic', 'name_arabic', 'title', 'label']) {
    const value = row[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return null;
}

export async function listTrash(
  prisma: PrismaClient,
  actor: Actor,
  filters: TrashFilters = {},
): Promise<Page<TrashRow>> {
  // The read gets freshness too. It is not a mutation, but it is the one list in
  // the platform that spans **every entity across every branch** (§5.6), so a
  // revoked Super Admin browsing it on a still-valid token is a real disclosure
  // rather than a theoretical one — and leaving the read on the token while the
  // writes re-read live rows is the kind of inconsistency somebody later
  // "tidies" in the wrong direction. One indexed read, on a low-frequency page.
  await assertFreshSuperAdmin(prisma, actor);

  const where: Prisma.TrashWhereInput = {
    ...(filters.entity ? { targetEntity: filters.entity } : {}),
    ...(filters.deletedById ? { deletedById: filters.deletedById } : {}),
    ...(filters.from || filters.to
      ? {
          deletedAt: {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lte: filters.to } : {}),
          },
        }
      : {}),
  };

  const window = pageWindow(filters);
  const [rows, total] = await Promise.all([
    prisma.trash.findMany({
      where,
      // Most recently deleted first: the record somebody is looking for is
      // almost always the one they just lost.
      orderBy: resolveSort(TRASH_SORT_FIELDS, filters, [{ deletedAt: 'desc' }]) as never,
      skip: window.skip,
      take: window.take,
      include: { deletedBy: { select: { id: true, nameArabic: true } } },
    }),
    prisma.trash.count({ where }),
  ]);

  /**
   * **R191 — every row is restorable and purgeable, and the server still says
   * so per row.** A type absent from `RESTORABLE` can only be one no deletion
   * writes any more (`Exam.questions`, a test's invented name): its restore
   * reads `NOT_YET_SUPPORTED`, which is the honest answer, and its purge
   * removes the entry. What a restore or a purge cannot do for THIS row — a
   * parent that is deleted, a live record that still uses it, a slot taken
   * since — is decided inside the transaction and refused by name, because a
   * list read earlier could not promise it anyway.
   */
  const mapped = rows.map((row) => {
    const restorable = RESTORABLE[row.targetEntity] !== undefined;
    // Every entry can be destroyed: a type with a plan, an account (de-identified),
    // and a type nothing writes any more (the entry alone is removed).
    const purgeable = true;
    return {
      id: row.id,
      targetEntity: row.targetEntity,
      targetId: row.targetId,
      label: labelOf(row.snapshot),
      deletedAt: row.deletedAt,
      deletedById: row.deletedById,
      deletedByName: row.deletedBy?.nameArabic ?? null,
      purgeAfter: row.purgeAfter,
      restorable,
      restoreBlockedReason: restorable ? null : 'NOT_YET_SUPPORTED',
      purgeable,
      purgeBlockedReason: purgeable ? null : 'NOT_YET_SUPPORTED',
    };
  });

  // **Search is applied to the LABEL, after the page is read.** The label lives
  // inside a JSONB snapshot under a key that differs per entity, so a SQL
  // predicate would need one expression per entity type and would still miss any
  // type added later. Narrowing the page a reader is already looking at is
  // honest — and the entity and date filters above, which do run in SQL, are the
  // ones that make the page small enough for that to be true.
  const needle = filters.q?.trim().toLowerCase();
  const searched = needle
    ? mapped.filter(
        (r) =>
          r.label?.toLowerCase().includes(needle) ||
          r.targetEntity.toLowerCase().includes(needle),
      )
    : mapped;

  /**
   * **Retained history is not an actionable Trash item** (Owner, 2026-09-02).
   *
   * A row that can be neither restored nor purged is not waiting for a decision
   * — it is being kept, because a Session, an audit row or consent evidence
   * references it and R59 says those stay. Listing it beside genuinely
   * disposable records offered an administrator two buttons that could never
   * work, which is what made the Trash misleading.
   *
   * **The row is not moved, hidden or altered.** Referential and historical
   * integrity are untouched; this is a lens over the same table, defaulting to
   * the items an action actually exists for. `retained` shows the other side
   * and `all` shows both, so nothing becomes unreachable.
   *
   * Applied after the page is read, exactly as the label search above is and
   * for the same reason: purgeability is a per-row question that no single SQL
   * predicate expresses across every entity type.
   */
  const view = filters.view ?? 'actionable';
  const data =
    view === 'all'
      ? searched
      : searched.filter((r) => (view === 'retained' ? !r.restorable && !r.purgeable : r.restorable || r.purgeable));

  return page(data, window, total);
}

/**
 * Restores one soft-deleted record — **only where §7's cascade problem does not
 * arise**.
 *
 * The refusal is deliberately loud rather than a hidden no-op. R111's account
 * deletion is restorable because its soft-delete phase removes no relationship
 * rows; entity types whose deletion really cascades remain outside RESTORABLE.
 */
/**
 * **The seats a deleted circle released, given back where they still fit**
 * (R169 §8). A seat returns to a student who (a) lost it TO this deletion —
 * stamped at or after the circle's own tombstone, never an earlier removal,
 * which was a different decision; (b) is still enrolled at the circle's Level;
 * and (c) has not since been seated in another circle of the same Subject —
 * `student_teaching_group_student_subject_level_unique` would refuse it, and
 * moving her back would undo a decision somebody made after the deletion.
 *
 * Consent re-evaluation is enqueued for every student whose seat returns, AFTER
 * it has: her audience just changed, and with it the gate of every recording of
 * the classes this circle attends — the mirror of what the deletion enqueued.
 */
async function restoreCircleSeats(
  tx: Prisma.TransactionClient,
  teachingGroupId: string,
  deletedAt: Date,
): Promise<{ seats_restored: number; seats_not_restored: number }> {
  const released = await tx.studentTeachingGroup.findMany({
    where: { teachingGroupId, deletedAt: { gte: deletedAt } },
    select: { id: true, studentId: true, subjectId: true, levelId: true },
  });
  if (released.length === 0) return { seats_restored: 0, seats_not_restored: 0 };

  const studentIds = released.map((seat) => seat.studentId);
  const { subjectId, levelId } = released[0]!;
  const [seatedElsewhere, stillEnrolled] = await Promise.all([
    tx.studentTeachingGroup.findMany({
      where: { deletedAt: null, studentId: { in: studentIds }, subjectId, levelId },
      select: { studentId: true },
    }),
    tx.enrollment.findMany({
      where: { deletedAt: null, studentId: { in: studentIds }, levelId, student: { deletedAt: null } },
      select: { studentId: true },
    }),
  ]);
  const elsewhere = new Set(seatedElsewhere.map((seat) => seat.studentId));
  const enrolled = new Set(stillEnrolled.map((enrolment) => enrolment.studentId));
  const returning = released.filter((seat) => !elsewhere.has(seat.studentId) && enrolled.has(seat.studentId));

  await tx.studentTeachingGroup.updateMany({
    where: { id: { in: returning.map((seat) => seat.id) } },
    data: { deletedAt: null, deletedById: null },
  });
  for (const seat of returning) await enqueueConsentReevaluationForStudent(tx, seat.studentId);

  return { seats_restored: returning.length, seats_not_restored: released.length - returning.length };
}

/**
 * **The activities that were addressed to a deleted Level, re-addressed**
 * (R169 §8). Only for an activity that is still live, only for a group that came
 * back with the Level, and never twice (`skipDuplicates`).
 */
async function restoreLevelEventLinks(
  tx: Prisma.TransactionClient,
  levelId: string,
  snapshot: unknown,
): Promise<{ event_links_restored: number; event_links_unknown: boolean }> {
  const record = (snapshot ?? {}) as Record<string, unknown>;
  const levelEventIds = record['removed_event_level_event_ids'];
  const groupLinks = record['removed_event_group_links'];
  if (!Array.isArray(levelEventIds) || !Array.isArray(groupLinks)) {
    // A tombstone from before this revision: what it was addressed by was never
    // written down. Said, rather than guessed.
    return { event_links_restored: 0, event_links_unknown: true };
  }
  const wanted = [
    ...levelEventIds.filter((id): id is string => typeof id === 'string'),
    ...groupLinks.map((link) => (link as { event_id?: unknown }).event_id).filter((id): id is string => typeof id === 'string'),
  ];
  const live = new Set(
    (await tx.event.findMany({ where: { id: { in: wanted }, deletedAt: null }, select: { id: true } })).map((e) => e.id),
  );
  const liveGroups = new Set(
    (await tx.administrativeGroup.findMany({ where: { levelId, deletedAt: null }, select: { id: true } })).map((g) => g.id),
  );
  const levelRows = levelEventIds
    .filter((id): id is string => typeof id === 'string' && live.has(id))
    .map((eventId) => ({ eventId, levelId }));
  const groupRows = groupLinks
    .map((link) => link as { event_id?: unknown; administrative_group_id?: unknown })
    .filter(
      (link): link is { event_id: string; administrative_group_id: string } =>
        typeof link.event_id === 'string' &&
        typeof link.administrative_group_id === 'string' &&
        live.has(link.event_id) &&
        liveGroups.has(link.administrative_group_id),
    )
    .map((link) => ({ eventId: link.event_id, administrativeGroupId: link.administrative_group_id }));
  const a = await tx.eventLevel.createMany({ data: levelRows, skipDuplicates: true });
  const b = await tx.eventAdministrativeGroup.createMany({ data: groupRows, skipDuplicates: true });
  return { event_links_restored: a.count + b.count, event_links_unknown: false };
}

/**
 * **The occurrences a deleted class schedule took with it, given back where
 * they still fit** (R169 §8) — see `RESTORABLE.RecurringCourseSchedule`.
 */
async function restoreScheduleSessions(
  tx: Prisma.TransactionClient,
  scheduleId: string,
  row: Record<string, unknown>,
  snapshot: unknown,
): Promise<{ sessions_restored: number; sessions_not_restored: number; cascade_unknown?: boolean }> {
  // R191 — a tombstone that never listed what it took (none written since
  // R43 lacks the key) restores the class alone and SAYS so, rather than
  // refusing: the Owner's «restore any element».
  if (!hasValidSnapshotIds(snapshot, 'removed_session_ids')) {
    return { sessions_restored: 0, sessions_not_restored: 0, cascade_unknown: true };
  }
  const removedIds = snapshotIds(snapshot, 'removed_session_ids', 'RecurringCourseSchedule');
  // R170 §8 — the past occurrences that went with the class come straight
  // back: nothing can have been booked in the past, so there is no conflict to
  // ask about. Absent on a snapshot older than R170, which listed none.
  const pastIds = hasValidSnapshotIds(snapshot, 'removed_past_session_ids')
    ? snapshotIds(snapshot, 'removed_past_session_ids', 'RecurringCourseSchedule')
    : [];
  const pastRestored =
    pastIds.length === 0
      ? 0
      : (
          await tx.session.updateMany({
            where: { id: { in: pastIds }, scheduleId, deletedAt: { not: null } },
            data: { deletedAt: null, deletedById: null },
          })
        ).count;

  // Morocco's date, not UTC's (codex review, 2026-09-22; R167 §2).
  const today = calendarDay();
  const ahead = await tx.session.findMany({
    where: { id: { in: removedIds }, scheduleId, deletedAt: { not: null }, date: { gte: today } },
    select: { id: true, date: true },
    orderBy: { date: 'asc' },
  });
  if (ahead.length === 0) {
    return { sessions_restored: pastRestored, sessions_not_restored: removedIds.length };
  }

  const staff = await tx.courseScheduleStaff.findMany({
    where: { scheduleId, deletedAt: null },
    select: { userId: true, position: true, effectiveFrom: true, effectiveUntil: true },
  });
  // The people it names must still be able to teach it (suspended, deleted…).
  await assertStaffAccountsAvailable(
    tx,
    staff.map((person) => person.userId),
  );

  // The scheduling form's OWN conflict check, over exactly the span coming
  // back: the room or a مؤطِّرة may have been booked since the deletion.
  const conflicts = await findConflicts(
    tx,
    {
      branchId: row['branchId'] as string,
      roomId: (row['roomId'] as string | null) ?? null,
      startTime: row['startTime'] as Date,
      endTime: row['endTime'] as Date,
      recurrence: row['recurrence'] as string,
      weekdays: (row['weekdays'] as string[] | null) ?? [],
      dayOfMonth: (row['dayOfMonth'] as number | null) ?? null,
      monthOfYear: (row['monthOfYear'] as number | null) ?? null,
      anchorDate: (row['anchorDate'] as Date | null) ?? null,
      effectiveUntil: (row['effectiveUntil'] as Date | null) ?? null,
      staff: staff.map((person) => ({
        userId: person.userId,
        position: person.position,
        effectiveFrom: person.effectiveFrom,
        effectiveUntil: person.effectiveUntil,
      })),
    },
    ahead[0]!.date,
    ahead[ahead.length - 1]!.date,
    scheduleId,
  );
  if (conflicts.length > 0) {
    throw new AppError('SCHEDULE_CONFLICT', 'the room or a member of staff has been booked since', {
      reason: 'OVERLAPPING_SESSIONS',
      conflicts: conflicts.slice(0, 10),
    });
  }

  await tx.session.updateMany({
    where: { id: { in: ahead.map((session) => session.id) } },
    data: { deletedAt: null, deletedById: null },
  });
  return {
    sessions_restored: pastRestored + ahead.length,
    sessions_not_restored: removedIds.length - ahead.length,
  };
}

/**
 * **An activity's audience, re-created from its snapshot** (R191). `deleteEvent`
 * hard-deletes the four scope joins and records their ids under `scope`; each
 * comes back for an audience row that is still live, never twice
 * (`skipDuplicates`). A snapshot without `scope` predates the record and is
 * said, not guessed.
 */
async function restoreEventScope(
  tx: Prisma.TransactionClient,
  eventId: string,
  snapshot: unknown,
): Promise<{ scope_links_restored: number; scope_links_unknown: boolean }> {
  const scope = ((snapshot ?? {}) as Record<string, unknown>)['scope'];
  if (typeof scope !== 'object' || scope === null) {
    return { scope_links_restored: 0, scope_links_unknown: true };
  }
  const ids = (key: string): string[] => {
    const value = (scope as Record<string, unknown>)[key];
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  };
  const live = async (model: ModelName, wanted: string[]): Promise<string[]> => {
    if (wanted.length === 0) return [];
    const delegate = tx[model] as unknown as { findMany: (a: unknown) => Promise<{ id: string }[]> };
    const rows = await delegate.findMany({ where: { id: { in: wanted }, deletedAt: null }, select: { id: true } });
    return rows.map((row) => row.id);
  };
  const [branches, categories, levels, groups] = await Promise.all([
    live('branch', ids('branch_ids')),
    live('category', ids('category_ids')),
    live('level', ids('level_ids')),
    live('administrativeGroup', ids('administrative_group_ids')),
  ]);
  const a = await tx.eventBranch.createMany({
    data: branches.map((branchId) => ({ eventId, branchId })),
    skipDuplicates: true,
  });
  const b = await tx.eventCategory.createMany({
    data: categories.map((categoryId) => ({ eventId, categoryId })),
    skipDuplicates: true,
  });
  const c = await tx.eventLevel.createMany({
    data: levels.map((levelId) => ({ eventId, levelId })),
    skipDuplicates: true,
  });
  const d = await tx.eventAdministrativeGroup.createMany({
    data: groups.map((administrativeGroupId) => ({ eventId, administrativeGroupId })),
    skipDuplicates: true,
  });
  return { scope_links_restored: a.count + b.count + c.count + d.count, scope_links_unknown: false };
}

/**
 * **The activities a deleted group was addressed by, re-addressed** (R191 —
 * `deleteAdministrativeGroup` records `removed_event_ids` since this
 * revision). Live activities only, never twice; an older tombstone says so.
 */
async function restoreGroupEventLinks(
  tx: Prisma.TransactionClient,
  administrativeGroupId: string,
  snapshot: unknown,
): Promise<{ event_links_restored: number; event_links_unknown: boolean }> {
  const value = ((snapshot ?? {}) as Record<string, unknown>)['removed_event_ids'];
  if (!Array.isArray(value)) return { event_links_restored: 0, event_links_unknown: true };
  const wanted = value.filter((id): id is string => typeof id === 'string');
  if (wanted.length === 0) return { event_links_restored: 0, event_links_unknown: false };
  const live = await tx.event.findMany({ where: { id: { in: wanted }, deletedAt: null }, select: { id: true } });
  const created = await tx.eventAdministrativeGroup.createMany({
    data: live.map((event) => ({ eventId: event.id, administrativeGroupId })),
    skipDuplicates: true,
  });
  return { event_links_restored: created.count, event_links_unknown: false };
}

/**
 * **The circle seats an enrolment's ending released, given back where they
 * still fit** (R191; the same test `restoreCircleSeats` applies): the seat
 * row named in the snapshot (`teachingGroupSeats`) is still tombstoned, its
 * circle is live, and the student holds no other live seat for that Subject
 * at that Level. Consent is re-evaluated for the student afterwards — her
 * audience just changed, as it did when the enrolment ended.
 */
async function restoreEnrollmentSeats(
  tx: Prisma.TransactionClient,
  studentId: string,
  snapshot: unknown,
): Promise<{ seats_restored: number; seats_not_restored: number }> {
  const seats = ((snapshot ?? {}) as Record<string, unknown>)['teachingGroupSeats'];
  const ids = Array.isArray(seats)
    ? seats
        .map((seat) => (seat as { id?: unknown }).id)
        .filter((id): id is string => typeof id === 'string')
    : [];
  if (ids.length === 0) {
    await enqueueConsentReevaluationForStudent(tx, studentId);
    return { seats_restored: 0, seats_not_restored: 0 };
  }
  const released = await tx.studentTeachingGroup.findMany({
    where: { id: { in: ids }, studentId, deletedAt: { not: null } },
    select: { id: true, subjectId: true, levelId: true, teachingGroup: { select: { deletedAt: true } } },
  });
  const taken = await tx.studentTeachingGroup.findMany({
    where: { studentId, deletedAt: null, subjectId: { in: released.map((seat) => seat.subjectId) } },
    select: { subjectId: true, levelId: true },
  });
  const occupied = new Set(taken.map((seat) => `${seat.subjectId}:${seat.levelId}`));
  const returning = released.filter(
    (seat) => seat.teachingGroup.deletedAt === null && !occupied.has(`${seat.subjectId}:${seat.levelId}`),
  );
  await tx.studentTeachingGroup.updateMany({
    where: { id: { in: returning.map((seat) => seat.id) } },
    data: { deletedAt: null, deletedById: null },
  });
  await enqueueConsentReevaluationForStudent(tx, studentId);
  return { seats_restored: returning.length, seats_not_restored: ids.length - returning.length };
}

/**
 * **A question's place on the paper** (R191). The removal closed the gap
 * (`removeQuestion`), so its old `display_order` may now be a live question's:
 * the row keeps its place when the place is free and takes the last otherwise
 * (`exam_question_order_unique` is partial on live rows). Decided BEFORE the
 * tombstone is cleared, so the index never refuses.
 */
async function placeRestoredQuestion(tx: Prisma.TransactionClient, questionId: string): Promise<void> {
  const question = await tx.examQuestion.findUniqueOrThrow({
    where: { id: questionId },
    select: { examId: true, displayOrder: true },
  });
  const taken = await tx.examQuestion.count({
    where: { examId: question.examId, deletedAt: null, displayOrder: question.displayOrder },
  });
  if (taken === 0) return;
  const last = await tx.examQuestion.aggregate({
    where: { examId: question.examId, deletedAt: null },
    _max: { displayOrder: true },
  });
  await tx.examQuestion.update({
    where: { id: questionId },
    data: { displayOrder: (last._max.displayOrder ?? 0) + 1 },
  });
}

/**
 * **A library item's file, brought back from quarantine** (R191). The same
 * durable obligation mechanism its deletion used, in the opposite direction:
 * recorded in the restoring transaction, performed by TD-7's worker, idempotent
 * (`restoreQuarantinedContentObject`). A row with no canonical coordinate
 * (fixture rows, R172) cannot carry one; the row itself still returns.
 */
async function enqueueContentStorageRestore(
  tx: Prisma.TransactionClient,
  row: Record<string, unknown>,
): Promise<{ file_restore_queued: boolean }> {
  const contentId = row['id'];
  const bucket = row['storageBucket'];
  const storageKey = row['storageKey'];
  if (typeof contentId !== 'string' || typeof bucket !== 'string' || typeof storageKey !== 'string') {
    return { file_restore_queued: false };
  }
  try {
    await requireRetirement(tx, { operation: 'restore_quarantined_object', contentId, bucket, storageKey }, true);
  } catch (error) {
    if (error instanceof AppError && error.details?.['reason'] === 'NON_CANONICAL_COORDINATE') {
      return { file_restore_queued: false };
    }
    throw error;
  }
  return { file_restore_queued: true };
}

/**
 * **A `UNIQUE` violation does not arrive as `P2002` either** — the same
 * driver-adapter shape `isForeignKeyViolation` documents below: SQLSTATE
 * `23505` under `P2039`. Either form means a LIVE row holds the place the
 * restored one would take (a partial index `WHERE deleted_at IS NULL`).
 */
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ((error as { code?: unknown }).code === 'P2002') return true;
  return sqlStateOf(error) === '23505';
}

export interface RestoreResult {
  targetEntity: string;
  targetId: string;
  seats_restored?: number;
  seats_not_restored?: number;
  sessions_restored?: number;
  sessions_not_restored?: number;
  event_links_restored?: number;
  event_links_unknown?: boolean;
  /** R191 — an activity's audience re-created from its snapshot. */
  scope_links_restored?: number;
  scope_links_unknown?: boolean;
  /** R191 — a library item's file is being brought back from quarantine. */
  file_restore_queued?: boolean;
  /** R191 — a rejected family link came back as a pending request. */
  reopened_as_pending?: boolean;
  /** R191 — the tombstone did not name what its deletion took; the record
   *  alone came back. Said, never guessed. */
  cascade_unknown?: boolean;
  /** R199 §5 — the classes a restored عطلة cancelled again. */
  holiday_cancelled_sessions?: number;
}

export async function restoreEntry(prisma: PrismaClient, actor: Actor, id: string): Promise<RestoreResult> {
  await assertFreshSuperAdmin(prisma, actor);

  const entry = await prisma.trash.findUnique({ where: { id } });
  if (!entry) throw new AppError('NOT_FOUND', 'no such trash entry');

  const plan = RESTORABLE[entry.targetEntity];
  if (!plan) {
    throw new AppError('STATE_CONFLICT', 'restoring this entity type is not supported', {
      reason: 'NOT_YET_SUPPORTED',
      target_entity: entry.targetEntity,
    });
  }
  let recalculateQuran: { studentId: string; surahId: number } | null = null;
  let result: RestoreResult;
  try {
    result = await prisma.$transaction(async (tx) => {
      if (entry.targetEntity === 'User') {
        // Same governing lock as soft/permanent deletion. Re-read the exact
        // generation AFTER waiting; a stale restore must not revive a tombstone.
        await lockUser(tx, entry.targetId);
        const current = await tx.trash.findFirst({
          where: { id, targetEntity: 'User', targetId: entry.targetId },
        });
        if (!current) throw new AppError('NOT_FOUND', 'no such trash entry');
        if (current.purgeAfter <= new Date()) {
          throw new AppError('STATE_CONFLICT', 'the restoration window has expired', {
            reason: 'RESTORATION_EXPIRED',
          });
        }
      }
      if (entry.targetEntity === 'EducationalContent') {
        // The same lock every storage transition takes (TD-7): the restore's
        // obligation and a quarantine job must not interleave on one item.
        await lockEducationalContent(tx, [entry.targetId]);
      }
      const delegate = tx[plan.model] as unknown as {
        findUnique: (a: unknown) => Promise<Record<string, unknown> | null>;
        update: (a: unknown) => Promise<unknown>;
      };

      const row = await delegate.findUnique({ where: { id: entry.targetId } });
      // BR-15 has purged the row itself, so there is nothing left to un-delete —
      // the snapshot alone cannot recreate it safely, because every foreign key it
      // points at may since have gone too.
      if (!row) {
        throw new AppError('STATE_CONFLICT', 'the record itself is gone — BR-15 purged it', {
          reason: 'ALREADY_PURGED',
        });
      }
      if (row['deletedAt'] === null) {
        throw new AppError('STATE_CONFLICT', 'that record is not deleted', { reason: 'NOT_DELETED' });
      }
      // R191 — a tombstone written before its type recorded what the deletion
      // took brings the record back alone and SAYS so (`cascade_unknown`),
      // rather than refusing (`INCOMPLETE_SNAPSHOT` withdrawn). A present but
      // malformed list is corruption and still aborts (`snapshotIds`).
      const cascadeUnknown =
        plan.children?.some(
          (child) =>
            child.snapshotIdsKey !== undefined &&
            child.legacyOptional !== true &&
            snapshotLacks(entry.snapshot, child.snapshotIdsKey),
        ) ?? false;

      // **A child cannot be restored into a deleted parent.** Restoring a Room
      // whose Branch is still in the Trash would produce a room nobody can reach
      // through any screen — technically alive, practically lost.
      for (const parent of [...(plan.parent ? [plan.parent] : []), ...(plan.parents ?? [])]) {
        const parentId = row[parent.field];
        if (parentId === null || parentId === undefined) continue;
        const parentDelegate = tx[parent.model] as unknown as {
          findFirst: (a: unknown) => Promise<unknown>;
        };
        if (!(await parentDelegate.findFirst({ where: { id: parentId, deletedAt: null } }))) {
          throw new AppError('STATE_CONFLICT', 'restore its parent first', {
            reason: 'PARENT_DELETED',
            parent_entity: String(parent.model),
          });
        }
      }

      // R172 §9 — a future occurrence returns into a slot that may have been
      // given away since (R171 §6's rule for a cancellation's restore): the
      // room and the staff it would re-occupy are checked, `SCHEDULE_CONFLICT`.
      if (entry.targetEntity === 'Session' && (row['date'] as Date) >= calendarDay()) {
        const occurrence = await tx.session.findUniqueOrThrow({
          where: { id: entry.targetId },
          select: {
            id: true,
            roomId: true,
            date: true,
            startTime: true,
            endTime: true,
            schedule: { select: { branchId: true } },
            staff: { where: { deletedAt: null }, select: { userId: true, position: true } },
          },
        });
        await assertOccurrenceFree(tx, {
          id: occurrence.id,
          branchId: occurrence.schedule.branchId,
          roomId: occurrence.roomId,
          date: occurrence.date,
          startTime: occurrence.startTime,
          endTime: occurrence.endTime,
          staff: occurrence.staff,
        });
      }

      // R191 — a circle seat returns only to a student still enrolled at the
      // Level (the rule each seat of a restored circle already meets).
      if (entry.targetEntity === 'StudentTeachingGroup') {
        const enrolled = await tx.enrollment.count({
          where: { studentId: row['studentId'] as string, levelId: row['levelId'] as string, deletedAt: null },
        });
        if (enrolled === 0) {
          throw new AppError('STATE_CONFLICT', 'the student is no longer enrolled at that Level', {
            reason: 'NOT_ENROLLED',
          });
        }
      }
      // R191 — a question keeps its place on the paper or takes the last one.
      if (entry.targetEntity === 'ExamQuestion') await placeRestoredQuestion(tx, entry.targetId);

      // R191 — a REJECTED family link's rejection WAS its deletion: it comes
      // back as a pending request for the reviewer to decide again, never into
      // authority (§4.3). A revoked approved link comes back approved.
      const reopened = entry.targetEntity === 'FamilyLink' && row['status'] === 'rejected';
      await delegate.update({
        where: { id: entry.targetId },
        data: {
          deletedAt: null,
          deletedById: null,
          ...(reopened
            ? { status: 'pending', decidedAt: null, decidedById: null, decisionReason: null }
            : {}),
        },
      });

      // **The children come back with it, or the restore is the half-restore §7
      // warns about** (R59.3). Only declared reinstatements run: a type whose
      // cascade is not written stays out of `RESTORABLE` entirely rather than
      // being restored partially here.
      // **The record's OWN tombstone is the reference, not the Trash entry's.**
      // The service stamps the record and its children from one `new Date()`
      // inside the transaction; the Trash row is written a few milliseconds later
      // from a different clock reading. Comparing against the entry therefore
      // excluded the very children it was meant to include — measured, not
      // supposed: the staff were 4 ms early and a restored exam came back with
      // nobody supervising it.
      const deletedAt = row['deletedAt'] as Date;

      /**
       * Restoring a FUTURE exam revives an operational obligation, not merely
       * history. An account may have been deleted after the exam was binned,
       * because its ExamStaff rows were correctly tombstoned at that moment.
       * Lock and re-check those people before revival so restore participates in
       * the same R111 serialization as ordinary staffing writes. Past exam staff
       * remain historical evidence and may still point at a de-identified User.
       */
      if (entry.targetEntity === 'Exam') {
        const examDate = row['date'];
        // Morocco's date, not UTC's (codex review, 2026-09-22; R167 §2).
        const today = calendarDay();
        if (examDate instanceof Date && examDate >= today) {
          const staff = await tx.examStaff.findMany({
            where: { examId: entry.targetId, deletedAt: { gte: deletedAt } },
            select: { userId: true },
          });
          await assertStaffAccountsAvailable(
            tx,
            staff.map((person) => person.userId),
          );
        }
      }

      for (const child of plan.children ?? []) {
        const childDelegate = tx[child.model] as unknown as {
          updateMany: (a: unknown) => Promise<{ count: number }>;
        };
        await childDelegate.updateMany({
          // Scoped to the rows removed BY this deletion: a supervisor taken off
          // the exam a week earlier stays off it, because that was a different
          // decision by a different person.
          where: child.snapshotIdsKey
            ? {
                [child.fk]: {
                  in: snapshotIds(entry.snapshot, child.snapshotIdsKey, entry.targetEntity),
                },
                deletedAt: { gte: deletedAt },
              }
            : { [child.fk]: entry.targetId, deletedAt: { gte: deletedAt } },
          data: { deletedAt: null, deletedById: null },
        });
      }

      // What came back WITH it, per type (R169 §8, R191) — counted, so the
      // screen can say what could not return.
      let consequence: Omit<RestoreResult, 'targetEntity' | 'targetId'> = {};
      switch (entry.targetEntity) {
        case 'TeachingGroup':
          consequence = await restoreCircleSeats(tx, entry.targetId, deletedAt);
          break;
        case 'RecurringCourseSchedule':
          consequence = await restoreScheduleSessions(tx, entry.targetId, row, entry.snapshot);
          break;
        case 'Level':
          consequence = await restoreLevelEventLinks(tx, entry.targetId, entry.snapshot);
          break;
        case 'Event':
          consequence = await restoreEventScope(tx, entry.targetId, entry.snapshot);
          // R199 §5 — a restored عطلة cancels its classes again.
          consequence = { ...consequence, holiday_cancelled_sessions: (await applyHoliday(tx, entry.targetId)).cancelled };
          break;
        case 'AdministrativeGroup':
          consequence = await restoreGroupEventLinks(tx, entry.targetId, entry.snapshot);
          break;
        case 'Enrollment':
          consequence = await restoreEnrollmentSeats(tx, row['studentId'] as string, entry.snapshot);
          break;
        case 'StudentTeachingGroup':
        case 'FamilyLink':
          // Her audience — and with it the gate of every recording she appears
          // in — just changed (TD-4.6), as it did when the row was removed.
          await enqueueConsentReevaluationForStudent(tx, row['studentId'] as string);
          if (reopened) consequence = { reopened_as_pending: true };
          break;
        case 'SessionContent':
          await enqueueConsentReevaluationForSessions(tx, [row['sessionId'] as string]);
          break;
        case 'EducationalContent':
          consequence = await enqueueContentStorageRestore(tx, row);
          break;
        case 'QuranProgressLog':
          // §4.5 — coverage is recomputed from the live logs once the row is
          // back; after the commit, as every log mutation does.
          recalculateQuran = { studentId: row['studentId'] as string, surahId: row['surahId'] as number };
          break;
        default:
          break;
      }
      if (cascadeUnknown) consequence = { ...consequence, cascade_unknown: true };

      // The tombstone goes with the restoration: the record is no longer deleted,
      // so leaving it listed would make the Trash disagree with the platform. The
      // audit row below is what keeps the event answerable afterwards.
      await tx.trash.delete({ where: { id } });

      await audit.write(tx, {
        actorUserId: actor.userId,
        activeRole: actor.activeRole,
        actionType: 'trash.restore',
        targetEntity: entry.targetEntity,
        targetId: entry.targetId,
        detail: {
          deleted_at: entry.deletedAt.toISOString(),
          deleted_by: entry.deletedById,
          // R169 §8 — what came back WITH it, in counts (TD-14: no names).
          ...consequence,
        },
      });

      return { targetEntity: entry.targetEntity, targetId: entry.targetId, ...consequence };
    });
  } catch (error) {
    // R191 — a LIVE row has taken the place the restored one would hold (a
    // live enrolment of the same student at the Level, a year with that label,
    // presence already recorded for that student at that occurrence). The
    // answer, not a failure: the restore is refused and the holder is named.
    if (isUniqueViolation(error)) {
      const constraint = constraintOf(error);
      throw new AppError('STATE_CONFLICT', 'a live record already holds this place', {
        reason: 'DUPLICATE_LIVE',
        target_entity: entry.targetEntity,
        constraint,
      });
    }
    throw error;
  }
  if (recalculateQuran !== null) {
    const { studentId, surahId } = recalculateQuran as { studentId: string; surahId: number };
    await recalculateFor(prisma, studentId, surahId);
  }
  return result;
}

/**
 * **Destroys a soft-deleted record permanently** (SRS Revision 59.1).
 *
 * Super Admin only, asserted here against the actor's live role scopes — the
 * `/admin/` prefix is not the boundary (TD-2), and a client that hides a button
 * has secured nothing.
 *
 * ## Why this exists at all
 *
 * Revision 52 forbade it: *a manual "delete now" would bypass a retention rule
 * that exists for legal and safeguarding reasons*. Revision 59 supersedes that
 * for one reason — **"wait out the window" is not an answer to a safeguarding
 * erasure request**. What the retention rule protects against is *accidental and
 * unaccountable* destruction, and an audited, confirmed, Super-Admin-only action
 * is neither. BR-15's window is unchanged and remains the default path for
 * everything nobody acts on.
 *
 * ## It is complete or it does not happen
 *
 * Children, then the record, then the tombstone, then the audit row — one
 * transaction. A partial destruction is the single outcome that would leave the
 * platform unable to say what was removed, which is worse than either extreme.
 * R191's deleted dependents are purged BEFORE it, each as the complete act its
 * own entry describes; a refusal of the record afterwards leaves rows that
 * were due for destruction anyway destroyed, and the record intact.
 *
 * ## The database decides what still depends on it
 *
 * Every foreign key into these tables is `Restrict`, so a LIVE referrer makes
 * PostgreSQL refuse and that refusal becomes `DEPENDENTS_EXIST`, naming the
 * holder. Enumerating blockers in TypeScript would be a second copy of the
 * schema, and the copy is the one that drifts.
 *
 * ## An account is de-identified, never deleted (R111, R191)
 *
 * «حذف نهائي» on a `User` entry is `purgeUserAccount` — the same act as
 * `DELETE /admin/users/{id}?permanent=true`, with the same two refusals (the
 * last active Super Admin, live staffing responsibilities): the personal
 * fields, credentials and snapshot go, the non-identifying row stays for the
 * audit trail, and the Trash entry goes with the de-identification.
 */
export async function purgeEntry(
  prisma: PrismaClient,
  actor: Actor,
  id: string,
): Promise<{ targetEntity: string; targetId: string; alreadyPurged: boolean }> {
  await assertFreshSuperAdmin(prisma, actor);
  const entry = await prisma.trash.findUnique({ where: { id }, select: { targetEntity: true, targetId: true } });
  if (!entry) throw new AppError('NOT_FOUND', 'no such trash entry');
  if (entry.targetEntity === 'User') {
    await purgeUserAccount(prisma, actor, entry.targetId);
    return { targetEntity: 'User', targetId: entry.targetId, alreadyPurged: false };
  }
  return purgeTrashEntry(prisma, actor, id);
}

/**
 * **A record's deleted dependents go first** (R191, `TRASHED_DEPENDENTS`): each
 * referrer row that is tombstoned AND has a Trash entry of its own is purged
 * through that entry — the same body, its own consequences, its own audit row
 * — depth first, so a deleted class under a deleted Branch still goes with its
 * occurrences. Counted per type for the parent's audit row.
 */
async function purgeTrashedDependents(
  prisma: PrismaClient,
  actor: Actor | null,
  targetEntity: string,
  targetId: string,
): Promise<{ dependents: Record<string, number>; orphans: Record<string, number> }> {
  const dependents: Record<string, number> = {};
  const orphans: Record<string, number> = {};
  for (const dependent of TRASHED_DEPENDENTS[targetEntity] ?? []) {
    const delegate = prisma[dependent.model] as unknown as {
      findMany: (a: unknown) => Promise<{ id: string }[]>;
      deleteMany: (a: unknown) => Promise<{ count: number }>;
    };
    const rows = await delegate.findMany({
      where: { [dependent.fk]: targetId, deletedAt: { not: null } },
      select: { id: true },
    });
    if (rows.length === 0) continue;
    const entries = await prisma.trash.findMany({
      where: { targetEntity: dependent.entity, targetId: { in: rows.map((row) => row.id) } },
      select: { id: true, targetId: true },
      orderBy: { deletedAt: 'asc' },
    });
    for (const entry of entries) {
      try {
        await purgeTrashEntry(prisma, actor, entry.id);
        dependents[dependent.entity] = (dependents[dependent.entity] ?? 0) + 1;
      } catch (error) {
        // Already gone (a concurrent purge won): nothing to count.
        if (error instanceof AppError && error.code === 'NOT_FOUND') continue;
        throw error;
      }
    }
    /**
     * **A tombstone nothing names** — a join row cascade-deleted before its
     * parent's snapshot listed ids (2026-08, before R59.2/R169), or removed
     * before its own deletion wrote an entry. It is in no list, restorable by
     * nobody, and it held «فرصة أمل» and «محو الأمية» in the Localhost Trash
     * for five weeks. For the LEAF types — rows with nothing beneath them —
     * it goes with the parent and is counted apart (`orphans_purged`). A
     * tombstoned dependent WITH consequences of its own and no entry is left
     * to the refusal, named: destroying it by improvisation is what the plan
     * registry exists to prevent.
     */
    if (LEAF_DEPENDENTS.has(dependent.entity)) {
      const named = new Set(entries.map((entry) => entry.targetId));
      const orphanIds = rows.map((row) => row.id).filter((id) => !named.has(id));
      if (orphanIds.length > 0) {
        const gone = await delegate.deleteMany({ where: { id: { in: orphanIds }, deletedAt: { not: null } } });
        if (gone.count > 0) orphans[dependent.entity] = (orphans[dependent.entity] ?? 0) + gone.count;
      }
    }
  }
  return { dependents, orphans };
}

/** Dependent types with nothing beneath them: a tombstone of theirs that no
 *  entry names may go with the parent (`purgeTrashedDependents`). */
const LEAF_DEPENDENTS = new Set([
  'LevelSubject',
  'CategorySubject',
  'LevelSurah',
  'StudentTeachingGroup',
  'SessionContent',
  'Attendance',
  'Enrollment',
]);

/** Owned rows of an occurrence — they exist as part of it (TD-4.6c). */
const SESSION_OWNED = [
  'sessionStaff',
  'sessionContent',
  'sessionSurah',
  'sessionAudienceBranch',
  'sessionAudienceCategory',
  'sessionAudienceLevel',
  'sessionAudienceAdministrativeGroup',
  'sessionAudienceTeachingGroup',
  'notification',
] as const;

/**
 * **R172 §6 — an exam's evidence goes with it.** Answers (and their chosen
 * options), papers, marks (their per-question scores cascade) and attendance
 * recorded against the exam. Restrict FKs everywhere, so the order matters:
 * options → answers → papers, then marks, then attendance.
 */
async function purgeExamEvidence(
  tx: Prisma.TransactionClient,
  examId: string,
): Promise<{ submissions: number; grades: number; attendance: number }> {
  await tx.studentExamAnswerOption.deleteMany({ where: { answer: { submission: { examId } } } });
  await tx.studentExamAnswer.deleteMany({ where: { submission: { examId } } });
  const submissions = await tx.studentExamSubmission.deleteMany({ where: { examId } });
  const grades = await tx.grade.deleteMany({ where: { examId } });
  const attendance = await tx.attendance.deleteMany({ where: { examId } });
  return { submissions: submissions.count, grades: grades.count, attendance: attendance.count };
}

/**
 * **The whole of an exam, destroyed** — its evidence (above), its options,
 * then the owned rows `PURGEABLE.Exam` declares, then the row, then any Trash
 * entries that named it or its questions. One body for the exam's own purge
 * and for R191's rule that a quick test sat in a destroyed occurrence goes
 * with the occurrence (`purgeSessions`): the two cannot drift.
 */
async function purgeExamWhole(
  tx: Prisma.TransactionClient,
  examId: string,
): Promise<{ submissions: number; grades: number; attendance: number }> {
  const evidence = await purgeExamEvidence(tx, examId);
  await tx.examQuestionOption.deleteMany({ where: { question: { examId } } });
  // Every question, live or tombstoned (no `deletedAt` term): all go with the paper.
  const questions = await tx.examQuestion.findMany({ where: { examId }, select: { id: true } });
  await tx.examStaff.deleteMany({ where: { examId } });
  await tx.examQuestion.deleteMany({ where: { examId } });
  await tx.notification.deleteMany({ where: { examId } });
  await tx.exam.delete({ where: { id: examId } });
  await tx.trash.deleteMany({
    where: {
      OR: [
        { targetEntity: 'Exam', targetId: examId },
        { targetEntity: 'ExamQuestion', targetId: { in: questions.map((question) => question.id) } },
      ],
    },
  });
  return evidence;
}

/**
 * **Destroys the class's occurrences WITH their attendance, their recordings
 * and the quick tests sat in them** (R170 §8 — the Owner, 2026-09-22: *«those
 * records be destroyed with the class after seven days»*; R191 — the Owner,
 * 2026-10-01: *«any element»*). Every occurrence of the class goes: the past
 * ones its deletion took, the future ones it took, and the ones protection
 * kept LIVE under the deleted class — the class row cannot go while any
 * remains, and a class in the Trash is what the Owner chose to destroy. A
 * recording an occurrence produced is soft-deleted into the Trash with its own
 * snapshot and exact-key quarantine obligation, so the file follows the
 * ordinary content lifecycle rather than being left as an orphan in the
 * library. Runs inside the purge transaction.
 */
async function purgeScheduleSessions(
  tx: Prisma.TransactionClient,
  scheduleId: string,
  deletedById: string | null,
): Promise<{ sessions: number; attendance: number; recordings: number; exams: number }> {
  // Every occurrence, live or tombstoned (no `deletedAt` term — see above).
  const gone = await tx.session.findMany({ where: { scheduleId }, select: { id: true } });
  return purgeSessions(tx, gone.map((session) => session.id), deletedById);
}

/** The destruction itself, for a class's occurrences (above) or one deleted
 *  on its own (R172 §9). R191 — a quick test sat in one of them is addressed
 *  to it (`exam_target_check`: a `session` target names its occurrence) and
 *  cannot outlive it: it goes with the occurrence, whole (`purgeExamWhole`). */
async function purgeSessions(
  tx: Prisma.TransactionClient,
  ids: string[],
  deletedById: string | null,
): Promise<{ sessions: number; attendance: number; recordings: number; exams: number }> {
  if (ids.length === 0) return { sessions: 0, attendance: 0, recordings: 0, exams: 0 };

  // Every quick test addressed to them, live or tombstoned (no `deletedAt`
  // term): none can outlive its occurrence.
  const exams = await tx.exam.findMany({ where: { sessionId: { in: ids } }, select: { id: true } });
  for (const exam of exams) await purgeExamWhole(tx, exam.id);

  // The recordings these occurrences produced (R99): each becomes an ordinary
  // deleted library item, with the obligation that moves its object.
  const recordings = await tx.sessionRecording.findMany({
    where: { sessionId: { in: ids }, educationalContentId: { not: null } },
    select: { educationalContentId: true },
  });
  const now = new Date();
  let recordingsDeleted = 0;
  for (const contentId of [...new Set(recordings.map((r) => r.educationalContentId!))]) {
    const row = await tx.educationalContent.findFirst({ where: { id: contentId, deletedAt: null } });
    if (!row) continue;
    await tx.educationalContent.update({ where: { id: contentId }, data: { deletedAt: now, deletedById } });
    await snapshotToTrash(tx, {
      targetEntity: 'EducationalContent',
      targetId: contentId,
      snapshot: { ...row, sizeBytes: row.sizeBytes.toString() },
      deletedById,
    });
    await requireRetirement(
      tx,
      { operation: 'quarantine_retired_object', contentId, bucket: row.storageBucket, storageKey: row.storageKey },
      true,
    );
    recordingsDeleted += 1;
  }

  const attendance = await tx.attendance.deleteMany({ where: { sessionId: { in: ids } } });
  await tx.sessionRecording.deleteMany({ where: { sessionId: { in: ids } } });
  for (const model of SESSION_OWNED) {
    const delegate = tx[model] as unknown as { deleteMany: (a: unknown) => Promise<{ count: number }> };
    await delegate.deleteMany({ where: { sessionId: { in: ids } } });
  }
  await tx.session.deleteMany({ where: { id: { in: ids } } });
  // The Trash entries of occurrences deleted on their own (R172 §9) that
  // just went with their class: the row is gone, so the entry goes too.
  await tx.trash.deleteMany({ where: { targetEntity: 'Session', targetId: { in: ids } } });
  return { sessions: ids.length, attendance: attendance.count, recordings: recordingsDeleted, exams: exams.length };
}

/**
 * The purge itself, with **no authority check and no opinion about who asked**.
 *
 * Two callers: the Super Admin action above, and BR-15's automatic seven-day
 * sweep below, which has no actor at all because the calendar is not a person.
 * They share this body deliberately — a second implementation of *destroy this
 * record permanently* is the one that would eventually disagree with the first
 * about what "destroy" includes, and both would be right about their own code.
 *
 * `actor === null` means system-initiated: the audit row carries no actor, which
 * R60.8 states is how a row omits a capacity that does not exist.
 */
async function purgeTrashEntry(
  prisma: PrismaClient,
  actor: Actor | null,
  id: string,
): Promise<{ targetEntity: string; targetId: string; alreadyPurged: boolean }> {
  const entry = await prisma.trash.findUnique({ where: { id } });
  if (!entry) throw new AppError('NOT_FOUND', 'no such trash entry');

  const plan = PURGEABLE[entry.targetEntity];
  if (!plan) {
    /**
     * **A type no deletion writes any more** (R191). One such entry exists:
     * `Exam.questions`, written by R124's migration for the paper blob it
     * replaced, for a type nothing can read. There is no row to destroy — the
     * entry IS the whole artefact — so «حذف نهائي» removes it, says so in the
     * audit row, and the Trash stops listing a thing no button could act on.
     * Restoring it stays refused: nothing knows what it would restore.
     */
    await prisma.$transaction(async (tx) => {
      await tx.trash.delete({ where: { id } });
      await audit.write(tx, {
        actorUserId: actor?.userId ?? null,
        activeRole: actor?.activeRole,
        actionType: 'trash.permanent_delete',
        targetEntity: entry.targetEntity,
        targetId: entry.targetId,
        detail: {
          already_purged: true,
          unknown_entity: true,
          deleted_at: entry.deletedAt.toISOString(),
          system: actor === null,
        },
      });
    });
    return { targetEntity: entry.targetEntity, targetId: entry.targetId, alreadyPurged: true };
  }

  // R191 — its deleted dependents go first, each through its own entry.
  const { dependents: dependentsPurged, orphans: orphansPurged } = await purgeTrashedDependents(
    prisma,
    actor,
    entry.targetEntity,
    entry.targetId,
  );

  try {
    return await prisma.$transaction(async (tx) => {
      const delegate = tx[plan.model] as unknown as {
        findUnique: (a: unknown) => Promise<Record<string, unknown> | null>;
        delete: (a: unknown) => Promise<unknown>;
      };

      if (entry.targetEntity === 'EducationalContent') {
        await lockEducationalContent(tx, [entry.targetId]);
      }
      const row = await delegate.findUnique({ where: { id: entry.targetId } });

      // **The record is already gone and only the tombstone remains.** Removing
      // the entry is exactly what the caller asked for, so it succeeds and says
      // which of the two happened rather than raising over a state that is not
      // an error.
      if (!row) {
        await enqueueContentStorageRetirement(tx, entry.targetEntity, entry.targetId, entry.snapshot);
        await tx.trash.delete({ where: { id } });
        await audit.write(tx, {
          actorUserId: actor?.userId ?? null,
          activeRole: actor?.activeRole,
          actionType: 'trash.permanent_delete',
          targetEntity: entry.targetEntity,
          targetId: entry.targetId,
          detail: {
            already_purged: true,
            deleted_at: entry.deletedAt.toISOString(),
            system: actor === null,
          },
        });
        return { targetEntity: entry.targetEntity, targetId: entry.targetId, alreadyPurged: true };
      }

      // **A live record is never destroyed through the Trash.** Somebody
      // restored it since, and the tombstone is stale — destroying it now would
      // remove a record in active use with no deletion behind it.
      if (row['deletedAt'] === null) {
        throw new AppError('STATE_CONFLICT', 'that record is not deleted', { reason: 'NOT_DELETED' });
      }

      await enqueueContentStorageRetirement(tx, entry.targetEntity, entry.targetId, row);

      /**
       * **R136 (Codex H2) — `ExamQuestionOption` is a GRANDCHILD, one hop past
       * what the flat `{ [fk]: targetId }` children mechanism below can
       * express** (its FK is to `ExamQuestion.id`, not to `examId` directly).
       * `purgeExamEvidence` has removed every answer to these questions by
       * the time this runs, so removing every option first is exactly what
       * makes `ExamQuestion.deleteMany` below succeed rather than hit the same
       * RESTRICT this fix exists to stop hitting.
       */
      let purgedWithExam = { submissions: 0, grades: 0, attendance: 0 };
      if (entry.targetEntity === 'Exam') {
        // R172 §6 — the papers, marks and attendance recorded against it go
        // with it (acknowledged at deletion; restorable until now).
        purgedWithExam = await purgeExamEvidence(tx, entry.targetId);
        await tx.examQuestionOption.deleteMany({ where: { question: { examId: entry.targetId } } });
      }
      // R170 §8 / R191 — a class goes with its occurrences, their attendance,
      // their recordings and the quick tests sat in them.
      let purgedWithClass = { sessions: 0, attendance: 0, recordings: 0, exams: 0 };
      if (entry.targetEntity === 'Session') {
        // R172 §9 — what one occurrence carries goes with it (R170 §8's rule);
        // R191 — a quick test sat in it too (`purgeSessions`).
        purgedWithClass = await purgeSessions(tx, [entry.targetId], actor?.userId ?? null);
        // The row itself is gone with them (and its entry, by `purgeSessions`);
        // the generic delete below would find nothing, so the act is closed here.
        await audit.write(tx, {
          actorUserId: actor?.userId ?? null,
          activeRole: actor?.activeRole,
          actionType: 'trash.permanent_delete',
          targetEntity: entry.targetEntity,
          targetId: entry.targetId,
          detail: {
            already_purged: false,
            deleted_at: entry.deletedAt.toISOString(),
            deleted_by: entry.deletedById,
            system: actor === null,
            attendance_purged: purgedWithClass.attendance,
            recordings_deleted: purgedWithClass.recordings,
            ...(purgedWithClass.exams > 0 ? { exams_purged: purgedWithClass.exams } : {}),
            ...(Object.keys(dependentsPurged).length > 0 ? { dependents_purged: dependentsPurged } : {}),
            ...(Object.keys(orphansPurged).length > 0 ? { orphans_purged: orphansPurged } : {}),
          },
        });
        return { targetEntity: entry.targetEntity, targetId: entry.targetId, alreadyPurged: false };
      }
      if (entry.targetEntity === 'RecurringCourseSchedule') {
        // R170 §8 / R191 — every occurrence it still holds goes with it.
        purgedWithClass = await purgeScheduleSessions(tx, entry.targetId, actor?.userId ?? null);
      }
      if (entry.targetEntity === 'EducationalContent') {
        // R191 — the occurrence's recording row (R99) keeps saying it was
        // recorded; the file it pointed at is what is being destroyed, so the
        // pointer is cleared rather than the row kept hostage to a deleted item.
        await tx.sessionRecording.updateMany({
          where: { educationalContentId: entry.targetId },
          data: { educationalContentId: null },
        });
      }

      for (const child of plan.children ?? []) {
        const childDelegate = tx[child.model] as unknown as {
          deleteMany: (a: unknown) => Promise<{ count: number }>;
        };
        const where = child.snapshotIdsKey
          ? {
              [child.fk]: {
                in: snapshotIds(entry.snapshot, child.snapshotIdsKey, entry.targetEntity),
              },
            }
          : { [child.fk]: entry.targetId };
        await childDelegate.deleteMany({ where });
      }

      await delegate.delete({ where: { id: entry.targetId } });
      await tx.trash.delete({ where: { id } });

      // Retained indefinitely: `trash.permanent_delete` is deliberately absent
      // from `PURGEABLE_ACTION_TYPES`, so the record of an irreversible act
      // outlives the audit-purge horizon.
      await audit.write(tx, {
        actorUserId: actor?.userId ?? null,
        activeRole: actor?.activeRole,
        actionType: 'trash.permanent_delete',
        targetEntity: entry.targetEntity,
        targetId: entry.targetId,
        detail: {
          already_purged: false,
          deleted_at: entry.deletedAt.toISOString(),
          deleted_by: entry.deletedById,
          // The calendar did it, not a person — distinguishable in the trail
          // without needing to know that `actor_user_id` happened to be null.
          system: actor === null,
          // R170 §8 — what went with the class (counts: an occurrence id is a
          // coordinate, never a person).
          // R172 §6 — what went with the exam, in counts.
          ...(purgedWithExam.submissions + purgedWithExam.grades + purgedWithExam.attendance > 0
            ? {
                submissions_purged: purgedWithExam.submissions,
                grades_purged: purgedWithExam.grades,
                attendance_purged: purgedWithExam.attendance,
              }
            : {}),
          ...(purgedWithClass.sessions > 0
            ? {
                sessions_purged: purgedWithClass.sessions,
                attendance_purged: purgedWithClass.attendance,
                recordings_deleted: purgedWithClass.recordings,
                ...(purgedWithClass.exams > 0 ? { exams_purged: purgedWithClass.exams } : {}),
              }
            : {}),
          // R191 — the deleted dependents that went first, per type, in counts;
          // and the tombstones no entry named (leaf rows), likewise.
          ...(Object.keys(dependentsPurged).length > 0 ? { dependents_purged: dependentsPurged } : {}),
          ...(Object.keys(orphansPurged).length > 0 ? { orphans_purged: orphansPurged } : {}),
        },
      });

      return { targetEntity: entry.targetEntity, targetId: entry.targetId, alreadyPurged: false };
    });
  } catch (error) {
    // P2003: a foreign key still points at the row. That is the answer, not a
    // failure — a record in use is not destroyed, and the caller is told which
    // constraint held it.
    if (isForeignKeyViolation(error)) {
      const constraint = constraintOf(error);
      throw new AppError('STATE_CONFLICT', 'something still references this record', {
        reason: 'DEPENDENTS_EXIST',
        target_entity: entry.targetEntity,
        constraint,
        /**
         * **What still depends on it, in domain terms** (UAT, 2026-09-02).
         *
         * The refusal is correct — a record in use is not destroyed — but the
         * administrator was told only *«something still references this»*, with
         * no way to learn what or what to do next. She would then try the same
         * purge again.
         *
         * This is a TRANSLATION of the answer PostgreSQL just gave, not the
         * hand-maintained blocker list this module's docstring rules out: it
         * predicts nothing, it is consulted only after a real refusal, and an
         * unrecognised constraint degrades to the previous generic sentence
         * rather than to a wrong one. The raw `constraint` stays for engineers;
         * the interface renders this.
         */
        blocking_entity: blockingEntityOf(constraint),
      });
    }
    throw error;
  }
}

/**
 * **BR-15's seven days, enforced automatically** (Owner decision, 2026-09-04 —
 * closing Revision 59.4).
 *
 * R59.4 was the open question: `Trash.purge_after` recorded the end of the
 * window and the job named as its enforcement was never built, so nothing ever
 * expired. The Owner has now authorised the intended semantics — expired
 * entries are permanently purged, without a Super Admin approving each one.
 *
 * ## What it does NOT do, and why each absence is deliberate
 *
 * * **No second purge implementation.** It calls `purgeTrashEntry`, the same
 *   body the manual action uses, so the children destroyed, the storage
 *   retirement enqueued and the audit row written are identical.
 * * **No new lifecycle state.** An entry is due or it is not, decided by one
 *   comparison against `purge_after`. Adding a `purging` state would create a
 *   value that a crash could strand.
 * * **No snapshot parsing for storage coordinates.** `enqueueContentStorageRetirement`
 *   already reads the authoritative row, and the exact coordinate it enqueues is
 *   what `content.quarantine-purge` deletes. Digging keys out of historical
 *   JSON would couple this to the shape every model used to have.
 * * **No broad deletion of anything.** Every delete is by primary key or by the
 *   declared child foreign key of one record.
 *
 * ## It fails closed, per entry
 *
 * An entry that cannot be destroyed cleanly is **left alone and counted**, never
 * skipped silently and never allowed to abort the sweep:
 *
 * * `DEPENDENTS_EXIST` — something still references the record. That is the
 *   correct answer, not a failure; the row stays and will be retried tomorrow.
 * * `NOT_YET_SUPPORTED` — the entity has no purge plan. Destroying it by
 *   improvisation is exactly what the plan registry exists to prevent.
 * * `NOT_DELETED` — somebody restored the record since; the tombstone is stale
 *   and destroying a live record would be the worst possible outcome here.
 *
 * **An unexpected error propagates.** A sweep that swallowed everything would
 * report success while destroying nothing, and TD-7's retry would never fire.
 *
 * ## Codex B5 — a `User` entry dispatches to R133's OWN lifecycle, not the plan
 *
 * `User` is deliberately absent from `PURGEABLE` (R54 — the row itself is an
 * accountability record and may never be DELETEd, only de-identified), so
 * routing it through `purgeTrashEntry` like everything else would only ever
 * reach `ACCOUNTABILITY_RECORD` and leave the entry stranded forever — exactly
 * the bug Codex reproduced. `deIdentifyAccountSystem` is the SAME function a
 * Super Admin's manual `DELETE /admin/users/{id}?permanent=true` already
 * calls, so the destruction, the Trash cleanup and the audit row are identical
 * either way; it deletes the `Trash` row itself as part of de-identifying, so
 * there is nothing left here for `purgeTrashEntry` to do for this entity.
 * `NOT_DELETED` (restored since) and `NOT_FOUND` (a concurrent manual purge
 * already won) are the SAME two `AppError` shapes `deIdentifyAccount` throws
 * as the generic path, so the existing catch below handles both without
 * change.
 *
 * ## Ordering, and what a crash leaves behind
 *
 * Per entry: the transaction destroys children, record and tombstone together
 * and enqueues the storage retirement **inside** it, so a crash before commit
 * leaves the entry exactly as it was and tomorrow's sweep retries it. The object
 * deletion happens afterwards through TD-7's own retrying job, which is why the
 * failure mode the Owner named — *DB says gone, object silently remains
 * forever* — cannot arise: the job is durable and an already-missing object is
 * a successful DELETE in S3 semantics rather than an error.
 */
export async function purgeExpiredEntries(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<{ purged: number; blocked: number; unsupported: number; stale: number }> {
  const due = await prisma.trash.findMany({
    // Strictly before: on the boundary instant the window has not elapsed. The
    // same strictness as the two application clocks and the ten-year one.
    where: { purgeAfter: { lt: now } },
    select: { id: true, targetEntity: true, targetId: true },
    orderBy: { purgeAfter: 'asc' },
  });

  const counts = { purged: 0, blocked: 0, unsupported: 0, stale: 0 };
  for (const entry of due) {
    try {
      if (entry.targetEntity === 'User') {
        await deIdentifyAccountSystem(prisma, entry.targetId, entry.id, now);
      } else {
        await purgeTrashEntry(prisma, null, entry.id);
      }
      counts.purged += 1;
    } catch (error) {
      const reason =
        error instanceof AppError
          ? ((error.details as { reason?: string } | undefined)?.reason ?? null)
          : null;
      if (reason === 'DEPENDENTS_EXIST') counts.blocked += 1;
      else if (reason === 'NOT_DELETED' || reason === 'STALE_DELETION') counts.stale += 1;
      else if (error instanceof AppError && error.code === 'STATE_CONFLICT') {
        counts.unsupported += 1;
      } else if (error instanceof AppError && error.code === 'NOT_FOUND') {
        // A concurrent manual purge won. Nothing to do and nothing wrong.
        counts.purged += 1;
      } else {
        throw error;
      }
    }
  }
  return counts;
}

/**
 * Reads an exact consequence set written by the deleting service.
 *
 * Absence means a legacy snapshot and deliberately returns an empty set: the
 * parent's eventual FK delete then refuses, which is the safe answer when the
 * platform cannot distinguish an owned cascade from an earlier independent
 * deletion. A present but malformed set is corruption and aborts the whole
 * transaction rather than silently broadening or narrowing destruction.
 */
function snapshotIds(snapshot: unknown, key: string, targetEntity: string): string[] {
  if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) return [];
  const value = (snapshot as Record<string, unknown>)[key];
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string')) {
    throw new Error(`${targetEntity} Trash snapshot has malformed ${key}`);
  }
  return value as string[];
}

/** The key is simply not there — a snapshot from before it was written. */
function snapshotLacks(snapshot: unknown, key: string): boolean {
  if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) return false;
  return (snapshot as Record<string, unknown>)[key] === undefined;
}

function hasValidSnapshotIds(snapshot: unknown, key: string): boolean {
  if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) return false;
  const value = (snapshot as Record<string, unknown>)[key];
  return Array.isArray(value) && value.every((id) => typeof id === 'string');
}

/**
 * Makes a content purge's database destruction and exact object-retirement
 * obligation indivisible. Storage cannot join the transaction, so the durable
 * pg-boss row is the committed promise; the worker performs idempotent deletes
 * afterwards and must fail/retry on an ambiguous storage response.
 *
 * The snapshot fallback closes purges whose content row was already removed by
 * an older/manual path. Missing or malformed coordinates fail the transaction
 * closed: erasing the final Trash locator would otherwise recreate the orphan
 * this obligation exists to prevent.
 */
async function enqueueContentStorageRetirement(
  tx: Prisma.TransactionClient,
  targetEntity: string,
  contentId: string,
  source: unknown,
): Promise<void> {
  if (targetEntity !== 'EducationalContent') return;
  if (typeof source !== 'object' || source === null) {
    throw new Error('EducationalContent purge has no storage snapshot');
  }
  const coordinate = source as Record<string, unknown>;
  const bucket = coordinate['storageBucket'];
  const storageKey = coordinate['storageKey'];
  if (typeof bucket !== 'string' || typeof storageKey !== 'string') {
    throw new Error('EducationalContent purge has no exact storage coordinate');
  }
  await requireRetirement(tx, { operation: 'manual_permanent_delete', contentId, bucket, storageKey }, true);
}

/**
 * **A `RESTRICT` violation does not arrive as `P2003`.**
 *
 * Measured rather than assumed, and the assumption was wrong. `P2003` is
 * Prisma's *foreign key constraint failed* — PostgreSQL `23503`. A column
 * declared `onDelete: Restrict`, which is how every relation on this schema is
 * declared, raises **`23001` `restrict_violation`** instead, and the driver
 * adapter surfaces it as **`P2039`** with the SQLSTATE buried in a nested
 * `driverAdapterError.cause`.
 *
 * Matching only `P2003` therefore let the raw Prisma error escape to the client
 * as a 500 for the single most likely refusal this endpoint has. Both codes are
 * accepted, and the SQLSTATE is what is actually checked.
 */
const FK_SQLSTATES = new Set(['23001', '23503']);

function isForeignKeyViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  if (code === 'P2003') return true;
  return FK_SQLSTATES.has(sqlStateOf(error) ?? '');
}

function sqlStateOf(error: unknown): string | null {
  const cause = (
    error as { meta?: { driverAdapterError?: { cause?: { code?: unknown; originalCode?: unknown } } } }
  ).meta?.driverAdapterError?.cause;
  // `code` on a RESTRICT refusal (P2039); `originalCode` on a typed violation
  // the adapter classified itself (R191 — `UniqueConstraintViolation`).
  for (const value of [cause?.code, cause?.originalCode]) if (typeof value === 'string') return value;
  return null;
}

/** The constraint that held the row — the useful half of the message, so an
 *  administrator learns WHICH relationship is in the way. */
function constraintOf(error: unknown): string | null {
  const meta = (error as {
    meta?: {
      field_name?: unknown;
      constraint?: unknown;
      driverAdapterError?: { cause?: { message?: unknown; originalMessage?: unknown } };
    };
  }).meta;

  for (const value of [meta?.constraint, meta?.field_name]) {
    if (typeof value === 'string') return value;
  }
  for (const message of [meta?.driverAdapterError?.cause?.message, meta?.driverAdapterError?.cause?.originalMessage]) {
    if (typeof message !== 'string') continue;
    // `violates foreign key constraint "…"` and, since R191, `duplicate key
    // value violates unique constraint "…"` — both name the holder.
    const named = /(?:foreign key|unique) constraint "([^"]+)"/.exec(message)?.[1];
    if (named) return named;
  }
  return null;
}
