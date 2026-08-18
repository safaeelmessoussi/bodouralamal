-- Revision 81 — the maximum grade belongs to the Exam.
--
-- The platform-wide `grading.display_scale` and `grading.passing_grade_bp` are
-- retired. Each exam carries its own maximum, and a grade is the score itself
-- rather than basis points of a normalised total.
--
-- **Existing grades keep their displayed value, and this migration is what has
-- to prove it.** Every exam is backfilled with the scale that was in force, read
-- from the setting row rather than assumed, and each score is recomputed from
-- its basis points against that same number — so a grade that read 3/20 before
-- reads 3.00/20.00 after, by construction rather than by coincidence.

-- ── 1. The exam's own maximum ───────────────────────────────────────────────
--
-- NUMERIC, not a float and not basis points: a maximum of 20, 10 or 100 is an
-- exact decimal, and NUMERIC arithmetic is exact, so nothing here can drift.
ALTER TABLE "exam" ADD COLUMN "max_grade" NUMERIC(6, 2);

-- The scale that was actually in force, defaulting to R14's 20 only when no row
-- was configured — the same fallback `readGradingScale` applied.
--
-- `system_setting.value` is **jsonb**, so the number is extracted with `#>> '{}'`
-- rather than cast directly: a plain `::NUMERIC` on jsonb fails, and a `::TEXT`
-- would carry JSON quoting for a string-typed row.
UPDATE "exam"
SET "max_grade" = COALESCE(
  (
    SELECT NULLIF("value" #>> '{}', '')::NUMERIC
    FROM "system_setting"
    WHERE "key" = 'grading.display_scale'
  ),
  20
);

ALTER TABLE "exam" ALTER COLUMN "max_grade" SET NOT NULL;
ALTER TABLE "exam" ADD CONSTRAINT "exam_max_grade_positive" CHECK ("max_grade" > 0);

-- ── 2. The grade becomes the score ──────────────────────────────────────────
ALTER TABLE "grade" ADD COLUMN "score" NUMERIC(6, 2);

UPDATE "grade" g
SET "score" = ROUND(g."value_bp" * e."max_grade" / 10000, 2)
FROM "exam" e
WHERE e."id" = g."exam_id";

ALTER TABLE "grade" ALTER COLUMN "score" SET NOT NULL;
ALTER TABLE "grade" ADD CONSTRAINT "grade_score_non_negative" CHECK ("score" >= 0);

-- **The precondition, asserted rather than assumed.** A score above its exam's
-- maximum cannot be produced by the conversion above, so if one exists the data
-- disagrees with the model and a silent clamp would hide it.
DO $$
DECLARE bad INT;
BEGIN
  SELECT COUNT(*) INTO bad
  FROM "grade" g JOIN "exam" e ON e."id" = g."exam_id"
  WHERE g."score" > e."max_grade";
  IF bad > 0 THEN
    RAISE EXCEPTION 'R81: % grade(s) exceed their exam maximum after conversion; migration aborted', bad;
  END IF;
END $$;

-- ── 3. What the Owner decision retires ──────────────────────────────────────
--
-- contract-phase: R81 retires basis-point grade storage and the pass/fail
-- concept entirely. `value_bp` is superseded by `score` above, which is derived
-- from it in this same migration, so no attainment is lost. The manual pass/fail
-- override columns have nothing left to override: the MVP derives no verdict
-- from a grade, and keeping them would leave configuration implying a feature
-- that no longer exists.
ALTER TABLE "grade" DROP COLUMN "value_bp";
ALTER TABLE "grade" DROP COLUMN "manual_pass_fail_override";
ALTER TABLE "grade" DROP COLUMN "override_by";
ALTER TABLE "grade" DROP COLUMN "override_at";
ALTER TABLE "grade" DROP COLUMN "override_reason";

-- The two settings rows go with them. A row left behind would state that a
-- platform-wide scale still governs something.
DELETE FROM "system_setting" WHERE "key" IN ('grading.display_scale', 'grading.passing_grade_bp');
