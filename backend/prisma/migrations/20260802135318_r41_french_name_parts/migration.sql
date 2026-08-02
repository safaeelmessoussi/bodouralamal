-- SRS Revision 41 — the French name split, mirroring Revision 40 exactly.
--
-- One rule rather than two: `name_french` is RETAINED and becomes
-- server-composed from these parts, for the same reasons `name_arabic` was —
-- consumers want the whole name, and a client must not decide its order (§1.1).
--
-- Unlike the Arabic pair, this one is **entirely optional**: both parts or
-- neither. Supplying exactly one is refused at the boundary, because half a
-- name is not a name and storing it would leave a value nothing can render.
--
-- Nullable and NOT backfilled: splitting an existing `name_french` on
-- whitespace would be the same guess Revision 40 refused to make for Arabic,
-- and afterwards nothing could tell a guessed part from a typed one.
ALTER TABLE "user" ADD COLUMN "first_name_french" VARCHAR(60);
ALTER TABLE "user" ADD COLUMN "last_name_french" VARCHAR(60);

-- TD-9 / the same blank-value defence the Arabic parts and
-- `public_display_name` carry: a whitespace-only part would compose a name with
-- a stray space — a value that reads as set and renders as broken.
ALTER TABLE "user"
  ADD CONSTRAINT "user_first_name_french_not_blank_check"
  CHECK ("first_name_french" IS NULL OR btrim("first_name_french") <> '');

ALTER TABLE "user"
  ADD CONSTRAINT "user_last_name_french_not_blank_check"
  CHECK ("last_name_french" IS NULL OR btrim("last_name_french") <> '');

-- Both parts or neither (Revision 41), enforced in the database as well as at
-- the boundary: the API is not the only writer, and a half-name row would be
-- unrenderable by every consumer.
ALTER TABLE "user"
  ADD CONSTRAINT "user_french_name_parts_together_check"
  CHECK (
    ("first_name_french" IS NULL AND "last_name_french" IS NULL)
    OR ("first_name_french" IS NOT NULL AND "last_name_french" IS NOT NULL)
  );
