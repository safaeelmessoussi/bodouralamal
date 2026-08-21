-- R99 C2 — the recording BECOMES a library item, and the relation is the
-- idempotency anchor that makes it happen exactly once.
--
-- **Two columns and one index.** Nothing about C1's state machine is redesigned:
-- the provider still reports `completed`, and `completed` still means only that
-- an object exists in the staging bucket (R99.13).
--
-- ## Why availability is DERIVED and not a status value
--
-- R99.14 requires the interface to distinguish *processing* from *available*,
-- and «available» to be claimed **only once the asset genuinely exists in Bodour
-- storage**. That is exactly *`educational_content_id IS NOT NULL`*, so adding
-- an `available` enum value would create a second fact that can disagree with
-- the first — and the disagreement would look like a working library item whose
-- object is absent, which R99.14 calls worse than an honest failure.
--
-- ## Why UNIQUE, and why it is the whole design
--
-- A provider may deliver the same completion twice; a pg-boss job may be
-- retried; a worker may be killed between the copy and the row. All three must
-- converge on ONE `EducationalContent`. The worker therefore reads this column
-- first and returns the existing result when it is set — and the unique index is
-- what makes that check hold under concurrency instead of merely usually.
--
-- ## Why RESTRICT
--
-- Deleting a library item must not silently erase the record that a class was
-- recorded. The link is severed deliberately or not at all.

ALTER TABLE "session_recording"
  ADD COLUMN "educational_content_id" uuid,
  ADD COLUMN "ingestion_failure_reason" varchar(500);

ALTER TABLE "session_recording"
  ADD CONSTRAINT "session_recording_educational_content_id_fkey"
  FOREIGN KEY ("educational_content_id") REFERENCES "educational_content"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- A PLAIN unique index (§20 rule 5 permits these in schema.prisma; it is written
-- here with the rest of the change for one reviewable unit). NULLs do not
-- collide in PostgreSQL, so every not-yet-ingested recording is unconstrained
-- and every ingested one is unique — which is precisely the 1:1-optional shape.
CREATE UNIQUE INDEX "session_recording_educational_content_id_key"
  ON "session_recording" ("educational_content_id");
