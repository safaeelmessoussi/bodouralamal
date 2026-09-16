-- SRS Revision 156 — "who created it and when, and if deleted, who deleted
-- it and when" (Document Owner instruction, 2026-09-16), for anything a
-- person manually creates or deletes through the platform. Explicitly
-- excludes rows the system creates as a side effect of something else
-- (Notification is the Owner's own named example; also AuditLog, RefreshToken,
-- ConsumedToken, RateLimitCounter, Trash, the four EventXxx/CourseScheduleXxx
-- scope joins, and every wholesale delete-then-recreate profile table —
-- see docs/SRS.md Revision 156 for the full model-by-model reasoning).
--
-- `created_by` is a BARE UUID column with NO foreign key, on the SAME
-- convention `deleted_by` already uses on 33 of the 35 tables that carry
-- it (only `user.deleted_by` and `trash.deleted_by` are real FKs). That is
-- a deliberate, load-bearing choice already made by this schema: a real FK
-- would RESTRICT deleting/anonymising an account that ever created
-- anything, which is every staff account within days of the platform
-- opening. `created_at`/an equivalent creation timestamp already exists on
-- every table below (several under a domain-specific name — `enrolled_at`,
-- `added_at`, `logged_at`) — this migration adds only the missing "who"
-- half, once "when" was already there.
--
-- Every model below already has (or, for the six-model join-table group,
-- is getting for the first time here) a genuine, non-redundant "who
-- created this row" question — `Grade.created_by` in particular is a real
-- gap this migration closes, not a formality: nothing on that row
-- previously named who entered a mark, only who it was about. Models with
-- an EXISTING actor-equivalent column (`Attendance.marked_by_id`,
-- `QuranProgressLog.logged_by_id`, `ConsentRecord.granted_by_user_id`,
-- `SelfManagedClaim`/`StudentExamSubmission`/`ChildApplication`'s own
-- unambiguous self-service actor, `SessionRecording.started_by_id`) are
-- deliberately NOT touched — a second column naming the same fact would be
-- the exact duplicated-actor risk `docs/architecture/security.md` already
-- warns against.

ALTER TABLE "user" ADD COLUMN "created_by" UUID;
ALTER TABLE "partner" ADD COLUMN "created_by" UUID;
ALTER TABLE "user_branch_role" ADD COLUMN "created_by" UUID;
ALTER TABLE "branch" ADD COLUMN "created_by" UUID;
ALTER TABLE "room" ADD COLUMN "created_by" UUID;
ALTER TABLE "category" ADD COLUMN "created_by" UUID;
ALTER TABLE "level" ADD COLUMN "created_by" UUID;
ALTER TABLE "subject" ADD COLUMN "created_by" UUID;
ALTER TABLE "level_subject" ADD COLUMN "created_by" UUID;
ALTER TABLE "level_surah" ADD COLUMN "created_by" UUID;
ALTER TABLE "administrative_group" ADD COLUMN "created_by" UUID;
ALTER TABLE "teaching_group" ADD COLUMN "created_by" UUID;
ALTER TABLE "student_teaching_group" ADD COLUMN "created_by" UUID;
ALTER TABLE "enrollment" ADD COLUMN "created_by" UUID;
ALTER TABLE "recurring_course_schedule" ADD COLUMN "created_by" UUID;
ALTER TABLE "course_schedule_staff" ADD COLUMN "created_by" UUID;
ALTER TABLE "scheduling_type" ADD COLUMN "created_by" UUID;
ALTER TABLE "event" ADD COLUMN "created_by" UUID;
ALTER TABLE "exam" ADD COLUMN "created_by" UUID;
ALTER TABLE "exam_question" ADD COLUMN "created_by" UUID;
ALTER TABLE "exam_question_option" ADD COLUMN "created_by" UUID;
ALTER TABLE "academic_period" ADD COLUMN "created_by" UUID;
ALTER TABLE "academic_year" ADD COLUMN "created_by" UUID;
ALTER TABLE "educational_content" ADD COLUMN "created_by" UUID;
ALTER TABLE "exam_staff" ADD COLUMN "created_by" UUID;
ALTER TABLE "event_staff" ADD COLUMN "created_by" UUID;
ALTER TABLE "hijri_month_start" ADD COLUMN "created_by" UUID;
ALTER TABLE "grade" ADD COLUMN "created_by" UUID;
ALTER TABLE "session_content" ADD COLUMN "created_by" UUID;
ALTER TABLE "session_staff" ADD COLUMN "created_by" UUID;
ALTER TABLE "family_link" ADD COLUMN "created_by" UUID;
