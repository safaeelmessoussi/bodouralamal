/**
 * `npm run ops:requeue-recordings [-- --dry-run]` — see
 * `requeueStrandedRecordings` for what it does and why it exists.
 *
 * **Under `src/`, not `backend/scripts/`, on purpose**: the release image ships
 * compiled `src` and `prisma` only, and a recovery tool that cannot run on the
 * tier where recordings were stranded is a note, not a tool. On Staging and
 * Production it is a queue mutation and needs the Owner's authorization like
 * any other (CLAUDE.md, *Safe implementation*).
 */
import { loadConfig } from '../lib/config.js';
import { createPrismaClient } from '../lib/prisma.js';
import { requeueStrandedRecordings } from '../services/session-recording-ingest.service.js';

const prisma = createPrismaClient(loadConfig().DATABASE_URL, 2);
const outcome = await requeueStrandedRecordings(prisma, {
  dryRun: process.argv.includes('--dry-run'),
});
process.stdout.write(`${JSON.stringify(outcome)}\n`);
await prisma.$disconnect();
