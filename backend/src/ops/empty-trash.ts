/**
 * **Empty «سلة المحذوفات»** (Owner's request, 2026-10-01 — R190 §6).
 *
 * Purges every entry of the Trash through the same door the page's «حذف
 * نهائي» uses (`purgeEntry`: Super Admin freshness, the declared cascade,
 * the audit row), acting as the platform owner. An entry the service refuses
 * — `DEPENDENTS_EXIST` (something live still points at it) or
 * `NOT_YET_SUPPORTED` — is left in place and named in the report, never
 * forced: the refusal is the rule, not an obstacle. Children are purged in
 * passes, so a parent blocked only by a trashed child goes on the next pass.
 *
 *   docker compose exec -T api npm run --silent ops:empty-trash </dev/null
 *
 * `DRY_RUN=1` lists what would be purged and purges nothing. Prints a line
 * per entry and a summary.
 */
import { loadConfig } from '../lib/config.js';
import { AppError } from '../lib/errors.js';
import { createPrismaClient } from '../lib/prisma.js';
import type { Actor } from '../policies/actor.js';
import { purgeEntry } from '../services/trash.service.js';

const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, 2);

const owner = await prisma.platformOwner.findFirst({ select: { ownerUserId: true } });
if (!owner) throw new Error('no platform owner: nobody to act as');
const actor: Actor = {
  userId: owner.ownerUserId,
  roles: ['super_admin'],
  roleScopes: [{ role: 'super_admin', branches: null }],
  activeRole: 'super_admin',
  accountStatus: 'active',
};

let purged = 0;
let left: { entity: string; id: string; reason: string }[] = [];
// Up to four passes: a purge can unblock a parent that only a trashed child held.
for (let pass = 1; pass <= 4; pass += 1) {
  const entries = await prisma.trash.findMany({
    select: { id: true, targetEntity: true, targetId: true },
    orderBy: { deletedAt: 'asc' },
  });
  if (entries.length === 0) {
    left = [];
    break;
  }
  const blocked: typeof left = [];
  let purgedThisPass = 0;
  for (const entry of entries) {
    if (process.env['DRY_RUN'] === '1') {
      console.log(`would purge  ${entry.targetEntity} ${entry.targetId}`);
      continue;
    }
    try {
      const result = await purgeEntry(prisma, actor, entry.id);
      purged += 1;
      purgedThisPass += 1;
      console.log(
        `purged  ${result.targetEntity} ${result.targetId}${result.alreadyPurged ? ' (already gone)' : ''}`,
      );
    } catch (error) {
      const reason =
        error instanceof AppError
          ? `${error.code}${error.details?.['reason'] ? ` ${String(error.details['reason'])}` : ''}`
          : String(error);
      blocked.push({ entity: entry.targetEntity, id: entry.id, reason });
      console.log(`left    ${entry.targetEntity} ${entry.targetId} — ${reason}`);
    }
  }
  left = blocked;
  if (process.env['DRY_RUN'] === '1' || purgedThisPass === 0 || blocked.length === 0) break;
}
console.log(`\n${purged} purged, ${left.length} left${left.length ? ': ' + left.map((row) => `${row.entity} (${row.reason})`).join(', ') : ''}`);
await prisma.$disconnect();
