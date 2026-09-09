-- R137 — an optional per-question grade allocation, so a student can see
-- what a question is worth. NULL is every existing question's state and
-- stays a legitimate permanent state; it is never awarded automatically.
ALTER TABLE "exam_question"
  ADD COLUMN "points" numeric(6, 2);

ALTER TABLE "exam_question"
  ADD CONSTRAINT "exam_question_points_positive_check"
  CHECK ("points" IS NULL OR "points" > 0);
