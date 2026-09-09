-- SRS Revision 138 — `Session.title` and `.description`.
--
-- A SESSION GAINS ITS OWN TITLE/DESCRIPTION, on the same snapshot-plus-
-- `overridden` footing every other Session field already has (`room_id`,
-- `delivery_mode`, `visibility`, all added by earlier revisions the same
-- way): written by `session.materialize` from the schedule's current
-- values, changeable for ONE date through `session.override`, and
-- thereafter spared by the next schedule edit through the SAME single
-- `overridden` flag — no second, per-field override marker (§4.4, R43.6).
--
-- TD-6b expand-migrate-contract for `title`, exactly as
-- `20260809120000_r57_schedule_title` did for `recurring_course_schedule`.

-- 1. EXPAND — nullable, so existing rows stay valid.
--    TD-6a: `ar-x-icu` cannot be expressed in Prisma's schema syntax, so the
--    collation is applied here, matching the schedule's own title column.
ALTER TABLE "session" ADD COLUMN "title" VARCHAR(120) COLLATE "ar-x-icu";
ALTER TABLE "session" ADD COLUMN "description" VARCHAR(2000);

-- 2. MIGRATE — backfill from the owning schedule's CURRENT title/description.
--    Every existing Session was already displayed under its schedule's name
--    on every screen (Session carried no title of its own before this
--    revision), so carrying that forward preserves what each row already
--    meant rather than inventing a value.
UPDATE "session" AS s
   SET "title" = rcs."title",
       "description" = rcs."description"
  FROM "recurring_course_schedule" AS rcs
 WHERE rcs."id" = s."schedule_id"
   AND s."title" IS NULL;

-- A session whose schedule was itself soft-deleted (a real state — the
-- schedule can be removed once its future occurrences are gone, but a
-- historical Session survives it, TD-5) still needs a name; this is the only
-- case the join above cannot answer, and it is a fallback rather than a
-- guess about what the class was called.
UPDATE "session"
   SET "title" = 'حصة'
 WHERE "title" IS NULL;

-- 3. CONTRACT — the column is required from here on. A DB-layer DEFAULT is
--    also set here, unlike `recurring_course_schedule.title` (which has
--    none) — every REAL Session is written by `session.materialize` or an
--    explicit `session.override`, both of which always supply this
--    explicitly; the default exists solely for the many pre-existing direct
--    test fixtures elsewhere in this codebase that construct a scratch
--    Session for an unrelated scenario and assert nothing about its title.
ALTER TABLE "session" ALTER COLUMN "title" SET NOT NULL;
ALTER TABLE "session" ALTER COLUMN "title" SET DEFAULT 'حصة';

-- TD-9's bounds, enforced where they cannot drift from the application: an
-- empty or whitespace-only title is not a name — the same guard
-- `recurring_course_schedule` already carries.
ALTER TABLE "session"
  ADD CONSTRAINT "session_title_not_blank_check"
  CHECK (btrim("title") <> '');
