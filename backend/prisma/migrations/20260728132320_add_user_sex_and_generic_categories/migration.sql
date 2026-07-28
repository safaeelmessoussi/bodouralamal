-- SRS Revision 27 — generic educational stages; sex belongs to the person.
--
-- Two halves. The DDL adds `User.sex`, the person-side counterpart of
-- `Level.gender_restriction` — without it the restriction is unenforceable,
-- because nothing can compare a person against a `girls_only` Level.
--
-- The data migration then moves the sex restriction out of the Arabic category
-- NAMES, where no query could read it, and into `gender_restriction`, where
-- §4.4b always said it belonged. Before this migration every seeded Level
-- carried `any`, so "Teen + Male is unavailable" was expressed only by the
-- feminine plural in `اليافعات`.
--
-- Renames are UPDATEs on data, not schema renames: TD-6b forbids the latter and
-- requires data preservation, so the existing Category rows keep their ids and
-- their Levels stay attached. Creating new rows instead would orphan 21 Levels.

-- CreateEnum
CREATE TYPE "sex" AS ENUM ('female', 'male');

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "sex" "sex";

-- ── Data migration: generic stage names (Revision 27, §15.1) ────────────────
-- Guarded by the legacy name so re-running is a no-op, and so a deployment that
-- never carried the legacy data is unaffected.
UPDATE "category" SET "name" = 'الكبار'   WHERE "name" = 'المرأة';
UPDATE "category" SET "name" = 'اليافعون' WHERE "name" = 'اليافعات';
-- `الطفل` is already sex-neutral and is deliberately left untouched.

-- ── Data migration: the MVP's availability becomes readable data ────────────
-- Adult and Teen levels are female-only in the MVP; Child levels admit both.
-- Enabling Teen + Male or Adult + Male later is Super Admin data entry (adding
-- Levels, R26) — no rename, no schema change, no registration-flow change.
UPDATE "level" SET "gender_restriction" = 'girls_only'
WHERE "gender_restriction" = 'any'
  AND "category_id" IN (SELECT "id" FROM "category" WHERE "name" IN ('الكبار', 'اليافعون'));
