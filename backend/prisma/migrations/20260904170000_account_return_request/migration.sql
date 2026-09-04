-- A former beneficiary who closed her account asks for it back
-- (Owner decision, 2026-09-04).
--
-- **Not a `SelfManagedClaim`.** R132's claim is the closest existing machinery
-- and cannot carry this without being weakened in two places that exist for real
-- reasons: it resolves a beneficiary `WHERE deleted_at IS NULL` — a closed
-- account is soft-deleted — and it requires a recorded date of birth, which
-- Option A now clears. Relaxing both would make one queue mean two things, one
-- of which restores a closed account.
--
-- **Additive only** (TD-6a): a new enum, a new table, two indexes. Nothing
-- existing is altered, so there is no backfill and no rewrite of live rows.
CREATE TYPE "account_return_status" AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE "account_return_request" (
  "id"                  uuid PRIMARY KEY,
  -- Resolved from the reference code BY THE SERVER; a client never names a user.
  "subject_id"          uuid NOT NULL REFERENCES "user"("id") ON UPDATE CASCADE ON DELETE RESTRICT,
  -- Recorded, never bound, until a Super Admin approves.
  "provider"            "auth_provider" NOT NULL,
  "provider_subject_id" text NOT NULL,
  "email"               text NOT NULL,
  -- Her CURRENT identity, acquired anew rather than restored: the old values
  -- were erased and inventing them would be fabricating history.
  "first_name_arabic"   varchar(60) NOT NULL,
  "last_name_arabic"    varchar(60) NOT NULL,
  "phone"               varchar(30),
  "status"              "account_return_status" NOT NULL DEFAULT 'pending',
  "created_at"          timestamptz(6) NOT NULL DEFAULT now(),
  "decided_at"          timestamptz(6),
  "decided_by"          uuid REFERENCES "user"("id") ON UPDATE CASCADE ON DELETE RESTRICT,
  "decision_reason"     varchar(500),
  "deleted_at"          timestamptz(6),
  "deleted_by"          uuid,
  -- A decided row names its decider, exactly as `child_application` requires.
  CONSTRAINT "account_return_decision_complete_check"
    CHECK (("decided_at" IS NULL) = ("decided_by" IS NULL))
);

CREATE INDEX "account_return_request_status_idx" ON "account_return_request" ("status");
CREATE INDEX "account_return_request_subject_id_status_idx"
  ON "account_return_request" ("subject_id", "status");
