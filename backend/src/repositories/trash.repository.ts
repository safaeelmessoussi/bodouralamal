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

/**
 * **R111's window for a deleted ACCOUNT — three days, and deliberately not the
 * same number.**
 *
 * A **second, shorter window for one entity type**, never a change to BR-15's.
 * The two answer different questions: ninety days is how long a deleted *record*
 * stays recoverable for the association, three is how long a person who deleted
 * their own account has to change their mind. Merging them would silently move
 * one of the two.
 *
 * Because they differ, **Trash must show which window a row is on** — a Super
 * Admin looking at a 3-day account beside a 90-day record cannot be left to
 * infer it from the entity name.
 */
export const ACCOUNT_PURGE_WINDOW_DAYS = 3;
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
export async function snapshot(
  db: Db,
  entry: TrashEntry,
  now: Date = new Date(),
  /**
   * Days until permanent deletion. Defaults to BR-15's ninety, so every existing
   * call site keeps exactly the window it had. **R111's account deletion passes
   * three** — stated by the caller that owns the shorter rule rather than
   * inferred here from the entity name, which would put one rule in two places.
   */
  purgeAfterDays: number = PURGE_WINDOW_DAYS,
): Promise<void> {
  await db.trash.create({
    data: {
      targetEntity: entry.targetEntity,
      targetId: entry.targetId,
      snapshot: entry.snapshot,
      deletedById: entry.deletedById,
      purgeAfter: new Date(now.getTime() + purgeAfterDays * MS_PER_DAY),
    },
  });
}

/**
 * Removes every tombstone for a row that a domain service has deliberately
 * revived through its canonical idempotent write path.
 *
 * Some unique relationship rows (currently LevelSubject and LevelSurah) cannot
 * be re-inserted after soft deletion: assigning the same pair restores the
 * existing row. The revival and removal of its old Trash entry must be one
 * transaction, or the Trash would advertise a live row as deleted forever.
 */
export async function removeForRevivedTarget(
  db: Db,
  targetEntity: string,
  targetId: string,
): Promise<void> {
  await db.trash.deleteMany({ where: { targetEntity, targetId } });
}
