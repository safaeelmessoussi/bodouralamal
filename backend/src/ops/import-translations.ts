/**
 * **Import the translations of the stored texts** (SRS Revision 224 §4 — the
 * Owner, 2026-10-16: «the robust correct translations of everything currently
 * saved in the whole platform»).
 *
 * Writes `data/translations-r224.ts` into `text_translation`, one row per
 * language and Arabic text. A row a person corrected (`origin = 'manual'`) is
 * never overwritten; every other row takes the imported text. Harmless to run
 * twice.
 *
 *   docker compose exec -T -e DRY_RUN=1 api npm run --silent ops:import-translations </dev/null
 *   docker compose exec -T api npm run --silent ops:import-translations </dev/null
 */
import { loadConfig } from '../lib/config.js';
import { createPrismaClient } from '../lib/prisma.js';
import { TRANSLATIONS } from './data/translations-r224.js';

const dry = process.env['DRY_RUN'] === '1';
const prisma = createPrismaClient(loadConfig().DATABASE_URL, 2);

let written = 0;
let kept = 0;
for (const [locale, dictionary] of Object.entries(TRANSLATIONS)) {
  const manual = new Set(
    (await prisma.textTranslation.findMany({ where: { locale, origin: 'manual' }, select: { source: true } })).map(
      (r) => r.source,
    ),
  );
  let count = 0;
  for (const [source, text] of Object.entries(dictionary)) {
    if (manual.has(source)) {
      kept += 1;
      continue;
    }
    if (!dry) {
      await prisma.textTranslation.upsert({
        where: { locale_source: { locale, source } },
        create: { locale, source, text, origin: 'initial' },
        update: { text, origin: 'initial' },
      });
    }
    count += 1;
  }
  written += count;
  console.log(`${locale.padEnd(8)} ${dry ? 'would write' : 'written'} ${String(count)}`);
}
console.log(`${dry ? 'DRY RUN — nothing saved. ' : ''}translations: ${String(written)}; corrected by a person, kept: ${String(kept)}`);
await prisma.$disconnect();
