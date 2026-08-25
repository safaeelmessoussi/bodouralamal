-- R101 final concurrency closure: token generations are not a stable lock
-- target at PostgreSQL READ COMMITTED. Rotation can insert a successor after a
-- locking statement's snapshot, while token.purge can delete the predecessor a
-- waiting logout discovered. One row per session supplies the exact, durable
-- target shared by refresh, logout, revoke-all and purge.
CREATE TABLE "refresh_session" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "refresh_session_pkey" PRIMARY KEY ("id")
);

-- Existing chains predate the anchor. `session_id` is already the chain
-- identity and every generation in a valid chain belongs to the same user, so
-- this is a lossless backfill; MIN(issued_at) preserves the chain's beginning.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "refresh_token"
    GROUP BY "session_id"
    HAVING COUNT(DISTINCT "user_id") <> 1
  ) THEN
    RAISE EXCEPTION 'refresh_token session_id belongs to more than one user';
  END IF;
END $$;

INSERT INTO "refresh_session" ("id", "user_id", "created_at")
SELECT "session_id", MIN("user_id"::text)::uuid, MIN("issued_at")
FROM "refresh_token"
GROUP BY "session_id";

CREATE INDEX "refresh_session_user_id_idx" ON "refresh_session"("user_id");

ALTER TABLE "refresh_session"
  ADD CONSTRAINT "refresh_session_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "user"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "refresh_token"
  ADD CONSTRAINT "refresh_token_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "refresh_session"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
