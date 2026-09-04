import type { PrismaClient } from '../generated/prisma/client.js';

/**
 * **What BR-15's ninety days would destroy, if anyone were authorised to run
 * it** (SRS §4.10, BR-15, Revision 59.4).
 *
 * ## The open question this exists to inform
 *
 * `Trash.purge_after` records the end of the ninety-day window, and the job
 * named as its enforcement — `content.quarantine-purge` — **was never built**.
 * `startJobRunner` deliberately does not schedule it, with the reason in the
 * code: automatic destruction in production is an Owner decision that has not
 * been taken. That is R59.4, and it is still open.
 *
 * **So this module computes and explains, and destroys nothing.** It is the
 * same phase-1 position as the ten-year educational clock and the twelve-month
 * application clock, adopted for the same reason — a number nobody has measured
 * is a poor basis for authorising irreversible work. The Owner asked *«what
 * would it actually delete»*; this answers that, and only that.
 *
 * ## Why the storage split is the interesting half
 *
 * Purging a `Trash` row is cheap and reversible-ish in consequence: the row is
 * already a tombstone and the live record is already gone. **Purging the
 * STORAGE OBJECT a content snapshot points at is neither.** MinIO has no
 * undelete, the object is the only copy outside backups, and BR-15's window is
 * the only thing that has been keeping it. The two are therefore reported
 * separately rather than as one total, because they are two different
 * authorisations and the Owner may well grant one and not the other.
 *
 * **`targetEntity` is the classifier and it is not interpreted.** A snapshot is
 * a JSON blob whose shape follows whatever the row looked like when it was
 * deleted; reading fields out of it to guess at storage keys would make this
 * report depend on the historical shape of every model. The entity name is
 * recorded at delete time and is stable, so the report groups by it and says
 * plainly which groups carry objects.
 */

/**
 * Entities whose Trash snapshot corresponds to bytes in object storage.
 *
 * **Deliberately a small explicit list, not a heuristic.** Adding an entity here
 * is a statement that purging its tombstone strands or destroys a stored object,
 * and that statement should be made by a person reading the model, not inferred
 * from a field name that happens to contain "key".
 */
export const STORAGE_BACKED_ENTITIES = new Set(['EducationalContent']);

export interface TrashPurgeGroup {
  targetEntity: string;
  /** Rows whose ninety days have elapsed. */
  elapsed: number;
  /** The oldest elapsed row's window end — how long this has been sitting. */
  oldestPurgeAfter: Date;
  /**
   * Whether purging this group reaches object storage. **The consequential
   * half**: MinIO has no undelete and the object is the only copy outside
   * backups.
   */
  reachesStorage: boolean;
}

export interface TrashPurgeReport {
  /** The instant the report was computed against — echoed so a stored report
   *  is interpretable later without assuming when it ran. */
  asOf: Date;
  groups: TrashPurgeGroup[];
  totalElapsed: number;
  /** Elapsed rows in storage-backed entities, separated because they are a
   *  different authorisation from the rest. */
  totalElapsedReachingStorage: number;
}

/**
 * Reports every Trash row whose BR-15 window has elapsed, grouped by entity.
 *
 * **A dry run with no destructive counterpart.** There is no `purge` function in
 * this module and there must not be one until R59.4 is answered — a reporter
 * that ships beside its own executor invites someone to call the executor.
 */
export async function elapsedTrashWindows(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<TrashPurgeReport> {
  const rows = await prisma.trash.groupBy({
    by: ['targetEntity'],
    // Strictly before `now`: on the boundary instant the window has not elapsed,
    // matching the two retention clocks rather than differing by a day.
    where: { purgeAfter: { lt: now } },
    _count: { _all: true },
    _min: { purgeAfter: true },
  });

  const groups = rows
    .map((row) => ({
      targetEntity: row.targetEntity,
      elapsed: row._count._all,
      oldestPurgeAfter: row._min.purgeAfter!,
      reachesStorage: STORAGE_BACKED_ENTITIES.has(row.targetEntity),
    }))
    .sort((a, b) => b.elapsed - a.elapsed || a.targetEntity.localeCompare(b.targetEntity));

  return {
    asOf: now,
    groups,
    totalElapsed: groups.reduce((sum, g) => sum + g.elapsed, 0),
    totalElapsedReachingStorage: groups
      .filter((g) => g.reachesStorage)
      .reduce((sum, g) => sum + g.elapsed, 0),
  };
}
