-- R271 — an enrolment for a whole academic year, the ordinary path; a single
-- semester stays the exception (the Owner, 2026-11-14).
--
-- A year enrolment names the YEAR, not each of its semesters: it is live on
-- every day some semester of that year covers — including a semester the
-- Super Admin records after the enrolment was made. An enrolment names a year
-- or a semester, never both; rows written before R122 name neither.
ALTER TABLE "enrollment" ADD COLUMN "academic_year_id" UUID;

ALTER TABLE "enrollment"
  ADD CONSTRAINT "enrollment_academic_year_id_fkey"
  FOREIGN KEY ("academic_year_id") REFERENCES "academic_year"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "enrollment"
  ADD CONSTRAINT "enrollment_year_or_period_check"
  CHECK ("academic_year_id" IS NULL OR "academic_period_id" IS NULL);

-- One live year enrolment per beneficiary per Level per year.
CREATE UNIQUE INDEX "enrollment_student_level_year_unique"
  ON "enrollment" ("student_id", "level_id", "academic_year_id")
  WHERE "deleted_at" IS NULL AND "academic_year_id" IS NOT NULL;

CREATE INDEX "enrollment_academic_year_id_deleted_at_idx"
  ON "enrollment" ("academic_year_id", "deleted_at");
