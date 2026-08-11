-- Revision 66 — a student is enrolled in a Level; a Group is a subdivision.
--
-- TD-6b expand → backfill → contract. Nothing is dropped and nothing is
-- deleted; every value written here is DERIVED from data that already exists,
-- so the migration is reversible by inspection.
--
-- The whole revision is the second column below. A student's branch used to be
-- reachable only through their Administrative Group, which is exactly why the
-- group could not be optional: an ungrouped student would have had no branch,
-- and Admin scoping, Teaching-Group placement (R43.3), the Educational
-- Library's own-branch ordering and `entire_level` audience resolution all
-- require one. The enrolment is the operational assignment, so the branch
-- belongs on it.

-- ── Expand ──────────────────────────────────────────────────────────────────

-- A Level that needs no subdivision needs no group.
ALTER TABLE "enrollment" ALTER COLUMN "administrative_group_id" DROP NOT NULL;

ALTER TABLE "enrollment" ADD COLUMN "branch_id" uuid NULL;

-- ── Backfill ────────────────────────────────────────────────────────────────
--
-- Every enrolment that exists today has a group, because until this migration
-- the column was NOT NULL. So every row gets a value and the contract step
-- below cannot fail on live data.
UPDATE "enrollment" e
   SET "branch_id" = g."branch_id"
  FROM "administrative_group" g
 WHERE g."id" = e."administrative_group_id"
   AND e."branch_id" IS NULL;

-- Fail LOUDLY rather than silently relaxing the column: a row with no branch
-- after the backfill would mean an enrolment pointing at a group that does not
-- exist, which is a referential problem this migration must not paper over.
DO $$
DECLARE orphans bigint;
BEGIN
  SELECT count(*) INTO orphans FROM "enrollment" WHERE "branch_id" IS NULL;
  IF orphans > 0 THEN
    RAISE EXCEPTION
      'R66: % enrollment row(s) could not derive a branch from their administrative group', orphans;
  END IF;
END $$;

-- ── Contract ────────────────────────────────────────────────────────────────

ALTER TABLE "enrollment" ALTER COLUMN "branch_id" SET NOT NULL;

ALTER TABLE "enrollment"
  ADD CONSTRAINT "enrollment_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The unique constraint the composite FK below needs. Redundant against the
-- primary key on purpose — PostgreSQL requires it on the REFERENCED columns.
CREATE UNIQUE INDEX "administrative_group_id_branch_id_key"
  ON "administrative_group" ("id", "branch_id");

-- **The enrolment's branch is provably the group's, not a copy that drifts.**
-- The same device R43 already uses for (administrative_group_id, level_id), and
-- it needs no exception for ungrouped enrolments: a composite FK in PostgreSQL
-- (MATCH SIMPLE, the default) is not enforced when any of its columns is NULL.
ALTER TABLE "enrollment"
  ADD CONSTRAINT "enrollment_group_branch_fkey"
  FOREIGN KEY ("administrative_group_id", "branch_id")
  REFERENCES "administrative_group" ("id", "branch_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "enrollment_branch_id_deleted_at_idx" ON "enrollment" ("branch_id", "deleted_at");
