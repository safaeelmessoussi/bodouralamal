-- SRS Revision 155 (expand phase) — RecurringCourseSchedule's multi-dimension
-- targeting: branches, categories, levels, administrative groups and
-- teaching circles, mirroring §7's Event join tables exactly (R24's own
-- precedent: an explicit join per dimension, never a generic polymorphic
-- scope table).
--
-- ADDITIVE ONLY (TD-6b). The three legacy single-target arms
-- (`entire_level`/`administrative_group`/`teaching_group`) and their own
-- CHECK constraint (`course_schedule_mode_target_check`) are untouched —
-- nothing is dropped, nothing is renamed, no column is tightened. A new,
-- fourth `teaching_mode` value is added; a schedule using it leaves all
-- three legacy target columns NULL and resolves entirely through the five
-- join tables below. A single migration that both adds and drops is
-- prohibited by this project's own convention; the CHECK constraint's
-- extension for the new value is a SEPARATE, companion migration
-- (`..._r155_multi_dimension_schedule_constraints`), for the same reason
-- the ICU collations and composite FKs of R43's own constraints migration
-- were kept apart from its CREATE TABLE statements.

-- AlterEnum
ALTER TYPE "teaching_mode" ADD VALUE 'multi_dimension';

-- CreateTable
CREATE TABLE "course_schedule_branch" (
    "schedule_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,

    CONSTRAINT "course_schedule_branch_pkey" PRIMARY KEY ("schedule_id","branch_id")
);

-- CreateTable
CREATE TABLE "course_schedule_category" (
    "schedule_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,

    CONSTRAINT "course_schedule_category_pkey" PRIMARY KEY ("schedule_id","category_id")
);

-- CreateTable
CREATE TABLE "course_schedule_level" (
    "schedule_id" UUID NOT NULL,
    "level_id" UUID NOT NULL,

    CONSTRAINT "course_schedule_level_pkey" PRIMARY KEY ("schedule_id","level_id")
);

-- CreateTable
CREATE TABLE "course_schedule_administrative_group" (
    "id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,
    "administrative_group_id" UUID NOT NULL,

    CONSTRAINT "course_schedule_administrative_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_schedule_teaching_group" (
    "id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,
    "teaching_group_id" UUID NOT NULL,

    CONSTRAINT "course_schedule_teaching_group_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "course_schedule_administrative_group_schedule_id_administr_key" ON "course_schedule_administrative_group"("schedule_id", "administrative_group_id");

-- CreateIndex
CREATE INDEX "course_schedule_administrative_group_administrative_group__idx" ON "course_schedule_administrative_group"("administrative_group_id");

-- CreateIndex
CREATE UNIQUE INDEX "course_schedule_teaching_group_schedule_id_teaching_group__key" ON "course_schedule_teaching_group"("schedule_id", "teaching_group_id");

-- CreateIndex
CREATE INDEX "course_schedule_teaching_group_teaching_group_id_idx" ON "course_schedule_teaching_group"("teaching_group_id");

-- AddForeignKey
ALTER TABLE "course_schedule_branch" ADD CONSTRAINT "course_schedule_branch_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "recurring_course_schedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_schedule_branch" ADD CONSTRAINT "course_schedule_branch_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_schedule_category" ADD CONSTRAINT "course_schedule_category_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "recurring_course_schedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_schedule_category" ADD CONSTRAINT "course_schedule_category_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_schedule_level" ADD CONSTRAINT "course_schedule_level_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "recurring_course_schedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_schedule_level" ADD CONSTRAINT "course_schedule_level_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_schedule_administrative_group" ADD CONSTRAINT "course_schedule_administrative_group_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "recurring_course_schedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_schedule_administrative_group" ADD CONSTRAINT "course_schedule_administrative_group_administrative_group_fkey" FOREIGN KEY ("administrative_group_id") REFERENCES "administrative_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_schedule_teaching_group" ADD CONSTRAINT "course_schedule_teaching_group_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "recurring_course_schedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_schedule_teaching_group" ADD CONSTRAINT "course_schedule_teaching_group_teaching_group_id_fkey" FOREIGN KEY ("teaching_group_id") REFERENCES "teaching_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
