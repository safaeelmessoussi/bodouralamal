-- SRS Revision 50 — `RecurringCourseSchedule.effective_until`.
--
-- THE LAST DATE THIS RECURRENCE PRODUCES OCCURRENCES FOR.
--
-- The model could say when a series BEGINS (`anchor_date`) and not when it
-- STOPS, which is the single reason "this session and all future sessions" had
-- no mechanism. §4.4 (R50) implements that scope by SPLITTING a schedule: the
-- current one is closed here, and a successor is anchored at the split date.
--
-- **NULL is open-ended**, which every schedule created before this revision is
-- and most created after it. A calendar DATE rather than a timestamp (TD-11): a
-- schedule ends after a day's classes, not at a timezone-dependent moment.
--
-- No backfill and no default: NULL already means exactly what every existing
-- row means.
ALTER TABLE "recurring_course_schedule" ADD COLUMN "effective_until" DATE;

-- A schedule that ends before it starts produces nothing and is certainly a
-- mistake — the database refuses it rather than leaving a silently empty series.
ALTER TABLE "recurring_course_schedule"
  ADD CONSTRAINT "course_schedule_effective_until_check"
  CHECK ("effective_until" IS NULL OR "anchor_date" IS NULL OR "effective_until" >= "anchor_date");
