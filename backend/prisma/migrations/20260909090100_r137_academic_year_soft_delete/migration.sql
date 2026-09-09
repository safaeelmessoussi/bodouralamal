-- R137 — Academic Year gains the same TD-5 soft-delete shape every other
-- reference-data row (Level, Subject, Branch) already carries, so a year
-- created in error can be removed through the same blocking-reference
-- pattern rather than staying permanent by omission. It also gains TD-15
-- optimistic locking, matching `academic_period.version` beside it, now that
-- it has real writes for the first time.
ALTER TABLE "academic_year"
  ADD COLUMN "deleted_at" timestamptz(6),
  ADD COLUMN "deleted_by" uuid,
  ADD COLUMN "version" integer NOT NULL DEFAULT 0;
