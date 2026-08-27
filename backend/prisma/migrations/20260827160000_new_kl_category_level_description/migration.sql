-- NEW K/L — a Category and a Level each carry a DESCRIPTION.
--
-- §7 defined both narrowly — Category as `name` + `display_order`, Level as
-- those plus `gender_restriction` — and the seed said so in a deliberate
-- comment. The Owner's canonical dataset supplies a description for every one
-- of them («النساء من سن الجامعة الى ما فوق» for المرأة, «المستوى N - برنامج X»
-- for each Level), so the narrow definition is the thing that was wrong.
-- Ratified by the Document Owner on 2026-08-27.
--
-- **Why a column and not a setting.** The alternative was
-- `system_setting['category.description.<id>']`, which is where §4.9's default
-- visibility lives. It was rejected: that pattern exists for a *policy value
-- attached to* a Category, whereas this is an attribute *of* the Category —
-- it is read on every list, it belongs in the same projection as the name, and
-- routing it through settings would make one screen issue two reads for one
-- row and put half a row's identity outside the row.
--
-- **Nullable, and it stays nullable.** A Category or Level with no description
-- is the ordinary case, not a gap — the same treatment Revision 35 gave the
-- Branch contact fields and NEW I gave the second phone. Requiring one would
-- also make every existing row invalid, which a description cannot justify.
--
-- `VARCHAR(500)`: the Owner's longest is «الأطفال اناثا و ذكورا من سن السنة
-- الأخيرة من الروض الى سن السادسة ابتدائي» at well under 200 characters, and
-- 500 leaves room without inviting prose — this is a subtitle a person reads
-- under a name, not a page.

ALTER TABLE "category"
  ADD COLUMN "description" VARCHAR(500);

ALTER TABLE "level"
  ADD COLUMN "description" VARCHAR(500);
