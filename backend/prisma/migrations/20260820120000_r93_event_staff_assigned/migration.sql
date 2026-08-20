-- SRS Revision 93 — being ASSIGNED to an event is not the same news as the
-- event existing.
--
-- `event_created` announces an activity to the people it is for. A مؤطرة named
-- as an assistant needs something else entirely: **you are working on this**,
-- so she can say she is unavailable. Announcing it with `event_created` would
-- tell her the association is holding a celebration — true, and not the thing
-- she has to act on.
--
-- **And it is not optional.** The general audience announcement is a decision
-- the administrator takes after the change is saved (R82.5); an assignment is
-- communication *to the person assigned*, and withholding it would leave her
-- rostered without knowing.

ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'event_staff_assigned';

-- **No data migration.** The value is new, nothing carries it yet, and no
-- existing row changes meaning. `session_assigned` (R78.2) is its counterpart
-- for a class occurrence and is deliberately left alone: one concept per type,
-- and a Session is not an Event (§20 rule 22).
