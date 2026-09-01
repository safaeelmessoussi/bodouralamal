-- Revision 116 — actionable account and exam notifications.
--
-- The existing Notification entity remains the whole architecture: no tier,
-- preference, channel or delivery job. Account/relationship notices need one
-- further real target, the affected User. Exam scheduling and staffing reuse
-- the existing exam_id target, so a dual-role person can hold two distinct
-- semantic rows for the same sitting.

ALTER TABLE "notification" ADD COLUMN "subject_user_id" UUID;

ALTER TABLE "notification"
  ADD CONSTRAINT "notification_subject_user_id_fkey"
  FOREIGN KEY ("subject_user_id") REFERENCES "user"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Assert the old three-target invariant before replacing it. A corrupted row
-- must stop the migration rather than being made valid by a wider CHECK.
DO $$
DECLARE bad INT;
BEGIN
  SELECT COUNT(*) INTO bad
  FROM "notification"
  WHERE (("session_id" IS NOT NULL)::INT
       + ("event_id" IS NOT NULL)::INT
       + ("exam_id" IS NOT NULL)::INT) <> 1;
  IF bad > 0 THEN
    RAISE EXCEPTION 'R116: % notification row(s) violate the pre-R116 target invariant', bad;
  END IF;
END $$;

-- contract-phase: R116 widens the existing target CHECK from exactly one of
-- three foreign keys to exactly one of four. The assertion above proves every
-- existing row satisfies the former contract before its constraint is replaced;
-- no target column or historical notification is dropped.
ALTER TABLE "notification" DROP CONSTRAINT "notification_exactly_one_target";
ALTER TABLE "notification"
  ADD CONSTRAINT "notification_exactly_one_target"
  CHECK (
    (("session_id" IS NOT NULL)::INT
   + ("event_id" IS NOT NULL)::INT
   + ("exam_id" IS NOT NULL)::INT
   + ("subject_user_id" IS NOT NULL)::INT) = 1
  );

CREATE UNIQUE INDEX "notification_user_subject_user_type_key"
  ON "notification" ("user_id", "subject_user_id", "type")
  WHERE "subject_user_id" IS NOT NULL;

ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'registration_review_required';
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'registration_approved';
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'registration_rejected';
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'family_link_requested';
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'family_link_approved';
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'family_link_rejected';
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'family_link_revoked';
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'role_assignments_changed';
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'platform_ownership_received';
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'enrollment_changed';
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'session_unassigned';
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'event_staff_unassigned';
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'exam_teacher_assigned';
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'exam_teacher_unassigned';
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'exam_scheduled';
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'exam_rescheduled';
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'exam_cancelled';
