-- R130 — a full date of birth for every beneficiary (Owner decision, 2026-09-03).
--
-- ## Two columns, one fact
--
-- `user.birth_date` is the durable answer: one person, one row, beside `sex`,
-- which is the other fact captured about the person themselves.
--
-- `child_application.birth_date` is the SUBMITTED answer. A child `User` does
-- not exist until the application is approved (R62), so the application carries
-- the value exactly as it already carries the name parts, `sex` and the
-- schooling stage, and approval materialises the same calendar date onto the row
-- it creates. This is the existing application→approved-record convention, not a
-- second source of truth: after approval the `User` column is authoritative.
--
-- ## A DATE, never a timestamp
--
-- TD-11. A birth date has no time and no zone; storing an instant would put a
-- person's birthday one day earlier for half the world, and every previous date
-- column on this project (`exam.date`, `session.date`,
-- `branch.operational_start_date`) is `DATE` for the same reason.
--
-- ## Nullable, deliberately, and this is the EXPAND phase
--
-- Read-only before this migration was written:
--   Localhost — 73 users (18 live), 25 beneficiaries, **0 with a birth date**,
--   4 child applications (all approved).
-- Staging was not queried in this session; Production is not deployed.
--
-- Every existing beneficiary would fail a NOT NULL column, and there is no
-- honest value to backfill: a date cannot be inferred from a Category, a
-- schooling stage, an enrolment or a row's creation date, and a sentinel would
-- be indistinguishable from a recorded fact a year later. The Owner's
-- instruction is explicit — **do not fabricate**.
--
-- **The requirement is therefore at the WRITE BOUNDARY**, exactly as R122 did
-- for `enrollment.academic_period_id`: nullable in the schema, required by the
-- validators, so every new beneficiary carries one while no historical row is
-- rewritten. A legacy row stays visibly incomplete until an authorised
-- administrator records the real date.
--
-- **The CONTRACT phase (NOT NULL) is not performed here and cannot honestly be
-- performed until every live beneficiary has a real recorded date.** That
-- condition is written down rather than assumed; see `docs/TASKS.md`.
--
-- ## The CHECK is a typo guard, not an eligibility rule
--
-- A CHECK cannot reference `CURRENT_DATE` — PostgreSQL requires an immutable
-- expression — so the future bound lives in `lib/birth-date.ts` with the rest of
-- the boundary rule. What the database can guarantee for ever is a static floor:
-- `1899-12-31` is a slipped digit, not a person. Nothing in the platform refuses
-- anybody for their age, and §20 forbids inventing an eligibility cutoff no
-- requirement states.

ALTER TABLE "user" ADD COLUMN "birth_date" DATE;
ALTER TABLE "child_application" ADD COLUMN "birth_date" DATE;

ALTER TABLE "user"
  ADD CONSTRAINT "user_birth_date_plausible_check"
  CHECK ("birth_date" IS NULL OR "birth_date" >= DATE '1900-01-01');

ALTER TABLE "child_application"
  ADD CONSTRAINT "child_application_birth_date_plausible_check"
  CHECK ("birth_date" IS NULL OR "birth_date" >= DATE '1900-01-01');
