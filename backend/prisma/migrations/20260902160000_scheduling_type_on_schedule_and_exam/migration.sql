-- A schedule and a sitting record WHICH catalogue type they are (Owner, 2026-09-02).
--
-- ## Why
--
-- `الجدول الزمني`'s type filter exposed the internal occurrence vocabulary —
-- session / event / exam — so the association's own words for what it schedules
-- («حصة دراسية», «محاضرة», «حفل», «عطلة») were not offerable, and a عطلة was
-- indistinguishable from an ordinary activity because both are stored as an
-- `Event`.
--
-- Only `Event` carried `scheduling_type_id`. R110 deliberately keeps
-- `structural_kind` as the answer to *which entity delivers this*, and that is
-- unchanged — this adds the separate answer to *which catalogue row is it*, for
-- the two entities that had nowhere to put it.
--
-- ## Nullable, and no backfill
--
-- Every existing schedule and sitting predates the catalogue and records no
-- type. Guessing one would be exactly the name-matching §4.4b forbids — «حصة
-- دراسية» and «محاضرة» are both `class`, and nothing in an old row says which it
-- was. A legacy row therefore matches no type filter and appears under «الكل»,
-- which is the honest answer.
--
-- `RESTRICT`, like `event.scheduling_type_id`: a retired type must stay
-- resolvable by the rows that used it, or tidying the catalogue destroys the
-- record of what something WAS.

ALTER TABLE "recurring_course_schedule" ADD COLUMN "scheduling_type_id" UUID;
ALTER TABLE "recurring_course_schedule"
  ADD CONSTRAINT "recurring_course_schedule_scheduling_type_id_fkey"
  FOREIGN KEY ("scheduling_type_id") REFERENCES "scheduling_type"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "recurring_course_schedule_scheduling_type_id_idx"
  ON "recurring_course_schedule" ("scheduling_type_id");

ALTER TABLE "exam" ADD COLUMN "scheduling_type_id" UUID;
ALTER TABLE "exam"
  ADD CONSTRAINT "exam_scheduling_type_id_fkey"
  FOREIGN KEY ("scheduling_type_id") REFERENCES "scheduling_type"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "exam_scheduling_type_id_idx" ON "exam" ("scheduling_type_id");
