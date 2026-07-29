import type { Prisma } from '../generated/prisma/client.js';

/**
 * `Trash` snapshots — BR-15, TD-4.8, §4.10.
 *
 * BR-15 makes two promises about every soft delete: a **restorable snapshot**
 * exists, and it survives a **90-day** permanent-delete window. Both were
 * previously re-stated at each delete site, which meant the window was
 * hand-computed in four places — and a single site drifting would break BR-15
 * silently, for one entity only, in a way no test of the other three would see.
 *
 * The window lives here now, once. There is no MVP restoration UI (§4.10): the
 * runbook reads these rows, so what they contain is the whole recovery story.
 */

/** BR-15: the permanent-delete window. */
export const PURGE_WINDOW_DAYS = 90;
const MS_PER_DAY = 86_400_000;

type Db = Pick<Prisma.TransactionClient, 'trash'>;

export interface TrashEntry {
  targetEntity: string;
  targetId: string;
  /** The row as it stood before deletion. Serialised by the caller, which knows
   *  which of its fields are Dates that must survive the round-trip. */
  snapshot: object;
  deletedById: string;
}

/**
 * Writes the snapshot. Always called **inside the deleting transaction** — a
 * snapshot committed separately from its delete could be missing for a row that
 * is already gone, which is the one state the runbook cannot recover from.
 */
export async function snapshot(db: Db, entry: TrashEntry, now: Date = new Date()): Promise<void> {
  await db.trash.create({
    data: {
      targetEntity: entry.targetEntity,
      targetId: entry.targetId,
      snapshot: entry.snapshot,
      deletedById: entry.deletedById,
      purgeAfter: new Date(now.getTime() + PURGE_WINDOW_DAYS * MS_PER_DAY),
    },
  });
}
