-- The durable self-managed-authority lookup gets an index (Owner decision,
-- 2026-09-04).
--
-- Self-managed authority is now DERIVED from an approved `SelfManagedClaim`
-- rather than from the presence of a login identity — because Option A
-- deliberately deletes `user_identity`, so *"has no active login"* stopped being
-- a safe reading of *"a guardian manages this account"* the moment account
-- closure shipped.
--
-- That derivation runs on **every child-scoped request** (the `X-Active-Child-ID`
-- resolver) and on the child-linking candidate search, filtering on
-- `(beneficiary_id, status)`. The table's existing indexes do not serve it: the
-- plain one covers `status` alone, and the two partial unique indexes cover
-- PENDING rows only, while this lookup asks about APPROVED ones.
--
-- **Additive and non-destructive.** No column, constraint, enum or row changes;
-- nothing is backfilled and no status is fabricated. An index cannot alter what
-- the query returns, only how fast it is returned, which is why this is safe to
-- apply ahead of the code that uses it.

CREATE INDEX "self_managed_claim_beneficiary_id_status_idx"
  ON "self_managed_claim" ("beneficiary_id", "status");
