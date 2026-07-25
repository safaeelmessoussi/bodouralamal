import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { PrismaClient } from '../generated/prisma/client.js';
import { RefreshRevokedReason } from '../generated/prisma/enums.js';
import * as audit from '../repositories/audit.repository.js';
import type { Db } from '../repositories/audit.repository.js';
import * as tokens from '../repositories/refresh-token.repository.js';

/**
 * Refresh-token lifecycle (SRS TD-12, TD-4.13/14/15, §18 T1–T12).
 *
 * The only part of the system where one missing check silently extends a
 * 30-day credential, so every branch maps to a numbered acceptance criterion.
 *
 * Transaction boundaries live here, not in the repositories (§16.2), and every
 * revocation path writes its TD-8 audit row **inside the same transaction** —
 * the §7 attribution invariant makes that a correctness requirement, not
 * logging hygiene: who/when/why must be reconstructable from the AuditLog
 * alone, because the token row itself may later be purged (TD-7).
 */

/** TD-12: refresh token TTL 30 days. */
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** TD-12: the predecessor grace window that absorbs a two-tab refresh race. */
export const ROTATION_GRACE_MS = 10 * 1000;

/** 256 bits of entropy; the raw value is returned once and never persisted. */
const TOKEN_BYTES = 32;

export type RefreshOutcome =
  /** T1 — current live token: rotated. */
  | { kind: 'rotated'; userId: string; sessionId: string; rawToken: string; expiresAt: Date }
  /**
   * T3 — immediate predecessor inside the grace window. Deliberately does NOT
   * mint a third token: the caller keeps the successor it already has, because
   * a forked chain makes reuse detection impossible (TD-12).
   */
  | { kind: 'grace'; userId: string; sessionId: string }
  /**
   * T5 — replay of an older or revoked token. The whole session is revoked and
   * the caller still receives `401 AUTH_REQUIRED`; the distinction is
   * audit-only, so a stolen cookie learns nothing (TD-12).
   */
  | { kind: 'reuse_detected'; userId: string; sessionId: string; revokedCount: number }
  /** T10/T11 — expired, unknown or purged. */
  | { kind: 'rejected'; reason: 'unknown' | 'expired' };

/** Tokens are stored hashed, never raw (§18 T2). */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

function mintRaw(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** Prisma's unique-constraint code, without importing its error class. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002'
  );
}

export interface IssuedRefreshToken {
  rawToken: string;
  sessionId: string;
  expiresAt: Date;
}

/**
 * Starts a NEW session chain — used after a successful login, never for
 * rotation. `sessionId` is stamped here and copied by every successor, which is
 * what makes session-scoped revocation an indexed UPDATE (§7).
 */
export async function issueNewSession(
  db: Db,
  userId: string,
  now: Date = new Date(),
): Promise<IssuedRefreshToken> {
  const rawToken = mintRaw();
  const sessionId = randomUUID();
  const expiresAt = new Date(now.getTime() + REFRESH_TTL_MS);

  await tokens.insert(db, {
    userId,
    sessionId,
    tokenHash: hashToken(rawToken),
    issuedAt: now,
    expiresAt,
  });
  return { rawToken, sessionId, expiresAt };
}

/**
 * TD-4.13 — rotation is atomic: revoke the presented token, insert its
 * successor, and write `auth.refresh`, all in one transaction. A committed
 * revocation with a lost successor logs the user out spuriously; a committed
 * successor with a live predecessor leaves two valid tokens and defeats reuse
 * detection.
 */
export async function rotate(
  prisma: PrismaClient,
  presentedRaw: string,
  now: Date = new Date(),
): Promise<RefreshOutcome> {
  const presentedHash = hashToken(presentedRaw);

  return prisma.$transaction(async (tx) => {
    const presented = await tokens.findByHash(tx, presentedHash);

    // T10/T11 — unknown or purged. Fail closed, and identically to expired.
    if (!presented) return { kind: 'rejected', reason: 'unknown' };
    if (presented.expiresAt <= now) return { kind: 'rejected', reason: 'expired' };

    /** T5 — end the whole chain and record it as a security event. */
    const detectReuse = async (): Promise<RefreshOutcome> => {
      const revokedIds = await tokens.revokeSessionTokens(
        tx,
        presented.sessionId,
        RefreshRevokedReason.reuse_detected,
        now,
      );
      // Actor is null: a replay arrives on an unauthenticated request, so the
      // revocation is system-initiated (§7, Revision 17). The victim is the
      // target, and the reason carries the why.
      await audit.write(tx, {
        actorUserId: null,
        actionType: audit.AUDIT_ACTIONS.tokenRevoked,
        targetEntity: 'User',
        targetId: presented.userId,
        detail: {
          reason: RefreshRevokedReason.reuse_detected,
          session_ids: [presented.sessionId],
          tokens_revoked: revokedIds.length,
        },
      });
      await audit.write(tx, {
        actorUserId: null,
        actionType: audit.AUDIT_ACTIONS.loginDenied,
        targetEntity: 'User',
        targetId: presented.userId,
        detail: { reason: 'refresh_token_replayed', session_ids: [presented.sessionId] },
      });
      return {
        kind: 'reuse_detected',
        userId: presented.userId,
        sessionId: presented.sessionId,
        revokedCount: revokedIds.length,
      };
    };

    const successor = presented.rotatedTo;

    // Decision order matters, and it is NOT "revoked ⇒ replay". Rotation itself
    // revokes the predecessor, so the immediate predecessor is ALWAYS revoked —
    // checking `revokedAt` first would make the grace window unreachable and log
    // innocent users out on a two-tab race. Successor-presence is therefore the
    // first question, and `revokedAt` only decides the no-successor case, where
    // it can only mean a DELIBERATE revocation.
    if (successor !== null) {
      // At least two generations old: unambiguously a replayed secret.
      if (await tokens.hasSuccessor(tx, successor.id)) return detectReuse();

      // T3 — immediate predecessor inside the window: accept, but do NOT mint a
      // third token; forking the chain would destroy reuse detection (TD-12).
      if (now.getTime() - successor.issuedAt.getTime() <= ROTATION_GRACE_MS) {
        return { kind: 'grace', userId: presented.userId, sessionId: presented.sessionId };
      }
      // T4 — same token, past the window: a replay, not grace.
      return detectReuse();
    }

    // No successor, so a revocation here cannot have come from rotation: it is
    // deliberate — logout, suspension, deletion, or an earlier detected replay
    // (T6, T7, T8, T9, T11). Never resurrect it.
    if (presented.revokedAt !== null) return detectReuse();

    // ── T1: the current live token. Rotate.
    const rawToken = mintRaw();
    const expiresAt = new Date(now.getTime() + REFRESH_TTL_MS);

    await tokens.markRotated(tx, presented.id, now);

    try {
      await tokens.insert(tx, {
        userId: presented.userId,
        sessionId: presented.sessionId,
        tokenHash: hashToken(rawToken),
        rotatedFromId: presented.id,
        issuedAt: now,
        expiresAt,
      });
    } catch (error) {
      // Lost the insert race: a concurrent request already rotated this exact
      // token, caught by the unique index on `rotated_from_id`. That is the same
      // situation the grace window exists for, so the caller keeps the winner's
      // successor. TD-15.3 forbids surfacing a concurrency conflict as a 500,
      // and logging the user out here would be worse still.
      if (isUniqueViolation(error)) {
        return { kind: 'grace', userId: presented.userId, sessionId: presented.sessionId };
      }
      throw error;
    }

    // Self-service action: the actor is the session's own user.
    await audit.write(tx, {
      actorUserId: presented.userId,
      actionType: audit.AUDIT_ACTIONS.refresh,
      targetEntity: 'User',
      targetId: presented.userId,
      detail: {
        session_ids: [presented.sessionId],
        rotated_from_token_id: presented.id,
      },
    });

    return {
      kind: 'rotated',
      userId: presented.userId,
      sessionId: presented.sessionId,
      rawToken,
      expiresAt,
    };
  });
}

/**
 * TD-4.14 — logout revokes only the CURRENT session, with its audit row in the
 * same transaction. Other devices keep working (§18 T6).
 *
 * `actorUserId` is explicit rather than inferred: for a self-service logout it
 * is the user, and passing it keeps the caller honest about attribution.
 */
export async function logout(
  db: Db,
  params: { userId: string; sessionId: string; actorUserId: string | null },
  now: Date = new Date(),
): Promise<number> {
  const revokedIds = await tokens.revokeSessionTokens(
    db,
    params.sessionId,
    RefreshRevokedReason.logout,
    now,
  );
  await audit.write(db, {
    actorUserId: params.actorUserId,
    actionType: audit.AUDIT_ACTIONS.logout,
    targetEntity: 'User',
    targetId: params.userId,
    detail: { session_ids: [params.sessionId], tokens_revoked: revokedIds.length },
  });
  return revokedIds.length;
}

/**
 * TD-4.15 — revoke every live session of a user (§18 T7/T8/T9). Called INSIDE
 * the suspension or soft-delete transaction: a suspension that commits without
 * revoking leaves a 30-day credential alive, which is the safeguarding failure
 * the TD-12 freshness rule exists to prevent.
 *
 * The audit detail records the affected `session_id`s, not merely a count, so a
 * specific session remains attributable (§7 attribution invariant).
 *
 * There is deliberately no user-facing route for this (TD-12, §14.1).
 */
export async function revokeAllSessions(
  db: Db,
  params: {
    userId: string;
    reason: RefreshRevokedReason;
    /** Null for system-initiated revocation; the admin's id for suspension. */
    actorUserId: string | null;
  },
  now: Date = new Date(),
): Promise<{ sessionIds: string[]; tokenCount: number }> {
  const result = await tokens.revokeAllUserTokens(db, params.userId, params.reason, now);

  // Written even when nothing was live: "an admin suspended this user and no
  // session existed" is itself the answer to "why is there no revocation row?".
  await audit.write(db, {
    actorUserId: params.actorUserId,
    actionType: audit.AUDIT_ACTIONS.tokenRevoked,
    targetEntity: 'User',
    targetId: params.userId,
    detail: {
      reason: params.reason,
      session_ids: result.sessionIds,
      tokens_revoked: result.tokenCount,
    },
  });
  return result;
}

/**
 * TD-7 `token.purge` — collect tokens past `expires_at`. Purging can never
 * widen access: a presented token with no row is rejected identically to an
 * expired one (§18 T10). No audit row: nothing is revoked here, and the
 * attribution invariant concerns revocation, not garbage collection.
 */
export async function purgeExpired(db: Db, now: Date = new Date()): Promise<number> {
  return tokens.deleteExpired(db, now);
}
