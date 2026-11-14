-- R275 — the beneficiaries of a class are told when it becomes an exam (R269)
-- and when it is changed back (the Owner, 2026-11-14: «add notice for students»).
ALTER TYPE "notification_type" ADD VALUE 'session_became_exam';
ALTER TYPE "notification_type" ADD VALUE 'session_back_to_class';
