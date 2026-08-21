import type { RefreshToken } from '../generated/prisma/client.js';
import { RefreshRevokedReason } from '../generated/prisma/enums.js';

import type { Db } from './audit.repository.js';

/**
 * The sole data-access layer for `RefreshToken` (§16.2 — services never touch
 * Prisma directly). Every function accepts the caller's `Db`, so a service can
 * pass its transaction client and keep TD-4.13/14/15 atomic.
 */

/** A token plus the successor that decides which refresh outcome applies. */
export type TokenWithSuccessor = RefreshToken & { rotatedTo: RefreshToken | null };

export async function findByHash(db: Db, tokenHash: string): Promise<TokenWithSuccessor | null> {
  return db.refreshToken.findUnique({
    where: { tokenHash },
    include: { rotatedTo: true },
  });
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

/** TD-7 `token.purge` — collects tokens past `expires_at`. */
export async function deleteExpired(db: Db, now: Date): Promise<number> {
  const result = await db.refreshToken.deleteMany({ where: { expiresAt: { lte: now } } });
  return result.count;
}
