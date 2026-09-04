import type { Prisma } from '../generated/prisma/client.js';

/**
 * `Trash` snapshots — BR-15, TD-4.8, §4.10.
 *
 * BR-15 makes two promises about every soft delete: a **restorable snapshot**
 * exists, and it survives a permanent-delete window. Both were previously
 * re-stated at each delete site, which meant the window was hand-computed in
 * four places — and a single site drifting would break BR-15 silently, for one
 * entity only, in a way no test of the other three would see.
 *
 * The window lives here, once.
 */

/**
 * **Seven days, for everything** (Owner decision, 2026-09-05 — Revision 133).
 *
 * There used to be two: ninety days for a record and three for an account. They
 * were defended as answering different questions — how long the association may
 * change its mind, versus how long a person may — and the cost of that was
 * real: the Trash had to display **which window a row was on**, because a Super
 * Admin looking at a three-day account beside a ninety-day record could not
 * infer it from the entity name.
 *
 * The Owner's simplification removes the distinction rather than the display.
 * One number, one sentence to teach an administrator, one boundary to test:
 * *deleted things come back within a week or not at all*. Anything a person or
 * the association wants back is wanted within days; ninety days of recoverable
 * personal data was retention nobody had asked for.
 */
export const TRASH_WINDOW_DAYS = 7;
const MS_PER_DAY = 86_400_000;

type Db = Pick<Prisma.TransactionClient, 'trash'>;

export interface TrashEntry {
  targetEntity: string;
  targetId: string;
  /** The row as it stood before deletion. Serialised by the caller, which knows
   *  which of its fields are Dates that must survive the round-trip. */
  snapshot: object;
  /** `null` when the calendar did it rather than a person — the column is
   *  nullable precisely so a system-initiated deletion is recorded honestly. */
  deletedById: string | null;
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
): Promise<void> {
  await db.trash.create({
    data: {
      targetEntity: entry.targetEntity,
      targetId: entry.targetId,
      snapshot: entry.snapshot,
      deletedById: entry.deletedById,
      // **No per-caller override.** There used to be one, so account deletion
      // could pass its own shorter window; with a single window a parameter that
      // every caller leaves at the default is just a way for one of them to
      // disagree with the policy later.
      purgeAfter: new Date(now.getTime() + TRASH_WINDOW_DAYS * MS_PER_DAY),
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
