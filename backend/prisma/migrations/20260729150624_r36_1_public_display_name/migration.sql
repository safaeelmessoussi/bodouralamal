-- SRS Revision 36.1 — `User.public_display_name`.
--
-- `IF NOT EXISTS` because of the ordering defect documented at length in
-- `20260729060000_r36_1_display_name_not_blank`: that migration sorts NINE
-- HOURS EARLIER than this one despite depending on this column, so on a clean
-- database it now creates the column itself and this becomes a no-op. Both
-- migrations are idempotent, so either order produces the same schema.
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "public_display_name" VARCHAR(120);
