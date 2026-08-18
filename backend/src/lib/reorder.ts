import type { Prisma } from '../generated/prisma/client.js';
import { AppError } from './errors.js';

/**
 * **Manual ordering — the single implementation** (SRS Proposal R76).
 *
 * ## The contract takes the SEQUENCE, not per-row numbers
 *
 * `{ ids: [...] }`, and the server assigns `display_order` from each id's
 * position. That choice is what makes the failure modes disappear rather than be
 * validated against:
 *
 * * **duplicate `display_order` is impossible** — positions in a list are unique
 *   by construction;
 * * **gaps are impossible** — positions are contiguous;
 * * **no client arithmetic** — a client that had to compute every row's number
 *   would race any other client doing the same, and BR-19 would then resolve the
 *   collision arbitrarily.
 *
 * ## The sequence must be the WHOLE live set
 *
 * A partial sequence cannot say where the omitted rows belong: prepend them,
 * append them, or leave their old numbers to interleave unpredictably with the
 * new ones? Each is a different answer and none is obviously right, so the
 * request is refused unless `ids` matches the live set exactly — **naming which
 * ids were duplicated, missing or foreign**, because *"invalid order"* is not
 * something a caller can act on.
 *
 * This also makes the operation **idempotent**: sending the same sequence twice
 * produces the same rows, so a retried request after a dropped response is safe.
 *
 * ## Concurrency
 *
 * The set check and the writes run in **one transaction**. Two administrators
 * reordering at once resolve last-writer-wins **on the whole sequence**, which is
 * the honest outcome for an ordering: the loser's arrangement is replaced
 * wholesale rather than interleaved into an order neither of them chose. A
 * caller whose set is stale — a row created or deleted meanwhile — is refused by
 * the exact-set rule rather than silently discarding it.
 *
 * TD-15's per-row `version` is deliberately **not** used: it answers *"did this
 * row change under me"*, and a reorder is a statement about the collection.
 */

/** What a resource must expose for `applyOrder` to work on it. */
export interface ReorderTarget {
  /**
   * The live ids in the caller's scope — the set the request must match.
   *
   * **Takes the transaction**, because reading it outside would let the set go
   * stale between the check and the writes, which is precisely the race the
   * exact-set rule exists to catch.
   */
  liveIds: (tx: Prisma.TransactionClient) => Promise<string[]>;
  /** Writes one row's position, inside the caller's transaction. */
  write: (tx: Prisma.TransactionClient, id: string, displayOrder: number) => Promise<unknown>;
}

/**
 * Validates a requested sequence against the live set.
 *
 * Exported so it can be tested directly and reused by a resource whose write
 * side is unusual — the validation is the part with the interesting rules.
 */
export function assertExactSet(requested: readonly string[], live: readonly string[]): void {
  const seen = new Set<string>();
  const duplicates = requested.filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
  if (duplicates.length > 0) {
    throw new AppError('VALIDATION_FAILED', 'the order lists an id twice', {
      reason: 'DUPLICATE_ID',
      issues: [{ path: 'ids', message: `duplicated: ${[...new Set(duplicates)].join(', ')}` }],
    });
  }

  const liveSet = new Set(live);
  const foreign = requested.filter((id) => !liveSet.has(id));
  if (foreign.length > 0) {
    // Covers both "belongs to another resource" and "does not exist" — and does
    // not distinguish them, so the response confirms nothing about an id the
    // caller may not see (§20 rule 17).
    throw new AppError('VALIDATION_FAILED', 'the order lists an unknown id', {
      reason: 'UNKNOWN_ID',
      issues: [{ path: 'ids', message: `not in this collection: ${foreign.join(', ')}` }],
    });
  }

  const missing = live.filter((id) => !seen.has(id));
  if (missing.length > 0) {
    throw new AppError('VALIDATION_FAILED', 'the order omits rows', {
      reason: 'INCOMPLETE_ORDER',
      issues: [{ path: 'ids', message: `missing: ${missing.join(', ')}` }],
    });
  }
}

/**
 * Applies a sequence: validates it, then writes `1..n` in one transaction.
 *
 * Returns the ids in their new order, so a caller re-renders from the server's
 * answer rather than from its own optimistic guess.
 */
export async function applyOrder(
  prisma: { $transaction: <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T> },
  target: ReorderTarget,
  ids: readonly string[],
): Promise<string[]> {
  return prisma.$transaction(async (tx) => {
    // Read inside the transaction: a set read outside it could be stale by the
    // time the writes land, which is the race the exact-set rule exists to catch.
    assertExactSet(ids, await target.liveIds(tx));
    // **1-based and contiguous** (R76.6). Sequential rather than parallel so the
    // writes take their row locks in a consistent order and two concurrent
    // reorders cannot deadlock against each other.
    for (const [index, id] of ids.entries()) {
      await target.write(tx, id, index + 1);
    }
    return [...ids];
  });
}
