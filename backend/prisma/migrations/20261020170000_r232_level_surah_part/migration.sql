-- SRS Revision 232 — a Level may teach سورة البقرة in two parts (Warsh):
-- part 1 = verses 1–140 (the first and second hizbs), part 2 = 141–285.
-- NULL is the whole Surah, which every existing row stays.
ALTER TABLE "level_surah" ADD COLUMN "part" SMALLINT;

ALTER TABLE "level_surah"
  ADD CONSTRAINT "level_surah_part_check"
  CHECK ("part" IS NULL OR ("surah_id" = 2 AND "part" IN (1, 2)));
