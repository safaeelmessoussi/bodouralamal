/**
 * **The programmes as the institute runs them from this year** (the Owner,
 * 2026-10-20 — SRS Revision 233): «اليافعات» in two tracks (the current Levels
 * renamed «… كبار», a new «… صغار» line), the new boys' «اليافعين» in two
 * tracks, and the entry Levels. The rule is `applyProgrammesR233`; re-running
 * it changes nothing. One audit row per change.
 *
 *   docker compose exec -T -e DRY_RUN=1 api npm run --silent ops:apply-programmes </dev/null
 *   docker compose exec -T api npm run --silent ops:apply-programmes </dev/null
 *
 * `DRY_RUN=1` prints what would change and rolls everything back.
 */
import { loadConfig } from '../lib/config.js';
import { createPrismaClient } from '../lib/prisma.js';
import { applyProgrammesR233 } from '../services/programmes-r233.service.js';

const dry = process.env['DRY_RUN'] === '1';
const prisma = createPrismaClient(loadConfig().DATABASE_URL, 2);

class Rollback extends Error {}
let changes = 0;

try {
  await prisma.$transaction(
    async (tx) => {
      const report = await applyProgrammesR233(tx);
      for (const line of report.lines) console.log(line);
      changes = report.changes;
      if (dry) throw new Rollback();
    },
    { timeout: 120_000 },
  );
} catch (error) {
  if (!(error instanceof Rollback)) throw error;
}

console.log(`${dry ? 'DRY RUN — nothing saved. ' : ''}changes: ${String(changes)}`);
await prisma.$disconnect();
