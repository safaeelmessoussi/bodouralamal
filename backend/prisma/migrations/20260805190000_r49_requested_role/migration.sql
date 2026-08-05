-- Revision 49 (proposed) — `User.requested_role`.
--
-- WHAT AN APPLICANT ASKED TO BE, AND NOTHING MORE.
--
-- The §5.6 approval queue could not distinguish a teacher applicant from a
-- family registration, because nothing recorded the request. Everything else the
-- staff workflow needs already existed: `POST /registrations` creates the
-- Pending account, the queue lists it, and approve/reject decides it.
--
-- **This column grants nothing.** Authority lives in `user_branch_role`, written
-- at approval by a Super Admin. A self-declared value that granted access would
-- be privilege escalation by form submission; this is a hint to the approver and
-- is deliberately retained afterwards as provenance — the same treatment
-- `pre_provisioned_email` gets (§7, Revision 15).
--
-- **Constrained to 'teacher'.** An applicant may not self-nominate for an
-- administrator role: those accounts arrive through staff pre-provisioning
-- (§4.1, §4.1b step 4b), which is an authenticated path with a named actor.
-- Widening this set is an SRS revision, not a code change — which is exactly
-- what the CHECK makes true.
ALTER TABLE "user" ADD COLUMN "requested_role" VARCHAR(40);

ALTER TABLE "user"
  ADD CONSTRAINT "user_requested_role_check"
  CHECK ("requested_role" IS NULL OR "requested_role" IN ('teacher'));

-- Partial: the column is null for every family registration, which is most of
-- the table, and the queue's only question is "which pending rows asked for a
-- role".
CREATE INDEX "user_requested_role_idx" ON "user" ("requested_role")
  WHERE "requested_role" IS NOT NULL;
