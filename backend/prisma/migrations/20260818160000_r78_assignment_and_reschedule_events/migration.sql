-- Revision 78 — two more notification events (§4.8 as narrowed by R77, R78.2/R78.4).
--
-- R77.2 reserved new event types to an SRS revision, and this is that revision.
-- The framework stays postponed: still one entity, no tier, no preference, no
-- channel. Only the enum grows.
--
-- `session_assigned`    — a person was ADDED to a Session's staffing (R78.2).
-- `session_rescheduled` — an occurrence's date or time changed (R78.4).
--
-- Additive only. Existing rows are untouched, and the values can be retired
-- later without affecting rows of the other types.

ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'session_assigned';
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'session_rescheduled';
