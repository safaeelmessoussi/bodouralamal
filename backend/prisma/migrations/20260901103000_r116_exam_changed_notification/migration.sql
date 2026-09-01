-- Revision 116 follow-up — distinguish a material sitting-detail change from
-- a date/time reschedule. This remains a notification enum addition only; the
-- existing Exam foreign-key target and idempotency coordinate are unchanged.

ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'exam_changed';
