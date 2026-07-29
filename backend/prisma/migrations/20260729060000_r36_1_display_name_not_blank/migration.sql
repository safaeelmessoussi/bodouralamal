-- SRS Revision 36.1, TD-9 — "unset" must have exactly one representation.
--
-- Hand-written (TD-6a): Prisma has no CHECK constraints. NULL means "no public
-- name chosen, fall back to the full name"; an empty or whitespace-only string
-- would be a *third* state that reads as set but renders as nothing — and would
-- defeat the fallback, publishing a blank instructor instead of a name. The
-- application trims to NULL; this is the backstop for any other writer.
ALTER TABLE "user"
  ADD CONSTRAINT "user_public_display_name_not_blank_check"
  CHECK ("public_display_name" IS NULL OR btrim("public_display_name") <> '');
