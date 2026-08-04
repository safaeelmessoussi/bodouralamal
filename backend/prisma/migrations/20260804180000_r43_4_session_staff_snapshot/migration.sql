-- SRS Revision 43.4 — a Session snapshots its teaching assignment.
--
-- WHY: Revision 43 gave a Session "its own room and teacher" but never said WHEN
-- those are written, and the first implementation left the teacher null and
-- re-derived staffing from the schedule. That makes history mutable — changing a
-- schedule's teacher in June would silently re-attribute March's classes to
-- someone who never taught them. Room and staff are now snapshot at
-- materialization, and a past or `held` session is never rewritten by a
-- schedule edit.
--
-- `session_staff` mirrors `course_schedule_staff` exactly. It REPLACES the
-- single `session.teacher_id` rather than sitting beside it: the association
-- co-teaches and classes have assistants, so one column could not hold the
-- answer, and keeping both would give "who taught this" two homes that drift.
--
-- contract-phase: `session.teacher_id` is dropped rather than deprecated in
-- place (TD-6b). The exception is narrow and stated rather than assumed: the
-- `session` table was created three migrations ago in the same unreleased
-- Revision-43 expand phase, **no deployment of this platform exists**, and the
-- column has never been written by released code — `session.materialize` has
-- always left it null. There is therefore no production data to preserve, which
-- is the interest TD-6b's expand–migrate–contract sequence protects. Carrying a
-- dead column through a whole phase would be ceremony without a beneficiary,
-- and a column nothing writes is exactly what a later reader mistakes for a
-- source of truth.

-- DropForeignKey
ALTER TABLE "session" DROP CONSTRAINT "session_teacher_id_fkey";

-- DropIndex
DROP INDEX "session_teacher_id_date_idx";

-- AlterTable
ALTER TABLE "session" DROP COLUMN "teacher_id";

-- CreateTable
CREATE TABLE "session_staff" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "position" "schedule_staff_position" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" UUID,

    CONSTRAINT "session_staff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "session_staff_user_id_deleted_at_idx" ON "session_staff"("user_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "session_staff_session_id_user_id_key" ON "session_staff"("session_id", "user_id");

-- AddForeignKey
ALTER TABLE "session_staff" ADD CONSTRAINT "session_staff_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_staff" ADD CONSTRAINT "session_staff_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

