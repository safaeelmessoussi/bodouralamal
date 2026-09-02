-- Versioned, immutable legal consent wording (Owner, 2026-09-02).
--
-- ## What this replaces
--
-- The Arabic consent wording lived in the frontend's `i18n/ar.ts`; the version
-- string lived in the `legal.consent_text_version` SystemSetting; a
-- `consent_record` stored only that string. Nothing bound the three together,
-- so the wording could change without the version and the version without the
-- wording — and the platform could not answer *«what exactly did this person
-- agree to»* from its own data at all.
--
-- ## Nothing here rewrites existing evidence
--
-- `consent_record.consent_text_version` is untouched on every existing row.
-- `consent_text_id` is added NULL and is **not backfilled**: no
-- `legal_consent_text` is manufactured for a historical string, because the
-- wording those people saw was never stored and asserting today's text was it
-- would be fabricating evidence. NULL means *«the wording is not resolvable»*,
-- which is the honest state, and the version string beside it is preserved as
-- the evidence that does exist.
--
-- ## The active-version invariant is a CONSTRAINT
--
-- `legal_consent_text_one_active` is a partial unique index over
-- `status = 'active'`. Two administrators activating two versions concurrently
-- cannot both succeed: one transaction fails on the index. A service-level
-- check alone would be a race, and this is the one invariant whose violation
-- means a person could be recorded as agreeing to wording nobody put in force.
--
-- `RESTRICT` on both references: consent evidence must stay reconstructible, so
-- a wording somebody agreed to can never be deleted out from under the record
-- that names it.

CREATE TYPE "legal_consent_text_status" AS ENUM ('draft', 'active', 'superseded');

CREATE TABLE "legal_consent_text" (
  "id"              UUID PRIMARY KEY,
  "version_label"   VARCHAR(60) NOT NULL,
  "body_arabic"     TEXT NOT NULL,
  "body_digest"     CHAR(64) NOT NULL,
  "status"          "legal_consent_text_status" NOT NULL DEFAULT 'draft',
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "created_by_id"   UUID NOT NULL,
  "activated_at"    TIMESTAMPTZ(6),
  "activated_by_id" UUID,
  "superseded_at"   TIMESTAMPTZ(6),
  "version"         INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "legal_consent_text_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "legal_consent_text_activated_by_id_fkey"
    FOREIGN KEY ("activated_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  -- An activated row records WHO and WHEN, or it records neither. A version in
  -- force whose provenance is half-missing is not auditable evidence.
  CONSTRAINT "legal_consent_text_activation_provenance_check"
    CHECK (("activated_at" IS NULL) = ("activated_by_id" IS NULL)),
  -- A draft has never been in force; anything else has.
  CONSTRAINT "legal_consent_text_status_activation_check"
    CHECK (("status" = 'draft') = ("activated_at" IS NULL)),
  -- Only a superseded version has stopped being in force.
  CONSTRAINT "legal_consent_text_superseded_check"
    CHECK (("status" = 'superseded') = ("superseded_at" IS NOT NULL)),
  CONSTRAINT "legal_consent_text_digest_check"
    CHECK ("body_digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "legal_consent_text_body_not_blank_check"
    CHECK (btrim("body_arabic") <> '')
);

CREATE UNIQUE INDEX "legal_consent_text_version_label_key"
  ON "legal_consent_text" ("version_label");
CREATE INDEX "legal_consent_text_status_idx" ON "legal_consent_text" ("status");

-- **The invariant.** At most one row is active, enforced by the database.
CREATE UNIQUE INDEX "legal_consent_text_one_active"
  ON "legal_consent_text" (("status")) WHERE "status" = 'active';

ALTER TABLE "consent_record" ADD COLUMN "consent_text_id" UUID;
ALTER TABLE "consent_record"
  ADD CONSTRAINT "consent_record_consent_text_id_fkey"
  FOREIGN KEY ("consent_text_id") REFERENCES "legal_consent_text"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "consent_record_consent_text_id_idx"
  ON "consent_record" ("consent_text_id");

ALTER TABLE "child_application" ADD COLUMN "consent_text_id" UUID;
ALTER TABLE "child_application"
  ADD CONSTRAINT "child_application_consent_text_id_fkey"
  FOREIGN KEY ("consent_text_id") REFERENCES "legal_consent_text"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "child_application_consent_text_id_idx"
  ON "child_application" ("consent_text_id");
