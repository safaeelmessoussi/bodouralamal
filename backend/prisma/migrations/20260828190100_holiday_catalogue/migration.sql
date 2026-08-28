-- The catalogue's kinds, corrected in place (Owner decision, 2026-08-28).
--
-- A separate migration from the enum addition on purpose: PostgreSQL cannot use
-- a new enum value in the same transaction that adds it.
--
-- Ids are preserved — these are UPDATEs, not a delete-and-recreate — because a
-- scheduling type is reference data an administrator may already have edited,
-- and R110 made the database authoritative for it after initialization.

UPDATE "scheduling_type" SET "structural_kind" = 'class'
 WHERE "name" = 'محاضرة' AND "deleted_at" IS NULL;

UPDATE "scheduling_type" SET "structural_kind" = 'holiday'
 WHERE "name" = 'عطلة' AND "deleted_at" IS NULL;

-- The generic activity the catalogue lacked. Additive and idempotent: a rerun
-- must not create a second one, and must not resurrect one an administrator
-- deleted (R110's rule — the database is authoritative after initialization).
-- `updated_at` is NOT NULL with no default (`@updatedAt` is Prisma-side), so an
-- INSERT that omits it fails. Supplied explicitly rather than adding a database
-- default, which would change the column for every other writer.
INSERT INTO "scheduling_type"
       ("id", "name", "structural_kind", "attendance_required", "display_order", "updated_at")
SELECT gen_random_uuid(), 'نشاط', 'activity', FALSE,
       COALESCE((SELECT MAX("display_order") FROM "scheduling_type"), 0) + 1, now()
 WHERE NOT EXISTS (SELECT 1 FROM "scheduling_type" WHERE "name" = 'نشاط');
