-- R131 Option B — the request/review control plane (Owner decision, 2026-09-03;
-- implemented 2026-09-04).
--
-- ## What this is, and what it deliberately is not
--
-- Option A closes the account and keeps the minimal educational archive. Option
-- B asks for the archive itself to be deleted, which may make a future
-- educational attestation impossible. That is why it is a **request** a Super
-- Admin reviews, and never a cascade a browser can start.
--
-- **This migration adds the control plane only.** Destructive execution is a
-- separate step, gated on the cross-domain classifications §4.10a leaves open,
-- and is NOT implemented. An `approved` row records a decision waiting to be
-- carried out; nothing deletes educational data today.
--
-- ## Why a table of its own
--
-- §4.10a's authority rule is not expressible on any existing entity: a
-- self-managed adult asks for herself, a live approved guardian asks for a
-- minor, and a FORMER guardian of a self-managed adult has neither basis. That
-- basis is evidence about the moment of asking — relationships change while a
-- request waits — so it is recorded on the row rather than re-derived later.
-- Reusing `SelfManagedClaim` or `FamilyLink` because their columns look similar
-- would put two lifecycles in one table, which is how a destructive verb reaches
-- the wrong row (R128).
--
-- ## The indexes are the queries
--
-- `status` serves the reviewer's queue. `(subject_id, status)` serves the
-- one-live-request-per-person check, which is asserted in the service rather
-- than by a partial unique index: a person may legitimately ask again after a
-- refusal, and the refusal is soft-deleted precisely so it does not block her.

CREATE TYPE "full_deletion_request_status" AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE "full_deletion_requester_basis" AS ENUM ('self', 'guardian');

CREATE TABLE "full_deletion_request" (
  "id"              UUID PRIMARY KEY,
  "subject_id"      UUID NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "requested_by"    UUID NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "basis"           "full_deletion_requester_basis" NOT NULL,
  "status"          "full_deletion_request_status" NOT NULL DEFAULT 'pending',
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "decided_at"      TIMESTAMPTZ(6),
  "decided_by"      UUID REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "decision_reason" VARCHAR(500),
  "deleted_at"      TIMESTAMPTZ(6),
  "deleted_by"      UUID
);

CREATE INDEX "full_deletion_request_status_idx" ON "full_deletion_request" ("status");
CREATE INDEX "full_deletion_request_subject_id_status_idx"
  ON "full_deletion_request" ("subject_id", "status");
