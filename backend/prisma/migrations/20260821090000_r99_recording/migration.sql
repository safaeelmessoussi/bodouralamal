-- R99 — an online class MAY be recorded, and a recording becomes a SEMANTIC FACT.
--
-- Two things land here and nothing else:
--   1. `educational_content.origin` — what an item IS, replacing the MIME
--      inference that decided «التسجيلات» (R99.9, R99.10).
--   2. `session_recording` — the integration state of one attempt to record one
--      occurrence (R99.9's "provider job state lives apart from the content
--      model").
--
-- **No provider identifier is added to `session` or `recurring_course_schedule`.**
-- R97.9 forbids it, and `session_recording.provider_egress_id` is exactly such
-- an identifier — which is why it lives on its own row and not on the occurrence.

CREATE TYPE "content_origin" AS ENUM ('uploaded', 'session_recording');

CREATE TYPE "recording_status" AS ENUM (
  'starting', 'recording', 'stopping', 'processing', 'completed', 'failed', 'aborted'
);

-- ── 1. What a content item IS ───────────────────────────────────────────────
ALTER TABLE "educational_content"
  ADD COLUMN "origin" "content_origin" NOT NULL DEFAULT 'uploaded';

-- **R99.11 — the backfill preserves what the screens show today.**
--
-- Before this migration «التسجيلات» was `mime_type LIKE 'audio/%'` among a
-- Session's linked contents. §4.9's MVP flow is *"teachers record with their
-- phone's native voice-recorder app and upload the file"*, so an audio item
-- carrying a LIVE session link genuinely IS a class recording — it is not being
-- reclassified by guess, it is being named.
--
-- Everything else stays `uploaded`: audio sitting in the library attached to no
-- session was never rendered as a recording, and documents, slides and images
-- never could be. The rendering after this migration is therefore identical to
-- the rendering before it, which is the only acceptable outcome for a backfill.
UPDATE "educational_content" ec
   SET "origin" = 'session_recording'
 WHERE ec."mime_type" LIKE 'audio/%'
   AND ec."deleted_at" IS NULL
   AND EXISTS (
         SELECT 1 FROM "session_content" sc
          WHERE sc."educational_content_id" = ec."id"
            AND sc."deleted_at" IS NULL
       );

-- ── 2. One attempt to record one occurrence ─────────────────────────────────
CREATE TABLE "session_recording" (
    "id"                 UUID NOT NULL,
    "session_id"         UUID NOT NULL,
    "status"             "recording_status" NOT NULL DEFAULT 'starting',
    "provider_egress_id" TEXT,
    "output_bucket"      VARCHAR(63),
    "output_key"         TEXT,
    "size_bytes"         BIGINT,
    "duration_ms"        INTEGER,
    "mime_type"          VARCHAR(120),
    "started_by"         UUID NOT NULL,
    "started_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stopped_by"         UUID,
    "stopped_at"         TIMESTAMPTZ(6),
    "failure_reason"     VARCHAR(500),
    "version"            INTEGER NOT NULL DEFAULT 0,
    "created_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"         TIMESTAMPTZ(6) NOT NULL,
    "deleted_at"         TIMESTAMPTZ(6),
    CONSTRAINT "session_recording_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "session_recording"
  ADD CONSTRAINT "session_recording_session_id_fkey"
      FOREIGN KEY ("session_id") REFERENCES "session"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "session_recording_started_by_fkey"
      FOREIGN KEY ("started_by") REFERENCES "user"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "session_recording_stopped_by_fkey"
      FOREIGN KEY ("stopped_by") REFERENCES "user"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;

-- **The idempotency key, as a database fact** (R99.15). A duplicate webhook
-- delivery names an egress id this platform has already seen; unique means the
-- second delivery can never become a second recording even if two of them are
-- processed at the same instant.
CREATE UNIQUE INDEX "session_recording_provider_egress_id_key"
    ON "session_recording"("provider_egress_id");

-- The classroom asks "is this occurrence recording right now" on every read.
CREATE INDEX "session_recording_session_id_status_idx"
    ON "session_recording"("session_id", "status");

-- **At most ONE live recording per occurrence, enforced rather than assumed.**
-- Two concurrent egress jobs on one room would produce two files nobody asked
-- for and leave «جاري التسجيل» unable to say which it means. A partial unique
-- index is the right instrument: it constrains only the states that are
-- actually in flight and leaves any number of finished ones alone.
CREATE UNIQUE INDEX "session_recording_one_live_per_session"
    ON "session_recording"("session_id")
 WHERE "deleted_at" IS NULL
   AND "status" IN ('starting', 'recording', 'stopping');
