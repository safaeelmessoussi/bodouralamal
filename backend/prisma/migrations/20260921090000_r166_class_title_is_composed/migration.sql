-- SRS Revision 166 §3 — a class is CALLED what it is; nobody types its title
-- (Document Owner decision, 2026-09-21).
--
-- Revision 57 gave a class its own typed name and Revision 138 snapshotted it
-- onto every occurrence. Revision 165 then pre-filled that name from the type,
-- the Subject, the Surah and the main teacher — and a stored suggestion goes
-- stale the first time anything it was built from changes (a cover teacher for
-- one date, a Surah changed for one occurrence, a class moved an hour). The
-- title is now COMPOSED at read time from what the row says (`lib/item-title`),
-- and what somebody wants to add in her own words goes in `description`.
--
-- **Nothing is dropped and nothing is rewritten.** The two columns are retired
-- in place: they stop being required, the application stops writing and reading
-- them, and every value already there stays exactly as it was typed. Removing
-- the columns is a later cleanup with no behaviour attached to it.
--
-- `exam.title` is NOT touched: the same column holds the titles of papers
-- authored in «بناء الاختبارات», which are those papers' identity.

ALTER TABLE "recurring_course_schedule" ALTER COLUMN "title" DROP NOT NULL;

ALTER TABLE "session" ALTER COLUMN "title" DROP DEFAULT;
ALTER TABLE "session" ALTER COLUMN "title" DROP NOT NULL;
