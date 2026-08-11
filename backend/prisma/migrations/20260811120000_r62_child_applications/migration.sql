-- R62 — parent and child registration: one request, many children, decided one
-- child at a time.
--
-- Forward-only (TD-6b). Nothing is dropped and nothing is backfilled with a
-- guess: every new column is nullable where an existing row cannot have a
-- truthful value.

-- ── Enums ──────────────────────────────────────────────────────────────────
CREATE TYPE "relationship_type" AS ENUM ('mother', 'father', 'legal_guardian');

CREATE TYPE "schooling_stage" AS ENUM (
  'pre_primary', 'primary', 'middle', 'high', 'post_secondary', 'not_in_school'
);

CREATE TYPE "child_application_status" AS ENUM ('pending', 'approved', 'rejected');

CREATE TYPE "child_application_rejection_reason" AS ENUM (
  'duplicate_application', 'insufficient_information', 'not_eligible', 'other'
);

-- ── FamilyLink ─────────────────────────────────────────────────────────────
-- Nullable: rows predating R62 have no relationship recorded, and inventing one
-- would be a fabrication about a family.
ALTER TABLE "family_link" ADD COLUMN "relationship_type" "relationship_type";

-- ── User ───────────────────────────────────────────────────────────────────
-- `reference_code` is nullable and UNIQUE. Students receive one; staff do not.
-- Unique among non-null values, which is what a plain UNIQUE gives in Postgres.
ALTER TABLE "user" ADD COLUMN "reference_code" VARCHAR(16);
ALTER TABLE "user" ADD COLUMN "schooling_stage" "schooling_stage";
CREATE UNIQUE INDEX "user_reference_code_key" ON "user" ("reference_code");

-- ── ChildApplication ───────────────────────────────────────────────────────
CREATE TABLE "child_application" (
  "id"                       UUID PRIMARY KEY,
  "request_id"               UUID NOT NULL,
  "parent_id"                UUID NOT NULL,
  "child_user_id"            UUID,
  "first_name_arabic"        VARCHAR(60) NOT NULL,
  "last_name_arabic"         VARCHAR(60) NOT NULL,
  "sex"                      "sex",
  "schooling_stage"          "schooling_stage",
  "requested_category_id"    UUID,
  "consent_data_processing"  BOOLEAN NOT NULL,
  "consent_media_release"    BOOLEAN NOT NULL,
  "consent_text_version"     VARCHAR(60) NOT NULL,
  "consent_given_at"         TIMESTAMPTZ(6) NOT NULL,
  "status"                   "child_application_status" NOT NULL DEFAULT 'pending',
  "matched_existing_user_id" UUID,
  "rejection_reason"         "child_application_rejection_reason",
  "internal_note"            VARCHAR(500),
  "decided_at"               TIMESTAMPTZ(6),
  "decided_by"               UUID,
  "created_at"               TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"               TIMESTAMPTZ(6) NOT NULL,
  "deleted_at"               TIMESTAMPTZ(6),
  "deleted_by"               UUID,

  CONSTRAINT "child_application_parent_id_fkey"
    FOREIGN KEY ("parent_id") REFERENCES "user"("id") ON DELETE RESTRICT,
  CONSTRAINT "child_application_child_user_id_fkey"
    FOREIGN KEY ("child_user_id") REFERENCES "user"("id") ON DELETE RESTRICT,
  CONSTRAINT "child_application_matched_existing_user_id_fkey"
    FOREIGN KEY ("matched_existing_user_id") REFERENCES "user"("id") ON DELETE RESTRICT,
  CONSTRAINT "child_application_decided_by_fkey"
    FOREIGN KEY ("decided_by") REFERENCES "user"("id") ON DELETE RESTRICT,
  CONSTRAINT "child_application_requested_category_id_fkey"
    FOREIGN KEY ("requested_category_id") REFERENCES "category"("id") ON DELETE RESTRICT,

  -- A decided application names who decided it and when. A pending one names
  -- neither. Half-decided is not a state the queue can render honestly.
  CONSTRAINT "child_application_decision_complete_check" CHECK (
    ("status" = 'pending'  AND "decided_at" IS NULL AND "decided_by" IS NULL)
    OR
    ("status" <> 'pending' AND "decided_at" IS NOT NULL AND "decided_by" IS NOT NULL)
  ),

  -- An APPROVED application must name the child it created or linked; a
  -- rejected one must not, because R62 creates no child for a rejection.
  CONSTRAINT "child_application_approved_has_child_check" CHECK (
    ("status" = 'approved' AND "child_user_id" IS NOT NULL)
    OR
    ("status" <> 'approved' AND ("status" <> 'rejected' OR "child_user_id" IS NULL))
  ),

  -- A rejection states a bounded reason. The internal note is optional and is
  -- never returned to a parent.
  CONSTRAINT "child_application_rejected_has_reason_check" CHECK (
    ("status" = 'rejected') = ("rejection_reason" IS NOT NULL)
  )
);

CREATE INDEX "child_application_request_id_idx"        ON "child_application" ("request_id");
CREATE INDEX "child_application_parent_id_status_idx"  ON "child_application" ("parent_id", "status");
CREATE INDEX "child_application_status_created_at_idx" ON "child_application" ("status", "created_at");
