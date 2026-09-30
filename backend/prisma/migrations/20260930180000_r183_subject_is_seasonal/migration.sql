-- SRS Revision 183 §1 — a SEASONAL course is not the year's programme
-- (Document Owner decision, 2026-09-30).
--
-- Some Subjects are courses taught for a limited period — a week, a few
-- days — and organised any time of the year, any number of times; they are
-- not part of a Level's programme and «برامجنا التعليمية» must not list them
-- as if they were. "Which Subjects are seasonal" is a fact about the Subject
-- (`subject.is_seasonal`, a tick-box on «المواد»), never a match on its name
-- (R27 made Subjects editable reference data; §4.4b requires rules checked
-- generically). Scheduling, exams and the curriculum policy are untouched: a
-- course is still taught, planned and assessed exactly as before.

ALTER TABLE "subject"
  ADD COLUMN "is_seasonal" BOOLEAN NOT NULL DEFAULT false;

-- The rows the Owner named on 2026-09-30 — the courses whose names begin with
-- «دورة». A ONE-TIME data statement against the names as they stand; no
-- runtime rule reads a Subject's name, before or after this migration.
UPDATE "subject"
   SET "is_seasonal" = true
 WHERE "deleted_at" IS NULL
   AND "name" LIKE 'دورة%';
