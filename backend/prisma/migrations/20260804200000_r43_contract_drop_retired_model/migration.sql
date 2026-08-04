-- SRS Revision 43 — CONTRACT PHASE. The retired model is removed and Revision
-- 43 becomes the single source of truth.
--
-- Drops `group`, `group_teacher`, `student_group`, `event_group`,
-- `grade.group_id` and `educational_content.event_id`, and tightens
-- `educational_content.subject_id` to NOT NULL (§7, Revision 43).
--
-- contract-phase: **Document Owner decision, 2026-08-04 — no data is migrated,
-- deliberately.** TD-6b's expand–migrate–contract sequence exists to protect
-- production data. **There is no production deployment and no real beneficiary
-- data**; the platform is mid-M3b of an eight-milestone build. The Owner's
-- instruction was explicit: *"Do not spend time writing compatibility migrations
-- that fabricate schedules or placeholder subjects. Remove the old model
-- cleanly and adopt Revision 43 as the single source of truth. Test fixtures and
-- development data may be recreated under the new model instead of migrated."*
--
-- **Why a backfill would have had to invent data.** A retired `group` carried a
-- weekly slot (`day_of_week`, `start_time`, `end_time`, `room_id`) but no
-- Subject — the old model had no notion of *what* was taught in that slot.
-- Converting one into an `administrative_group` plus a
-- `recurring_course_schedule` therefore requires choosing a Subject that was
-- never recorded. Any automatic choice is a fabrication that would look like
-- real curriculum data to everyone who read it afterwards.
--
-- The expand phase (`_r43_educational_model_expand`, three migrations back)
-- created the replacement structures; every released code path was moved onto
-- them before this ran, and nothing in `src/` references the dropped tables.
--
-- **Every statement is idempotent (`IF EXISTS`).** A contract step that has
-- partially applied must be re-runnable: the first attempt here failed on the
-- `subject_id` NOT NULL tightening *after* dropping several constraints, and a
-- non-idempotent script would then have been unrecoverable without hand-editing
-- the database. Forward-only (TD-6b) means a failed migration is fixed by
-- running it again, so it has to tolerate its own partial effects.
-- DropForeignKey
ALTER TABLE IF EXISTS "group" DROP CONSTRAINT IF EXISTS "group_level_id_fkey";

-- DropForeignKey
ALTER TABLE IF EXISTS "group" DROP CONSTRAINT IF EXISTS "group_branch_id_fkey";

-- DropForeignKey
ALTER TABLE IF EXISTS "group" DROP CONSTRAINT IF EXISTS "group_room_id_fkey";

-- DropForeignKey
ALTER TABLE IF EXISTS "group_teacher" DROP CONSTRAINT IF EXISTS "group_teacher_group_id_fkey";

-- DropForeignKey
ALTER TABLE IF EXISTS "group_teacher" DROP CONSTRAINT IF EXISTS "group_teacher_teacher_id_fkey";

-- DropForeignKey
ALTER TABLE IF EXISTS "student_group" DROP CONSTRAINT IF EXISTS "student_group_student_id_fkey";

-- DropForeignKey
ALTER TABLE IF EXISTS "student_group" DROP CONSTRAINT IF EXISTS "student_group_group_id_fkey";

-- DropForeignKey
ALTER TABLE IF EXISTS "event_group" DROP CONSTRAINT IF EXISTS "event_group_event_id_fkey";

-- DropForeignKey
ALTER TABLE IF EXISTS "event_group" DROP CONSTRAINT IF EXISTS "event_group_group_id_fkey";

-- DropForeignKey
ALTER TABLE IF EXISTS "grade" DROP CONSTRAINT IF EXISTS "grade_group_id_fkey";

-- DropForeignKey
ALTER TABLE IF EXISTS "educational_content" DROP CONSTRAINT IF EXISTS "educational_content_subject_id_fkey";

-- DropForeignKey
ALTER TABLE IF EXISTS "educational_content" DROP CONSTRAINT IF EXISTS "educational_content_event_id_fkey";

-- AlterTable
ALTER TABLE "grade" DROP COLUMN IF EXISTS "group_id";

-- AlterTable
ALTER TABLE "educational_content" DROP COLUMN IF EXISTS "event_id",
ALTER COLUMN "subject_id" SET NOT NULL;

-- DropTable
DROP TABLE IF EXISTS "group";

-- DropTable
DROP TABLE IF EXISTS "group_teacher";

-- DropTable
DROP TABLE IF EXISTS "student_group";

-- DropTable
DROP TABLE IF EXISTS "event_group";

-- AddForeignKey
ALTER TABLE "educational_content" ADD CONSTRAINT "educational_content_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

