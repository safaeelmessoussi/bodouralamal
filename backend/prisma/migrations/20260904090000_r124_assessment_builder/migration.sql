-- A simple online assessment builder — the paper, its audience, and the answers
-- (Owner decision, 2026-09-04 — SRS Revision 124, proposed).
--
-- ## Nothing here is a new domain
--
-- `exam.mode = 'online'` has existed since R58 and was refused at the service
-- level with `ONLINE_NOT_AVAILABLE`, because — in that service's own words —
-- *"`physical` carries a place and staff and no questions; `online` will carry
-- questions and no place"*. This migration builds the half that was declared
-- and postponed. It creates **no** second assessment entity: a parallel model
-- would fork `grade`, which is keyed `(exam_id, student_id)` and already
-- carries the 20-point scale, the draft/published split, the sheet and the
-- student's results screen.
--
-- ## Why the two `jsonb` columns go
--
-- `exam.questions` and `student_exam_submission.answers` were blobs. Three
-- things the Owner requires cannot be expressed in one:
--
-- 1. **stable explicit ordering** — an array's index IS its order, so any edit
--    reorders by accident;
-- 2. **an answer that references the option it chose** — a blob can only name a
--    string, so rewording an option silently rewrites what a student said;
-- 3. **a database that refuses to delete an answered question** — `RESTRICT`,
--    rather than a rule a service has to remember on every path.
--
-- `student_exam_submission.answers` is empty on every row in every installation
-- (no submission endpoint ever existed). `exam.questions` holds sample data on
-- development databases only, from `prisma/seed/fixtures.ts`; the online
-- feature was refused, so **no member of staff has ever authored through the
-- platform**. Nothing is destroyed regardless: every non-empty value is
-- **snapshotted into `trash`** before the column is dropped, which is this
-- platform's own mechanism for exactly this, and the snapshot names the exam it
-- came from.
--
-- contract-phase: TD-6b — `exam.questions` and `student_exam_submission.answers`
-- are DROPPED, and `exam.is_published` with them. The expand/contract split
-- protects a running deployment from losing data between two releases; here
-- there is nothing to lose. `is_published` has **no application reader at all**
-- (verified by search, not assumed) and is replaced by `status`, which is
-- written from it in the statement above the drop. The two blobs are preserved
-- in `trash` first. Keeping any of the three would leave two columns answering
-- one question, with nothing keeping them in step.

-- ── Enums ────────────────────────────────────────────────────────────────────

CREATE TYPE "exam_status" AS ENUM ('draft', 'published', 'closed');
CREATE TYPE "exam_target" AS ENUM (
  'level', 'administrative_group', 'session', 'teaching_group', 'student'
);
CREATE TYPE "exam_question_kind" AS ENUM (
  'short_text', 'long_text', 'single_choice', 'multiple_choice'
);
CREATE TYPE "justification_rule" AS ENUM ('none', 'optional', 'required');

-- ── Exam: a lifecycle and a stored target ────────────────────────────────────

ALTER TABLE "exam" ADD COLUMN "status" "exam_status";
ALTER TABLE "exam" ADD COLUMN "closed_at" TIMESTAMPTZ(6);

-- **Every existing row is `published`, and that is the honest reading.** They
-- are physical sittings that were arranged, announced and in several cases
-- already graded; calling them drafts would hide them from the people they were
-- arranged for. `is_published` was never written by anything, so it cannot be
-- consulted for a better answer than this one.
UPDATE "exam" SET "status" = 'published'::"exam_status";
ALTER TABLE "exam" ALTER COLUMN "status" SET NOT NULL;
ALTER TABLE "exam" ALTER COLUMN "status" SET DEFAULT 'draft';
ALTER TABLE "exam" DROP COLUMN "is_published";

ALTER TABLE "exam"
  ADD COLUMN "target_kind" "exam_target" NOT NULL DEFAULT 'level',
  ADD COLUMN "session_id" UUID REFERENCES "session"("id") ON DELETE RESTRICT,
  ADD COLUMN "teaching_group_id" UUID REFERENCES "teaching_group"("id") ON DELETE RESTRICT,
  ADD COLUMN "student_id" UUID REFERENCES "user"("id") ON DELETE RESTRICT;

-- R58 stored the narrower sitting as a non-null `administrative_group_id` and
-- read NULL as *the whole Level*. That inference stops being decidable with
-- three more arms, so the existing rows are classified once, structurally.
UPDATE "exam"
   SET "target_kind" = 'administrative_group'::"exam_target"
 WHERE "administrative_group_id" IS NOT NULL;

-- **Exactly one target, and it matches the declared arm.** The same idiom
-- `course_schedule_mode_target_check` and `attendance_one_occurrence_check`
-- use: a mode without its target, or a target without its mode, is a row
-- nothing can resolve an audience for.
ALTER TABLE "exam"
  ADD CONSTRAINT "exam_target_check"
  CHECK (
    ("target_kind" = 'level' AND "administrative_group_id" IS NULL
      AND "session_id" IS NULL AND "teaching_group_id" IS NULL AND "student_id" IS NULL)
    OR ("target_kind" = 'administrative_group' AND "administrative_group_id" IS NOT NULL
      AND "session_id" IS NULL AND "teaching_group_id" IS NULL AND "student_id" IS NULL)
    OR ("target_kind" = 'session' AND "session_id" IS NOT NULL
      AND "administrative_group_id" IS NULL AND "teaching_group_id" IS NULL AND "student_id" IS NULL)
    OR ("target_kind" = 'teaching_group' AND "teaching_group_id" IS NOT NULL
      AND "administrative_group_id" IS NULL AND "session_id" IS NULL AND "student_id" IS NULL)
    OR ("target_kind" = 'student' AND "student_id" IS NOT NULL
      AND "administrative_group_id" IS NULL AND "session_id" IS NULL AND "teaching_group_id" IS NULL)
  );

CREATE INDEX "exam_session_id_idx" ON "exam" ("session_id");
CREATE INDEX "exam_teaching_group_id_idx" ON "exam" ("teaching_group_id");
CREATE INDEX "exam_student_id_idx" ON "exam" ("student_id");
CREATE INDEX "exam_status_idx" ON "exam" ("status");

-- ── The paper ────────────────────────────────────────────────────────────────

CREATE TABLE "exam_question" (
  "id"            UUID PRIMARY KEY,
  "exam_id"       UUID NOT NULL REFERENCES "exam"("id") ON DELETE RESTRICT,
  "display_order" INTEGER NOT NULL,
  "kind"          "exam_question_kind" NOT NULL,
  "prompt"        VARCHAR(1000) NOT NULL,
  "justification" "justification_rule" NOT NULL DEFAULT 'none',
  "version"       INTEGER NOT NULL DEFAULT 0,
  "created_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "deleted_at"    TIMESTAMPTZ(6),
  "deleted_by"    UUID
);

-- A text question IS its own justification; asking for a second one would ask
-- the same question twice.
ALTER TABLE "exam_question"
  ADD CONSTRAINT "exam_question_justification_check"
  CHECK ("kind" IN ('single_choice', 'multiple_choice') OR "justification" = 'none');

ALTER TABLE "exam_question"
  ADD CONSTRAINT "exam_question_prompt_not_blank_check"
  CHECK (btrim("prompt") <> '');

-- Two questions cannot claim one place. Partial, so a removed question frees
-- its position rather than blocking the one that takes it.
CREATE UNIQUE INDEX "exam_question_order_unique"
  ON "exam_question" ("exam_id", "display_order")
  WHERE "deleted_at" IS NULL;
CREATE INDEX "exam_question_exam_id_display_order_idx"
  ON "exam_question" ("exam_id", "display_order");

CREATE TABLE "exam_question_option" (
  "id"            UUID PRIMARY KEY,
  "question_id"   UUID NOT NULL REFERENCES "exam_question"("id") ON DELETE RESTRICT,
  "display_order" INTEGER NOT NULL,
  "label"         VARCHAR(500) NOT NULL,
  "created_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "deleted_at"    TIMESTAMPTZ(6),
  "deleted_by"    UUID
);

ALTER TABLE "exam_question_option"
  ADD CONSTRAINT "exam_question_option_label_not_blank_check"
  CHECK (btrim("label") <> '');

CREATE UNIQUE INDEX "exam_question_option_order_unique"
  ON "exam_question_option" ("question_id", "display_order")
  WHERE "deleted_at" IS NULL;
CREATE INDEX "exam_question_option_question_id_display_order_idx"
  ON "exam_question_option" ("question_id", "display_order");

-- ── The answers ──────────────────────────────────────────────────────────────

CREATE TABLE "student_exam_answer" (
  "id"            UUID PRIMARY KEY,
  "submission_id" UUID NOT NULL REFERENCES "student_exam_submission"("id") ON DELETE RESTRICT,
  "question_id"   UUID NOT NULL REFERENCES "exam_question"("id") ON DELETE RESTRICT,
  "text"          VARCHAR(5000),
  "justification" VARCHAR(2000),
  "created_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "student_exam_answer_submission_question_unique"
  ON "student_exam_answer" ("submission_id", "question_id");
CREATE INDEX "student_exam_answer_question_id_idx"
  ON "student_exam_answer" ("question_id");

CREATE TABLE "student_exam_answer_option" (
  "answer_id" UUID NOT NULL REFERENCES "student_exam_answer"("id") ON DELETE CASCADE,
  "option_id" UUID NOT NULL REFERENCES "exam_question_option"("id") ON DELETE RESTRICT,
  PRIMARY KEY ("answer_id", "option_id")
);

CREATE INDEX "student_exam_answer_option_option_id_idx"
  ON "student_exam_answer_option" ("option_id");

-- ── The two blobs, preserved and then dropped ────────────────────────────────
--
-- `deleted_by` is NULL: this is the platform removing a column, not a person
-- removing a row, and inventing an actor would be worse than admitting there
-- was none.

INSERT INTO "trash" ("id", "target_entity", "target_id", "snapshot", "deleted_by", "deleted_at", "purge_after")
SELECT gen_random_uuid(), 'Exam.questions', "id",
       jsonb_build_object('exam_id', "id", 'questions', "questions"),
       NULL, now(), now() + INTERVAL '90 days'
  FROM "exam"
 WHERE "questions" IS NOT NULL AND "questions"::text NOT IN ('[]', '{}', 'null');

INSERT INTO "trash" ("id", "target_entity", "target_id", "snapshot", "deleted_by", "deleted_at", "purge_after")
SELECT gen_random_uuid(), 'StudentExamSubmission.answers', "id",
       jsonb_build_object('submission_id', "id", 'answers', "answers"),
       NULL, now(), now() + INTERVAL '90 days'
  FROM "student_exam_submission"
 WHERE "answers" IS NOT NULL AND "answers"::text NOT IN ('[]', '{}', 'null');

ALTER TABLE "exam" DROP COLUMN "questions";
ALTER TABLE "student_exam_submission" DROP COLUMN "answers";
