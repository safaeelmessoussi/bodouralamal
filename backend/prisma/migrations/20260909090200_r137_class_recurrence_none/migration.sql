-- R137 — «مرة واحدة» for حصة دراسية/محاضرة (Owner decision, 2026-09-09).
--
-- R43's `course_schedule_recurrence_not_none_check` reasoned that a
-- non-recurring occurrence is always an Event, because only Event modeled a
-- single dated occurrence. That is no longer true for a genuine one-time
-- class or lecture: it still needs the audience/room/staff richness only
-- `RecurringCourseSchedule` carries (a teaching group, a Subject, a Level),
-- which Event does not and was never meant to. The Owner's decision
-- supersedes R43's constraint for this one case rather than routing a
-- one-time class through a shape that cannot hold it.
--
-- contract-phase: R137 is a direct Document Owner decision, negotiated and
-- ratified before this migration, exactly as R43's own contract-phase drops
-- were (see 20260804200000_r43_contract_drop_retired_model). Both dropped
-- constraints are replaced immediately below in the same file, widening
-- rather than narrowing what a schedule may express, so no expand/migrate
-- straddle is needed — every existing row already satisfies the new,
-- strictly wider shape check unchanged.
ALTER TABLE "recurring_course_schedule"
  DROP CONSTRAINT "course_schedule_recurrence_not_none_check";

-- `none` reuses `anchor_date` as the occurrence's own single date — exactly
-- the column `biweekly_alternating` already anchors on, so no new column is
-- needed for a single-day series. `weekdays`/`day_of_month`/`month_of_year`
-- stay meaningless for `none` and the shape check does not require them.
ALTER TABLE "recurring_course_schedule"
  DROP CONSTRAINT "course_schedule_recurrence_shape_check";

ALTER TABLE "recurring_course_schedule"
  ADD CONSTRAINT "course_schedule_recurrence_shape_check"
  CHECK (
    ("recurrence" NOT IN ('biweekly_alternating', 'none') OR "anchor_date" IS NOT NULL)
    AND ("recurrence" NOT IN ('weekly', 'multiple_weekdays', 'biweekly_alternating')
         OR array_length("weekdays", 1) >= 1)
    AND ("recurrence" <> 'weekly' OR array_length("weekdays", 1) = 1)
    AND ("recurrence" NOT IN ('monthly', 'yearly') OR "day_of_month" IS NOT NULL)
    AND ("recurrence" <> 'yearly' OR "month_of_year" IS NOT NULL)
    AND ("day_of_month" IS NULL OR ("day_of_month" >= 1 AND "day_of_month" <= 31))
    AND ("month_of_year" IS NULL OR ("month_of_year" >= 1 AND "month_of_year" <= 12))
  );
