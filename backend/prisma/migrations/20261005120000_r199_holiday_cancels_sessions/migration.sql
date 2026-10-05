-- SRS Revision 199 §5 — a عطلة cancels the class occurrences it covers (the
-- Owner, 2026-10-05), reversibly: the occurrence remembers WHICH holiday
-- cancelled it, so editing the holiday, deleting it or restoring it from the
-- Trash puts exactly those occurrences back (or cancels them again). NULL for
-- every cancellation a person made. SET NULL on the holiday's final purge:
-- by then the deletion has already restored them.
ALTER TABLE "session" ADD COLUMN "cancelled_by_event_id" UUID;
ALTER TABLE "session" ADD CONSTRAINT "session_cancelled_by_event_id_fkey"
  FOREIGN KEY ("cancelled_by_event_id") REFERENCES "event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "session_cancelled_by_event_id_idx" ON "session" ("cancelled_by_event_id")
  WHERE "cancelled_by_event_id" IS NOT NULL;
-- Only a cancelled occurrence may name the holiday that cancelled it.
ALTER TABLE "session" ADD CONSTRAINT "session_cancelled_by_event_check"
  CHECK ("cancelled_by_event_id" IS NULL OR "status" = 'cancelled');
