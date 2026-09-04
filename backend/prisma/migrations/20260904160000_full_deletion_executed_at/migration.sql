-- R131 Option B — when the destruction actually ran (Owner decision, 2026-09-04).
--
-- Approval and execution are separate facts. `status` records the DECISION a
-- Super Admin took; this records the WORK. Conflating them is how a request ends
-- up marked done while the data is still present, so the two are stored apart.
--
-- **Additive and nullable** (TD-6a): every existing row is an approval that has
-- not executed, which is exactly what NULL means here — no backfill is possible
-- and none would be honest, since Option B execution did not exist before this
-- migration.
--
-- **One column rather than a fourth status value**, so the state machine gains
-- no "decided but not yet done" state that a crash could strand.
ALTER TABLE "full_deletion_request"
  ADD COLUMN "executed_at" timestamptz(6);
