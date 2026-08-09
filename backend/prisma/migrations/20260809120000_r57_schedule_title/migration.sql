-- SRS Revision 57 — `RecurringCourseSchedule.title` and `.description`.
--
-- A CLASS NOW CARRIES ITS OWN NAME.
--
-- The model had none: a class was identified by its Subject and its target
-- (*تفسير · مجموعة 1*), which identifies correctly and names poorly — two
-- classes in one Subject for one group could not be told apart at a glance.
-- Every other schedulable item is named by something a person typed; a class
-- alone borrowed its name from a foreign key.
--
-- **Labels, never identifiers.** Neither column is unique, and neither takes any
-- part in conflict detection, recurrence, materialization, the R50 split or
-- audience resolution. `subject_id` remains what a client filters and links by.
--
-- TD-6b expand–migrate–contract, because a required column cannot simply appear
-- on a table that already has rows.

-- 1. EXPAND — both columns nullable, so existing rows stay valid.
--    TD-6a: `ar-x-icu` cannot be expressed in Prisma's schema syntax, so the
--    collation is applied here. It is what makes ORDER BY correct for Arabic
--    without a per-query COLLATE anywhere (§20 rule 13).
ALTER TABLE "recurring_course_schedule" ADD COLUMN "title" VARCHAR(120) COLLATE "ar-x-icu";
ALTER TABLE "recurring_course_schedule" ADD COLUMN "description" VARCHAR(2000);

-- 2. MIGRATE — backfill from the Subject's name.
--    Deliberately not a placeholder: a schedule created before this revision
--    *was* displayed under its Subject's name on every screen, so carrying that
--    forward preserves what each row already meant instead of inventing a value.
UPDATE "recurring_course_schedule" AS s
   SET "title" = sub."name"
  FROM "subject" AS sub
 WHERE sub."id" = s."subject_id"
   AND s."title" IS NULL;

-- A schedule whose Subject was itself soft-deleted still needs a name; this is
-- the only case the join above cannot answer, and it is a fallback rather than
-- a guess about what the class is called.
UPDATE "recurring_course_schedule"
   SET "title" = 'حصة'
 WHERE "title" IS NULL;

-- 3. CONTRACT — the column is required from here on.
ALTER TABLE "recurring_course_schedule" ALTER COLUMN "title" SET NOT NULL;

-- TD-9's bounds, enforced where they cannot drift from the application: an
-- empty or whitespace-only title is not a name.
ALTER TABLE "recurring_course_schedule"
  ADD CONSTRAINT "course_schedule_title_not_blank_check"
  CHECK (btrim("title") <> '');
