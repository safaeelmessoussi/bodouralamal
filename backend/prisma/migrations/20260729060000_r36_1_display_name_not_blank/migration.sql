-- SRS Revision 36.1, TD-9 — "unset" must have exactly one representation.
--
-- Hand-written (TD-6a): Prisma has no CHECK constraints. NULL means "no public
-- name chosen, fall back to the full name"; an empty or whitespace-only string
-- would be a *third* state that reads as set but renders as nothing — and would
-- defeat the fallback, publishing a blank instructor instead of a name. The
-- application trims to NULL; this is the backstop for any other writer.
--
-- ── ORDERING DEFECT, REPAIRED (found 2026-08-01, Revision 39 work) ───────────
-- This migration is named `20260729060000` and the one that ADDS
-- `public_display_name` is named `20260729150624` — nine hours later. Prisma
-- applies migrations in filename order, so on a CLEAN database this ran first
-- and failed:
--
--     ERROR: column "public_display_name" does not exist  (SQLSTATE 42703)
--
-- Every existing database was fine, because the two were applied in the order
-- they were authored and `_prisma_migrations` recorded both as done. The break
-- was therefore invisible to every developer and to CI, and would have
-- surfaced exactly once: at the FIRST production deployment, where §19.1 step 5
-- runs `prisma migrate deploy` against an empty database.
--
-- The repair is to make both migrations **idempotent and order-independent**
-- rather than to renumber one — a directory name is recorded in
-- `_prisma_migrations`, so renaming it would orphan the row on every database
-- that has already applied it. Verified by running `migrate deploy` against a
-- freshly created database, which now succeeds.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "public_display_name" VARCHAR(120);

-- `IF NOT EXISTS` has no ADD CONSTRAINT form in PostgreSQL, so the guard is
-- explicit. Re-running must be safe: on an existing database the constraint is
-- already there.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_public_display_name_not_blank_check'
  ) THEN
    ALTER TABLE "user"
      ADD CONSTRAINT "user_public_display_name_not_blank_check"
      CHECK ("public_display_name" IS NULL OR btrim("public_display_name") <> '');
  END IF;
END $$;
