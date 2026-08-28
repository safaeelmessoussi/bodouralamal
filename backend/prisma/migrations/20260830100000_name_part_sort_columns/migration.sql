-- Sorting a table by الاسم الشخصي and الاسم العائلي, independently (Owner, 2026-08-30).
--
-- ## Why a column and not an ORDER BY expression
--
-- `lib/sorting.ts` is emphatic that ordering belongs to the database: TD-10
-- paginates every collection, so a client that ordered the page it holds would
-- present that page's order as the collection's. Sorting therefore has to be
-- expressible as a Prisma `orderBy`, and Prisma cannot order by an expression.
--
-- ## Why the stored parts alone are not enough
--
-- Revisions 40–41 split the Arabic name into `first_name_arabic` and
-- `last_name_arabic` and **deliberately refused to backfill them**: splitting an
-- existing full name is a guess, and once written nothing could distinguish a
-- guessed part from a typed one. So every row predating those revisions — and
-- every row the seeds still write — carries NULL parts and only the composed
-- `name_arabic`.
--
-- Ordering by `last_name_arabic` alone would therefore group every legacy row
-- together under NULL, which is not «sorted by family name»; it is «sorted by
-- whether anybody has edited this person yet».
--
-- ## What these columns are
--
-- The same derivation the API already performs on read — `splitComposedName` in
-- `src/lib/person-name.ts` — expressed once in SQL and kept by the database.
-- **They are GENERATED ALWAYS: nothing can write them**, so they cannot drift
-- from the two columns they are derived from, and an attempt to set one is an
-- error rather than a silent second source of truth.
--
-- They are for **ordering only** and are never projected into a DTO. The values
-- a reader sees still come from the API's own derivation, so there is exactly
-- one answer to «what is her family name» on the wire.
--
-- The split matches `splitComposedName` case for case:
--   * trim first, so leading spaces do not become an empty first name;
--   * split at the FIRST space — «عبد الله» is one given name far more often
--     than «الرحمن» is a family name on its own;
--   * a single token is a first name with NO family name, not a family name;
--   * empty becomes NULL, never '', so absent sorts as absent.
--
-- `first_name_sort` deliberately COALESCEs onto the composed name's first token
-- rather than the whole composed name: they are the same string for a
-- well-formed row, and using the token keeps the two columns symmetrical.

ALTER TABLE "user"
  ADD COLUMN "first_name_sort" VARCHAR(200)
  GENERATED ALWAYS AS (
    COALESCE(
      NULLIF(btrim("first_name_arabic"), ''),
      NULLIF(split_part(btrim("name_arabic"), ' ', 1), '')
    )
  ) STORED;

ALTER TABLE "user"
  ADD COLUMN "last_name_sort" VARCHAR(200)
  GENERATED ALWAYS AS (
    COALESCE(
      NULLIF(btrim("last_name_arabic"), ''),
      CASE
        WHEN position(' ' in btrim("name_arabic")) = 0 THEN NULL
        ELSE NULLIF(
          btrim(substr(btrim("name_arabic"), position(' ' in btrim("name_arabic")) + 1)),
          ''
        )
      END
    )
  ) STORED;

-- BR-19 orders Arabic natively; the sort columns need the same collation as the
-- name they are derived from, or «ا» and «أ» would order by code point here and
-- alphabetically everywhere else.
CREATE INDEX "user_first_name_sort_idx" ON "user" ("first_name_sort" COLLATE "ar-x-icu");
CREATE INDEX "user_last_name_sort_idx" ON "user" ("last_name_sort" COLLATE "ar-x-icu");
