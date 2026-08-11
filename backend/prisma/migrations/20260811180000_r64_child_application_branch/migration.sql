-- Revision 64 — the branch a child-registration request asks for.
--
-- Revision 39 recorded the applicant's chosen branch on their own `user` row
-- and stated it is never copied onto the child. That held while every
-- registration created a parent row; once the parent already exists — a parent
-- adding a second child, an adult student registering one — the request had
-- nowhere to put a branch, and arrived naming none.
--
-- TD-6b expand-only: a nullable column with no backfill. NULL means *not
-- stated*, which is exactly what an application submitted before this revision
-- can honestly say, and is how Revision 39 already reads a null branch.
--
-- ON DELETE RESTRICT, matching every other branch reference: a branch named by
-- a live request must not vanish underneath it.
ALTER TABLE "child_application"
  ADD COLUMN "requested_branch_id" uuid NULL
    REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The approvals queue filters by branch (§14.2, Revision 39), and this is the
-- column that finally makes a child-registration request reachable by it.
CREATE INDEX "child_application_requested_branch_id_idx"
  ON "child_application" ("requested_branch_id");
