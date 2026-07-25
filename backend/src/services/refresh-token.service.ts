import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { PrismaClient } from '../generated/prisma/client.js';
import { RefreshRevokedReason } from '../generated/prisma/enums.js';

/**
 * Refresh-token lifecycle (SRS TD-12, TD-4.13/14/15, §18 T1–T12).
 *
 * The only part of the system where one missing check silently extends a
 * 30-day credential, so every branch below maps to a numbered acceptance
 * criterion and the tests assert them by name.
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
   * T5 — replay of an older or revoked token. The whole session is revoked.
   * `AUTH_REQUIRED` is returned either way; the distinction is audit-only, so a
   * stolen cookie learns nothing (TD-12).
   */
  | { kind: 'reuse_detected'; userId: string; sessionId: string; revokedCount: number }
  /** T10/T11 — expired, unknown, purged, or already-revoked-and-not-a-chain-replay. */
  | { kind: 'rejected'; reason: 'unknown' | 'expired' };

/** Prisma's unique-constraint code, without importing its error class. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

/** Tokens are stored hashed, never raw (T2). */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

function mintRaw(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
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
  tx: PrismaClient,
  userId: string,
  now: Date = new Date(),
): Promise<IssuedRefreshToken> {
  const rawToken = mintRaw();
  const sessionId = randomUUID();
  const expiresAt = new Date(now.getTime() + REFRESH_TTL_MS);

  await tx.refreshToken.create({
    data: { userId, sessionId, tokenHash: hashToken(rawToken), issuedAt: now, expiresAt },
  });
  return { rawToken, sessionId, expiresAt };
}

/**
 * TD-4.13 — rotation is atomic: revoke the presented token AND insert its
 * successor in one transaction. A committed revocation with a lost successor
 * logs the user out spuriously; a committed successor with a live predecessor
 * leaves two valid tokens and defeats reuse detection.
 */
export async function rotate(
  prisma: PrismaClient,
  presentedRaw: string,
  now: Date = new Date(),
): Promise<RefreshOutcome> {
  const presentedHash = hashToken(presentedRaw);

  return prisma.$transaction(async (tx) => {
    const presented = await tx.refreshToken.findUnique({
      where: { tokenHash: presentedHash },
      // The successor, if this token was already rotated. Its existence is what
      // distinguishes "current" from "predecessor" from "ancient".
      include: { rotatedTo: true },
    });

    // T10/T11 — unknown or purged. Fail closed and identically.
    if (!presented) return { kind: 'rejected', reason: 'unknown' };

    if (presented.expiresAt <= now) return { kind: 'rejected', reason: 'expired' };

    const revokeWholeSession = async (): Promise<RefreshOutcome> => {
      const revoked = await tx.refreshToken.updateMany({
        where: { sessionId: presented.sessionId, revokedAt: null },
        data: { revokedAt: now, revokedReason: RefreshRevokedReason.reuse_detected },
      });
      return {
        kind: 'reuse_detected',
        userId: presented.userId,
        sessionId: presented.sessionId,
        revokedCount: revoked.count,
      };
    };

    const successor = presented.rotatedTo;

    // Decision order matters, and it is NOT "revoked ⇒ replay". Rotation itself
    // revokes the predecessor, so the immediate predecessor is ALWAYS revoked —
    // checking `revokedAt` first would make the grace window unreachable and
    // log innocent users out on a two-tab race. Presence of a successor is
    // therefore the first question, and `revokedAt` only decides the no-successor
    // case, where it can only mean a DELIBERATE revocation.
    if (successor !== null) {
      // T5 — the successor has itself been rotated, so this token is at least
      // two generations old: unambiguously a replayed secret.
      const successorWasRotated =
        (await tx.refreshToken.count({ where: { rotatedFromId: successor.id } })) > 0;
      if (successorWasRotated) return revokeWholeSession();

      // T3 — immediate predecessor inside the window: accept, but do NOT mint a
      // third token. The caller already holds the live successor, and forking
      // the chain would destroy reuse detection (TD-12).
      if (now.getTime() - successor.issuedAt.getTime() <= ROTATION_GRACE_MS) {
        return { kind: 'grace', userId: presented.userId, sessionId: presented.sessionId };
      }

      // T4 — same token, past the window: a replay, not grace.
      return revokeWholeSession();
    }

    // No successor. A revocation here cannot have come from rotation, so it is a
    // deliberate one — logout, suspension, deletion, or an earlier detected
    // replay (T6, T7, T8, T9, T11). Never resurrect it.
    if (presented.revokedAt !== null) return revokeWholeSession();

    // ── T1: the current live token. Rotate.
    const rawToken = mintRaw();
    const expiresAt = new Date(now.getTime() + REFRESH_TTL_MS);

    await tx.refreshToken.update({
      where: { id: presented.id },
      // revokedReason stays NULL: §7 lists the four reasons as DELIBERATE
      // revocations, and rotation is mechanical supersession, not one of them.
      // A null reason on a revoked row therefore reads as "rotated".
      data: { revokedAt: now },
    });

    try {
      await tx.refreshToken.create({
        data: {
          userId: presented.userId,
          sessionId: presented.sessionId,
          tokenHash: hashToken(rawToken),
          rotatedFromId: presented.id,
          issuedAt: now,
          expiresAt,
        },
      });
    } catch (error) {
      // Lost the insert race: a concurrent request already rotated this exact
      // token, and the unique index on `rotated_from_id` is what caught it. That
      // is the same situation the grace window exists for, so the caller keeps
      // the winner's successor. TD-15.3 forbids surfacing a concurrency conflict
      // as a 500, and logging the user out here would be worse still.
      if (isUniqueViolation(error)) {
        return { kind: 'grace', userId: presented.userId, sessionId: presented.sessionId };
      }
      throw error;
    }

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
 * TD-4.14 — logout revokes only the CURRENT session. Other devices keep
 * working (T6): logging out of one browser must not end a session elsewhere.
 */
export async function revokeSession(
  tx: PrismaClient,
  sessionId: string,
  reason: RefreshRevokedReason = RefreshRevokedReason.logout,
  now: Date = new Date(),
): Promise<number> {
  const result = await tx.refreshToken.updateMany({
    where: { sessionId, revokedAt: null },
    data: { revokedAt: now, revokedReason: reason },
  });
  return result.count;
}

/**
 * TD-4.15 — revoke every live token of a user (T7/T8/T9). Called INSIDE the
 * suspension or soft-delete transaction: a suspension that commits without
 * revoking leaves a 30-day credential alive, which is the safeguarding failure
 * the TD-12 freshness rule exists to prevent.
 *
 * There is deliberately no user-facing route for this (TD-12, §14.1).
 */
export async function revokeAllForUser(
  tx: PrismaClient,
  userId: string,
  reason: RefreshRevokedReason,
  now: Date = new Date(),
): Promise<number> {
  const result = await tx.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: now, revokedReason: reason },
  });
  return result.count;
}

/**
 * TD-7 `token.purge` — collect tokens past `expires_at`. Purging can never
 * widen access: a presented token with no row is rejected identically to an
 * expired one (T10).
 */
export async function purgeExpired(
  tx: PrismaClient,
  now: Date = new Date(),
): Promise<number> {
  const result = await tx.refreshToken.deleteMany({ where: { expiresAt: { lte: now } } });
  return result.count;
}
