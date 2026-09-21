-- SRS Revision 169 §10 — a recording (or any library item) may belong to SEVERAL
-- Levels (Document Owner, 2026-09-21).
--
-- `educational_content.level_id` is single and stays: it is the item's HOME
-- Level — what its Subject is checked against, what §4.9's library is grouped
-- by, what R167's «whole Category» is read through. A class that addresses two
-- Levels filed its recording under the first, and a PRIVATE recording was then
-- listed for that Level's beneficiaries only.
--
-- These rows are the item's OTHER Levels. Purely additive: an item with none
-- behaves exactly as before, and every reader that knows only `level_id` is
-- still right about the home Level.

CREATE TABLE "educational_content_level" (
  "content_id" UUID NOT NULL,
  "level_id"   UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "educational_content_level_pkey" PRIMARY KEY ("content_id", "level_id"),
  -- The rows mean nothing without the item, and go with it (purge included).
  CONSTRAINT "educational_content_level_content_id_fkey"
    FOREIGN KEY ("content_id") REFERENCES "educational_content"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- A Level something is still filed under is not deleted from beneath it —
  -- the same rule `level_id` itself carries.
  CONSTRAINT "educational_content_level_level_id_fkey"
    FOREIGN KEY ("level_id") REFERENCES "level"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "educational_content_level_level_id_idx" ON "educational_content_level" ("level_id");

-- The home Level is never ALSO an additional one: one fact, one place.
CREATE FUNCTION "educational_content_level_not_home"() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "educational_content" c
     WHERE c."id" = NEW."content_id" AND c."level_id" = NEW."level_id"
  ) THEN
    RAISE EXCEPTION 'level % is already the home level of content %', NEW."level_id", NEW."content_id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "educational_content_level_not_home"
  BEFORE INSERT OR UPDATE ON "educational_content_level"
  FOR EACH ROW EXECUTE FUNCTION "educational_content_level_not_home"();
