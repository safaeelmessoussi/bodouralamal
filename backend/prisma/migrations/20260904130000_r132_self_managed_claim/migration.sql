-- R132 — a beneficiary may claim her own account at 18 (Owner decision, 2026-09-03).
--
-- ## What this closes
--
-- A former minor is a login-less `User` (R62.9) holding her whole educational
-- history. Until now there was no way for her ever to sign in as herself, and
-- the blocker recorded on 2026-09-03 was precise: no operation points an
-- EXISTING account at an address, and `PATCH /admin/users/{id}` refuses
-- `pre_provisioned_email` *because it authorises claiming an account*. That
-- refusal is right and stays. This table is the controlled path that refusal
-- was protecting the absence of.
--
-- ## The trust model, in one row
--
-- Google proves CONTROL OF A GOOGLE IDENTITY. It does not prove that the person
-- controlling it is the beneficiary. The reference code names WHICH beneficiary
-- is claimed and grants nothing on its own (R62.5 — that is exactly why it is
-- safe to quote down a telephone). Neither, nor both, binds anything: together
-- they produce a PENDING row, and a Super Admin performs the association-side
-- identity match that only a human can.
--
-- ## The indexes are the concurrency rules
--
-- Both are PARTIAL and cover PENDING, LIVE rows only, so history never blocks a
-- future attempt:
--
--   * one pending claim per beneficiary — two requests for one record cannot
--     race to bind different identities;
--   * one pending claim per verified Google subject — one identity cannot be
--     pending against two beneficiaries at once.
--
-- An APPROVED row stays live as decision evidence and blocks neither, because
-- after approval the binding itself is what a second attempt collides with:
-- `user_identity`'s own uniqueness is the authority, not this table.
--
-- The lowercase CHECK mirrors `user_identity`'s: an address compared in two
-- cases is two addresses.

CREATE TYPE "self_managed_claim_status" AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE "self_managed_claim" (
  "id"                  UUID PRIMARY KEY,
  "beneficiary_id"      UUID NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "provider"            "auth_provider" NOT NULL,
  "provider_subject_id" TEXT NOT NULL,
  "email"               TEXT NOT NULL,
  "status"              "self_managed_claim_status" NOT NULL DEFAULT 'pending',
  "created_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "decided_at"          TIMESTAMPTZ(6),
  "decided_by"          UUID REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "decision_reason"     VARCHAR(500),
  "deleted_at"          TIMESTAMPTZ(6),
  "deleted_by"          UUID,
  CONSTRAINT "self_managed_claim_email_lowercase_check" CHECK ("email" = lower("email"))
);

CREATE INDEX "self_managed_claim_status_idx" ON "self_managed_claim" ("status");

-- One pending claim per beneficiary.
CREATE UNIQUE INDEX "self_managed_claim_pending_beneficiary_key"
  ON "self_managed_claim" ("beneficiary_id")
  WHERE "deleted_at" IS NULL AND "status" = 'pending';

-- One pending claim per verified Google subject.
CREATE UNIQUE INDEX "self_managed_claim_pending_subject_key"
  ON "self_managed_claim" ("provider", "provider_subject_id")
  WHERE "deleted_at" IS NULL AND "status" = 'pending';
