-- SRS Revision 195 (Owner, 2026-10-03) — a class addressed to a whole Level or
-- to an Administrative Group may have NO Subject: it teaches all the Level's
-- Subjects at once (a child's or a teen's group sits one session for
-- everything). `NULL` reads «كل المواد». A circle is a Subject's own split and
-- always names it; a filter-built class (`multi_dimension`) may leave it only
-- when it names a Level or a group and no circle — the service decides that,
-- since its audience is rows in other tables. What such a class produces —
-- its recordings, the materials attached to its occurrences — belongs to no
-- single Subject either: TD-5's «General», `NULL` on the content row. Expand
-- only; nothing stored changes.

ALTER TABLE "recurring_course_schedule" ALTER COLUMN "subject_id" DROP NOT NULL;
ALTER TABLE "recurring_course_schedule"
  ADD CONSTRAINT "course_schedule_subject_check" CHECK (
    "subject_id" IS NOT NULL OR "teaching_mode" <> 'teaching_group'
  );

ALTER TABLE "educational_content" ALTER COLUMN "subject_id" DROP NOT NULL;
