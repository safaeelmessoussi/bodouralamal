-- SRS Revision 58 — an Exam has a MODE, and a physical exam is scheduled.
--
-- SUPERSEDES §4.6's "digital exams only in MVP" and NARROWS "exam independence".
--
-- An exam is now sat on the premises: it has a branch, a room, a date, a clock
-- window and staff. What stays outside the platform is the **paper** — its
-- questions, its print layout, and the marking of scripts. The association was
-- already organising sittings; it was doing so on paper about an event the
-- platform could not see.
--
-- **The mode is a discriminator, not a flag.** Each mode carries exactly the
-- columns its own reality has, and the CHECKs at the bottom enforce it: a
-- physical exam cannot acquire an access policy's companions, and an online one
-- cannot acquire a room.
--
-- ONE ENTITY, not `Exam` + `ExamSitting`: a physical exam's paper is not in the
-- platform at all, so the row *is* the sitting and there is no second fact to
-- separate.

CREATE TYPE "exam_mode" AS ENUM ('physical', 'online');
CREATE TYPE "exam_staff_position" AS ENUM ('supervisor', 'assistant');

-- Every existing row predates the online builder and is a scheduled sitting in
-- intent, so `physical` is both the default and the correct backfill.
ALTER TABLE "exam" ADD COLUMN "mode" "exam_mode" NOT NULL DEFAULT 'physical';

ALTER TABLE "exam" ADD COLUMN "description" VARCHAR(2000);

-- Nullable rather than required: existing rows have no year to infer, and
-- inventing one would assert something nobody recorded. New physical exams are
-- required to carry it at the write boundary.
ALTER TABLE "exam" ADD COLUMN "academic_year_id" UUID REFERENCES "academic_year"("id");

ALTER TABLE "exam" ADD COLUMN "branch_id"  UUID REFERENCES "branch"("id");
ALTER TABLE "exam" ADD COLUMN "room_id"    UUID REFERENCES "room"("id");
ALTER TABLE "exam" ADD COLUMN "start_time" TIME(0);
ALTER TABLE "exam" ADD COLUMN "end_time"   TIME(0);

-- NULL is **the whole Level**, not "no target".
ALTER TABLE "exam" ADD COLUMN "administrative_group_id" UUID
  REFERENCES "administrative_group"("id");

CREATE TABLE "exam_staff" (
  "id"         UUID PRIMARY KEY,
  "exam_id"    UUID NOT NULL REFERENCES "exam"("id"),
  "user_id"    UUID NOT NULL REFERENCES "user"("id"),
  "position"   "exam_staff_position" NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "deleted_at" TIMESTAMPTZ(6),
  "deleted_by" UUID
);
-- One person holds one position on one exam.
CREATE UNIQUE INDEX "exam_staff_exam_id_user_id_key" ON "exam_staff" ("exam_id", "user_id");
CREATE INDEX "exam_staff_user_id_idx" ON "exam_staff" ("user_id");

-- A sitting that ends before it starts is certainly a mistake, and TD-11 makes
-- these wall-clock values, so the comparison is exact rather than timezone-
-- dependent.
ALTER TABLE "exam"
  ADD CONSTRAINT "exam_time_order_check"
  CHECK ("start_time" IS NULL OR "end_time" IS NULL OR "end_time" > "start_time");

-- **The discriminator, enforced — as ALL FOUR OR NONE.**
--
-- The obvious constraint is "a physical exam has a branch, a room and a clock
-- window", and it is wrong here: rows predating this revision are physical in
-- intent and have none of them, and a migration that refuses existing data
-- either aborts or forces a backfill that INVENTS a room somebody never chose.
-- TD-6b forbids the second and the first is not an option.
--
-- So the database refuses the state that is actually dangerous — a **half**
-- specified sitting, which reads as scheduled and cannot be attended — and the
-- write boundary requires all four for a new physical exam, where a real value
-- can actually be demanded. This is the same division §7 uses for the Branch
-- address columns (R35): nullable in the schema for rows that predate the
-- requirement, required where a person is asked.
ALTER TABLE "exam"
  ADD CONSTRAINT "exam_physical_place_all_or_none_check"
  CHECK (
    "mode" <> 'physical'
    OR (
      ("branch_id" IS NOT NULL AND "room_id" IS NOT NULL
       AND "start_time" IS NOT NULL AND "end_time" IS NOT NULL)
      OR
      ("branch_id" IS NULL AND "room_id" IS NULL
       AND "start_time" IS NULL AND "end_time" IS NULL)
    )
  );

ALTER TABLE "exam"
  ADD CONSTRAINT "exam_online_has_no_room_check"
  CHECK ("mode" <> 'online' OR ("branch_id" IS NULL AND "room_id" IS NULL));
