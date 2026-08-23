import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { RefreshRevokedReason } from '../generated/prisma/enums.js';
import { issueAccessToken } from '../lib/access-token.js';
import { narrowToRole } from '../policies/branch-scope.js';
import * as audit from '../repositories/audit.repository.js';
import type { Db } from '../repositories/audit.repository.js';
import * as tokens from '../repositories/refresh-token.repository.js';
import * as users from '../repositories/user.repository.js';

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

export type RefreshAccessOutcome =
  | Extract<RefreshOutcome, { kind: 'rejected' | 'reuse_detected' }>
  | {
      kind: 'rotated';
      accessToken: string;
      accessExpiresAt: Date;
      activeRole: string | null;
      rawToken: string;
      refreshExpiresAt: Date;
    }
  | {
      kind: 'grace';
      accessToken: string;
      accessExpiresAt: Date;
      activeRole: string | null;
    };

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
 * Finds the presented credential, takes the stable session-row lock, then
 * reads it again. The first read discovers the server-owned `session_id`; only
 * the second is authoritative because another rotation/logout/purge may have
 * committed while this transaction waited.
 */
async function identifyAndLockSession(
  tx: Prisma.TransactionClient,
  presentedHash: string,
): Promise<
  | {
      identified: tokens.TokenWithSuccessor;
      current: tokens.TokenWithSuccessor | null;
    }
  | null
> {
  const identified = await tokens.findByHash(tx, presentedHash);
  if (!identified) return null;

  if (!(await tokens.lockSession(tx, identified.sessionId))) return null;
  return { identified, current: await tokens.findByHash(tx, presentedHash) };
}

function isRootClient(db: Db): db is PrismaClient {
  return '$transaction' in db;
}

/**
 * Starts a NEW session chain — used after a successful login, never for
 * rotation. `sessionId` is stamped here and copied by every successor, which is
 * what makes session-scoped revocation an indexed UPDATE (§7). Every caller,
 * including test/maintenance callers using the root client, participates in
 * the user-level serialization boundary here; a helper call cannot bypass the
 * lock simply because it did not enter through the OAuth controller.
 */
export async function issueNewSession(
  db: Db,
  userId: string,
  now: Date = new Date(),
): Promise<IssuedRefreshToken> {
  const rawToken = mintRaw();
  const sessionId = randomUUID();
  const expiresAt = new Date(now.getTime() + REFRESH_TTL_MS);

  const persist = async (tx: Prisma.TransactionClient): Promise<void> => {
    if (!(await users.lockUser(tx, userId))) {
      throw new Error('cannot issue a refresh session for a missing user');
    }
    const state = await users.findSessionState(tx, userId);
    if (
      !state ||
      state.deletedAt !== null ||
      (state.accountStatus !== 'active' && state.accountStatus !== 'pending')
    ) {
      // R102: the shared issuer is itself an authority boundary. A caller that
      // bypasses final OAuth routing still cannot create a new session after
      // rejection (or another deactivation) won the User governing lock.
      throw new Error('cannot issue a refresh session for an ineligible user');
    }
    await tokens.insertSession(tx, { id: sessionId, userId, createdAt: now });
    await tokens.insert(tx, {
      userId,
      sessionId,
      tokenHash: hashToken(rawToken),
      issuedAt: now,
      expiresAt,
    });
  };

  if (isRootClient(db)) await db.$transaction(persist);
  else await persist(db);
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
    const locked = await identifyAndLockSession(tx, presentedHash);

    // T10/T11 — unknown or purged. Fail closed, and identically to expired.
    if (!locked?.current) return { kind: 'rejected', reason: 'unknown' };
    const presented = locked.current;
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

      // The predecessor grace exists only while its successor is the live
      // credential for this session. Logout/suspension/deletion revoke that
      // successor, so accepting the predecessor afterwards would resurrect a
      // deliberately ended session for up to ten seconds (R101).
      if (successor.revokedAt !== null) return detectReuse();

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

const ROLE_PRECEDENCE = ['super_admin', 'admin', 'teacher', 'parent', 'student'] as const;

/** R60 fail-safe active-role resolution, kept beside the authoritative role
 * read that supplies access-token claims. */
export function resolveActiveRole(
  liveScopes: readonly { role: string }[],
  requested: string | undefined,
): string | null {
  if (requested === undefined) return null;
  const held = new Set(liveScopes.map((scope) => scope.role));
  if (held.has(requested)) return requested;
  return ROLE_PRECEDENCE.find((role) => held.has(role)) ?? null;
}

/**
 * Completes the HTTP refresh lifecycle at the session-serialization boundary.
 *
 * Rotation commits first because its predecessor/successor/audit triple is the
 * TD-4.13 unit. Before any access token is signed, a second transaction locks
 * the same stable session row, verifies that the chain still has a live token,
 * and reads the authoritative account/role rows. A logout that linearizes in
 * between therefore turns this request into a refusal; if finalization locks
 * first, the access token is issued before logout and logout waits.
 */
export async function refreshAccessSession(
  prisma: PrismaClient,
  params: {
    presentedRaw: string;
    requestedRole?: string | undefined;
    signingKey: string;
  },
): Promise<RefreshAccessOutcome> {
  const outcome = await rotate(prisma, params.presentedRaw);
  if (outcome.kind === 'rejected' || outcome.kind === 'reuse_detected') return outcome;

  return prisma.$transaction(async (tx): Promise<RefreshAccessOutcome> => {
    if (!(await tokens.lockSession(tx, outcome.sessionId))) {
      return { kind: 'rejected', reason: 'unknown' };
    }
    if (!(await tokens.hasLiveToken(tx, outcome.sessionId, new Date()))) {
      return { kind: 'rejected', reason: 'unknown' };
    }

    const account = await users.findAccountById(tx, outcome.userId);
    // TD-1/§4.1b: only Active and Pending are session-bearing states. Rejected
    // is terminal/deactivated, Suspended is deactivated, and a deleted account
    // is unavailable. Downstream route guards are not a substitute for refusing
    // to renew credentials here.
    if (
      !account ||
      account.user.deletedAt !== null ||
      (account.user.accountStatus !== 'active' && account.user.accountStatus !== 'pending')
    ) {
      return { kind: 'rejected', reason: 'unknown' };
    }

    const activeRole = resolveActiveRole(account.roleScopes, params.requestedRole);
    const roleScopes =
      activeRole === null
        ? account.roleScopes
        : narrowToRole(account.roleScopes, activeRole) ?? account.roleScopes;
    const issued = issueAccessToken(
      {
        userId: account.user.id,
        roleScopes,
        ...(activeRole !== null ? { activeRole } : {}),
        accountStatus: account.user.accountStatus,
      },
      params.signingKey,
    );

    if (outcome.kind === 'rotated') {
      return {
        kind: 'rotated',
        accessToken: issued.token,
        accessExpiresAt: issued.expiresAt,
        activeRole,
        rawToken: outcome.rawToken,
        refreshExpiresAt: outcome.expiresAt,
      };
    }
    return {
      kind: 'grace',
      accessToken: issued.token,
      accessExpiresAt: issued.expiresAt,
      activeRole,
    };
  });
}

/**
 * TD-4.14 — logout revokes only the CURRENT session, with its audit row in the
 * same transaction. Other devices keep working (§18 T6).
 *
 * The raw credential is the only session authority R101 permits. Identification
 * therefore happens here, inside this transaction, rather than in the HTTP
 * controller or through caller-supplied user/session ids.
 */
export async function logout(
  prisma: PrismaClient,
  presentedRaw: string,
  now: Date = new Date(),
): Promise<number> {
  const presentedHash = hashToken(presentedRaw);

  return prisma.$transaction(async (tx) => {
    const locked = await identifyAndLockSession(tx, presentedHash);
    // R101: unknown, or a fully purged session whose anchor is gone, is an
    // idempotent no-op. If purge removed only the presented predecessor while a
    // successor remains, the pre-lock discovery still identifies the exact
    // locked session and logout must revoke that successor.
    if (!locked) return 0;
    const presented = locked.current ?? locked.identified;

    const revokedIds = await tokens.revokeSessionTokens(
      tx,
      presented.sessionId,
      RefreshRevokedReason.logout,
      now,
    );
    await audit.write(tx, {
      actorUserId: presented.userId,
      actionType: audit.AUDIT_ACTIONS.logout,
      targetEntity: 'User',
      targetId: presented.userId,
      detail: { session_ids: [presented.sessionId], tokens_revoked: revokedIds.length },
    });
    return revokedIds.length;
  });
}

/**
 * TD-4.15 — revoke every live session of a user (§18 T7/T8/T9/T14). Called
 * INSIDE the rejection, suspension or soft-delete transaction: a state change
 * that commits without revoking leaves a 30-day credential alive.
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
    /** Null for system-initiated revocation; the admin's id for rejection or suspension. */
    actorUserId: string | null;
    /** R60.8 — the capacity an acting admin used. Absent when the
     *  revocation is system-initiated, where there is no capacity to record. */
    activeRole?: string | undefined;
  },
  now: Date = new Date(),
): Promise<{ sessionIds: string[]; tokenCount: number }> {
  const revoke = async (
    tx: Prisma.TransactionClient,
  ): Promise<{ sessionIds: string[]; tokenCount: number }> => {
    // User-wide revocation shares one stable serialization anchor with new
    // login/session creation. Lock order is always User -> RefreshSession(s),
    // so no new anchor can appear after this transaction enumerates the set.
    if (!(await users.lockUser(tx, params.userId))) {
      return { sessionIds: [], tokenCount: 0 };
    }
    const sessionIds = await tokens.findUserSessionIds(tx, params.userId);
    await tokens.lockSessions(tx, sessionIds);
    const result = await tokens.revokeAllUserTokens(tx, params.userId, params.reason, now);

    // Written even when nothing was live: "an admin suspended this user and no
    // session existed" is itself the answer to "why is there no revocation row?".
    await audit.write(tx, {
      actorUserId: params.actorUserId,
      ...(params.activeRole !== undefined ? { activeRole: params.activeRole } : {}),
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
  };

  // Production suspension/deletion already supplies its governing transaction.
  // Standalone callers still need one transaction for locks + revocation + audit.
  if (isRootClient(db)) return db.$transaction(revoke);
  return revoke(db);
}

/**
 * TD-7 `token.purge` — collect tokens past `expires_at`. Purging can never
 * widen access: a presented token with no row is rejected identically to an
 * expired one (§18 T10). No audit row: nothing is revoked here, and the
 * attribution invariant concerns revocation, not garbage collection.
 */
export async function purgeExpired(prisma: PrismaClient, now: Date = new Date()): Promise<number> {
  let deleted = 0;

  while (true) {
    const sessionIds = await tokens.findExpiredSessionIds(prisma, now);
    if (sessionIds.length === 0) return deleted;

    for (const sessionId of sessionIds) {
      deleted += await prisma.$transaction(async (tx) => {
        if (!(await tokens.lockSession(tx, sessionId))) return 0;
        const count = await tokens.deleteExpiredForSession(tx, sessionId, now);
        await tokens.deleteSessionIfEmpty(tx, sessionId);
        return count;
      });
    }
  }
}
