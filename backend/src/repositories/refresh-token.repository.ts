import type { Prisma, RefreshToken } from '../generated/prisma/client.js';
import { RefreshRevokedReason } from '../generated/prisma/enums.js';

import type { Db } from './audit.repository.js';

/**
 * The sole data-access layer for `RefreshToken` (§16.2 — services never touch
 * Prisma directly). Every function accepts the caller's `Db`, so a service can
 * pass its transaction client and keep TD-4.13/14/15 atomic.
 */

/** A token plus the successor that decides which refresh outcome applies. */
export type TokenWithSuccessor = RefreshToken & { rotatedTo: RefreshToken | null };

/** Maximum number of expired rows examined before `token.purge` yields to the
 * next set of session-scoped transactions. The delete for each selected
 * session still removes every eligible generation in that session. */
export const PURGE_CANDIDATE_BATCH_SIZE = 100;

export async function findByHash(db: Db, tokenHash: string): Promise<TokenWithSuccessor | null> {
  return db.refreshToken.findUnique({
    where: { tokenHash },
    include: { rotatedTo: true },
  });
}

/**
 * Serializes every refresh-token state transition for one rotation chain.
 *
 * Locking only the presented row is insufficient: logout presents the current
 * token while a racing grace request may present its predecessor, and a purge
 * may delete either generation. The stable `refresh_session` row is therefore
 * the governing row: it exists independently of generation insertion/deletion
 * and gives every operation one exact boundary without serializing another
 * browser session of the same user.
 *
 * Callers identify the session before this lock and MUST re-read afterward.
 * Under PostgreSQL READ COMMITTED, that later statement sees the rotation,
 * revocation or purge that made the caller wait.
 */
export async function lockSession(
  tx: Prisma.TransactionClient,
  sessionId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "refresh_session"
    WHERE "id" = ${sessionId}::uuid
    FOR UPDATE`;
  return rows.length === 1;
}

/** Creates the stable lock target before the first credential generation. */
export async function insertSession(
  db: Db,
  data: { id: string; userId: string; createdAt: Date },
): Promise<void> {
  await db.refreshSession.create({
    data: { id: data.id, userId: data.userId, createdAt: data.createdAt },
  });
}

/** Stable session ids for TD-4.15 revoke-all, always locked in this order. */
export async function findUserSessionIds(db: Db, userId: string): Promise<string[]> {
  const rows = await db.refreshSession.findMany({
    where: { userId },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  return rows.map((row) => row.id);
}

export async function lockSessions(
  tx: Prisma.TransactionClient,
  sessionIds: readonly string[],
): Promise<void> {
  for (const sessionId of [...sessionIds].sort()) {
    await lockSession(tx, sessionId);
  }
}

/** True when `tokenId` has itself been rotated — i.e. the caller's token is at
 *  least two generations old, which is unambiguously a replay (§18 T5). */
export async function hasSuccessor(db: Db, tokenId: string): Promise<boolean> {
  return (await db.refreshToken.count({ where: { rotatedFromId: tokenId } })) > 0;
}

export async function insert(
  db: Db,
  data: {
    userId: string;
    sessionId: string;
    tokenHash: string;
    issuedAt: Date;
    expiresAt: Date;
    rotatedFromId?: string;
  },
): Promise<RefreshToken> {
  return db.refreshToken.create({
    data: {
      userId: data.userId,
      sessionId: data.sessionId,
      tokenHash: data.tokenHash,
      issuedAt: data.issuedAt,
      expiresAt: data.expiresAt,
      ...(data.rotatedFromId ? { rotatedFromId: data.rotatedFromId } : {}),
    },
  });
}

/**
 * Marks a token superseded by rotation. `revoked_reason` is deliberately left
 * NULL: §7's enumerated reasons name *deliberate* revocations, so a revoked row
 * with a null reason reads as "rotated" (TD-4.13, Revision 17; R101).
 */
export async function markRotated(db: Db, tokenId: string, now: Date): Promise<void> {
  await db.refreshToken.update({ where: { id: tokenId }, data: { revokedAt: now } });
}

/** Revokes every live token of one rotation chain. Returns the affected ids so
 *  the caller can record them in the audit detail (TD-8, Revision 17). */
export async function revokeSessionTokens(
  db: Db,
  sessionId: string,
  reason: RefreshRevokedReason,
  now: Date,
): Promise<string[]> {
  const live = await db.refreshToken.findMany({
    where: { sessionId, revokedAt: null },
    select: { id: true },
  });
  if (live.length === 0) return [];
  await db.refreshToken.updateMany({
    where: { sessionId, revokedAt: null },
    data: { revokedAt: now, revokedReason: reason },
  });
  return live.map((row) => row.id);
}

/**
 * Revokes every live token of a user, across all sessions. Returns the affected
 * `session_id`s — the audit detail needs the ids, not merely a count, or a
 * revoke-all touching several sessions could not attribute a specific one
 * (§7 attribution invariant, Revision 17).
 */
export async function revokeAllUserTokens(
  db: Db,
  userId: string,
  reason: RefreshRevokedReason,
  now: Date,
): Promise<{ sessionIds: string[]; tokenCount: number }> {
  const live = await db.refreshToken.findMany({
    where: { userId, revokedAt: null },
    select: { sessionId: true },
  });
  if (live.length === 0) return { sessionIds: [], tokenCount: 0 };

  await db.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: now, revokedReason: reason },
  });
  return {
    sessionIds: [...new Set(live.map((row) => row.sessionId))],
    tokenCount: live.length,
  };
}

/** True while the session can still authorize a refresh finalization. */
export async function hasLiveToken(db: Db, sessionId: string, now: Date): Promise<boolean> {
  return (
    (await db.refreshToken.count({
      where: { sessionId, revokedAt: null, expiresAt: { gt: now } },
    })) > 0
  );
}

/** Bounded discovery for TD-7 `token.purge`; locking happens afterwards in a
 * transaction scoped to each returned session. */
export async function findExpiredSessionIds(
  db: Db,
  now: Date,
  take: number = PURGE_CANDIDATE_BATCH_SIZE,
): Promise<string[]> {
  const rows = await db.refreshToken.findMany({
    where: { expiresAt: { lte: now } },
    select: { sessionId: true },
    orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
    take,
  });
  return [...new Set(rows.map((row) => row.sessionId))];
}

/** Deletes only eligible generations from the already-locked session. */
export async function deleteExpiredForSession(
  db: Db,
  sessionId: string,
  now: Date,
): Promise<number> {
  const result = await db.refreshToken.deleteMany({
    where: { sessionId, expiresAt: { lte: now } },
  });
  return result.count;
}

/** Removes a lock anchor only after its final token generation is gone. The
 * caller holds this anchor's row lock, so no refresh can insert a successor
 * between the emptiness predicate and the delete. */
export async function deleteSessionIfEmpty(db: Db, sessionId: string): Promise<void> {
  await db.refreshSession.deleteMany({
    where: { id: sessionId, tokens: { none: {} } },
  });
}
