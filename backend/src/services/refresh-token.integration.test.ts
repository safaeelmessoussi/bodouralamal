import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { RefreshRevokedReason } from '../generated/prisma/enums.js';
import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import * as auditRepo from '../repositories/audit.repository.js';
import {
  hashToken,
  issueNewSession,
  logout,
  purgeExpired,
  revokeAllSessions,
  ROTATION_GRACE_MS,
  rotate,
} from './refresh-token.service.js';

/**
 * §18 T1–T12 — the token-lifecycle acceptance criteria, one test each.
 * Runs against the real PostgreSQL from the compose stack: these guarantees are
 * enforced by transactions and constraints, so an in-memory double would prove
 * nothing.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);

const TEST_TAG = '[refresh-token-test]';

async function makeUser(): Promise<string> {
  const user = await prisma.user.create({
    data: { nameArabic: `${TEST_TAG} مستخدم`, accountStatus: 'active' },
  });
  return user.id;
}

beforeEach(async () => {
  await prisma.refreshToken.deleteMany({ where: { user: { nameArabic: { startsWith: TEST_TAG } } } });
  await prisma.auditLog.deleteMany({ where: { actor: { nameArabic: { startsWith: TEST_TAG } } } });
  await prisma.auditLog.deleteMany({ where: { targetEntity: 'User', actorUserId: null } });
  await prisma.user.deleteMany({ where: { nameArabic: { startsWith: TEST_TAG } } });
});

afterAll(async () => {
  await prisma.refreshToken.deleteMany({ where: { user: { nameArabic: { startsWith: TEST_TAG } } } });
  await prisma.auditLog.deleteMany({ where: { actor: { nameArabic: { startsWith: TEST_TAG } } } });
  await prisma.auditLog.deleteMany({ where: { targetEntity: 'User', actorUserId: null } });
  await prisma.user.deleteMany({ where: { nameArabic: { startsWith: TEST_TAG } } });
  await prisma.$disconnect();
});

describe('§18 token lifecycle acceptance criteria', () => {
  it('T1 — refresh with the current live token rotates and revokes the predecessor', async () => {
    const userId = await makeUser();
    const first = await issueNewSession(prisma, userId);

    const outcome = await rotate(prisma, first.rawToken);
    expect(outcome.kind).toBe('rotated');
    if (outcome.kind !== 'rotated') return;

    expect(outcome.rawToken).not.toBe(first.rawToken);
    // Same chain — rotation must not start a new session.
    expect(outcome.sessionId).toBe(first.sessionId);

    const predecessor = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(first.rawToken) },
    });
    expect(predecessor?.revokedAt).toBeInstanceOf(Date);

    const successor = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(outcome.rawToken) },
    });
    expect(successor?.revokedAt).toBeNull();
    expect(successor?.rotatedFromId).toBe(predecessor?.id);
  });

  it('T2 — the raw token is never persisted, only its hash', async () => {
    const userId = await makeUser();
    const { rawToken } = await issueNewSession(prisma, userId);

    const rows = await prisma.refreshToken.findMany({ where: { userId } });
    expect(rows).toHaveLength(1);
    // The stored value must be the hash, and the raw secret must appear nowhere.
    expect(rows[0]!.tokenHash).toBe(hashToken(rawToken));
    expect(rows[0]!.tokenHash).not.toBe(rawToken);
    expect(JSON.stringify(rows)).not.toContain(rawToken);
  });

  it('T3 — predecessor inside the grace window is accepted WITHOUT minting a third token', async () => {
    const userId = await makeUser();
    const first = await issueNewSession(prisma, userId);
    const rotated = await rotate(prisma, first.rawToken);
    expect(rotated.kind).toBe('rotated');

    const countBefore = await prisma.refreshToken.count({ where: { userId } });

    // Replay the predecessor immediately — the two-tab race.
    const graced = await rotate(prisma, first.rawToken);
    expect(graced.kind).toBe('grace');

    // The decisive assertion: no chain fork.
    const countAfter = await prisma.refreshToken.count({ where: { userId } });
    expect(countAfter).toBe(countBefore);

    // And the successor is still live.
    if (rotated.kind === 'rotated') {
      const successor = await prisma.refreshToken.findUnique({
        where: { tokenHash: hashToken(rotated.rawToken) },
      });
      expect(successor?.revokedAt).toBeNull();
    }
  });

  it('T4 — predecessor presented AFTER the grace window is a replay, not grace', async () => {
    const userId = await makeUser();
    const first = await issueNewSession(prisma, userId);
    const rotated = await rotate(prisma, first.rawToken);
    expect(rotated.kind).toBe('rotated');

    // Evaluate the replay from a clock beyond the window rather than sleeping.
    const beyond = new Date(Date.now() + ROTATION_GRACE_MS + 1000);
    const outcome = await rotate(prisma, first.rawToken, beyond);
    expect(outcome.kind).toBe('reuse_detected');
  });

  it('T5 — replaying an older rotated token revokes the ENTIRE session', async () => {
    const userId = await makeUser();
    const t1 = await issueNewSession(prisma, userId);
    const t2 = await rotate(prisma, t1.rawToken);
    expect(t2.kind).toBe('rotated');
    if (t2.kind !== 'rotated') return;
    const t3 = await rotate(prisma, t2.rawToken);
    expect(t3.kind).toBe('rotated');

    // t1 is now two generations old — unambiguously a replay.
    const outcome = await rotate(prisma, t1.rawToken);
    expect(outcome.kind).toBe('reuse_detected');

    const live = await prisma.refreshToken.count({
      where: { sessionId: t1.sessionId, revokedAt: null },
    });
    expect(live).toBe(0);

    const reasons = await prisma.refreshToken.findMany({
      where: { sessionId: t1.sessionId },
      select: { revokedReason: true },
    });
    expect(reasons.some((r) => r.revokedReason === RefreshRevokedReason.reuse_detected)).toBe(true);
  });

  it('T6 — logout revokes only the current session; other devices keep working', async () => {
    const userId = await makeUser();
    const deviceA = await issueNewSession(prisma, userId);
    const deviceB = await issueNewSession(prisma, userId);
    expect(deviceA.sessionId).not.toBe(deviceB.sessionId);

    await logout(prisma, { userId, sessionId: deviceA.sessionId, actorUserId: userId });

    // A is dead...
    const aDead = await rotate(prisma, deviceA.rawToken);
    expect(aDead.kind).toBe('reuse_detected');
    // ...B is untouched and still rotates.
    const bAlive = await rotate(prisma, deviceB.rawToken);
    expect(bAlive.kind).toBe('rotated');
  });

  it('T7/T8 — revoke-all kills every live session of the user', async () => {
    const userId = await makeUser();
    const adminId = await makeUser();
    const a = await issueNewSession(prisma, userId);
    const b = await issueNewSession(prisma, userId);

    const revoked = await revokeAllSessions(prisma, {
      userId,
      reason: RefreshRevokedReason.suspension,
      actorUserId: adminId,
    });
    expect(revoked.tokenCount).toBe(2);
    expect(revoked.sessionIds).toHaveLength(2);

    for (const token of [a, b]) {
      const outcome = await rotate(prisma, token.rawToken);
      expect(outcome.kind).toBe('reuse_detected');
    }
  });

  it('T8 — suspension revoking tokens in ONE transaction leaves no live token behind', async () => {
    const userId = await makeUser();
    const adminId = await makeUser();
    await issueNewSession(prisma, userId);
    await issueNewSession(prisma, userId);

    // The shape TD-4.15 mandates: status change and revocation are atomic.
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { accountStatus: 'suspended' } });
      await revokeAllSessions(tx, {
        userId,
        reason: RefreshRevokedReason.suspension,
        actorUserId: adminId,
      });
    });

    const live = await prisma.refreshToken.count({ where: { userId, revokedAt: null } });
    expect(live).toBe(0);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.accountStatus).toBe('suspended');
  });

  it('T9 — user deletion revokes with reason user_deleted', async () => {
    const userId = await makeUser();
    const adminId = await makeUser();
    await issueNewSession(prisma, userId);

    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { deletedAt: new Date() } });
      await revokeAllSessions(tx, {
        userId,
        reason: RefreshRevokedReason.user_deleted,
        actorUserId: adminId,
      });
    });

    const rows = await prisma.refreshToken.findMany({ where: { userId } });
    expect(rows.every((r) => r.revokedReason === RefreshRevokedReason.user_deleted)).toBe(true);
  });

  it('T10 — an expired token is refused, and purge collects it; a purged token is refused identically', async () => {
    const userId = await makeUser();
    // Issue in the past so it is already expired.
    const past = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    const stale = await issueNewSession(prisma, userId, past);

    const expired = await rotate(prisma, stale.rawToken);
    expect(expired.kind).toBe('rejected');
    if (expired.kind === 'rejected') expect(expired.reason).toBe('expired');

    const purged = await purgeExpired(prisma);
    expect(purged).toBeGreaterThanOrEqual(1);

    // Fail-closed: gone is as good as expired.
    const afterPurge = await rotate(prisma, stale.rawToken);
    expect(afterPurge.kind).toBe('rejected');
  });

  it('T11 — a revoked token is never accepted, at any age', async () => {
    const userId = await makeUser();
    const token = await issueNewSession(prisma, userId);
    await logout(prisma, { userId, sessionId: token.sessionId, actorUserId: userId });

    for (let attempt = 0; attempt < 3; attempt++) {
      const outcome = await rotate(prisma, token.rawToken);
      expect(outcome.kind).not.toBe('rotated');
      expect(outcome.kind).not.toBe('grace');
    }
    const live = await prisma.refreshToken.count({ where: { userId, revokedAt: null } });
    expect(live).toBe(0);
  });

  it('A1 — every revocation path is attributable from the AuditLog ALONE (§7 invariant)', async () => {
    // The justification for having no `revoked_by` column: who/when/why must be
    // reconstructable without reading the RefreshToken row, which TD-7 may purge.
    const userId = await makeUser();
    const adminId = await makeUser();

    // Path 1 — rotation (self-service).
    const rotating = await issueNewSession(prisma, userId);
    await rotate(prisma, rotating.rawToken);

    // Path 2 — logout (self-service).
    const loggingOut = await issueNewSession(prisma, userId);
    await logout(prisma, { userId, sessionId: loggingOut.sessionId, actorUserId: userId });

    // Path 3 — suspension (admin-initiated).
    const suspended = await issueNewSession(prisma, userId);
    await revokeAllSessions(prisma, {
      userId,
      reason: RefreshRevokedReason.suspension,
      actorUserId: adminId,
    });

    // Path 4 — replay detection (system-initiated, no human actor).
    const replayed = await issueNewSession(prisma, userId);
    await rotate(prisma, replayed.rawToken);
    await rotate(prisma, replayed.rawToken, new Date(Date.now() + ROTATION_GRACE_MS + 1000));

    // Reconstruct each session's story from the audit trail only.
    const cases = [
      { sessionId: rotating.sessionId, action: 'auth.refresh', actor: userId, reason: null },
      { sessionId: loggingOut.sessionId, action: 'auth.logout', actor: userId, reason: null },
      {
        sessionId: suspended.sessionId,
        action: 'auth.token_revoked',
        actor: adminId,
        reason: RefreshRevokedReason.suspension,
      },
      {
        sessionId: replayed.sessionId,
        action: 'auth.token_revoked',
        // Null actor = system-initiated, NOT attribution lost (§7 Revision 17).
        actor: null,
        reason: RefreshRevokedReason.reuse_detected,
      },
    ];

    for (const expected of cases) {
      const rows = await auditRepo.findBySessionId(prisma, expected.sessionId);
      const row = rows.find((r) => r.actionType === expected.action);

      // WHO
      expect(row, `no ${expected.action} row for session ${expected.sessionId}`).toBeDefined();
      expect(row!.actorUserId).toBe(expected.actor);
      // WHEN
      expect(row!.createdAt).toBeInstanceOf(Date);
      // WHY
      const detail = row!.detail as Record<string, unknown>;
      if (expected.reason !== null) expect(detail['reason']).toBe(expected.reason);
      // WHICH SESSION — the id itself, not merely a count.
      expect(detail['session_ids']).toContain(expected.sessionId);
      // AND TO WHOM
      expect(row!.targetId).toBe(userId);
    }
  });

  it('A2 — attribution survives purging the token rows it describes (TD-7)', async () => {
    const userId = await makeUser();
    const adminId = await makeUser();

    const past = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    const stale = await issueNewSession(prisma, userId, past);
    await revokeAllSessions(prisma, {
      userId,
      reason: RefreshRevokedReason.suspension,
      actorUserId: adminId,
    });

    // Purge the token rows entirely — the audit trail must stand on its own.
    await purgeExpired(prisma);
    expect(
      await prisma.refreshToken.count({ where: { tokenHash: hashToken(stale.rawToken) } }),
    ).toBe(0);

    const rows = await auditRepo.findBySessionId(prisma, stale.sessionId);
    const revocation = rows.find((r) => r.actionType === 'auth.token_revoked');
    expect(revocation).toBeDefined();
    expect(revocation!.actorUserId).toBe(adminId);
    expect((revocation!.detail as Record<string, unknown>)['reason']).toBe(
      RefreshRevokedReason.suspension,
    );
  });

  it('A3 — no raw token or secret ever reaches the audit detail (TD-14)', async () => {
    const userId = await makeUser();
    const token = await issueNewSession(prisma, userId);
    const rotated = await rotate(prisma, token.rawToken);
    await logout(prisma, { userId, sessionId: token.sessionId, actorUserId: userId });

    const rows = await prisma.auditLog.findMany({ where: { targetId: userId } });
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain(token.rawToken);
    if (rotated.kind === 'rotated') expect(serialized).not.toContain(rotated.rawToken);
    // Hashes are not secrets, but they have no business in the log either.
    expect(serialized).not.toContain(hashToken(token.rawToken));
  });

  it('T12 — concurrent refresh from two tabs rotates exactly once and logs nobody out', async () => {
    const userId = await makeUser();
    const token = await issueNewSession(prisma, userId);

    // Both tabs present the same token at the same moment.
    const [first, second] = await Promise.allSettled([
      rotate(prisma, token.rawToken),
      rotate(prisma, token.rawToken),
    ]);

    const outcomes = [first, second]
      .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof rotate>>> =>
        r.status === 'fulfilled')
      .map((r) => r.value.kind);

    // Exactly one rotation; the other is absorbed as grace (or serialized into
    // a rotation of the successor) — critically, NEITHER is reuse_detected,
    // because that would log an innocent user out.
    expect(outcomes).toContain('rotated');
    expect(outcomes).not.toContain('reuse_detected');

    const live = await prisma.refreshToken.count({ where: { userId, revokedAt: null } });
    expect(live).toBe(1);
  });
});
