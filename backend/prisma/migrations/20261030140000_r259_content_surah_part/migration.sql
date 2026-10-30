-- R259 — an item about سورة البقرة may name its part (1 or 2, as «مقرر الحفظ»
-- names it — R232); only Surah 2 has parts.
ALTER TABLE "educational_content" ADD COLUMN "surah_part" SMALLINT;
ALTER TABLE "educational_content"
  ADD CONSTRAINT "educational_content_surah_part_check"
  CHECK ("surah_part" IS NULL OR ("surah_part" IN (1, 2) AND "surah_id" = 2));
