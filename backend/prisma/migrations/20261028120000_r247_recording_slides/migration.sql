-- SRS Revision 247 — a recording's slides (Document Owner, 2026-10-28): the
-- images of the «مطبوع» heard in ONE recording, shown beside it while it
-- plays on «حسب السورة». A session's slides need no table: they are the
-- images attached to that session (`session_content`).
--
-- Each slide is still an ordinary `educational_content` item, read at its own
-- visibility. An image is a page of at most one recording (the key).

CREATE TABLE "recording_slide" (
  "slide_id"     UUID NOT NULL,
  "recording_id" UUID NOT NULL,
  "position"     INTEGER NOT NULL,
  "created_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "created_by"   UUID,

  CONSTRAINT "recording_slide_pkey" PRIMARY KEY ("slide_id"),
  -- The link means nothing without either item, and goes with it (purge included).
  CONSTRAINT "recording_slide_slide_id_fkey"
    FOREIGN KEY ("slide_id") REFERENCES "educational_content"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "recording_slide_recording_id_fkey"
    FOREIGN KEY ("recording_id") REFERENCES "educational_content"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "recording_slide_position_check" CHECK ("position" >= 0),
  CONSTRAINT "recording_slide_not_itself" CHECK ("slide_id" <> "recording_id")
);

CREATE INDEX "recording_slide_recording_id_position_idx" ON "recording_slide" ("recording_id", "position");

-- A recording is audio and a slide is an image — the service says so in its
-- own words first; this is the last word.
CREATE FUNCTION "recording_slide_kinds"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "educational_content" c
     WHERE c."id" = NEW."recording_id" AND c."mime_type" LIKE 'audio/%'
  ) THEN
    RAISE EXCEPTION 'content % is not a recording', NEW."recording_id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "educational_content" c
     WHERE c."id" = NEW."slide_id" AND c."mime_type" LIKE 'image/%'
  ) THEN
    RAISE EXCEPTION 'content % is not an image', NEW."slide_id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "recording_slide_kinds"
  BEFORE INSERT OR UPDATE ON "recording_slide"
  FOR EACH ROW EXECUTE FUNCTION "recording_slide_kinds"();
