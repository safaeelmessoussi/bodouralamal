-- R215 (Owner, 2026-10-10) — a framing preference says WHEN she is available
-- (the current academic year, the current semester, or a span of dates), in
-- which POSITION (main teacher, assistant, either) and for which LEVELS (all,
-- or a list). Planning data, never authority (R88.3). Every existing
-- preference keeps NULL period/position and all levels: not stated.
-- CreateEnum
CREATE TYPE "framing_period" AS ENUM ('academic_year', 'academic_period', 'date_range');

-- CreateEnum
CREATE TYPE "framing_position" AS ENUM ('teacher', 'assistant', 'both');

-- AlterTable
ALTER TABLE "framing_preference" ADD COLUMN     "academic_period_id" UUID,
ADD COLUMN     "academic_year_id" UUID,
ADD COLUMN     "all_levels" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "available_from" DATE,
ADD COLUMN     "available_until" DATE,
ADD COLUMN     "period" "framing_period",
ADD COLUMN     "position" "framing_position";

-- CreateTable
CREATE TABLE "framing_preference_level" (
    "user_id" UUID NOT NULL,
    "level_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "framing_preference_level_pkey" PRIMARY KEY ("user_id","level_id")
);

-- CreateIndex
CREATE INDEX "framing_preference_level_level_id_idx" ON "framing_preference_level"("level_id");

-- AddForeignKey
ALTER TABLE "framing_preference" ADD CONSTRAINT "framing_preference_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_year"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "framing_preference" ADD CONSTRAINT "framing_preference_academic_period_id_fkey" FOREIGN KEY ("academic_period_id") REFERENCES "academic_period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "framing_preference_level" ADD CONSTRAINT "framing_preference_level_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "framing_preference"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "framing_preference_level" ADD CONSTRAINT "framing_preference_level_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Each kind of period carries exactly its own columns.
ALTER TABLE "framing_preference" ADD CONSTRAINT "framing_preference_period_shape_check" CHECK (
  ("period" IS NULL AND "academic_year_id" IS NULL AND "academic_period_id" IS NULL
     AND "available_from" IS NULL AND "available_until" IS NULL)
  OR ("period" = 'academic_year' AND "academic_year_id" IS NOT NULL AND "academic_period_id" IS NULL
     AND "available_from" IS NULL AND "available_until" IS NULL)
  OR ("period" = 'academic_period' AND "academic_period_id" IS NOT NULL AND "academic_year_id" IS NULL
     AND "available_from" IS NULL AND "available_until" IS NULL)
  OR ("period" = 'date_range' AND "academic_year_id" IS NULL AND "academic_period_id" IS NULL
     AND "available_from" IS NOT NULL AND "available_until" IS NOT NULL
     AND "available_from" <= "available_until")
);

-- The commit-time check gains the Levels: all Levels has no rows, a list has
-- at least one — the rule the branches already follow.
CREATE OR REPLACE FUNCTION "assert_framing_preference_complete"("candidate_user_id" UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  preference_mode "framing_mode";
  preference_all BOOLEAN;
  preference_all_levels BOOLEAN;
  branch_count INTEGER;
  level_count INTEGER;
BEGIN
  SELECT "mode", "all_branches", "all_levels"
    INTO preference_mode, preference_all, preference_all_levels
    FROM "framing_preference"
    WHERE "user_id" = "candidate_user_id";

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT count(*) INTO branch_count
    FROM "framing_preference_branch"
    WHERE "user_id" = "candidate_user_id";

  IF preference_mode = 'online' AND (preference_all OR branch_count <> 0) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'framing_preference_online_has_no_branches',
      MESSAGE = 'online framing preference cannot carry branch willingness';
  END IF;

  IF preference_mode IN ('in_person', 'both')
     AND ((preference_all AND branch_count <> 0)
       OR (NOT preference_all AND branch_count = 0)) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'framing_preference_physical_branch_choice',
      MESSAGE = 'physical framing preference requires either all branches or explicit branches';
  END IF;

  SELECT count(*) INTO level_count
    FROM "framing_preference_level"
    WHERE "user_id" = "candidate_user_id";

  IF (preference_all_levels AND level_count <> 0)
     OR (NOT preference_all_levels AND level_count = 0) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'framing_preference_level_choice',
      MESSAGE = 'framing preference requires either all levels or explicit levels';
  END IF;
END;
$$;

CREATE CONSTRAINT TRIGGER "framing_preference_level_complete_deferred"
AFTER INSERT OR UPDATE OR DELETE ON "framing_preference_level"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "framing_preference_constraint_trigger"();
