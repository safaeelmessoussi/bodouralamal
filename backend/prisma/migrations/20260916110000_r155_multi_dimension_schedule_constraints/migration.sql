-- SRS Revision 155 (expand phase, constraints companion) — everything
-- Prisma's schema syntax cannot express, kept apart from the previous
-- migration's CREATE TABLE statements for the same reason R43's own
-- constraints migration was kept apart from its expand migration.
--
-- Postgres has no ALTER of a CHECK constraint's definition — it must be
-- dropped and recreated. The three original disjuncts are reproduced
-- byte-for-byte; only a fourth is added. A schedule using the new
-- `multi_dimension` mode leaves all three legacy target columns NULL —
-- its real target lives in the five `course_schedule_*` join tables the
-- previous migration created, resolved by policy code, not by this
-- constraint (which only proves the LEGACY columns agree with each other).
--
-- contract-phase: this DROP is definitional, not destructive — it replaces
-- a CHECK constraint's text (byte-for-byte identical for the three legacy
-- disjuncts, one new disjunct added) within the SAME additive migration
-- that introduces `multi_dimension`, exactly as R137's own recurrence-CHECK
-- replacement did. No row, column or table is dropped; ratified end to end
-- by the Document Owner (SRS Revision 155).

ALTER TABLE "recurring_course_schedule"
  DROP CONSTRAINT "course_schedule_mode_target_check";

ALTER TABLE "recurring_course_schedule"
  ADD CONSTRAINT "course_schedule_mode_target_check"
  CHECK (
    (
      "teaching_mode" = 'entire_level'
      AND "level_id" IS NOT NULL
      AND "administrative_group_id" IS NULL
      AND "teaching_group_id" IS NULL
    ) OR (
      "teaching_mode" = 'administrative_group'
      AND "administrative_group_id" IS NOT NULL
      AND "level_id" IS NULL
      AND "teaching_group_id" IS NULL
    ) OR (
      "teaching_mode" = 'teaching_group'
      AND "teaching_group_id" IS NOT NULL
      AND "level_id" IS NULL
      AND "administrative_group_id" IS NULL
    ) OR (
      "teaching_mode" = 'multi_dimension'
      AND "level_id" IS NULL
      AND "administrative_group_id" IS NULL
      AND "teaching_group_id" IS NULL
    )
  );

-- A `multi_dimension` schedule must name at least one dimension across the
-- five join tables, or it would be a class nobody is ever the audience of
-- — silently created rather than refused, the exact failure mode §4.4's own
-- CHECKs exist to make impossible at the database rather than trusted to
-- every future write path. Expressed as a trigger, not a CHECK: a CHECK
-- cannot reference another table's rows.
CREATE OR REPLACE FUNCTION course_schedule_multi_dimension_nonempty()
RETURNS trigger AS $$
BEGIN
  IF NEW.teaching_mode = 'multi_dimension' THEN
    IF NOT EXISTS (SELECT 1 FROM course_schedule_branch WHERE schedule_id = NEW.id)
       AND NOT EXISTS (SELECT 1 FROM course_schedule_category WHERE schedule_id = NEW.id)
       AND NOT EXISTS (SELECT 1 FROM course_schedule_level WHERE schedule_id = NEW.id)
       AND NOT EXISTS (SELECT 1 FROM course_schedule_administrative_group WHERE schedule_id = NEW.id)
       AND NOT EXISTS (SELECT 1 FROM course_schedule_teaching_group WHERE schedule_id = NEW.id)
    THEN
      RAISE EXCEPTION 'a multi_dimension schedule must name at least one dimension (course_schedule_multi_dimension_nonempty)';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Deferred, and fired on the schedule row's own insert/update rather than
-- on the join tables: the service writes the schedule row FIRST, then its
-- join rows, all inside one transaction (exactly as `resolveTarget`'s three
-- existing modes are validated before the row is written, then trusted) —
-- a same-statement check would see the schedule before its own joins exist.
CREATE CONSTRAINT TRIGGER course_schedule_multi_dimension_nonempty_trigger
  AFTER INSERT OR UPDATE ON "recurring_course_schedule"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION course_schedule_multi_dimension_nonempty();
