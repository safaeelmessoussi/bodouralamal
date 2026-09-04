-- Revision 133 — Option A / Option B are withdrawn, and with them the request
-- and review machinery that existed only to tell the two apart.
--
-- Option B asked for the educational record to be deleted; Option A closed the
-- account and kept it. R133 makes ordinary permanent account deletion do what
-- Option B did, so the distinction has no subject and the request queue has
-- nothing to decide between. `FullDeletionRequest` is therefore not migrated
-- into anything — there is no destination for it, and inventing one would be
-- fabricating a record of a decision nobody took.
--
-- **Forward-only, never a history rewrite** (TD-6a). The migration that created
-- this table on 2026-09-04, and the one that added `executed_at` to it, both
-- stay exactly as they are: a migration history that changes retroactively
-- cannot be replayed to reproduce any past state.
--
-- **Verified empty before dropping** on the only database this may touch, local
-- development.
DROP TABLE IF EXISTS "full_deletion_request";
DROP TYPE IF EXISTS "full_deletion_request_status";
DROP TYPE IF EXISTS "full_deletion_requester_basis";
