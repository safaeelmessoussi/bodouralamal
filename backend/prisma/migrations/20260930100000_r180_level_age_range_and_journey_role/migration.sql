-- SRS Revision 180 (Owner, 2026-09-30) — «برامجنا التعليمية» as a journey.
--
-- §4 — THE AGE RANGE LIVES ON THE LEVEL. A Category's range is DERIVED: its
-- start is the first year of its first Level, its end the last year of its
-- last Level (in the Category's own order), and a Category whose last Level
-- states no end has none — «من 18 سنة», never an invented ceiling. R170 §6's
-- columns on `category` therefore go: what they held is carried onto the
-- Category's first and last live Level, so nothing a form showed is lost.
-- Still INFORMATIONAL (R170 §6, R64.7): gates nothing.
--
-- §6 — `journey_role` says what a Level IS on the journey, as a column, never
-- a match on its name (§4.4b): `step` (the ordinary next rung) or
-- `preparatory` (a programme such as «فرصة أمل — محاربة الأمية» that leads
-- INTO the Category's first step and is not required of those who enter
-- there). Default `step`, so nothing changes until the Super Admin says so.

CREATE TYPE "level_journey_role" AS ENUM ('step', 'preparatory');

ALTER TABLE "level"
  ADD COLUMN "min_age" SMALLINT,
  ADD COLUMN "max_age" SMALLINT,
  ADD COLUMN "journey_role" "level_journey_role" NOT NULL DEFAULT 'step';

ALTER TABLE "level"
  ADD CONSTRAINT "level_age_range_check" CHECK (
    ("min_age" IS NULL OR "min_age" BETWEEN 0 AND 120)
    AND ("max_age" IS NULL OR "max_age" BETWEEN 0 AND 120)
    AND ("min_age" IS NULL OR "max_age" IS NULL OR "min_age" <= "max_age")
  );

-- Carry each Category's stated range onto its first / last live Level, in the
-- order the public overview and the back office both read (§2.2).
UPDATE "level" AS l
SET "min_age" = c."min_age"
FROM "category" AS c
WHERE l."category_id" = c."id"
  AND c."min_age" IS NOT NULL
  AND l."deleted_at" IS NULL
  AND l."id" = (
    SELECT x."id" FROM "level" AS x
    WHERE x."category_id" = c."id" AND x."deleted_at" IS NULL
    ORDER BY x."display_order" ASC NULLS LAST, x."name" ASC, x."id" ASC
    LIMIT 1
  );

UPDATE "level" AS l
SET "max_age" = c."max_age"
FROM "category" AS c
WHERE l."category_id" = c."id"
  AND c."max_age" IS NOT NULL
  AND l."deleted_at" IS NULL
  AND l."id" = (
    SELECT x."id" FROM "level" AS x
    WHERE x."category_id" = c."id" AND x."deleted_at" IS NULL
    ORDER BY x."display_order" DESC NULLS FIRST, x."name" DESC, x."id" DESC
    LIMIT 1
  );

-- contract-phase: **Document Owner decision, 2026-09-30 (Revision 180 §4) —
-- the Category's age range must NOT be stored separately from its Levels'.**
-- The two UPDATEs above are the data migration: every stated value is now on
-- the Category's first / last live Level, from which the range is derived
-- everywhere it was read. Nothing is lost; the columns would only ever
-- disagree with their Levels from here on.
ALTER TABLE "category" DROP CONSTRAINT IF EXISTS "category_age_range_check";
ALTER TABLE "category"
  DROP COLUMN "min_age",
  DROP COLUMN "max_age";
