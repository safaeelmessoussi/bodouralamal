-- R58 follow-up — the index a physical sitting is actually read by.
--
-- The calendar and the unified scheduling list both ask the same question:
-- *which exams are at this branch between these two dates*. `exam_level_id_date_idx`
-- answers a different one, and R58's own migration added the columns without the
-- index that makes them readable.
--
-- Forward-only (TD-6b): the previous migration is applied and is never edited.
CREATE INDEX IF NOT EXISTS "exam_branch_id_date_idx" ON "exam" ("branch_id", "date");
