/**
 * `npm run ops:reconcile-recordings` — **one pass of the recording reconciler,
 * now** (SRS Revision 167 §5, Revision 168 §2).
 *
 * The same function the `session-recording-reconcile` job runs every fifteen
 * minutes, for an operator who has just restarted a recorder and does not want
 * to wait: it asks the provider about open recordings, believes a staged file,
 * assembles the safety segments of a recording whose recorder died, and
 * re-queues every import that has not succeeded. It deletes nothing. Prints the
 * same counts the job logs.
 *
 * Under `src/` so that it ships in the release image. On Staging and Production
 * it changes recording state and queues jobs, and needs the Owner's
 * authorization like any other (CLAUDE.md, *Safe implementation*).
 */
import { loadConfig } from '../lib/config.js';
import { createOnlineClassProvider } from '../lib/online-class-provider.js';
import { createPrismaClient } from '../lib/prisma.js';
import { createStorageClients } from '../lib/storage.js';
import { reconcileRecordings } from '../services/session-recording-reconcile.service.js';

const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, 2);
const outcome = await reconcileRecordings(
  prisma,
  createStorageClients(config),
  createOnlineClassProvider(config),
);
process.stdout.write(`${JSON.stringify(outcome)}\n`);
await prisma.$disconnect();
