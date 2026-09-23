-- SRS Revision 172 §1 (Document Owner, 2026-09-23).
--
-- A SUBJECT TAUGHT TO A WHOLE CATEGORY.
--
-- Some Subjects — الفقه, السيرة النبوية — are taught to «المرأة» as a whole:
-- every Level of the Category, those that exist and those added later, and any
-- woman may join. Until now «what a Level teaches» had one source, `level_subject`,
-- so such a Subject had to be assigned to every Level one by one, a new Level
-- silently taught it not, and a class for «the whole Category» was only ever
-- «the Levels that happen to list it».
--
-- `category_subject` is the second source: one row means every live Level of the
-- Category teaches the Subject. It is read through the Level's `category_id` at
-- the moment of the read and never copied down, so `level_subject` keeps its
-- meaning (what a Level teaches on its own) and nothing is duplicated. Same
-- shape as `level_subject`: soft-deleted, unique per pair, RESTRICT both ways.

CREATE TABLE "category_subject" (
  "id"          UUID NOT NULL,
  "category_id" UUID NOT NULL,
  "subject_id"  UUID NOT NULL,
  "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at"  TIMESTAMPTZ(6),
  "created_by"  UUID,
  "deleted_by"  UUID,
  CONSTRAINT "category_subject_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "category_subject_category_id_subject_id_key"
  ON "category_subject"("category_id", "subject_id");

ALTER TABLE "category_subject"
  ADD CONSTRAINT "category_subject_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "category_subject"
  ADD CONSTRAINT "category_subject_subject_id_fkey"
  FOREIGN KEY ("subject_id") REFERENCES "subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
