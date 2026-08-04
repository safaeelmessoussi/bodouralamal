-- SRS Revision 43 / 43.2 — the guarantees Prisma cannot express (TD-6a).
--
-- Companion to `_r43_educational_model_expand`, which created the tables. Every
-- statement here is one of: a native `ar-x-icu` collation, a CHECK constraint, a
-- PARTIAL unique index, or a COMPOSITE foreign key. Prisma's schema syntax can
-- declare none of them, and §20 rule 5 forbids trying.
--
-- Two of these are the load-bearing ones, and they are the same idea twice:
-- a uniqueness rule that spans two tables cannot be a unique index, because a
-- PostgreSQL index cannot join. So the second table is carried ON the row and a
-- composite FK forces it to agree with its parent. That turns a denormalized
-- column into a CONSTRAINT rather than a copy that drifts (§20 rule 22).

-- ---------------------------------------------------------------------------
-- Collations (BR-19, §2.2) — ordering is correct by default in every query,
-- with no per-query COLLATE clause anywhere (§20 rule 13).
-- ---------------------------------------------------------------------------

ALTER TABLE "administrative_group"
  ALTER COLUMN "name" TYPE text COLLATE "ar-x-icu";

ALTER TABLE "teaching_group"
  ALTER COLUMN "name" TYPE text COLLATE "ar-x-icu";

-- ---------------------------------------------------------------------------
-- Enrollment — "exactly one Administrative Group per enrolled Level" (BR-21).
--
-- The rule spans `enrollment → administrative_group → level`. A plain unique
-- index cannot express it, so `enrollment.level_id` exists and this FK is what
-- makes it honest: the database REFUSES a row whose level disagrees with its
-- group's. Only then is the partial unique below a true statement of BR-21.
--
-- Never drop this FK to "remove the duplicate column" — without it the column
-- becomes exactly the second source of truth the design exists to prevent.
-- ---------------------------------------------------------------------------

ALTER TABLE "enrollment"
  ADD CONSTRAINT "enrollment_group_level_agree_fkey"
  FOREIGN KEY ("administrative_group_id", "level_id")
  REFERENCES "administrative_group" ("id", "level_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Scoped to live rows: a student who left a Level and returns must be able to
-- enrol again, and the soft-deleted row must not block them.
CREATE UNIQUE INDEX "enrollment_student_level_unique"
  ON "enrollment" ("student_id", "level_id")
  WHERE "deleted_at" IS NULL;

-- ---------------------------------------------------------------------------
-- StudentTeachingGroup — "at most one Teaching Group per (student, Subject,
-- Level)" (BR-22), which is what makes the splits INDEPENDENT BETWEEN SUBJECTS:
-- the uniqueness is per Subject, so Quran Group 2 and Tajweed Group 1 coexist.
--
-- Revision 43 specified this as "a functional unique index over the join". That
-- is not expressible — an index cannot reference another table — so 43.2
-- applies the Enrollment technique instead. Same problem, same solution.
-- ---------------------------------------------------------------------------

ALTER TABLE "student_teaching_group"
  ADD CONSTRAINT "student_teaching_group_subject_level_agree_fkey"
  FOREIGN KEY ("teaching_group_id", "subject_id", "level_id")
  REFERENCES "teaching_group" ("id", "subject_id", "level_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "student_teaching_group_student_subject_level_unique"
  ON "student_teaching_group" ("student_id", "subject_id", "level_id")
  WHERE "deleted_at" IS NULL;

-- ---------------------------------------------------------------------------
-- RecurringCourseSchedule — the mode/target agreement (§4.4c).
--
-- A mode without its target, or a target without its mode, is a schedule that
-- nothing can resolve a roster for. Enforcing it here rather than in the service
-- means a future importer or a hand-written INSERT cannot create one either.
-- ---------------------------------------------------------------------------

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
    )
  );

-- A schedule that never recurs is a one-off activity, which is an Event (§4.4).
-- Allowing `none` here would give the platform two ways to express one thing.
ALTER TABLE "recurring_course_schedule"
  ADD CONSTRAINT "course_schedule_recurrence_not_none_check"
  CHECK ("recurrence" <> 'none');

ALTER TABLE "recurring_course_schedule"
  ADD CONSTRAINT "course_schedule_time_order_check"
  CHECK ("start_time" < "end_time");

-- `biweekly_alternating` is undefined without an anchor: "week on" and "week
-- off" are indistinguishable unless something says which week the count starts
-- from. The weekday-bearing patterns are equally meaningless with no weekday.
ALTER TABLE "recurring_course_schedule"
  ADD CONSTRAINT "course_schedule_recurrence_shape_check"
  CHECK (
    ("recurrence" <> 'biweekly_alternating' OR "anchor_date" IS NOT NULL)
    AND ("recurrence" NOT IN ('weekly', 'multiple_weekdays', 'biweekly_alternating')
         OR array_length("weekdays", 1) >= 1)
    AND ("recurrence" <> 'weekly' OR array_length("weekdays", 1) = 1)
    AND ("recurrence" NOT IN ('monthly', 'yearly') OR "day_of_month" IS NOT NULL)
    AND ("recurrence" <> 'yearly' OR "month_of_year" IS NOT NULL)
    AND ("day_of_month" IS NULL OR ("day_of_month" >= 1 AND "day_of_month" <= 31))
    AND ("month_of_year" IS NULL OR ("month_of_year" >= 1 AND "month_of_year" <= 12))
  );

-- ---------------------------------------------------------------------------
-- Session
-- ---------------------------------------------------------------------------

ALTER TABLE "session"
  ADD CONSTRAINT "session_time_order_check"
  CHECK ("start_time" < "end_time");

-- TD-8 `session.cancel` records a mandatory reason; a cancelled class with no
-- stated reason is indistinguishable from one cancelled by accident.
--
-- Written as `status <> 'cancelled' OR (…IS NOT NULL AND …)` deliberately. The
-- obvious phrasing — `(status = 'cancelled' AND btrim(reason) <> '')` as one
-- arm of an OR — SILENTLY ACCEPTS a NULL reason: `btrim(NULL) <> ''` is NULL,
-- not false, and a CHECK treats NULL as satisfied. That version was written
-- first and admitted exactly the row this constraint exists to refuse. The
-- explicit IS NOT NULL is what closes it.
--
-- A restored session KEEPS its former reason (no `IS NULL` requirement on the
-- other branch): why it was once cancelled is history worth having, and forcing
-- the service to clear it would couple the restore path to this constraint.
ALTER TABLE "session"
  ADD CONSTRAINT "session_cancellation_reason_check"
  CHECK (
    "status" <> 'cancelled'
    OR ("cancellation_reason" IS NOT NULL AND btrim("cancellation_reason") <> '')
  );

-- ---------------------------------------------------------------------------
-- Room.capacity — BR-23: this CHECK constrains the value's SHAPE and nothing
-- else. Nothing anywhere compares a roster against it, and nothing may be added
-- that does (§20 rule 22). A capacity of zero or below is not a restriction
-- being expressed; it is a typo.
-- ---------------------------------------------------------------------------

ALTER TABLE "room"
  ADD CONSTRAINT "room_capacity_positive_check"
  CHECK ("capacity" IS NULL OR "capacity" > 0);

-- ---------------------------------------------------------------------------
-- display_order — same rule the other structural entities already carry (TD-6).
-- ---------------------------------------------------------------------------

ALTER TABLE "administrative_group"
  ADD CONSTRAINT "administrative_group_display_order_check"
  CHECK ("display_order" IS NULL OR "display_order" >= 0);

ALTER TABLE "teaching_group"
  ADD CONSTRAINT "teaching_group_display_order_check"
  CHECK ("display_order" IS NULL OR "display_order" >= 0);

-- Blank names would render as empty rows on every roster and selector; the same
-- `btrim` backstop the other named entities carry.
ALTER TABLE "administrative_group"
  ADD CONSTRAINT "administrative_group_name_not_blank_check"
  CHECK (btrim("name") <> '');

ALTER TABLE "teaching_group"
  ADD CONSTRAINT "teaching_group_name_not_blank_check"
  CHECK (btrim("name") <> '');
