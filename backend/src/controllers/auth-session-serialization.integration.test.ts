import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { verifyAccessToken } from '../lib/access-token.js';
import { loadConfig } from '../lib/config.js';
import { FLOW_STATE_COOKIE, sealFlowState } from '../lib/oauth.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import * as auditRepo from '../repositories/audit.repository.js';
import * as userRepo from '../repositories/user.repository.js';
import { finalizeLoginSession } from '../services/auth.service.js';
import { issueNewSession } from '../services/refresh-token.service.js';
import { suspendUser } from '../services/user.service.js';
import { actorFor } from '../test-support/actor.js';
import { oauthCallback } from './auth.controller.js';

const baseConfig = loadConfig();
const config = { ...baseConfig, PUBLIC_BASE_URL: 'https://r101-session.test' };
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = '[r101-user-session-race]';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function makeUser(params: {
  label: string;
  role?: 'super_admin' | 'student';
  googleSubject?: string;
}): Promise<string> {
  const email = `${params.label}-${randomUUID()}@example.test`;
  const user = await prisma.user.create({
    data: {
      sex: 'female',
      nameArabic: `${TAG} ${params.label}`,
      accountStatus: 'active',
      ...(params.googleSubject ? { preProvisionedEmail: email } : {}),
    },
  });

  if (params.role) {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: params.role } });
    await prisma.userBranchRole.create({
      data: { userId: user.id, roleId: role.id, branchId: null },
    });
  }
  if (params.googleSubject) {
    await prisma.userIdentity.create({
      data: {
        userId: user.id,
        provider: 'google',
        providerSubjectId: params.googleSubject,
        email,
      },
    });
  }
  return user.id;
}

function beginGoogleLogin(identity: { email: string; providerSubjectId: string }): {
  promise: Promise<void>;
  append: ReturnType<typeof vi.fn>;
  redirect: ReturnType<typeof vi.fn>;
} {
  const flow = { state: randomUUID(), codeVerifier: randomUUID() };
  const sealed = sealFlowState(flow, config.JWT_SIGNING_KEY);
  const req = {
    query: { state: flow.state, code: 'authorization-code' },
    header: vi.fn((name: string) =>
      name === 'cookie' ? `${FLOW_STATE_COOKIE}=${encodeURIComponent(sealed)}` : undefined,
    ),
    requestId: randomUUID(),
  } as unknown as Request;
  const append = vi.fn();
  const redirect = vi.fn();
  const res = { append, redirect } as unknown as Response;
  const fetchImpl = vi.fn(async () => ({
    ok: true,
    json: async () => ({ id_token: 'verified-by-test-boundary' }),
  })) as unknown as typeof fetch;
  const verifyIdToken = vi.fn(async () => ({ ok: true as const, identity }));

  return {
    promise: oauthCallback(prisma, config, { fetchImpl, verifyIdToken })(req, res),
    append,
    redirect,
  };
}

async function identityOf(userId: string): Promise<{ email: string; providerSubjectId: string }> {
  const identity = await prisma.userIdentity.findFirstOrThrow({ where: { userId } });
  return { email: identity.email, providerSubjectId: identity.providerSubjectId };
}

function refreshCookies(append: ReturnType<typeof vi.fn>): string[] {
  return append.mock.calls
    .map((call) => call[1])
    .filter((value): value is string =>
      typeof value === 'string' && value.startsWith('bodour_refresh='),
    );
}

async function clear(): Promise<void> {
  const rows = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = rows.map((row) => row.id);
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

describe('R101 user-level login/session serialization', () => {
  it('suspension-first re-read refuses stale callback issuance', async () => {
    const adminId = await makeUser({ label: 'admin', role: 'super_admin' });
    const subject = `subject-${randomUUID()}`;
    const userId = await makeUser({ label: 'target', role: 'student', googleSubject: subject });
    const existing = [await issueNewSession(prisma, userId), await issueNewSession(prisma, userId)];
    const loginReachedFinalLock = deferred();
    const allowLoginToLock = deferred();
    const realLock = userRepo.lockUser;
    let targetLockCalls = 0;

    vi.spyOn(userRepo, 'lockUser').mockImplementation(async (tx, targetUserId) => {
      if (targetUserId === userId && ++targetLockCalls === 1) {
        loginReachedFinalLock.resolve();
        await allowLoginToLock.promise;
      }
      return realLock(tx, targetUserId);
    });

    const login = beginGoogleLogin(await identityOf(userId));
    try {
      await loginReachedFinalLock.promise;
      await suspendUser(prisma, await actorFor(prisma, adminId), userId, 0, 'race test');

      expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).accountStatus)
        .toBe('suspended');
      expect(await prisma.refreshToken.count({ where: { userId, revokedAt: null } })).toBe(0);

      allowLoginToLock.resolve();
      await login.promise;

      expect(login.redirect).toHaveBeenCalledWith(
        302,
        `${config.PUBLIC_BASE_URL}/login?error=account_deactivated`,
      );
      expect(refreshCookies(login.append)).toEqual([]);
      expect(await prisma.refreshSession.count({ where: { userId } })).toBe(existing.length);
      expect(await prisma.refreshToken.count({ where: { userId, revokedAt: null } })).toBe(0);
      expect(
        await prisma.auditLog.count({ where: { targetId: userId, actionType: 'auth.login' } }),
      ).toBe(0);
      expect(
        await prisma.auditLog.count({
          where: { targetId: userId, actionType: 'auth.login_denied' },
        }),
      ).toBe(1);
    } finally {
      allowLoginToLock.resolve();
      await login.promise.catch(() => undefined);
    }
  });

  it('login-first commits its anchor before suspension enumerates and revokes every session', async () => {
    const adminId = await makeUser({ label: 'admin', role: 'super_admin' });
    const subject = `subject-${randomUUID()}`;
    const userId = await makeUser({ label: 'target', role: 'student', googleSubject: subject });
    const unrelatedId = await makeUser({ label: 'unrelated', role: 'student' });
    const existing = [await issueNewSession(prisma, userId), await issueNewSession(prisma, userId)];
    const loginHoldsUser = deferred();
    const allowLoginToCommit = deferred();
    const suspensionReachedUser = deferred();
    const realLock = userRepo.lockUser;
    let targetLockCalls = 0;

    vi.spyOn(userRepo, 'lockUser').mockImplementation(async (tx, targetUserId) => {
      if (targetUserId !== userId) return realLock(tx, targetUserId);
      targetLockCalls += 1;
      if (targetLockCalls === 1) {
        const locked = await realLock(tx, targetUserId);
        loginHoldsUser.resolve();
        await allowLoginToCommit.promise;
        return locked;
      }
      if (targetLockCalls === 2) suspensionReachedUser.resolve();
      return realLock(tx, targetUserId);
    });

    const login = beginGoogleLogin(await identityOf(userId));
    let suspension: Promise<Awaited<ReturnType<typeof suspendUser>>> | undefined;
    try {
      await loginHoldsUser.promise;
      let suspensionSettled = false;
      suspension = suspendUser(
        prisma,
        await actorFor(prisma, adminId),
        userId,
        0,
        'race test',
      ).finally(() => {
        suspensionSettled = true;
      });
      await suspensionReachedUser.promise;
      expect(suspensionSettled).toBe(false);

      // The governing lock is per User, not global: another user can complete
      // login issuance while the target user's callback deliberately waits.
      const unrelated = await finalizeLoginSession(prisma, {
        userId: unrelatedId,
        boundNow: false,
        signingKey: config.JWT_SIGNING_KEY,
      });
      expect(unrelated.kind).toBe('active');
      expect(await prisma.refreshToken.count({ where: { userId: unrelatedId, revokedAt: null } }))
        .toBe(1);

      allowLoginToCommit.resolve();
      await login.promise;
      const successfulRedirect = login.redirect.mock.calls
        .map((call) => call[1])
        .find((value): value is string => typeof value === 'string' && value.includes('#access_token='));
      expect(successfulRedirect).toBeDefined();
      const accessToken = successfulRedirect!.split('#access_token=')[1]!;
      expect(verifyAccessToken(accessToken, config.JWT_SIGNING_KEY).valid).toBe(true);
      expect(refreshCookies(login.append)).toHaveLength(1);

      await suspension;
      const allSessions = await prisma.refreshSession.findMany({ where: { userId } });
      expect(allSessions).toHaveLength(existing.length + 1);
      expect(await prisma.refreshToken.count({ where: { userId, revokedAt: null } })).toBe(0);
      expect(
        await prisma.auditLog.count({ where: { targetId: userId, actionType: 'auth.login' } }),
      ).toBe(1);

      const revocation = await prisma.auditLog.findFirstOrThrow({
        where: {
          actorUserId: adminId,
          targetId: userId,
          actionType: 'auth.token_revoked',
        },
      });
      expect((revocation.detail as { session_ids: string[] }).session_ids.sort())
        .toEqual(allSessions.map((session) => session.id).sort());
      expect(await prisma.refreshToken.count({ where: { userId: unrelatedId, revokedAt: null } }))
        .toBe(1);
    } finally {
      allowLoginToCommit.resolve();
      await login.promise.catch(() => undefined);
      await suspension?.catch(() => undefined);
    }
  });

  it('rolls back the new anchor/token when the mandatory auth.login audit fails', async () => {
    const subject = `subject-${randomUUID()}`;
    const userId = await makeUser({ label: 'target', role: 'student', googleSubject: subject });
    const realWrite = auditRepo.write;
    vi.spyOn(auditRepo, 'write').mockImplementation(async (db, entry) => {
      if (entry.actionType === 'auth.login') throw new Error('forced audit failure');
      return realWrite(db, entry);
    });

    const login = beginGoogleLogin(await identityOf(userId));
    await expect(login.promise).rejects.toThrow('forced audit failure');
    expect(refreshCookies(login.append)).toEqual([]);
    expect(await prisma.refreshSession.count({ where: { userId } })).toBe(0);
    expect(await prisma.refreshToken.count({ where: { userId } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { targetId: userId } })).toBe(0);
  });
});
