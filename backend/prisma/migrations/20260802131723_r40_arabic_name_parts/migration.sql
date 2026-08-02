-- SRS Revision 40 — الاسم الشخصي / الاسم العائلي captured separately.
--
-- `name_arabic` is DELIBERATELY RETAINED and becomes server-composed from these
-- two parts. Replacing it would touch TD-10 search, the `ar-x-icu` ordering
-- BR-19 requires, the §7 display-identity fallback, the §14.2 approval contract,
-- both seeds and every screen that shows a person — for no gain, because the
-- composed name is exactly what those consumers want. This is the expand half
-- of expand–migrate–contract (TD-6b); a later contract phase may drop it.
--
-- **Nullable, and deliberately NOT backfilled.** Splitting an existing
-- `name_arabic` on whitespace would be a *guess*: Moroccan names routinely
-- carry compound personal names (محمد أمين) and multi-word family names
-- (بن عبد الله), so a split would silently mis-file people, and afterwards
-- nothing could tell a guessed part from a typed one. NULL means "recorded
-- before the parts were collected", and `name_arabic` stays authoritative for
-- those rows.
ALTER TABLE "user" ADD COLUMN "first_name_arabic" VARCHAR(60);
ALTER TABLE "user" ADD COLUMN "last_name_arabic" VARCHAR(60);

-- TD-6a: the ar-x-icu collation cannot be expressed in Prisma's schema syntax
-- and must be applied here — the same reason `name_arabic` carries it. Ordering
-- a list of people by family name is a BR-19 requirement, and the database
-- default collation gets Arabic wrong.
ALTER TABLE "user" ALTER COLUMN "first_name_arabic" TYPE VARCHAR(60) COLLATE "ar-x-icu";
ALTER TABLE "user" ALTER COLUMN "last_name_arabic" TYPE VARCHAR(60) COLLATE "ar-x-icu";

-- TD-9: 1–60 characters each. The upper bound is the column; the lower bound
-- and the "not just whitespace" rule need a CHECK, exactly as
-- `public_display_name` does (Revision 36.1). A blank part would compose a name
-- with a leading or trailing space — a value that reads as set and renders as
-- broken.
ALTER TABLE "user"
  ADD CONSTRAINT "user_first_name_arabic_not_blank_check"
  CHECK ("first_name_arabic" IS NULL OR btrim("first_name_arabic") <> '');

ALTER TABLE "user"
  ADD CONSTRAINT "user_last_name_arabic_not_blank_check"
  CHECK ("last_name_arabic" IS NULL OR btrim("last_name_arabic") <> '');
