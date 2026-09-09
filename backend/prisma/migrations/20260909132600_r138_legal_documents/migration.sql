-- Versioned, immutable Privacy Policy and Terms of Use (R138 §12/§13).
--
-- ## The same pattern as legal_consent_text (20260902180000), one discriminator added
--
-- legal_consent_text enforces exactly one active row GLOBALLY, which is right
-- for one shared consent wording and wrong here: the Privacy Policy and Terms
-- of Use are two independent documents that must each have their own current
-- version in force at the same time. `kind` is that discriminator, and the
-- active-version invariant below is scoped by it rather than shared.
--
-- ## The active-version-per-kind invariant is a CONSTRAINT
--
-- `legal_document_one_active_per_kind` is a partial unique index over
-- `(kind) WHERE status = 'active'`. Two Super Admins activating two Privacy
-- Policy drafts concurrently cannot both succeed: one transaction fails on
-- the index. A service-level check alone would be a race, and this is the
-- one invariant whose violation means the public page could not say which
-- text is actually in force.
--
-- ## Nothing here references or rewrites anything else
--
-- Unlike legal_consent_text, no other table gains an FK to this one: nothing
-- records "which version of the Privacy Policy a reader saw" the way
-- consent_record does for the consent wording — the public page always shows
-- whichever version is active NOW, and a past version stays readable (never
-- deleted, only superseded) for the same reason legal_consent_text's rows
-- are never deleted: the platform must be able to answer what a document
-- said on a given date from its own data.

CREATE TYPE "legal_document_kind" AS ENUM ('privacy_policy', 'terms_of_use');
CREATE TYPE "legal_document_status" AS ENUM ('draft', 'active', 'superseded');

CREATE TABLE "legal_document" (
  "id"              UUID PRIMARY KEY,
  "kind"            "legal_document_kind" NOT NULL,
  "version_label"   VARCHAR(60) NOT NULL,
  "body_arabic"     TEXT NOT NULL,
  "status"          "legal_document_status" NOT NULL DEFAULT 'draft',
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "created_by_id"   UUID NOT NULL,
  "activated_at"    TIMESTAMPTZ(6),
  "activated_by_id" UUID,
  "superseded_at"   TIMESTAMPTZ(6),
  "version"         INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "legal_document_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "legal_document_activated_by_id_fkey"
    FOREIGN KEY ("activated_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  -- An activated row records WHO and WHEN, or it records neither.
  CONSTRAINT "legal_document_activation_provenance_check"
    CHECK (("activated_at" IS NULL) = ("activated_by_id" IS NULL)),
  -- A draft has never been in force; anything else has.
  CONSTRAINT "legal_document_status_activation_check"
    CHECK (("status" = 'draft') = ("activated_at" IS NULL)),
  -- Only a superseded version has stopped being in force.
  CONSTRAINT "legal_document_superseded_check"
    CHECK (("status" = 'superseded') = ("superseded_at" IS NOT NULL)),
  CONSTRAINT "legal_document_body_not_blank_check"
    CHECK (btrim("body_arabic") <> ''),
  CONSTRAINT "legal_document_version_label_not_blank_check"
    CHECK (btrim("version_label") <> '')
);

-- A label is unique WITHIN its kind, not across both: the Privacy Policy and
-- the Terms of Use are never compared to each other, so reusing "v1.0" for
-- both is not a collision.
CREATE UNIQUE INDEX "legal_document_kind_version_label_key"
  ON "legal_document" ("kind", "version_label");
CREATE INDEX "legal_document_kind_status_idx" ON "legal_document" ("kind", "status");

-- **The invariant.** At most one row per kind is active, enforced by the
-- database.
CREATE UNIQUE INDEX "legal_document_one_active_per_kind"
  ON "legal_document" ("kind") WHERE "status" = 'active';
