import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../app.js';
import { verifyAccessToken } from '../lib/access-token.js';
import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import * as tokenRepo from '../repositories/refresh-token.repository.js';
import { issueNewSession } from '../services/refresh-token.service.js';

const baseConfig = loadConfig();
const config = { ...baseConfig, PUBLIC_BASE_URL: 'http://r101-controller.test' };
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = '[r101-controller-race]';

let server: Server;
let baseUrl: string;
let userId: string;
let rawToken: string;
let sessionId: string;

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function clear(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((user) => user.id);
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.auditLog.deleteMany({
    where: { OR: [{ actorUserId: { in: ids } }, { targetId: { in: ids } }] },
  });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

async function post(path: string, cookie: string): Promise<{
  status: number;
  body: { access_token?: string; error?: { code?: string } };
  headers: Headers;
}> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      cookie: `bodour_refresh=${cookie}`,
      origin: config.PUBLIC_BASE_URL,
      'x-requested-with': 'XMLHttpRequest',
    },
  });
  return {
    status: response.status,
    body: (await response.json().catch(() => ({}))) as {
      access_token?: string;
      error?: { code?: string };
    },
    headers: response.headers,
  };
}

beforeAll(async () => {
  const app = createApp(prisma, config, {
    snapshot: () => ({
      state: 'ok',
      reason: 'ready',
      expected_workers: 0,
      registered_workers: 0,
      active_workers: 0,
    }),
  });
  server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}/api/v1/auth`;
});

beforeEach(async () => {
  await clear();
  const user = await prisma.user.create({
    data: {
      sex: 'female',
      nameArabic: `${TAG} مستخدمة`,
      accountStatus: 'active',
    },
  });
  userId = user.id;
  const issued = await issueNewSession(prisma, userId);
  rawToken = issued.rawToken;
  sessionId = issued.sessionId;
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await clear();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await prisma.$disconnect();
});

describe('R101 refresh HTTP issuance serialization', () => {
  it('cannot return a credential when logout commits after rotation but before issuance', async () => {
    const finalizationReached = deferred();
    const allowFinalization = deferred();
    const realLock = tokenRepo.lockSession;
    let targetLockCalls = 0;

    vi.spyOn(tokenRepo, 'lockSession').mockImplementation(async (tx, targetSessionId) => {
      if (targetSessionId === sessionId && ++targetLockCalls === 2) {
        // The first call was rotation. Its transaction has committed before the
        // service starts this final issuance transaction.
        finalizationReached.resolve();
        await allowFinalization.promise;
      }
      return realLock(tx, targetSessionId);
    });

    const racingRefresh = post('/refresh', rawToken);
    try {
      await finalizationReached.promise;

      const loggedOut = await post('/logout', rawToken);
      expect(loggedOut.status).toBe(204);
      expect(
        await prisma.refreshToken.count({
          where: { sessionId, revokedAt: null },
        }),
      ).toBe(0);

      allowFinalization.resolve();
      const refreshResponse = await racingRefresh;
      expect(refreshResponse.status).toBe(401);
      expect(refreshResponse.body.error?.code).toBe('AUTH_REQUIRED');
      expect(refreshResponse.body.access_token).toBeUndefined();
      expect(refreshResponse.headers.get('set-cookie')).toContain(
        'bodour_refresh=; Max-Age=0; Path=/api/v1/auth',
      );
      expect(
        await prisma.auditLog.count({
          where: { actorUserId: userId, actionType: 'auth.logout' },
        }),
      ).toBe(1);
    } finally {
      allowFinalization.resolve();
      await racingRefresh.catch(() => undefined);
    }
  });

  it('issues before logout when finalization holds the session lock, then lets logout revoke refresh state', async () => {
    const finalizationHoldsLock = deferred();
    const allowFinalization = deferred();
    const logoutReachedLock = deferred();
    const realLock = tokenRepo.lockSession;
    let targetLockCalls = 0;

    vi.spyOn(tokenRepo, 'lockSession').mockImplementation(async (tx, targetSessionId) => {
      if (targetSessionId !== sessionId) return realLock(tx, targetSessionId);
      targetLockCalls += 1;
      if (targetLockCalls === 2) {
        const locked = await realLock(tx, targetSessionId);
        finalizationHoldsLock.resolve();
        await allowFinalization.promise;
        return locked;
      }
      if (targetLockCalls === 3) logoutReachedLock.resolve();
      return realLock(tx, targetSessionId);
    });

    const racingRefresh = post('/refresh', rawToken);
    let racingLogout: Promise<Awaited<ReturnType<typeof post>>> | undefined;
    try {
      await finalizationHoldsLock.promise;
      let logoutSettled = false;
      racingLogout = post('/logout', rawToken).finally(() => {
        logoutSettled = true;
      });
      await logoutReachedLock.promise;
      expect(logoutSettled).toBe(false);

      allowFinalization.resolve();
      const refreshResponse = await racingRefresh;
      expect(refreshResponse.status).toBe(200);
      expect(typeof refreshResponse.body.access_token).toBe('string');

      const loggedOut = await racingLogout;
      expect(loggedOut.status).toBe(204);
      expect(
        verifyAccessToken(refreshResponse.body.access_token!, config.JWT_SIGNING_KEY).valid,
      ).toBe(true);
      expect(
        await prisma.refreshToken.count({ where: { sessionId, revokedAt: null } }),
      ).toBe(0);
    } finally {
      allowFinalization.resolve();
      await racingRefresh.catch(() => undefined);
      await racingLogout?.catch(() => undefined);
    }
  });
});
