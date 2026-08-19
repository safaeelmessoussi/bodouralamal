-- SRS Revision 91 — teaching staffing becomes EFFECTIVE-DATED.
--
-- `course_schedule_staff` recorded *she staffs this schedule* with no period, so
-- the platform could not answer *who teaches this class in November* and every
-- authorization consumer read the row as though it had always been true and
-- always would be. This adds the two bounds and nothing else: the row is still
-- the unit of assignment, `position` still means responsibility rather than
-- permission, and soft deletion still means the assignment was withdrawn.
--
-- **Calendar dates, not instants** (TD-11). A replacement runs *from the 1st to
-- the 30th*, at each branch's own clock; storing an instant would make the
-- boundary depend on a timezone nobody chose.

ALTER TABLE "course_schedule_staff"
  ADD COLUMN "effective_from" DATE,
  ADD COLUMN "effective_until" DATE;

-- **NULL is open-ended at that end, and is the ONLY ambiguity-free reading.**
--
--   effective_from  = NULL  →  from the schedule's own beginning
--   effective_until = NULL  →  through the schedule's own end (itself possibly
--                              open, `recurring_course_schedule.effective_until`)
--
-- Every existing row therefore keeps its exact present meaning WITHOUT a
-- backfill: a row with two NULLs spans the schedule's whole life, which is what
-- a time-blind row already meant. **Nothing is fabricated** — inventing an
-- `effective_from` from `anchor_date` would assert that somebody was assigned on
-- a date nobody recorded, and would differ from the schedule's real beginning
-- for every schedule created after its anchor.
--
-- The compatibility proof is a test, not a comment: `r91-migration-compat`
-- asserts that a pre-migration row resolves as effective on every date the
-- schedule produces occurrences for.

ALTER TABLE "course_schedule_staff"
  ADD CONSTRAINT "course_schedule_staff_period_check"
  CHECK (
    "effective_from" IS NULL
    OR "effective_until" IS NULL
    OR "effective_from" <= "effective_until"
  );

-- A single day is a valid assignment (`from = until`), which is why the check is
-- `<=` rather than `<`: covering one lesson is the commonest replacement there
-- is.

-- The resolver's access path: *which assignments on this schedule are live, and
-- what are their bounds*. `deleted_at` leads because withdrawal is checked
-- before any date arithmetic.
CREATE INDEX "course_schedule_staff_effective_idx"
  ON "course_schedule_staff" ("schedule_id", "deleted_at", "effective_from", "effective_until");

-- **The one-main-teacher-per-date invariant is NOT expressed here, deliberately.**
--
-- PostgreSQL can express it — an `EXCLUDE USING gist` constraint over
-- `(schedule_id WITH =, daterange(...) WITH &&) WHERE position = 'teacher'` —
-- but it requires the `btree_gist` extension, which this project's deployment
-- (§3.1, a small Moroccan VPS with a stock `postgres:18.4` image) does not
-- install and TD-13 does not list. Adding an extension dependency to make one
-- invariant declarative is the fragile-migration trade §28 warns against.
--
-- It is enforced in the service instead, under the same `FOR UPDATE` row lock
-- TD-15.2 already prescribes for the room-conflict check — so two administrators
-- racing cannot both pass validation. The lock is on `course_schedule_staff`
-- rows of the schedule being edited, which is the exact set the invariant
-- ranges over.

-- contract-phase: `(schedule_id, user_id)` cannot survive effective dating.
--
-- The constraint encoded *one person holds one position on one schedule*, which
-- was true only while an assignment had no period. **Safa teaching September to
-- November, interrupted by Amina, and resuming in January is TWO rows for
-- Safa** — the very case R91 exists for — and the unique index refuses it.
--
-- What replaces it is not weaker, it is the correct rule: the same person may
-- not hold OVERLAPPING intervals on one schedule (§7), and at most one main
-- teacher may be active on any date (§6). Neither is a unique index over two
-- columns; both are interval invariants, enforced in the service under the
-- TD-15.2 row lock described above.
--
-- No data is lost: the column pair remains, and every existing row is still a
-- distinct assignment.
-- Prisma expressed `@@unique` as a UNIQUE INDEX rather than a table constraint,
-- so this is `DROP INDEX`. Naming it as a constraint failed loudly, which is the
-- behaviour worth having: the migration aborted whole rather than applying the
-- columns and silently leaving the old rule in force.
DROP INDEX "course_schedule_staff_schedule_id_user_id_key";

-- The access path the withdrawn index was also serving.
CREATE INDEX "course_schedule_staff_schedule_user_idx"
  ON "course_schedule_staff" ("schedule_id", "user_id", "deleted_at");
