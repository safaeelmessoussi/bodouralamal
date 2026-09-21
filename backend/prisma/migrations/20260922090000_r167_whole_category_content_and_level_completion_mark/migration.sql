-- SRS Revision 167 (Document Owner decisions, 2026-09-21).
--
-- §5 — A LIBRARY ITEM MAY ADDRESS EVERY LEVEL OF ITS CATEGORY.
--
-- A recording belongs to one Level (`educational_content.level_id`, NOT NULL —
-- §4.9 groups the library by Level, and the Owner keeps that rule). A class
-- given to EVERY Level of one Category produced a recording only its first
-- Level could open. `whole_category` says the item is addressed to all the
-- Levels of its Level's Category — the ones that exist today and the ones
-- added later, because the Category is read through `level_id` at the moment
-- of the read and is never copied here (so the two cannot disagree).
-- `branch_id` keeps its meaning unchanged: NULL is every branch, a value is one.
ALTER TABLE "educational_content"
  ADD COLUMN "whole_category" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "educational_content_whole_category_idx"
  ON "educational_content" ("level_id")
  WHERE "whole_category" = true AND "deleted_at" IS NULL;

-- §3 — «إتمام المستوى»: THE ADMINISTRATION'S ATTESTATION, AND ITS CERTIFICATE.
--
-- BR-11 stays DERIVED and is never stored (Revision 166 §1). This is a
-- different fact: that an Admin or Super Admin RECORDED that a مستفيدة
-- completed a Level — which she may do knowingly while BR-11 is not yet met
-- (`requirements_met` keeps what BR-11 read at that moment, so the record says
-- whether the attestation agreed with the engine, for ever).
--
-- One row per (student, Level): completion is a fact about her and the Level,
-- not about one semester's enrolment (R122 lets her hold several).
--
-- The certificate is a second, separate confirmation. Its number comes from a
-- sequence at first issue and is never reused: withdrawing a certificate hides
-- it from her dashboard and keeps the number, so a printed copy stays traceable.
--
-- No soft delete: removing a mark made in error is a correction, the audit log
-- records who made it, and a mark whose certificate is showing cannot be
-- removed at all (the service withdraws the certificate first).
CREATE SEQUENCE "level_certificate_number_seq" AS INTEGER START WITH 1;

CREATE TABLE "level_completion_mark" (
  "id"                    UUID NOT NULL DEFAULT gen_random_uuid(),
  "student_id"            UUID NOT NULL,
  "level_id"              UUID NOT NULL,
  "branch_id"             UUID NOT NULL,
  "requirements_met"      BOOLEAN NOT NULL,
  "completed_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "completed_by"          UUID NOT NULL,
  "certificate_number"    INTEGER,
  "certificate_issued_at" TIMESTAMPTZ(6),
  "certificate_issued_by" UUID,

  CONSTRAINT "level_completion_mark_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "level_completion_mark_student_id_fkey"
    FOREIGN KEY ("student_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "level_completion_mark_level_id_fkey"
    FOREIGN KEY ("level_id") REFERENCES "level"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "level_completion_mark_branch_id_fkey"
    FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "level_completion_mark_completed_by_fkey"
    FOREIGN KEY ("completed_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "level_completion_mark_certificate_issued_by_fkey"
    FOREIGN KEY ("certificate_issued_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  -- Issued means: by somebody, with a number.
  CONSTRAINT "level_completion_mark_certificate_check"
    CHECK (
      ("certificate_issued_at" IS NULL AND "certificate_issued_by" IS NULL)
      OR ("certificate_issued_at" IS NOT NULL AND "certificate_issued_by" IS NOT NULL
          AND "certificate_number" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "level_completion_mark_student_level_key"
  ON "level_completion_mark" ("student_id", "level_id");
CREATE UNIQUE INDEX "level_completion_mark_certificate_number_key"
  ON "level_completion_mark" ("certificate_number");
CREATE INDEX "level_completion_mark_level_idx"
  ON "level_completion_mark" ("level_id");
