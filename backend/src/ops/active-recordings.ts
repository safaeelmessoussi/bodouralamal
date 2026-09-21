/**
 * `npm run ops:active-recordings` — **asked before anything restarts the
 * recorder** (SRS Revision 167 §5).
 *
 * The recorder holds a class's file locally until the class ends, and uploads
 * it once. Restarting it mid-class — which is what a deployment does — loses
 * what it had captured, and nothing afterwards can bring that back. So a
 * deployment asks first: exit `0` and an empty list means go; exit `3` names the
 * recordings still open, and the deployment waits for them.
 *
 * Read-only. Under `src/` so that it ships in the release image.
 */
import { loadConfig } from '../lib/config.js';
import { createPrismaClient } from '../lib/prisma.js';
import { activeRecordings } from '../services/session-recording-reconcile.service.js';

const prisma = createPrismaClient(loadConfig().DATABASE_URL, 2);
const open = await activeRecordings(prisma);
process.stdout.write(`${JSON.stringify({ active: open.length, recordings: open })}\n`);
await prisma.$disconnect();
process.exitCode = open.length === 0 ? 0 : 3;
