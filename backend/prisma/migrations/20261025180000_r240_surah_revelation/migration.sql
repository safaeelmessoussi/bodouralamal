-- SRS Revision 240 — every Surah's «نوع السورة» (مكية / مدنية), as the Madani
-- Mushaf classifies them: 28 مدنية, the rest مكية.
CREATE TYPE "surah_revelation" AS ENUM ('makki', 'madani');
ALTER TABLE "quran_surah" ADD COLUMN "revelation" "surah_revelation" NOT NULL DEFAULT 'makki';
UPDATE "quran_surah" SET "revelation" = 'madani' WHERE "surah_id" IN (2, 3, 4, 5, 8, 9, 13, 22, 24, 33, 47, 48, 49, 55, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 76, 98, 99, 110);
