-- SRS Revision 35, TD-9 — constraints for the public branch fields.
--
-- Hand-written (TD-6a): Prisma has no CHECK constraints, and these belong in the
-- database as well as in Zod. `google_maps_url` becomes an outbound link on a
-- public page, so the scheme restriction is a security control rather than a
-- formatting preference — a `javascript:` value there is an injection vector,
-- and Zod alone would not stop a row written by a future importer or by hand.

ALTER TABLE "branch"
  ADD CONSTRAINT "branch_google_maps_url_https_check"
  CHECK ("google_maps_url" IS NULL OR "google_maps_url" LIKE 'https://%');

-- Emails are stored lowercase everywhere (TD-12), so the same backstop the
-- other address columns carry applies here.
ALTER TABLE "branch"
  ADD CONSTRAINT "branch_email_lowercase_check"
  CHECK ("email" IS NULL OR "email" = lower("email"));

-- A present-but-blank required field is the failure this catches: NULL means
-- "not recorded yet" and is allowed, but an empty string is a value that says
-- nothing and would render as an empty card on the public page.
ALTER TABLE "branch"
  ADD CONSTRAINT "branch_address_not_blank_check"
  CHECK ("address" IS NULL OR btrim("address") <> '');

ALTER TABLE "branch"
  ADD CONSTRAINT "branch_opening_hours_not_blank_check"
  CHECK ("opening_hours_ar" IS NULL OR btrim("opening_hours_ar") <> '');
