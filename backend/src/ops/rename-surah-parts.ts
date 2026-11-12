/**
 * **Titles already stored name a Surah's part with today's label** (the Owner,
 * 2026-11-12 — R265: «الجزء الأول (الحزب الأول و الثاني)» and «الجزء الثاني
 * (من الحزب الثالث الى آخر السورة)», named once in `policies/surah-parts.ts`).
 * Re-run it after that label changes again.
 *
 *   docker compose exec -T api npm run --silent ops:rename-surah-parts </dev/null
 *
 * **Lists only, by default.** `APPLY=1` writes. Only the part's words change.
 */
import { loadConfig } from '../lib/config.js';
import { createPrismaClient } from '../lib/prisma.js';
import { partLabels, relabelParts } from '../policies/surah-parts.js';

const prisma = createPrismaClient(loadConfig().DATABASE_URL, 2);
const apply = process.env['APPLY'] === '1';

let changed = 0;
for (const surah of await prisma.quranSurah.findMany({ select: { surahId: true, nameArabic: true } })) {
  if (partLabels(surah.surahId).length === 0) continue;
  const rows = await prisma.educationalContent.findMany({
    where: { deletedAt: null, title: { contains: `سورة ${surah.nameArabic} الجزء` } },
    select: { id: true, title: true },
  });
  for (const row of rows) {
    const title = relabelParts(row.title, surah.surahId, surah.nameArabic);
    if (title === row.title) continue;
    // A title the longer label would push past the column is reported, never cut.
    if (title.length > 120) {
      console.log(`too long, left as it is  ${row.id}  ${row.title}`);
      continue;
    }
    changed += 1;
    console.log(`${apply ? 'renamed' : 'would rename'}  ${row.id}\n  ${row.title}\n→ ${title}`);
    if (apply) await prisma.educationalContent.update({ where: { id: row.id }, data: { title } });
  }
}
console.log(`${String(changed)} title(s) ${apply ? 'renamed' : 'to rename'}`);
await prisma.$disconnect();
