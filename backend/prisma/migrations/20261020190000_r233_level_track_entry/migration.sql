-- SRS Revision 233 — parallel tracks («صغار» / «كبار») within a Category, and
-- the entry Levels a newcomer may join.
CREATE TYPE "level_track" AS ENUM ('younger', 'older');

ALTER TABLE "level" ADD COLUMN "track" "level_track";
ALTER TABLE "level" ADD COLUMN "accepts_newcomers" BOOLEAN NOT NULL DEFAULT false;

-- Today's ways in, kept: every preparatory programme, and each Category's
-- first step (the Category's own order, as the journey reads it).
UPDATE "level" l SET "accepts_newcomers" = true
WHERE l."deleted_at" IS NULL
  AND (
    l."journey_role" = 'preparatory'
    OR l."id" = (
      SELECT f."id" FROM "level" f
      WHERE f."category_id" = l."category_id" AND f."deleted_at" IS NULL AND f."journey_role" = 'step'
      ORDER BY f."display_order" ASC NULLS LAST, f."name" ASC, f."id" ASC
      LIMIT 1
    )
  );
