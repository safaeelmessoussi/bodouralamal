-- SRS Revision 39 — the branch the applicant ASKED FOR at registration.
--
-- Deliberately not named `branch_id`: that name would claim to answer "which
-- branch is this person in", and the answer to that is the person's Group
-- (`student_group → group.branch_id`). An administrator may place an approved
-- applicant at a different branch when the requested one is full or unsuitable,
-- so these are two different facts and they get two different names. One name
-- for two facts is how a second source of truth starts (§16.4).
--
-- **Expand phase, forward-only (TD-6b).** A nullable column added to a live
-- table takes no long lock and breaks no running reader. There is deliberately
-- NO backfill and no NOT NULL follow-up: accounts predating this revision have
-- no such value, nobody knows what those applicants would have chosen, and
-- inventing one would be worse than recording the truth. NULL means
-- *not stated* — never *no branch*.
--
-- `ON DELETE RESTRICT` matches every other reference to a branch (TD-5): a
-- branch with registrations pointing at it cannot be deleted out from under
-- them, and the admin screen already surfaces that refusal as its own reason.
ALTER TABLE "user" ADD COLUMN "intended_branch_id" UUID;

ALTER TABLE "user"
  ADD CONSTRAINT "user_intended_branch_id_fkey"
  FOREIGN KEY ("intended_branch_id") REFERENCES "branch"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- The approval queue filters by this column over pending rows only (§14.2,
-- R39), so the index is partial — it serves the query that exists rather than
-- indexing every historical registration the queue will never look at.
CREATE INDEX "user_intended_branch_pending_idx"
  ON "user" ("intended_branch_id")
  WHERE "deleted_at" IS NULL AND "account_status" = 'pending';
