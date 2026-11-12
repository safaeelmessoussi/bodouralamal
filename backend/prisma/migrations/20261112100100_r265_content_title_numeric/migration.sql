-- R265 — «مكتبة المحتوى» sorted by title read «صفحة 10» before «صفحة 2»: the
-- column had no Arabic collation at all. Natively (§20 rule 13 — never a
-- per-query COLLATE): Arabic ICU with numbers read as numbers
-- («صفحة 1، 2، 3 … 10»). Deterministic, like "ar-x-icu", so equality and
-- pattern matching are unchanged.
CREATE COLLATION IF NOT EXISTS "ar-num-icu" (provider = icu, locale = 'ar-u-kn', deterministic = true);
ALTER TABLE "educational_content" ALTER COLUMN "title" TYPE VARCHAR(120) COLLATE "ar-num-icu";
