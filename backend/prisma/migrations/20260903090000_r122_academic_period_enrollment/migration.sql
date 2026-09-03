-- Enrolment gets an academic period, and stops meaning "active forever"
-- (Owner decision, 2026-09-02 — SRS Revision 122).
--
-- ## The two defects this closes
--
-- **1. An enrolment had no end.** `enrollment` carried `enrolled_at` and
-- `deleted_at` and nothing else, so a row was current until somebody manually
-- soft-deleted it. Nothing could answer *is this beneficiary enrolled right
-- now* without a human having remembered to close a row, and a retention rule
-- built on that would call somebody active a decade after they left.
--
-- **2. The association's ordinary case was refused by the database.**
-- `enrollment_student_level_unique (student_id, level_id) WHERE deleted_at IS
-- NULL` permitted ONE live enrolment per student per Level. The association
-- enrols **by semester**, so a beneficiary who takes Semester 1 of a Level and
-- then Semester 2 of the SAME Level needs two live rows. The old index made
-- that impossible, which is why the index is replaced rather than kept.
--
-- ## Level is the studies year — no new entity for it
--
-- `level` already IS the pedagogical progression: each Category holds an
-- ordered set (المرأة seven, الطفل seven, اليافعات six) ranked by
-- `display_order`. «First studies year» is the Level at rank 1 of that
-- Category. Adding a StudiesYear table would duplicate a concept the schema has
-- had since R43, so this migration adds only what is genuinely missing: WHEN.
--
-- ## No historical fact is fabricated
--
-- `academic_period_id` is added **NULL and is not backfilled**. Nothing in an
-- existing row says which semester it belonged to — `enrolled_at` is the moment
-- of data entry, not a period — and assigning one would invent a fact about
-- somebody's education. NULL reads as *period not recorded*. The write boundary
-- requires a period for every NEW enrolment; the column stays nullable so old
-- rows stay honest rather than being rewritten.
--
-- Read-only before writing this migration: Localhost 3 enrolments (all live,
-- all development fixtures), Staging 2 (synthetic per R104(4)), one
-- `academic_year` row in each. Production is not deployed.
--
-- contract-phase: TD-6b — `enrollment_student_level_unique` is DROPPED and
-- replaced, not deprecated in place. It is an index, so no data is lost and no
-- expand/contract dance applies; and it cannot coexist with its successor,
-- because the pair (student, level) is exactly what must stop being unique. The
-- replacement is strictly wider: every row the old index permitted, the new one
-- permits.

-- ── The period ─────────────────────────────────────────────────────────────

CREATE TABLE "academic_period" (
  "id"               UUID PRIMARY KEY,
  "academic_year_id" UUID NOT NULL,
  "sequence"         INTEGER NOT NULL,
  "start_date"       DATE NOT NULL,
  "end_date"         DATE NOT NULL,
  "version"          INTEGER NOT NULL DEFAULT 0,
  "created_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"       TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "academic_period_academic_year_id_fkey"
    FOREIGN KEY ("academic_year_id") REFERENCES "academic_year"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  -- 1 is the first semester. A zero or negative ordinal has no meaning and
  -- would sort ahead of every real period.
  CONSTRAINT "academic_period_sequence_positive_check" CHECK ("sequence" >= 1),
  -- `end_date` is INCLUSIVE, so a single-day period is legitimate and the
  -- comparison is `>=` rather than `>`.
  CONSTRAINT "academic_period_dates_ordered_check" CHECK ("end_date" >= "start_date")
);

-- One first semester per year, one second, and so on.
CREATE UNIQUE INDEX "academic_period_year_sequence_unique"
  ON "academic_period" ("academic_year_id", "sequence");

-- Every «which period contains today» read hits this.
CREATE INDEX "academic_period_start_date_end_date_idx"
  ON "academic_period" ("start_date", "end_date");

-- ── The enrolment's period ─────────────────────────────────────────────────

ALTER TABLE "enrollment" ADD COLUMN "academic_period_id" UUID;

ALTER TABLE "enrollment"
  ADD CONSTRAINT "enrollment_academic_period_id_fkey"
  FOREIGN KEY ("academic_period_id") REFERENCES "academic_period"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "enrollment_academic_period_id_deleted_at_idx"
  ON "enrollment" ("academic_period_id", "deleted_at");

-- ── Uniqueness moves from (student, level) to (student, level, period) ─────
--
-- BR-21 is NOT weakened. It said *one live enrolment per student per Level*
-- when a Level had no notion of when; it now says *one per student, per Level,
-- per period*, which is the same rule stated over the dimension the association
-- actually enrols in. Two rows for one student at one Level are legitimate
-- precisely when they name different semesters — and are still refused when
-- they name the same one.
--
-- **NULL does not collide in a PostgreSQL unique index**, so the untyped legacy
-- rows below neither block each other nor block a new periodised enrolment.
-- That is the correct behaviour here: a row whose period is unknown cannot be
-- proved to duplicate one whose period is known.

DROP INDEX "enrollment_student_level_unique";

CREATE UNIQUE INDEX "enrollment_student_level_period_unique"
  ON "enrollment" ("student_id", "level_id", "academic_period_id")
  WHERE "deleted_at" IS NULL;
