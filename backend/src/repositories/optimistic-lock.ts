import { AppError } from '../lib/errors.js';

import type { Db } from './audit.repository.js';

/**
 * Optimistic locking for the TD-15 `version`-carrying entities.
 *
 * TD-15.1 names them: `Group`, `Level`, `Category`, `Subject`, `Branch`, `Room`,
 * `Event`, `Exam`, `EducationalContent`, `SystemSetting`, `Grade`, `User`.
 * Every edit form loads the current `version` and sends it back; the UPDATE is
 * conditional on it and increments it. Zero rows updated → `409
 * VERSION_CONFLICT`, and the client reloads and re-applies.
 *
 * **Silent last-write-wins on these entities is prohibited** (§20 rule 12).
 * Two admins editing the same Group must resolve as first-save-wins with the
 * second told plainly — nothing merged, nothing lost without anyone noticing.
 */

/** The subset of a Prisma delegate this helper needs, so one implementation
 *  serves every TD-15 entity without `any` (§16.2 bans it here). */
interface VersionedDelegate<T> {
  updateMany(args: {
    where: { id: string; version: number; deletedAt?: null };
    data: Record<string, unknown>;
  }): Promise<{ count: number }>;
  findUnique(args: { where: { id: string } }): Promise<T | null>;
}

export interface VersionedUpdate<T> {
  delegate: VersionedDelegate<T>;
  id: string;
  /** The version the client last saw. */
  expectedVersion: number;
  data: Record<string, unknown>;
  /** Set when the entity is soft-deletable, so a deleted row cannot be edited. */
  requireNotDeleted?: boolean;
}

/**
 * Applies a conditional UPDATE and increments `version`.
 *
 * Throws `VERSION_CONFLICT` when the row exists but has moved on, and
 * `NOT_FOUND` when it does not exist at all — the two are different answers and
 * must not be collapsed: telling an admin "changed by someone else" about a row
 * that was deleted would send them to reload a record that is gone.
 */
export async function updateWithVersion<T>(params: VersionedUpdate<T>): Promise<T> {
  const result = await params.delegate.updateMany({
    where: {
      id: params.id,
      version: params.expectedVersion,
      ...(params.requireNotDeleted ? { deletedAt: null } : {}),
    },
    data: { ...params.data, version: { increment: 1 } },
  });

  if (result.count === 0) {
    // Distinguish "gone" from "moved on" with one extra indexed read, taken
    // only on the conflict path so the happy path stays a single statement.
    const current = await params.delegate.findUnique({ where: { id: params.id } });
    if (!current) throw new AppError('NOT_FOUND', `entity ${params.id} not found`);
    throw new AppError('VERSION_CONFLICT', `stale version for ${params.id}`, {
      expected_version: params.expectedVersion,
    });
  }

  const updated = await params.delegate.findUnique({ where: { id: params.id } });
  if (!updated) throw new AppError('NOT_FOUND', `entity ${params.id} vanished after update`);
  return updated;
}

/**
 * TD-5 deletion guards are check-then-write on an invariant, so callers must
 * hold the governing rows (TD-15.2). This helper only reports whether blocking
 * references exist; the caller owns the transaction and the lock.
 */
export async function assertNoBlockingReferences(
  counts: { label: string; count: number }[],
): Promise<void> {
  const blocking = counts.filter((entry) => entry.count > 0);
  if (blocking.length > 0) {
    // TD-5: prohibited deletions answer 409 STATE_CONFLICT, not 403 or 500.
    throw new AppError('STATE_CONFLICT', 'deletion blocked by references', {
      blocked_by: Object.fromEntries(blocking.map((entry) => [entry.label, entry.count])),
    });
  }
}

/** Convenience for repositories that need the `Db` type alias re-exported. */
export type { Db };
