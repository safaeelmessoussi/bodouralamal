-- R134 — provenance for a reused/copied online assessment.
--
-- `POST /assessments/{id}/copy` already produces a fully independent row: its
-- own questions, its own (empty) target, submissions, grades and
-- notifications. Nothing shared exists to mutate, so nothing about that
-- safety changes here. What was missing was a way to answer *where did this
-- paper's wording come from* for the library/detail screens («نسخة من» /
-- «استُخدمت N مرة»).
--
-- `ON DELETE SET NULL`, not RESTRICT: deleting the source paper must never
-- block deleting — or be blocked by — a sitting that only started from its
-- wording. The column carries no authority over authorization, the freeze,
-- targeting, grading, publication or deletion; those all remain exactly as
-- R124 defined them, keyed on the row itself.
ALTER TABLE "exam"
  ADD COLUMN "source_exam_id" uuid,
  ADD CONSTRAINT "exam_source_exam_id_fkey"
    FOREIGN KEY ("source_exam_id") REFERENCES "exam"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "exam_source_exam_id_idx" ON "exam" ("source_exam_id");
