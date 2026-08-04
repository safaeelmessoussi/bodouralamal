-- SRS Revision 43 — the educational model separates ORGANISATION from DELIVERY.
--
-- EXPAND PHASE (TD-6b). Every table here is ADDITIVE and lives alongside
-- `group`, `group_teacher`, `student_group` and `event_group`, which are still
-- read by released code. Nothing is dropped, nothing is renamed, and no column
-- is tightened — the migrate phase backfills, and a SEPARATE, LATER contract
-- migration drops the old structures. A single migration that added and dropped
-- in one step is prohibited.
--
-- The PostgreSQL-specific guarantees this model depends on — the two composite
-- foreign keys, the partial unique indexes, the mode/target CHECK, and the
-- `ar-x-icu` collations — are NOT here: Prisma cannot express them, so they are
-- hand-written in the companion `_r43_educational_model_constraints` migration
-- (TD-6a, §20 rule 5). That migration sorts immediately after this one.

-- CreateEnum
CREATE TYPE "teaching_mode" AS ENUM ('entire_level', 'administrative_group', 'teaching_group');

-- CreateEnum
CREATE TYPE "schedule_staff_position" AS ENUM ('teacher', 'assistant');

-- CreateEnum
CREATE TYPE "session_status" AS ENUM ('scheduled', 'cancelled', 'held');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "recurrence_type" ADD VALUE 'multiple_weekdays';
ALTER TYPE "recurrence_type" ADD VALUE 'monthly';

-- AlterTable
ALTER TABLE "room" ADD COLUMN     "capacity" INTEGER;

-- AlterTable
ALTER TABLE "grade" ADD COLUMN     "administrative_group_id" UUID;

-- CreateTable
CREATE TABLE "administrative_group" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "level_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "display_order" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" UUID,

    CONSTRAINT "administrative_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teaching_group" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "subject_id" UUID NOT NULL,
    "level_id" UUID NOT NULL,
    "display_order" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" UUID,

    CONSTRAINT "teaching_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_teaching_group" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "teaching_group_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "level_id" UUID NOT NULL,
    "added_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" UUID,

    CONSTRAINT "student_teaching_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollment" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "administrative_group_id" UUID NOT NULL,
    "level_id" UUID NOT NULL,
    "enrolled_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" UUID,

    CONSTRAINT "enrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_course_schedule" (
    "id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "teaching_mode" "teaching_mode" NOT NULL,
    "level_id" UUID,
    "administrative_group_id" UUID,
    "teaching_group_id" UUID,
    "branch_id" UUID NOT NULL,
    "room_id" UUID,
    "start_time" TIME(0) NOT NULL,
    "end_time" TIME(0) NOT NULL,
    "recurrence" "recurrence_type" NOT NULL,
    "weekdays" "day_of_week"[],
    "day_of_month" INTEGER,
    "month_of_year" INTEGER,
    "anchor_date" DATE,
    "academic_year_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" UUID,

    CONSTRAINT "recurring_course_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_schedule_staff" (
    "id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "position" "schedule_staff_position" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" UUID,

    CONSTRAINT "course_schedule_staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "start_time" TIME(0) NOT NULL,
    "end_time" TIME(0) NOT NULL,
    "room_id" UUID,
    "teacher_id" UUID,
    "status" "session_status" NOT NULL DEFAULT 'scheduled',
    "overridden" BOOLEAN NOT NULL DEFAULT false,
    "cancellation_reason" VARCHAR(500),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" UUID,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_content" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "educational_content_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" UUID,

    CONSTRAINT "session_content_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_administrative_group" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "administrative_group_id" UUID NOT NULL,

    CONSTRAINT "event_administrative_group_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "administrative_group_level_id_deleted_at_idx" ON "administrative_group"("level_id", "deleted_at");

-- CreateIndex
CREATE INDEX "administrative_group_branch_id_deleted_at_idx" ON "administrative_group"("branch_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "administrative_group_id_level_id_key" ON "administrative_group"("id", "level_id");

-- CreateIndex
CREATE INDEX "teaching_group_subject_id_level_id_deleted_at_idx" ON "teaching_group"("subject_id", "level_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "teaching_group_id_subject_id_level_id_key" ON "teaching_group"("id", "subject_id", "level_id");

-- CreateIndex
CREATE INDEX "student_teaching_group_teaching_group_id_deleted_at_idx" ON "student_teaching_group"("teaching_group_id", "deleted_at");

-- CreateIndex
CREATE INDEX "student_teaching_group_student_id_deleted_at_idx" ON "student_teaching_group"("student_id", "deleted_at");

-- CreateIndex
CREATE INDEX "student_teaching_group_subject_id_level_id_deleted_at_idx" ON "student_teaching_group"("subject_id", "level_id", "deleted_at");

-- CreateIndex
CREATE INDEX "enrollment_administrative_group_id_deleted_at_idx" ON "enrollment"("administrative_group_id", "deleted_at");

-- CreateIndex
CREATE INDEX "enrollment_level_id_deleted_at_idx" ON "enrollment"("level_id", "deleted_at");

-- CreateIndex
CREATE INDEX "enrollment_student_id_deleted_at_idx" ON "enrollment"("student_id", "deleted_at");

-- CreateIndex
CREATE INDEX "recurring_course_schedule_branch_id_deleted_at_idx" ON "recurring_course_schedule"("branch_id", "deleted_at");

-- CreateIndex
CREATE INDEX "recurring_course_schedule_subject_id_deleted_at_idx" ON "recurring_course_schedule"("subject_id", "deleted_at");

-- CreateIndex
CREATE INDEX "recurring_course_schedule_academic_year_id_deleted_at_idx" ON "recurring_course_schedule"("academic_year_id", "deleted_at");

-- CreateIndex
CREATE INDEX "course_schedule_staff_user_id_deleted_at_idx" ON "course_schedule_staff"("user_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "course_schedule_staff_schedule_id_user_id_key" ON "course_schedule_staff"("schedule_id", "user_id");

-- CreateIndex
CREATE INDEX "session_room_id_date_idx" ON "session"("room_id", "date");

-- CreateIndex
CREATE INDEX "session_teacher_id_date_idx" ON "session"("teacher_id", "date");

-- CreateIndex
CREATE INDEX "session_date_status_idx" ON "session"("date", "status");

-- CreateIndex
CREATE UNIQUE INDEX "session_schedule_id_date_key" ON "session"("schedule_id", "date");

-- CreateIndex
CREATE INDEX "session_content_educational_content_id_deleted_at_idx" ON "session_content"("educational_content_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "session_content_session_id_educational_content_id_key" ON "session_content"("session_id", "educational_content_id");

-- CreateIndex
CREATE INDEX "event_administrative_group_administrative_group_id_idx" ON "event_administrative_group"("administrative_group_id");

-- CreateIndex
CREATE UNIQUE INDEX "event_administrative_group_event_id_administrative_group_id_key" ON "event_administrative_group"("event_id", "administrative_group_id");

-- AddForeignKey
ALTER TABLE "administrative_group" ADD CONSTRAINT "administrative_group_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "administrative_group" ADD CONSTRAINT "administrative_group_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teaching_group" ADD CONSTRAINT "teaching_group_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teaching_group" ADD CONSTRAINT "teaching_group_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_teaching_group" ADD CONSTRAINT "student_teaching_group_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_teaching_group" ADD CONSTRAINT "student_teaching_group_teaching_group_id_fkey" FOREIGN KEY ("teaching_group_id") REFERENCES "teaching_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_teaching_group" ADD CONSTRAINT "student_teaching_group_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_teaching_group" ADD CONSTRAINT "student_teaching_group_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_administrative_group_id_fkey" FOREIGN KEY ("administrative_group_id") REFERENCES "administrative_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_course_schedule" ADD CONSTRAINT "recurring_course_schedule_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_course_schedule" ADD CONSTRAINT "recurring_course_schedule_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_course_schedule" ADD CONSTRAINT "recurring_course_schedule_administrative_group_id_fkey" FOREIGN KEY ("administrative_group_id") REFERENCES "administrative_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_course_schedule" ADD CONSTRAINT "recurring_course_schedule_teaching_group_id_fkey" FOREIGN KEY ("teaching_group_id") REFERENCES "teaching_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_course_schedule" ADD CONSTRAINT "recurring_course_schedule_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_course_schedule" ADD CONSTRAINT "recurring_course_schedule_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_course_schedule" ADD CONSTRAINT "recurring_course_schedule_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_year"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_schedule_staff" ADD CONSTRAINT "course_schedule_staff_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "recurring_course_schedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_schedule_staff" ADD CONSTRAINT "course_schedule_staff_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "recurring_course_schedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_content" ADD CONSTRAINT "session_content_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_content" ADD CONSTRAINT "session_content_educational_content_id_fkey" FOREIGN KEY ("educational_content_id") REFERENCES "educational_content"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_administrative_group" ADD CONSTRAINT "event_administrative_group_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_administrative_group" ADD CONSTRAINT "event_administrative_group_administrative_group_id_fkey" FOREIGN KEY ("administrative_group_id") REFERENCES "administrative_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade" ADD CONSTRAINT "grade_administrative_group_id_fkey" FOREIGN KEY ("administrative_group_id") REFERENCES "administrative_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

