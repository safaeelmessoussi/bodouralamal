-- بذور الأمل — initial schema (SRS §7) + PostgreSQL-specific elements (TD-6a).
--
-- TD-6a workflow: generated with `prisma migrate dev --create-only`, then the
-- hand-written SQL below was added before applying. `prisma db push` is
-- prohibited in every environment — it bypasses this history entirely.
--
-- The ar-x-icu collation is registered FIRST, before any column references it,
-- so the migration history is self-contained and portable across PostgreSQL
-- images rather than relying on the collation being predefined (TD-6a step 2).

CREATE COLLATION IF NOT EXISTS "ar-x-icu" (provider = icu, locale = 'ar', deterministic = true);

-- CreateEnum
CREATE TYPE "account_status" AS ENUM ('pending', 'active', 'rejected', 'suspended');

-- CreateEnum
CREATE TYPE "user_branch_status" AS ENUM ('active', 'left', 'paused');

-- CreateEnum
CREATE TYPE "auth_provider" AS ENUM ('google');

-- CreateEnum
CREATE TYPE "gender_restriction" AS ENUM ('any', 'girls_only', 'boys_only');

-- CreateEnum
CREATE TYPE "day_of_week" AS ENUM ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday');

-- CreateEnum
CREATE TYPE "family_link_status" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "consent_type" AS ENUM ('media_release', 'data_processing');

-- CreateEnum
CREATE TYPE "consent_method" AS ENUM ('online_form', 'staff_recorded');

-- CreateEnum
CREATE TYPE "visibility" AS ENUM ('public', 'private', 'hidden');

-- CreateEnum
CREATE TYPE "recurrence_type" AS ENUM ('none', 'daily', 'weekly', 'biweekly_alternating', 'yearly');

-- CreateEnum
CREATE TYPE "quran_log_category" AS ENUM ('new_memorization', 'revision');

-- CreateEnum
CREATE TYPE "exam_access_policy" AS ENUM ('single_submission', 'save_and_resume');

-- CreateEnum
CREATE TYPE "submission_state" AS ENUM ('in_progress', 'submitted', 'auto_graded', 'fully_graded');

-- CreateEnum
CREATE TYPE "grade_status" AS ENUM ('draft', 'published');

-- CreateEnum
CREATE TYPE "consumed_token_purpose" AS ENUM ('onboarding');

-- CreateTable
CREATE TABLE "user" (
    "id" UUID NOT NULL,
    "account_status" "account_status" NOT NULL DEFAULT 'pending',
    "name_arabic" VARCHAR(120) NOT NULL,
    "name_french" VARCHAR(120),
    "nickname" VARCHAR(60),
    "phone" VARCHAR(20),
    "notes" VARCHAR(2000),
    "name_arabic_normalized" TEXT,
    "name_french_normalized" TEXT,
    "nickname_normalized" TEXT,
    "phone_normalized" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" UUID,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_identity" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" "auth_provider" NOT NULL,
    "provider_subject_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_identity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_branch_role" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "branch_id" UUID,
    "user_status" "user_branch_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" UUID,

    CONSTRAINT "user_branch_role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "operational_start_date" DATE,
    "display_order" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" UUID,

    CONSTRAINT "branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "branch_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" UUID,

    CONSTRAINT "room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "display_order" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" UUID,

    CONSTRAINT "category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "level" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "category_id" UUID NOT NULL,
    "gender_restriction" "gender_restriction" NOT NULL DEFAULT 'any',
    "display_order" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" UUID,

    CONSTRAINT "level_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subject" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "display_order" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" UUID,

    CONSTRAINT "subject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "level_subject" (
    "id" UUID NOT NULL,
    "level_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" UUID,

    CONSTRAINT "level_subject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "level_surah" (
    "id" UUID NOT NULL,
    "level_id" UUID NOT NULL,
    "surah_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" UUID,

    CONSTRAINT "level_surah_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "level_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "room_id" UUID,
    "day_of_week" "day_of_week" NOT NULL,
    "start_time" TIME(0) NOT NULL,
    "end_time" TIME(0) NOT NULL,
    "max_students" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" UUID,

    CONSTRAINT "group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_teacher" (
    "id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" UUID,

    CONSTRAINT "group_teacher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_group" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "enrolled_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" UUID,

    CONSTRAINT "student_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "family_link" (
    "id" UUID NOT NULL,
    "parent_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "status" "family_link_status" NOT NULL DEFAULT 'pending',
    "decided_at" TIMESTAMPTZ(6),
    "decided_by" UUID,
    "decision_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" UUID,

    CONSTRAINT "family_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_record" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "consent_type" "consent_type" NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "method" "consent_method" NOT NULL,
    "consent_text_version" VARCHAR(60) NOT NULL,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "granted_by_user_id" UUID NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by_user_id" UUID,

    CONSTRAINT "consent_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consumed_token" (
    "id" UUID NOT NULL,
    "jti" TEXT NOT NULL,
    "purpose" "consumed_token_purpose" NOT NULL,
    "consumed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "consumed_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_social_profile" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "health_condition" VARCHAR(2000),
    "family_situation" VARCHAR(2000),
    "home_address" VARCHAR(2000),
    "siblings_count" INTEGER,
    "father_name" VARCHAR(120),
    "father_profession" VARCHAR(120),
    "mother_name" VARCHAR(120),
    "mother_profession" VARCHAR(120),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" UUID,

    CONSTRAINT "student_social_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event" (
    "id" UUID NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "description" VARCHAR(2000),
    "visibility" "visibility" NOT NULL DEFAULT 'private',
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "start_time" TIME(0),
    "end_time" TIME(0),
    "recurrence_type" "recurrence_type" NOT NULL DEFAULT 'none',
    "recurrence_end_date" DATE,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" UUID,

    CONSTRAINT "event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_branch" (
    "event_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,

    CONSTRAINT "event_branch_pkey" PRIMARY KEY ("event_id","branch_id")
);

-- CreateTable
CREATE TABLE "event_category" (
    "event_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,

    CONSTRAINT "event_category_pkey" PRIMARY KEY ("event_id","category_id")
);

-- CreateTable
CREATE TABLE "event_level" (
    "event_id" UUID NOT NULL,
    "level_id" UUID NOT NULL,

    CONSTRAINT "event_level_pkey" PRIMARY KEY ("event_id","level_id")
);

-- CreateTable
CREATE TABLE "event_group" (
    "event_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,

    CONSTRAINT "event_group_pkey" PRIMARY KEY ("event_id","group_id")
);

-- CreateTable
CREATE TABLE "quran_surah" (
    "surah_id" INTEGER NOT NULL,
    "name_arabic" VARCHAR(120) NOT NULL,
    "name_transliterated" VARCHAR(120) NOT NULL,
    "total_ayahs" INTEGER NOT NULL,

    CONSTRAINT "quran_surah_pkey" PRIMARY KEY ("surah_id")
);

-- CreateTable
CREATE TABLE "quran_progress_log" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "surah_id" INTEGER NOT NULL,
    "start_ayah" INTEGER NOT NULL,
    "end_ayah" INTEGER NOT NULL,
    "category" "quran_log_category" NOT NULL,
    "logged_by" UUID NOT NULL,
    "logged_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" UUID,

    CONSTRAINT "quran_progress_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_surah_progress" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "surah_id" INTEGER NOT NULL,
    "merged_ayah_count" INTEGER NOT NULL,
    "coverage_percent" DECIMAL(5,2) NOT NULL,
    "merged_intervals" JSONB NOT NULL,
    "last_log_id" UUID,
    "last_log_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "student_surah_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam" (
    "id" UUID NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "level_id" UUID NOT NULL,
    "subject_id" UUID,
    "surah_id" INTEGER,
    "date" DATE NOT NULL,
    "round" INTEGER,
    "access_policy" "exam_access_policy" NOT NULL DEFAULT 'save_and_resume',
    "questions" JSONB NOT NULL,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" UUID,

    CONSTRAINT "exam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_exam_submission" (
    "id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "answers" JSONB NOT NULL,
    "state" "submission_state" NOT NULL DEFAULT 'in_progress',
    "auto_score_bp" INTEGER,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "student_exam_submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade" (
    "id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "group_id" UUID,
    "value_bp" INTEGER NOT NULL,
    "status" "grade_status" NOT NULL DEFAULT 'draft',
    "absent" BOOLEAN NOT NULL DEFAULT false,
    "manual_pass_fail_override" BOOLEAN,
    "override_by" UUID,
    "override_at" TIMESTAMPTZ(6),
    "override_reason" VARCHAR(500),
    "version" INTEGER NOT NULL DEFAULT 0,
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "grade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academic_year" (
    "id" UUID NOT NULL,
    "label" VARCHAR(9) NOT NULL,
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "academic_year_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "educational_content" (
    "id" UUID NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "description" VARCHAR(2000),
    "visibility" "visibility" NOT NULL DEFAULT 'private',
    "consent_forced_private" BOOLEAN NOT NULL DEFAULT false,
    "level_id" UUID NOT NULL,
    "branch_id" UUID,
    "subject_id" UUID,
    "event_id" UUID,
    "academic_year_id" UUID NOT NULL,
    "storage_bucket" VARCHAR(20) NOT NULL,
    "storage_key" TEXT NOT NULL,
    "original_filename" TEXT NOT NULL,
    "mime_type" VARCHAR(120) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" UUID,

    CONSTRAINT "educational_content_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID,
    "action_type" VARCHAR(60) NOT NULL,
    "target_entity" VARCHAR(60),
    "target_id" UUID,
    "detail" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trash" (
    "id" UUID NOT NULL,
    "target_entity" VARCHAR(60) NOT NULL,
    "target_id" UUID NOT NULL,
    "snapshot" JSONB NOT NULL,
    "deleted_by" UUID,
    "deleted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purge_after" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "trash_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_setting" (
    "key" VARCHAR(80) NOT NULL,
    "value" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "system_setting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "user_account_status_idx" ON "user"("account_status");

-- CreateIndex
CREATE INDEX "user_deleted_at_idx" ON "user"("deleted_at");

-- CreateIndex
CREATE INDEX "user_identity_email_idx" ON "user_identity"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_identity_provider_provider_subject_id_key" ON "user_identity"("provider", "provider_subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "role_name_key" ON "role"("name");

-- CreateIndex
CREATE INDEX "user_branch_role_user_id_idx" ON "user_branch_role"("user_id");

-- CreateIndex
CREATE INDEX "user_branch_role_branch_id_idx" ON "user_branch_role"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_branch_role_user_id_role_id_branch_id_key" ON "user_branch_role"("user_id", "role_id", "branch_id");

-- CreateIndex
CREATE INDEX "branch_display_order_idx" ON "branch"("display_order");

-- CreateIndex
CREATE INDEX "room_branch_id_idx" ON "room"("branch_id");

-- CreateIndex
CREATE INDEX "category_display_order_idx" ON "category"("display_order");

-- CreateIndex
CREATE INDEX "level_category_id_display_order_idx" ON "level"("category_id", "display_order");

-- CreateIndex
CREATE INDEX "subject_display_order_idx" ON "subject"("display_order");

-- CreateIndex
CREATE UNIQUE INDEX "level_subject_level_id_subject_id_key" ON "level_subject"("level_id", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "level_surah_level_id_surah_id_key" ON "level_surah"("level_id", "surah_id");

-- CreateIndex
CREATE INDEX "group_branch_id_day_of_week_idx" ON "group"("branch_id", "day_of_week");

-- CreateIndex
CREATE INDEX "group_level_id_idx" ON "group"("level_id");

-- CreateIndex
CREATE INDEX "group_room_id_day_of_week_idx" ON "group"("room_id", "day_of_week");

-- CreateIndex
CREATE INDEX "group_teacher_teacher_id_idx" ON "group_teacher"("teacher_id");

-- CreateIndex
CREATE UNIQUE INDEX "group_teacher_group_id_teacher_id_key" ON "group_teacher"("group_id", "teacher_id");

-- CreateIndex
CREATE INDEX "student_group_group_id_deleted_at_idx" ON "student_group"("group_id", "deleted_at");

-- CreateIndex
CREATE INDEX "student_group_student_id_idx" ON "student_group"("student_id");

-- CreateIndex
CREATE INDEX "family_link_parent_id_status_idx" ON "family_link"("parent_id", "status");

-- CreateIndex
CREATE INDEX "family_link_student_id_status_idx" ON "family_link"("student_id", "status");

-- CreateIndex
CREATE INDEX "consent_record_student_id_consent_type_granted_at_idx" ON "consent_record"("student_id", "consent_type", "granted_at");

-- CreateIndex
CREATE UNIQUE INDEX "consumed_token_jti_key" ON "consumed_token"("jti");

-- CreateIndex
CREATE INDEX "consumed_token_expires_at_idx" ON "consumed_token"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "student_social_profile_student_id_key" ON "student_social_profile"("student_id");

-- CreateIndex
CREATE INDEX "event_start_date_visibility_idx" ON "event"("start_date", "visibility");

-- CreateIndex
CREATE INDEX "quran_progress_log_student_id_surah_id_idx" ON "quran_progress_log"("student_id", "surah_id");

-- CreateIndex
CREATE INDEX "quran_progress_log_student_id_surah_id_deleted_at_idx" ON "quran_progress_log"("student_id", "surah_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "student_surah_progress_student_id_surah_id_key" ON "student_surah_progress"("student_id", "surah_id");

-- CreateIndex
CREATE INDEX "exam_level_id_date_idx" ON "exam"("level_id", "date");

-- CreateIndex
CREATE INDEX "student_exam_submission_student_id_idx" ON "student_exam_submission"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_exam_submission_exam_id_student_id_key" ON "student_exam_submission"("exam_id", "student_id");

-- CreateIndex
CREATE INDEX "grade_student_id_status_idx" ON "grade"("student_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "grade_exam_id_student_id_key" ON "grade"("exam_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "academic_year_label_key" ON "academic_year"("label");

-- CreateIndex
CREATE UNIQUE INDEX "educational_content_storage_key_key" ON "educational_content"("storage_key");

-- CreateIndex
CREATE INDEX "educational_content_level_id_academic_year_id_branch_id_idx" ON "educational_content"("level_id", "academic_year_id", "branch_id");

-- CreateIndex
CREATE INDEX "educational_content_visibility_idx" ON "educational_content"("visibility");

-- CreateIndex
CREATE INDEX "audit_log_action_type_created_at_idx" ON "audit_log"("action_type", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_target_entity_target_id_idx" ON "audit_log"("target_entity", "target_id");

-- CreateIndex
CREATE INDEX "audit_log_actor_user_id_created_at_idx" ON "audit_log"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "trash_target_entity_target_id_idx" ON "trash"("target_entity", "target_id");

-- CreateIndex
CREATE INDEX "trash_purge_after_idx" ON "trash"("purge_after");

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_identity" ADD CONSTRAINT "user_identity_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branch_role" ADD CONSTRAINT "user_branch_role_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branch_role" ADD CONSTRAINT "user_branch_role_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branch_role" ADD CONSTRAINT "user_branch_role_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room" ADD CONSTRAINT "room_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "level" ADD CONSTRAINT "level_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "level_subject" ADD CONSTRAINT "level_subject_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "level_subject" ADD CONSTRAINT "level_subject_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "level_surah" ADD CONSTRAINT "level_surah_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "level_surah" ADD CONSTRAINT "level_surah_surah_id_fkey" FOREIGN KEY ("surah_id") REFERENCES "quran_surah"("surah_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group" ADD CONSTRAINT "group_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group" ADD CONSTRAINT "group_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group" ADD CONSTRAINT "group_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_teacher" ADD CONSTRAINT "group_teacher_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_teacher" ADD CONSTRAINT "group_teacher_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_group" ADD CONSTRAINT "student_group_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_group" ADD CONSTRAINT "student_group_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_link" ADD CONSTRAINT "family_link_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_link" ADD CONSTRAINT "family_link_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_record" ADD CONSTRAINT "consent_record_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_record" ADD CONSTRAINT "consent_record_granted_by_user_id_fkey" FOREIGN KEY ("granted_by_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_record" ADD CONSTRAINT "consent_record_revoked_by_user_id_fkey" FOREIGN KEY ("revoked_by_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_social_profile" ADD CONSTRAINT "student_social_profile_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_branch" ADD CONSTRAINT "event_branch_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_branch" ADD CONSTRAINT "event_branch_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_category" ADD CONSTRAINT "event_category_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_category" ADD CONSTRAINT "event_category_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_level" ADD CONSTRAINT "event_level_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_level" ADD CONSTRAINT "event_level_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_group" ADD CONSTRAINT "event_group_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_group" ADD CONSTRAINT "event_group_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quran_progress_log" ADD CONSTRAINT "quran_progress_log_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quran_progress_log" ADD CONSTRAINT "quran_progress_log_surah_id_fkey" FOREIGN KEY ("surah_id") REFERENCES "quran_surah"("surah_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quran_progress_log" ADD CONSTRAINT "quran_progress_log_logged_by_fkey" FOREIGN KEY ("logged_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_surah_progress" ADD CONSTRAINT "student_surah_progress_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_surah_progress" ADD CONSTRAINT "student_surah_progress_surah_id_fkey" FOREIGN KEY ("surah_id") REFERENCES "quran_surah"("surah_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam" ADD CONSTRAINT "exam_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam" ADD CONSTRAINT "exam_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam" ADD CONSTRAINT "exam_surah_id_fkey" FOREIGN KEY ("surah_id") REFERENCES "quran_surah"("surah_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_exam_submission" ADD CONSTRAINT "student_exam_submission_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_exam_submission" ADD CONSTRAINT "student_exam_submission_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade" ADD CONSTRAINT "grade_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade" ADD CONSTRAINT "grade_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade" ADD CONSTRAINT "grade_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "educational_content" ADD CONSTRAINT "educational_content_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "educational_content" ADD CONSTRAINT "educational_content_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "educational_content" ADD CONSTRAINT "educational_content_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "educational_content" ADD CONSTRAINT "educational_content_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "educational_content" ADD CONSTRAINT "educational_content_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_year"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trash" ADD CONSTRAINT "trash_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ###########################################################################
-- HAND-WRITTEN SQL (SRS TD-6a, §20 rule 5)
--
-- Everything below is PostgreSQL-specific and CANNOT be declared in
-- schema.prisma: Prisma either fails to compile it or silently drops it. An
-- implementation that omits these because "Prisma didn't generate them" is
-- non-compliant (§7 migration note). The `CREATE COLLATION` registration is at
-- the TOP of this file, before any column references it.
-- ###########################################################################

-- ---------------------------------------------------------------------------
-- 1. Native ar-x-icu collation on the structural `name` columns (§2.2, TD-6)
--
-- Default C/en_US collation sorts Arabic by codepoint and produces orderings
-- that look wrong to every user (BR-19). Collating the column itself means
-- every ORDER BY is correct WITHOUT per-query COLLATE clauses — TD-10 forbids
-- those workarounds outright.
--
-- Deviation from TD-6a's illustrative `TYPE text`: the columns keep
-- varchar(120), preserving the TD-9 length cap at the database level. This is
-- strictly more constrained than the example, never less.
-- ---------------------------------------------------------------------------
ALTER TABLE "branch"   ALTER COLUMN "name" TYPE varchar(120) COLLATE "ar-x-icu";
ALTER TABLE "category" ALTER COLUMN "name" TYPE varchar(120) COLLATE "ar-x-icu";
ALTER TABLE "level"    ALTER COLUMN "name" TYPE varchar(120) COLLATE "ar-x-icu";
ALTER TABLE "subject"  ALTER COLUMN "name" TYPE varchar(120) COLLATE "ar-x-icu";

-- Sortable person-name columns (TD-6). `name_french` is deliberately excluded:
-- it holds Latin text, where an Arabic-locale collation would be meaningless.
ALTER TABLE "user" ALTER COLUMN "name_arabic" TYPE varchar(120) COLLATE "ar-x-icu";
ALTER TABLE "user" ALTER COLUMN "nickname"    TYPE varchar(60)  COLLATE "ar-x-icu";

-- ---------------------------------------------------------------------------
-- 2. CHECK constraints (TD-6)
-- ---------------------------------------------------------------------------

-- display_order >= 0 on every structural entity.
ALTER TABLE "branch"   ADD CONSTRAINT "branch_display_order_check"   CHECK ("display_order" IS NULL OR "display_order" >= 0);
ALTER TABLE "category" ADD CONSTRAINT "category_display_order_check" CHECK ("display_order" IS NULL OR "display_order" >= 0);
ALTER TABLE "level"    ADD CONSTRAINT "level_display_order_check"    CHECK ("display_order" IS NULL OR "display_order" >= 0);
ALTER TABLE "subject"  ADD CONSTRAINT "subject_display_order_check"  CHECK ("display_order" IS NULL OR "display_order" >= 0);

-- Group capacity and wall-clock ordering.
ALTER TABLE "group" ADD CONSTRAINT "group_max_students_check" CHECK ("max_students" > 0);
ALTER TABLE "group" ADD CONSTRAINT "group_time_order_check"   CHECK ("start_time" < "end_time");

-- Quran log ayah range. The upper bound against total_ayahs crosses tables and
-- is enforced by the trigger in section 5 plus the service layer (TD-6).
ALTER TABLE "quran_progress_log"
  ADD CONSTRAINT "quran_progress_log_ayah_range_check"
  CHECK ("start_ayah" >= 1 AND "start_ayah" <= "end_ayah");

-- All stored scores are integer basis points, 0–10,000 (§4.6, §20 rule 3).
-- There is no float score column anywhere in the schema for these to guard.
ALTER TABLE "grade"
  ADD CONSTRAINT "grade_value_bp_range_check"
  CHECK ("value_bp" >= 0 AND "value_bp" <= 10000);
ALTER TABLE "student_exam_submission"
  ADD CONSTRAINT "student_exam_submission_auto_score_bp_range_check"
  CHECK ("auto_score_bp" IS NULL OR ("auto_score_bp" >= 0 AND "auto_score_bp" <= 10000));

-- AcademicYear label is strictly YYYY-YYYY; free-text years are prohibited
-- (§4.10). "second year = first + 1" is service-enforced (TD-6).
ALTER TABLE "academic_year"
  ADD CONSTRAINT "academic_year_label_format_check"
  CHECK ("label" ~ '^[0-9]{4}-[0-9]{4}$');

-- The database refuses mixed-case email storage outright, so a single
-- unlowered code path can never create a case-variant duplicate that bypasses
-- the unique index. Application lowercasing (TD-12) remains the normal path;
-- this is the backstop (TD-6, Revision 10).
ALTER TABLE "user_identity"
  ADD CONSTRAINT "user_identity_email_lowercase_check"
  CHECK ("email" = lower("email"));

-- Hijri day offset constrained to −2…+2 (§4.4, TD-6). SystemSetting is a
-- key/value table, so the constraint is scoped to that one key.
ALTER TABLE "system_setting"
  ADD CONSTRAINT "system_setting_hijri_offset_range_check"
  CHECK (
    "key" <> 'hijri.day_offset'
    OR (jsonb_typeof("value") = 'number' AND ("value" #>> '{}')::numeric BETWEEN -2 AND 2)
  );

-- Static Surah lookup sanity: exactly the 114 canonical surahs (§4.5).
ALTER TABLE "quran_surah"
  ADD CONSTRAINT "quran_surah_id_range_check" CHECK ("surah_id" >= 1 AND "surah_id" <= 114);
ALTER TABLE "quran_surah"
  ADD CONSTRAINT "quran_surah_total_ayahs_check" CHECK ("total_ayahs" > 0);

-- Coverage cache bounds (§4.5).
ALTER TABLE "student_surah_progress"
  ADD CONSTRAINT "student_surah_progress_coverage_range_check"
  CHECK ("coverage_percent" >= 0 AND "coverage_percent" <= 100);
ALTER TABLE "student_surah_progress"
  ADD CONSTRAINT "student_surah_progress_merged_count_check"
  CHECK ("merged_ayah_count" >= 0);

-- ---------------------------------------------------------------------------
-- 3. Partial unique indexes (TD-6)
--
-- Prisma's @@unique cannot carry a WHERE clause. Without the predicate, a
-- soft-deleted row would permanently block re-creating the same pair — e.g. a
-- family link that was rejected and deleted could never be requested again.
-- ---------------------------------------------------------------------------

-- FamilyLink unique among non-deleted rows.
CREATE UNIQUE INDEX "family_link_student_parent_active_key"
  ON "family_link" ("student_id", "parent_id")
  WHERE "deleted_at" IS NULL;

-- Enrollment unique among non-deleted rows.
CREATE UNIQUE INDEX "student_group_student_group_active_key"
  ON "student_group" ("student_id", "group_id")
  WHERE "deleted_at" IS NULL;

-- (provider, email) unique among ACTIVE identities. Combined with the
-- lowercase CHECK above, uniqueness is effectively case-insensitive (TD-6).
CREATE UNIQUE INDEX "user_identity_provider_email_active_key"
  ON "user_identity" ("provider", "email")
  WHERE "is_active";

-- Exactly one current academic year application-wide (TD-6).
CREATE UNIQUE INDEX "academic_year_single_current_key"
  ON "academic_year" (("is_current"))
  WHERE "is_current";

-- ---------------------------------------------------------------------------
-- 4. TD-10 search normalization
--
-- Normalization is applied identically to the stored value and the query, and
-- NEVER per-row at query time. The shadow columns are maintained by a trigger
-- rather than declared GENERATED ALWAYS: a generated column cannot be created
-- through Prisma, and dropping/recreating Prisma's columns would trip the
-- TD-6b DROP lint for no benefit. Trigger maintenance keeps the columns
-- readable by the Prisma client, so repositories can query them with ordinary
-- ILIKE instead of raw SQL — §16.2 permits raw SQL only for row locks and
-- pg-boss inserts.
--
-- Rules (TD-10): Arabic — strip tashkeel/tatweel, أإآٱ→ا, ة→ه, ى→ي;
-- Latin — lowercase and fold accents; phone — strip spaces and '+'.
-- No fuzzy matching, no trigram similarity, no search engine in MVP.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "normalize_search_text"(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT btrim(regexp_replace(
    translate(
      -- Strip Arabic diacritics (tashkeel U+064B–U+0652, superscript alef
      -- U+0670) and tatweel (U+0640) before any letter folding.
      regexp_replace(lower(input), '[ً-ْٰـ]', '', 'g'),
      -- Arabic letter folding, then French accent folding.
      'أإآٱةىéèêëàâäîïôöûüùç',
      'ااااهيeeeeaaaiioouuuc'
    ),
    '\s+', ' ', 'g'));
$$;

CREATE OR REPLACE FUNCTION "normalize_phone"(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT regexp_replace(input, '[\s+]', '', 'g');
$$;

CREATE OR REPLACE FUNCTION "user_search_shadow_sync"() RETURNS trigger AS $$
BEGIN
  NEW."name_arabic_normalized" := "normalize_search_text"(NEW."name_arabic");
  NEW."name_french_normalized" := "normalize_search_text"(NEW."name_french");
  NEW."nickname_normalized"    := "normalize_search_text"(NEW."nickname");
  NEW."phone_normalized"       := "normalize_phone"(NEW."phone");
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "user_search_shadow_sync_trigger"
  BEFORE INSERT OR UPDATE OF "name_arabic", "name_french", "nickname", "phone"
  ON "user"
  FOR EACH ROW EXECUTE FUNCTION "user_search_shadow_sync"();

-- Indexed for substring matching (TD-10: ILIKE '%…%' against the shadow).
-- text_pattern_ops does not help leading wildcards, so these are plain btree
-- indexes supporting equality/prefix; substring scans remain index-assisted
-- only for the prefix case, which is the documented MVP trade-off (no trigram
-- extension, no fuzzy matching).
CREATE INDEX "user_name_arabic_normalized_idx" ON "user" ("name_arabic_normalized");
CREATE INDEX "user_name_french_normalized_idx" ON "user" ("name_french_normalized");
CREATE INDEX "user_nickname_normalized_idx"    ON "user" ("nickname_normalized");
CREATE INDEX "user_phone_normalized_idx"       ON "user" ("phone_normalized");

-- ---------------------------------------------------------------------------
-- 5. Cross-table ayah-bounds trigger (TD-6)
--
-- end_ayah must not exceed the surah's total_ayahs. This crosses tables, so a
-- CHECK constraint cannot express it. The service layer validates too; this is
-- the backstop that no code path can bypass.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "quran_log_ayah_bounds_check"() RETURNS trigger AS $$
DECLARE
  surah_total int;
BEGIN
  SELECT "total_ayahs" INTO surah_total
    FROM "quran_surah" WHERE "surah_id" = NEW."surah_id";

  IF surah_total IS NULL THEN
    RAISE EXCEPTION 'unknown surah_id %', NEW."surah_id"
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NEW."end_ayah" > surah_total THEN
    RAISE EXCEPTION 'end_ayah % exceeds total_ayahs % for surah %',
      NEW."end_ayah", surah_total, NEW."surah_id"
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "quran_progress_log_ayah_bounds_trigger"
  BEFORE INSERT OR UPDATE OF "surah_id", "end_ayah"
  ON "quran_progress_log"
  FOR EACH ROW EXECUTE FUNCTION "quran_log_ayah_bounds_check"();
