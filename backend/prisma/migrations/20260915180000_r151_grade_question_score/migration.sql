-- Owner-reported, 2026-09-15 — per-question grading, where R137's optional
-- points allocation is actually in use. Purely additive: `grade`/`exam_
-- question` are unchanged, and this table means nothing until the service
-- writes to it. See `GradeQuestionScore`'s own schema comment for the full
-- reasoning (why this is not trigger-maintained, and why the all-or-nothing
-- points rule is re-checked defensively in the service rather than assumed).

-- CreateTable
CREATE TABLE "grade_question_score" (
    "id" UUID NOT NULL,
    "grade_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "score" DECIMAL(6,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "grade_question_score_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "grade_question_score_question_id_idx" ON "grade_question_score"("question_id");

-- CreateIndex
CREATE UNIQUE INDEX "grade_question_score_grade_id_question_id_key" ON "grade_question_score"("grade_id", "question_id");

-- AddForeignKey
-- Cascade: a Grade's per-question breakdown is part of the Grade, not an
-- independent record — deleting the Grade (it never is today, but the
-- column is declared the same way `Grade.examId`'s own sibling relations
-- are) takes its breakdown with it.
ALTER TABLE "grade_question_score" ADD CONSTRAINT "grade_question_score_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "grade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- Restrict, matching every other reference to a question
-- (`student_exam_answer.question_id`, `exam_question_option.question_id`):
-- a recorded score is part of the record and must not vanish out from under
-- it merely because the question was later removed from the paper.
ALTER TABLE "grade_question_score" ADD CONSTRAINT "grade_question_score_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "exam_question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The declarative bound a CHECK CAN express here (score >= 0), on the exact
-- footing `grade_score_non_negative` already states for `grade.score`
-- itself (R81's migration). The upper bound — a question's own score may
-- not exceed its own `points` — cannot be a CHECK (it reaches another
-- table) and is enforced in the service instead, the same division R81's
-- own comment already draws for `grade.score` against `exam.max_grade`.
ALTER TABLE "grade_question_score" ADD CONSTRAINT "grade_question_score_non_negative" CHECK ("score" >= 0);
