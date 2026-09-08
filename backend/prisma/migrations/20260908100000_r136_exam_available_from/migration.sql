-- R136 — remote exam availability, separate from calendar visibility and
-- from `status`/publication.
--
-- NULL = manually controlled, not yet opened. A timestamp = a student becomes
-- eligible once now() >= available_from. Set once, by the atomic scheduling
-- transaction (a policy computed at schedule time) or by an explicit later
-- staff "open now" act; R136 makes it one-way — never returned to NULL, never
-- moved once set — enforced in the service layer, since a CHECK cannot see
-- the row's own prior value.
ALTER TABLE "exam"
  ADD COLUMN "available_from" timestamptz(6);
