-- Attendance — presence recorded against the occurrence that actually happened
-- (Owner decision, 2026-09-03 — SRS Revision 123).
--
-- ## What the association does today, and what this reproduces
--
-- A paper sheet per class or activity: a column of names and a mark beside the
-- ones who came. Two different sheets exist. A **register** opens with the
-- enrolled names already written on it; a **blank list** starts empty and names
-- are added as people arrive. Both are reproduced here, and the difference
-- between them is the scheduling type's `attendance_mode`.
--
-- ## Why `attendance_required` becomes an enum
--
-- The boolean collapsed two questions the Owner states separately: *may
-- presence be recorded at all* and *are people expected to be there*. A عطلة
-- and an optional نشاط are both "not required", and a boolean cannot tell them
-- apart — which is how a vacation would have acquired an attendance sheet.
--
-- ## The classification of existing rows, stated exactly
--
-- * `holiday` -> `disabled`. **Structural**: the kind is the fact, no name is
--   consulted. عطلة has no staff, no room and no attendance by R110's own
--   definition of the kind.
-- * everything else: `true` -> `required`, `false` -> `optional`.
-- * the seeded **حفل** row -> `disabled`. This is the ONE place a name is read,
--   and it is read once, here, about a row the §15.1 seed itself created by
--   name — not by any runtime rule (§4.4b forbids that, and nothing in the
--   application matches on it). A party the Owner excluded has no structural
--   marker distinguishing it from نشاط; giving it one would be inventing a
--   taxonomy nobody asked for when a Super Admin can change this row on
--   أنواع الجدولة in one click. Guarded to `structural_kind = 'activity'`, so a
--   renamed or re-purposed row is left alone.
--
-- Same reasoning for `category.self_attendance_allowed`: seeded المرأة is set
-- `TRUE`, every other Category keeps the safe default `FALSE`. A minor must
-- never self-mark, and before this column the platform had no machine-readable
-- way to say which Categories are adults — §4.4b forbids matching the name at
-- runtime and R62.7 forbids `schooling_stage` gating anything.
--
-- contract-phase: TD-6b — `scheduling_type.attendance_required` is DROPPED in
-- the same migration that adds `attendance_mode`, because the new column is a
-- strict superset of the old one and is written from it in the statement above
-- the drop. The expand/contract split exists to protect a running deployment
-- from losing data between two releases; here nothing is lost — every boolean
-- value is representable, the mapping is total, and the column has exactly one
-- reader (the أنواع الجدولة screen) which ships in the same commit. Leaving the
-- boolean behind would be the real hazard: two columns answering one question,
-- with nothing keeping them in step.

-- ── The two enums ────────────────────────────────────────────────────────────

CREATE TYPE "attendance_mode" AS ENUM ('disabled', 'optional', 'required');
CREATE TYPE "attendance_marking" AS ENUM ('staff_only', 'self_or_staff');

-- ── SchedulingType: the boolean becomes the three-state answer ────────────────

ALTER TABLE "scheduling_type" ADD COLUMN "attendance_mode" "attendance_mode";

UPDATE "scheduling_type"
   SET "attendance_mode" = CASE
     WHEN "structural_kind" = 'holiday' THEN 'disabled'::"attendance_mode"
     WHEN "attendance_required"          THEN 'required'::"attendance_mode"
     ELSE 'optional'::"attendance_mode"
   END;

-- The one name read, once, about a seeded row. See the header.
UPDATE "scheduling_type"
   SET "attendance_mode" = 'disabled'::"attendance_mode"
 WHERE "structural_kind" = 'activity' AND "name" = 'حفل';

ALTER TABLE "scheduling_type" ALTER COLUMN "attendance_mode" SET NOT NULL;
ALTER TABLE "scheduling_type" DROP COLUMN "attendance_required";

-- ── Category: which populations may record their own presence ─────────────────

ALTER TABLE "category"
  ADD COLUMN "self_attendance_allowed" BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE "category" SET "self_attendance_allowed" = TRUE WHERE "name" = 'المرأة';

-- ── Who may mark, on the two occurrence carriers that have a standing one ─────
--
-- `exam` gets no column: a sitting is invigilated, and self-marking an exam is
-- not a workflow the association has. Adding a column for it would be offering
-- a configuration whose only correct value is the default.

ALTER TABLE "recurring_course_schedule"
  ADD COLUMN "attendance_marking" "attendance_marking" NOT NULL DEFAULT 'staff_only';
ALTER TABLE "event"
  ADD COLUMN "attendance_marking" "attendance_marking" NOT NULL DEFAULT 'staff_only';

-- ── The presence record itself ────────────────────────────────────────────────

CREATE TABLE "attendance" (
  "id"              UUID PRIMARY KEY,
  "session_id"      UUID REFERENCES "session"("id")  ON DELETE RESTRICT,
  "event_id"        UUID REFERENCES "event"("id")    ON DELETE RESTRICT,
  "exam_id"         UUID REFERENCES "exam"("id")     ON DELETE RESTRICT,
  "occurrence_date" DATE        NOT NULL,
  "student_id"      UUID        NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
  "marked_by"       UUID        NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
  "recorded_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "deleted_at"      TIMESTAMPTZ(6),
  "deleted_by"      UUID
);

-- Exactly one occurrence, the same idiom `notification` uses for its four
-- targets. A row naming none would be presence at nothing; a row naming two
-- would be presence at two places at once.
ALTER TABLE "attendance"
  ADD CONSTRAINT "attendance_one_occurrence_check"
  CHECK (
    (("session_id" IS NOT NULL)::int
   + ("event_id"   IS NOT NULL)::int
   + ("exam_id"    IS NOT NULL)::int) = 1
  );

-- **Idempotency, in the database.** «I am present» sent twice must leave one
-- row — §7 of the Owner's brief — and the service's check-then-insert is not
-- enough under a double-tap. `NULLS NOT DISTINCT` is what makes this work with
-- two of the three occurrence columns null: without it PostgreSQL treats every
-- NULL as unique and the index would permit unlimited duplicates.
CREATE UNIQUE INDEX "attendance_occurrence_student_unique"
  ON "attendance" ("session_id", "event_id", "exam_id", "occurrence_date", "student_id")
  NULLS NOT DISTINCT
  WHERE "deleted_at" IS NULL;

CREATE INDEX "attendance_session_id_deleted_at_idx"   ON "attendance" ("session_id", "deleted_at");
CREATE INDEX "attendance_event_date_deleted_at_idx"   ON "attendance" ("event_id", "occurrence_date", "deleted_at");
CREATE INDEX "attendance_exam_id_deleted_at_idx"      ON "attendance" ("exam_id", "deleted_at");
CREATE INDEX "attendance_student_id_deleted_at_idx"   ON "attendance" ("student_id", "deleted_at");
