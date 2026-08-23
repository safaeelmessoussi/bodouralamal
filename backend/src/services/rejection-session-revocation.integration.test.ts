import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RefreshRevokedReason } from '../generated/prisma/enums.js';
import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import * as auditRepo from '../repositories/audit.repository.js';
import * as tokenRepo from '../repositories/refresh-token.repository.js';
import * as userRepo from '../repositories/user.repository.js';
import { actorFor } from '../test-support/actor.js';
import { finalizeLoginSession } from './auth.service.js';
import { decide } from './approval.service.js';
import { issueNewSession, refreshAccessSession } from './refresh-token.service.js';

const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = '[r102-rejection-session]';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function makeUser(params: {
  label: string;
  status?: 'active' | 'pending';
  role?: 'super_admin' | 'student';
}): Promise<string> {
  const user = await prisma.user.create({
    data: {
      sex: 'female',
      nameArabic: `${TAG} ${params.label} ${randomUUID()}`,
      accountStatus: params.status ?? 'pending',
    },
  });
  if (params.role) {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: params.role } });
    await prisma.userBranchRole.create({
      data: { userId: user.id, roleId: role.id, branchId: null },
    });
  }
  return user.id;
}

async function reject(adminId: string, userId: string): Promise<void> {
  await decide(prisma, await actorFor(prisma, adminId), userId, {
    approve: false,
    reason: 'R102 deterministic rejection',
  });
}

async function clear(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((user) => user.id);
  if (ids.length === 0) return;

  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.refreshSession.deleteMany({ where: { userId: { in: ids } } });
  await prisma.auditLog.deleteMany({
    where: { OR: [{ actorUserId: { in: ids } }, { targetId: { in: ids } }] },
  });
  await prisma.userIdentity.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

beforeEach(clear);
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe('R102 Pending to Rejected session revocation', () => {
  it('atomically rejects, revokes every target session, audits both facts, and leaves another user untouched', async () => {
    const adminId = await makeUser({ label: 'admin', status: 'active', role: 'super_admin' });
    const targetId = await makeUser({ label: 'target', role: 'student' });
    const unrelatedId = await makeUser({ label: 'unrelated', status: 'active', role: 'student' });
    const targetSessions = [
      await issueNewSession(prisma, targetId),
      await issueNewSession(prisma, targetId),
    ];
    const unrelated = await issueNewSession(prisma, unrelatedId);

    await reject(adminId, targetId);

    expect((await prisma.user.findUniqueOrThrow({ where: { id: targetId } })).accountStatus)
      .toBe('rejected');
    const targetTokens = await prisma.refreshToken.findMany({ where: { userId: targetId } });
    expect(targetTokens).toHaveLength(2);
    expect(targetTokens.every((token) => token.revokedAt !== null)).toBe(true);
    expect(targetTokens.every((token) => token.revokedReason === RefreshRevokedReason.rejection))
      .toBe(true);
    expect(await prisma.refreshToken.count({ where: { userId: unrelatedId, revokedAt: null } }))
      .toBe(1);

    const rejectionAudit = await prisma.auditLog.findFirstOrThrow({
      where: { actorUserId: adminId, targetId, actionType: 'user.reject' },
    });
    expect((rejectionAudit.detail as { reason?: string }).reason)
      .toBe('R102 deterministic rejection');
    const revocationAudit = await prisma.auditLog.findFirstOrThrow({
      where: { actorUserId: adminId, targetId, actionType: 'auth.token_revoked' },
    });
    expect(revocationAudit.detail).toMatchObject({
      reason: RefreshRevokedReason.rejection,
      tokens_revoked: 2,
    });
    expect((revocationAudit.detail as { session_ids: string[] }).session_ids.sort())
      .toEqual(targetSessions.map((session) => session.sessionId).sort());

    const retained = await refreshAccessSession(prisma, {
      presentedRaw: targetSessions[0]!.rawToken,
      signingKey: config.JWT_SIGNING_KEY,
    });
    expect(['rejected', 'reuse_detected']).toContain(retained.kind);
    const unrelatedRefresh = await refreshAccessSession(prisma, {
      presentedRaw: unrelated.rawToken,
      signingKey: config.JWT_SIGNING_KEY,
    });
    expect(unrelatedRefresh.kind).toBe('rotated');
  });

  it.each(['auth.token_revoked', 'user.reject'] as const)(
    'rolls back status and revocation when mandatory %s audit fails',
    async (failingAction) => {
      const adminId = await makeUser({ label: 'admin', status: 'active', role: 'super_admin' });
      const targetId = await makeUser({ label: 'target', role: 'student' });
      await issueNewSession(prisma, targetId);
      await issueNewSession(prisma, targetId);
      const realWrite = auditRepo.write;
      vi.spyOn(auditRepo, 'write').mockImplementation(async (db, entry) => {
        if (entry.actionType === failingAction && entry.targetId === targetId) {
          throw new Error(`forced ${failingAction} failure`);
        }
        return realWrite(db, entry);
      });

      await expect(reject(adminId, targetId)).rejects.toThrow(`forced ${failingAction} failure`);

      expect((await prisma.user.findUniqueOrThrow({ where: { id: targetId } })).accountStatus)
        .toBe('pending');
      expect(await prisma.refreshToken.count({ where: { userId: targetId, revokedAt: null } }))
        .toBe(2);
      expect(
        await prisma.auditLog.count({
          where: { targetId, actionType: { in: ['auth.token_revoked', 'user.reject'] } },
        }),
      ).toBe(0);
    },
  );

  it('never resurrects an old credential after a later state change and requires a fresh session', async () => {
    const adminId = await makeUser({ label: 'admin', status: 'active', role: 'super_admin' });
    const targetId = await makeUser({ label: 'target', role: 'student' });
    const oldSession = await issueNewSession(prisma, targetId);
    await reject(adminId, targetId);

    await expect(issueNewSession(prisma, targetId))
      .rejects.toThrow('cannot issue a refresh session for an ineligible user');
    // TD-1 currently makes Rejected terminal. This direct transition models a
    // future owner-approved/manual recovery and proves revocation itself is not
    // coupled to status: old credentials stay dead even if the row changes.
    await prisma.user.update({ where: { id: targetId }, data: { accountStatus: 'active' } });

    const oldOutcome = await refreshAccessSession(prisma, {
      presentedRaw: oldSession.rawToken,
      signingKey: config.JWT_SIGNING_KEY,
    });
    expect(['rejected', 'reuse_detected']).toContain(oldOutcome.kind);
    expect(await prisma.refreshToken.count({ where: { userId: targetId, revokedAt: null } }))
      .toBe(0);

    const fresh = await issueNewSession(prisma, targetId);
    const freshOutcome = await refreshAccessSession(prisma, {
      presentedRaw: fresh.rawToken,
      signingKey: config.JWT_SIGNING_KEY,
    });
    expect(freshOutcome.kind).toBe('rotated');
  });

  it('refresh-first commits its successor before rejection enumerates and then revokes it', async () => {
    const adminId = await makeUser({ label: 'admin', status: 'active', role: 'super_admin' });
    const targetId = await makeUser({ label: 'target', role: 'student' });
    const session = await issueNewSession(prisma, targetId);
    const refreshBeforeSuccessor = deferred();
    const allowSuccessor = deferred();
    const rejectionHoldsUser = deferred();
    const rejectionReachedSession = deferred();

    const realInsert = tokenRepo.insert;
    vi.spyOn(tokenRepo, 'insert').mockImplementation(async (db, data) => {
      if (data.sessionId === session.sessionId && data.rotatedFromId) {
        refreshBeforeSuccessor.resolve();
        await allowSuccessor.promise;
      }
      return realInsert(db, data);
    });
    const realUserLock = userRepo.lockUser;
    let userSignalled = false;
    vi.spyOn(userRepo, 'lockUser').mockImplementation(async (tx, userId) => {
      const locked = await realUserLock(tx, userId);
      if (userId === targetId && !userSignalled) {
        userSignalled = true;
        rejectionHoldsUser.resolve();
      }
      return locked;
    });
    const realSessionLocks = tokenRepo.lockSessions;
    vi.spyOn(tokenRepo, 'lockSessions').mockImplementation(async (tx, sessionIds) => {
      if (sessionIds.includes(session.sessionId)) rejectionReachedSession.resolve();
      return realSessionLocks(tx, sessionIds);
    });

    const refresh = refreshAccessSession(prisma, {
      presentedRaw: session.rawToken,
      signingKey: config.JWT_SIGNING_KEY,
    });
    let rejection: Promise<void> | undefined;
    try {
      await refreshBeforeSuccessor.promise;
      rejection = reject(adminId, targetId);
      await rejectionHoldsUser.promise;
      await rejectionReachedSession.promise;

      allowSuccessor.resolve();
      const outcome = await refresh;
      await rejection;

      expect(outcome.kind).toBe('rejected');
      expect((await prisma.user.findUniqueOrThrow({ where: { id: targetId } })).accountStatus)
        .toBe('rejected');
      expect(await prisma.refreshToken.count({ where: { userId: targetId } })).toBe(2);
      expect(await prisma.refreshToken.count({ where: { userId: targetId, revokedAt: null } }))
        .toBe(0);
      // The immediate predecessor is still inside grace, but its successor was
      // deliberately revoked, so grace cannot resurrect the rejected session.
      const replay = await refreshAccessSession(prisma, {
        presentedRaw: session.rawToken,
        signingKey: config.JWT_SIGNING_KEY,
      });
      expect(['rejected', 'reuse_detected']).toContain(replay.kind);
      expect(await prisma.refreshToken.count({ where: { userId: targetId, revokedAt: null } }))
        .toBe(0);
    } finally {
      allowSuccessor.resolve();
      await refresh.catch(() => undefined);
      await rejection?.catch(() => undefined);
    }
  });

  it('rejection-first holds the session anchor until commit and a racing refresh mints nothing', async () => {
    const adminId = await makeUser({ label: 'admin', status: 'active', role: 'super_admin' });
    const targetId = await makeUser({ label: 'target', role: 'student' });
    const session = await issueNewSession(prisma, targetId);
    const rejectionBeforeCommit = deferred();
    const allowRejectionCommit = deferred();
    let paused = false;
    const realWrite = auditRepo.write;
    vi.spyOn(auditRepo, 'write').mockImplementation(async (db, entry) => {
      const written = await realWrite(db, entry);
      if (
        !paused &&
        entry.targetId === targetId &&
        entry.actionType === auditRepo.AUDIT_ACTIONS.tokenRevoked
      ) {
        paused = true;
        rejectionBeforeCommit.resolve();
        await allowRejectionCommit.promise;
      }
      return written;
    });

    const rejection = reject(adminId, targetId);
    let refresh: Promise<Awaited<ReturnType<typeof refreshAccessSession>>> | undefined;
    try {
      await rejectionBeforeCommit.promise;
      const refreshReachedAnchor = deferred();
      const realLock = tokenRepo.lockSession;
      vi.spyOn(tokenRepo, 'lockSession').mockImplementation(async (tx, sessionId) => {
        if (sessionId === session.sessionId) refreshReachedAnchor.resolve();
        return realLock(tx, sessionId);
      });
      refresh = refreshAccessSession(prisma, {
        presentedRaw: session.rawToken,
        signingKey: config.JWT_SIGNING_KEY,
      });
      await refreshReachedAnchor.promise;

      allowRejectionCommit.resolve();
      await rejection;
      const outcome = await refresh;

      expect(['rejected', 'reuse_detected']).toContain(outcome.kind);
      expect(await prisma.refreshToken.count({ where: { userId: targetId } })).toBe(1);
      expect(await prisma.refreshToken.count({ where: { userId: targetId, revokedAt: null } }))
        .toBe(0);
    } finally {
      allowRejectionCommit.resolve();
      await rejection.catch(() => undefined);
      await refresh?.catch(() => undefined);
    }
  });

  it('login-first commits its new anchor before rejection and rejection revokes it', async () => {
    const adminId = await makeUser({ label: 'admin', status: 'active', role: 'super_admin' });
    const targetId = await makeUser({ label: 'target', role: 'student' });
    const loginBeforeCommit = deferred();
    const allowLoginCommit = deferred();
    let paused = false;
    const realWrite = auditRepo.write;
    vi.spyOn(auditRepo, 'write').mockImplementation(async (db, entry) => {
      const written = await realWrite(db, entry);
      if (!paused && entry.targetId === targetId && entry.actionType === auditRepo.AUDIT_ACTIONS.login) {
        paused = true;
        loginBeforeCommit.resolve();
        await allowLoginCommit.promise;
      }
      return written;
    });

    const login = finalizeLoginSession(prisma, {
      userId: targetId,
      boundNow: false,
      signingKey: config.JWT_SIGNING_KEY,
    });
    let rejection: Promise<void> | undefined;
    try {
      await loginBeforeCommit.promise;
      const rejectionReachedUser = deferred();
      const realLock = userRepo.lockUser;
      vi.spyOn(userRepo, 'lockUser').mockImplementation(async (tx, userId) => {
        if (userId === targetId) rejectionReachedUser.resolve();
        return realLock(tx, userId);
      });
      rejection = reject(adminId, targetId);
      await rejectionReachedUser.promise;

      allowLoginCommit.resolve();
      const loginOutcome = await login;
      expect(loginOutcome.kind).toBe('pending');
      await rejection;

      expect((await prisma.user.findUniqueOrThrow({ where: { id: targetId } })).accountStatus)
        .toBe('rejected');
      expect(await prisma.refreshSession.count({ where: { userId: targetId } })).toBe(1);
      expect(await prisma.refreshToken.count({ where: { userId: targetId, revokedAt: null } }))
        .toBe(0);
      if (loginOutcome.kind !== 'pending' && loginOutcome.kind !== 'active') return;
      const retained = await refreshAccessSession(prisma, {
        presentedRaw: loginOutcome.refreshSession.rawToken,
        signingKey: config.JWT_SIGNING_KEY,
      });
      expect(['rejected', 'reuse_detected']).toContain(retained.kind);
    } finally {
      allowLoginCommit.resolve();
      await login.catch(() => undefined);
      await rejection?.catch(() => undefined);
    }
  });

  it('rejection-first makes a racing login re-read Rejected and create no session', async () => {
    const adminId = await makeUser({ label: 'admin', status: 'active', role: 'super_admin' });
    const targetId = await makeUser({ label: 'target', role: 'student' });
    await issueNewSession(prisma, targetId);
    const rejectionBeforeCommit = deferred();
    const allowRejectionCommit = deferred();
    let paused = false;
    const realWrite = auditRepo.write;
    vi.spyOn(auditRepo, 'write').mockImplementation(async (db, entry) => {
      const written = await realWrite(db, entry);
      if (
        !paused &&
        entry.targetId === targetId &&
        entry.actionType === auditRepo.AUDIT_ACTIONS.tokenRevoked
      ) {
        paused = true;
        rejectionBeforeCommit.resolve();
        await allowRejectionCommit.promise;
      }
      return written;
    });

    const rejection = reject(adminId, targetId);
    let login: Promise<Awaited<ReturnType<typeof finalizeLoginSession>>> | undefined;
    try {
      await rejectionBeforeCommit.promise;
      const loginReachedUser = deferred();
      const realLock = userRepo.lockUser;
      vi.spyOn(userRepo, 'lockUser').mockImplementation(async (tx, userId) => {
        if (userId === targetId) loginReachedUser.resolve();
        return realLock(tx, userId);
      });
      login = finalizeLoginSession(prisma, {
        userId: targetId,
        boundNow: false,
        signingKey: config.JWT_SIGNING_KEY,
      });
      await loginReachedUser.promise;

      allowRejectionCommit.resolve();
      await rejection;
      const outcome = await login;

      expect(outcome.kind).toBe('deactivated');
      expect(await prisma.refreshSession.count({ where: { userId: targetId } })).toBe(1);
      expect(await prisma.refreshToken.count({ where: { userId: targetId, revokedAt: null } }))
        .toBe(0);
      expect(
        await prisma.auditLog.count({ where: { targetId, actionType: 'auth.login' } }),
      ).toBe(0);
    } finally {
      allowRejectionCommit.resolve();
      await rejection.catch(() => undefined);
      await login?.catch(() => undefined);
    }
  });
});
