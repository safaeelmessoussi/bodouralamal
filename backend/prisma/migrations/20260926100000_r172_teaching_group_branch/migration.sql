-- SRS Revision 172 §15 (Document Owner, 2026-09-23).
--
-- A CIRCLE IS CREATED IN A BRANCH.
--
-- «إضافة حلقة should include also branches, as a circle is created in a branch,
-- each branch has its list of circles, same as for groups.» Until now a حلقة
-- (teaching_group) had no branch of its own (§4.4c, R43.3): the branch was the
-- CLASS's. That stays true of where a class is HELD; this column says where the
-- circle LIVES, as `administrative_group.branch_id` does for a group.
--
-- NULLABLE, and back-filled: a circle whose live classes are all held at ONE
-- branch takes that branch; a circle addressed from several branches, or from
-- none, stays «بلا فرع» until somebody says. RESTRICT: a branch with circles is
-- not deleted from under them.

ALTER TABLE "teaching_group" ADD COLUMN "branch_id" UUID;

ALTER TABLE "teaching_group"
  ADD CONSTRAINT "teaching_group_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "teaching_group_branch_id_idx" ON "teaching_group"("branch_id");

UPDATE "teaching_group" tg
SET "branch_id" = one.branch_id
FROM (
  -- HAVING keeps exactly one distinct branch, so MIN over its text is that
  -- branch (PostgreSQL has no MIN(uuid)).
  SELECT addressed.teaching_group_id, MIN(s.branch_id::text)::uuid AS branch_id
  FROM (
    SELECT id AS schedule_id, teaching_group_id FROM recurring_course_schedule
      WHERE teaching_group_id IS NOT NULL AND deleted_at IS NULL
    UNION
    SELECT x.schedule_id, x.teaching_group_id FROM course_schedule_teaching_group x
      JOIN recurring_course_schedule s ON s.id = x.schedule_id AND s.deleted_at IS NULL
  ) addressed
  JOIN recurring_course_schedule s ON s.id = addressed.schedule_id
  GROUP BY addressed.teaching_group_id
  HAVING COUNT(DISTINCT s.branch_id) = 1
) one
WHERE tg.id = one.teaching_group_id AND tg."branch_id" IS NULL;
