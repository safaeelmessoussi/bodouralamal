-- Revision 133 — the account-return workflow is withdrawn.
--
-- It existed only to reconnect a returning person with the educational archive
-- Option A preserved. R133 removes that archive: permanent account deletion now
-- destroys the beneficiary's own history, so there is nothing to reconnect to
-- and no matching to perform. A person who returns registers normally and
-- receives a new record.
--
-- **Forward-only, never a history rewrite** (TD-6a). The table was created on
-- 2026-09-04 and is dropped here; the migration that created it stays exactly as
-- it was, because a migration history that changes retroactively cannot be
-- replayed to reproduce any past state.
--
-- **Verified empty before dropping** on the only database this may touch — local
-- development. Nothing is converted or preserved: there is no destination for it
-- under the new model, and inventing one would be fabricating a record.
DROP TABLE IF EXISTS "account_return_request";
DROP TYPE IF EXISTS "account_return_status";
