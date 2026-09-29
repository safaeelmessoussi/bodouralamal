-- SRS Revision 181 §6 (Owner, 2026-09-30) — how much of «مقرر الحفظ» a Level
-- covers, in Hizb: the Owner's own measure of the memorisation curriculum
-- («5 أحزاب» for the first two years of المرأة, «10 أحزاب» after), stated on
-- «المستويات» and shown on the journey's cards, with the Surahs themselves in
-- the details. INFORMATIONAL: the Surah list (`level_surah`) stays the
-- curriculum the platform reads; this is what a visitor is told. NULL is «not
-- stated», and the card then says how many Surahs the list holds.
ALTER TABLE "level" ADD COLUMN "memorisation_hizb" SMALLINT;
ALTER TABLE "level"
  ADD CONSTRAINT "level_memorisation_hizb_check"
  CHECK ("memorisation_hizb" IS NULL OR "memorisation_hizb" BETWEEN 0 AND 60);
