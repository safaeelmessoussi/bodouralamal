-- SRS Revision 177 §7 (Document Owner, 2026-09-29) — decision D9 taken.
--
-- AN EDUCATIONAL CONTENT MAY BE ABOUT ONE SURAH.
--
-- «in تسجيل صوتي and in رفع ملف and in any place allowing to add or edit an
-- educational content, an educational content can be linked to a surah, so
-- that in المحتوى التعليمي educational contents are grouped by surahs too if
-- given, and a filter of surahs should be added.» R174 §3 asked for the
-- library grouped «per Surah» and found the model silent (§4.9: content
-- carries Level, Subject, Year, Branch — no Surah); this is the column.
--
-- ONE Surah, nullable: a recording of a class is about the Surah that class
-- was about (R165 §5 — one per sitting, one per date in practice), and an
-- uploaded file the same. NULL is «not about one Surah», the ordinary state
-- of a فقه lesson. Admissible only when the Subject works by Surah and the
-- Surah is in the syllabus of a Level the item is filed under — decided by
-- the service through the one curriculum policy every other Surah write uses
-- (`resolveSurahs`), never by the column.
--
-- RESTRICT, like every other reference to a Surah: a Surah is seeded
-- reference data (§4.5's 114) and is never deleted.
ALTER TABLE "educational_content"
  ADD COLUMN "surah_id" INTEGER NULL
    REFERENCES "quran_surah"("surah_id") ON DELETE RESTRICT;

-- The library groups and filters by it; partial, because most rows are NULL.
CREATE INDEX "educational_content_surah_id_idx"
  ON "educational_content"("surah_id")
  WHERE "surah_id" IS NOT NULL;
