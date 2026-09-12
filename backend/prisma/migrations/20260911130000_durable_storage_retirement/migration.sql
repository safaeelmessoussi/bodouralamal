-- B4/B5: operational outbox, independent of pg-boss execution retention and of
-- content/Trash lifetime. No existing domain row is changed or removed.
CREATE TABLE "storage_retirement" (
  "id" UUID NOT NULL,
  "dedup_key" VARCHAR(64) NOT NULL,
  "content_id" UUID NOT NULL,
  "operation" VARCHAR(40) NOT NULL,
  "bucket" VARCHAR(20) NOT NULL,
  "storage_key" TEXT,
  "copy_settled" BOOLEAN NOT NULL DEFAULT TRUE,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error_code" VARCHAR(40),
  "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(6),
  CONSTRAINT "storage_retirement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "storage_retirement_operation_check" CHECK ("operation" IN (
    'quarantine_retired_object', 'manual_permanent_delete', 'discard_unreferenced',
    'placement_attempt', 'retire_public', 'consent_migrate')),
  CONSTRAINT "storage_retirement_bucket_check" CHECK ("bucket" IN ('public', 'private')),
  CONSTRAINT "storage_retirement_attempts_check" CHECK ("attempts" >= 0),
  CONSTRAINT "storage_retirement_copy_check" CHECK (
    "copy_settled" OR ("operation" = 'placement_attempt' AND "completed_at" IS NULL)),
  CONSTRAINT "storage_retirement_locator_check" CHECK (
    ("completed_at" IS NULL AND "storage_key" IS NOT NULL AND "storage_key" LIKE 'content/' || "content_id"::text || '/%') OR
    ("completed_at" IS NOT NULL AND "storage_key" IS NULL))
);
CREATE UNIQUE INDEX "storage_retirement_dedup_key_key" ON "storage_retirement"("dedup_key");
CREATE INDEX "storage_retirement_completed_at_next_attempt_at_id_idx"
  ON "storage_retirement"("completed_at", "next_attempt_at", "id");
CREATE INDEX "storage_retirement_content_id_idx" ON "storage_retirement"("content_id");
