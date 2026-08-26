-- SRS Revision 110 — the scheduling-type catalogue becomes seeded reference
-- data, and an activity records which type it is.
--
-- The five types an administrator picks from lived in
-- `frontend/src/adapters/scheduling-types.ts` as a hardcoded constant. Nobody
-- could add one, rename one, reorder them, or say which of them takes
-- attendance — and **seeded does not mean immutable** (Owner addendum,
-- 2026-08-26): a seed is an initial state, never a whitelist.
--
-- **R56 refused `Event.type` and named the condition for adding it.** It
-- declined the column because *"the category would drive no rule, no job, no
-- report"*, and said in terms that *"it may be added when filtering or reporting
-- by category becomes a real requirement."* `attendance_required` is that
-- requirement — it drives the form (OD-03). This is R56's own clause being
-- exercised, not contradicted.
--
-- **Five rows, THREE entities.** R56 also settled the routing: *"the type
-- selector's branches are exactly the ones that mean something — the three that
-- route to different entities."* حصة دراسية → `RecurringCourseSchedule`,
-- اختبار → `Exam`, محاضرة/حفل/عطلة → `Event`. No fifth scheduling model is
-- created here, and none should be.

CREATE TYPE "scheduling_structural_kind" AS ENUM ('class', 'activity', 'exam');

-- The name is collated `ar-x-icu` in SQL, which Prisma's schema syntax cannot
-- express (TD-6a) — the same treatment every Arabic label on this platform gets,
-- and never a per-query COLLATE (§20 rule 13).
CREATE TABLE "scheduling_type" (
  "id" UUID NOT NULL,
  "name" VARCHAR(60) COLLATE "ar-x-icu" NOT NULL,
  "structural_kind" "scheduling_structural_kind" NOT NULL,

  -- **Structural data, not inferred from the label.** اختبار takes attendance
  -- and محاضرة does not, and nothing about either word says so — §4.4b already
  -- forbids reading a rule off a name, and a catalogue whose behaviour depended
  -- on its label could never be renamed.
  "attendance_required" BOOLEAN NOT NULL,

  -- The Owner calls the order canonical, so it is a column an administrator can
  -- change rather than the order the rows happen to have been inserted in.
  -- NOT NULL, unlike `subject.display_order`: this catalogue is seeded complete
  -- and ordered, so *unordered* is not a state it ever has.
  "display_order" INTEGER NOT NULL,

  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "deleted_at" TIMESTAMPTZ(6),
  "deleted_by" UUID,

  CONSTRAINT "scheduling_type_pkey" PRIMARY KEY ("id")
);

-- Unique among LIVE rows only. A retired type keeps its name in the record — it
-- is what a historical activity is still labelled by — so the index is partial,
-- exactly as every other soft-deleted vocabulary on this platform.
CREATE UNIQUE INDEX "scheduling_type_name_live_key"
  ON "scheduling_type" ("name")
  WHERE "deleted_at" IS NULL;

CREATE INDEX "scheduling_type_display_order_idx"
  ON "scheduling_type" ("display_order");

-- **Nullable, and it stays nullable.** R56 told administrators to write عطلة in
-- the title, so every activity created before this revision has its type
-- recorded nowhere a query can reach. Inferring one from the title would be the
-- name-matching §4.4b forbids, and NEW L's normalization protocol refuses to
-- invent data. The write boundary requires it; the column tolerates the past.
ALTER TABLE "event"
  ADD COLUMN "scheduling_type_id" UUID;

-- `Restrict`, never `Cascade`: a retired type must still be resolvable by the
-- activities that used it, or the record of what an activity WAS is destroyed
-- by tidying the catalogue.
ALTER TABLE "event"
  ADD CONSTRAINT "event_scheduling_type_id_fkey"
  FOREIGN KEY ("scheduling_type_id") REFERENCES "scheduling_type"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "event_scheduling_type_id_idx" ON "event" ("scheduling_type_id");
