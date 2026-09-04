-- R133 §14 — when an administrator last DECIDED this account's status.
--
-- The rejected-registration retention clock needs a trustworthy rejection
-- instant and there was none: the decision wrote `account_status` and nothing
-- else, and `updated_at` moves on any later edit. Reading `updated_at` would
-- measure the wrong thing, and backfilling from it would fabricate a rejection
-- date for a person — which is why this column is added empty.
--
-- **Additive and nullable** (TD-6a): NULL means *decided before this column
-- existed, and the instant is not recoverable*. That is a legacy fact rather
-- than a gap, and the clock skips those rows by construction instead of
-- guessing at them.
ALTER TABLE "user"
  ADD COLUMN "account_status_decided_at" timestamptz(6);
