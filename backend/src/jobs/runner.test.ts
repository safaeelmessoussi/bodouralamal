import type { PgBoss } from 'pg-boss';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../generated/prisma/client.js';
import type { AppConfig } from '../lib/config.js';
import { JobRunnerReadiness } from './readiness.js';
import {
  JOB_SHUTDOWN_TIMEOUT_MS,
  QUEUES,
  startJobRunner,
  stopJobRunner,
} from './runner.js';

const CONFIG: AppConfig = {
  DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused',
  GOOGLE_CLIENT_ID: 'unused',
  GOOGLE_CLIENT_SECRET: 'unused',
  JWT_SIGNING_KEY: 'unused',
  ONBOARDING_TOKEN_KEY: 'unused',
  MINIO_ENDPOINT: 'http://127.0.0.1:1',
  MINIO_ACCESS_KEY: 'unused',
  MINIO_SECRET_KEY: 'unused',
  RECORDING_STAGING_BUCKET: 'recordings-staging',
  PUBLIC_BASE_URL: 'http://127.0.0.1',
  STORAGE_BASE_URL: 'http://127.0.0.1/storage',
  NODE_ENV: 'test',
  TZ: 'Africa/Casablanca',
  PORT: 3000,
  LOG_LEVEL: 'info',
};

function fakeRunner() {
  const live: Array<{
    name: string;
    state: 'active';
    count: number;
    createdOn: number;
    lastFetchedOn: number;
  }> = [];
  const boss = {
    start: vi.fn(async () => undefined),
    createQueue: vi.fn(async () => undefined),
    updateQueue: vi.fn(async () => undefined),
    work: vi.fn(async (name: string) => {
      live.push({
        name,
        state: 'active',
        count: 0,
        createdOn: 1_000,
        lastFetchedOn: 1_000,
      });
      return `${name}-worker`;
    }),
    schedule: vi.fn(async () => undefined),
    getWipData: vi.fn(() => live),
  };
  return { boss, live };
}

function fakePrisma() {
  return {
    session: { findMany: vi.fn(async () => []) },
  } as unknown as PrismaClient;
}

describe('job runner startup readiness', () => {
  it('derives expected workers from exactly the catalog it registers', async () => {
    const { boss } = fakeRunner();
    const prisma = fakePrisma();
    const readiness = new JobRunnerReadiness(boss, () => 1_000);

    await startJobRunner(
      boss as unknown as PgBoss,
      prisma,
      CONFIG,
      readiness,
    );

    const registered = boss.work.mock.calls.map(([name]) => name);
    expect(registered).toEqual([
      QUEUES.tokenPurge,
      QUEUES.rateLimitPurge,
      // BR-15's ninety days (R59.4, closed by the Owner 2026-09-04) and
      // §4.10a's twelve-month application clock — real workers, so both are
      // part of readiness like every other one.
      QUEUES.trashRetentionPurge,
      QUEUES.applicationRetentionPurge,
      QUEUES.auditPurge,
      QUEUES.consentReevaluate,
      QUEUES.contentBucketMigrate,
      QUEUES.contentQuarantinePurge,
      QUEUES.uploadGc,
      QUEUES.sessionMaterialize,
      QUEUES.sessionRecordingIngest,
    ]);
    expect(readiness.snapshot()).toEqual({
      state: 'ok',
      reason: 'ready',
      expected_workers: registered.length,
      registered_workers: registered.length,
      active_workers: registered.length,
    });

    // Both halves of BR-2 are real workers and therefore part of readiness.
    expect(boss.createQueue).toHaveBeenCalledWith(
      QUEUES.consentReevaluate,
      { retryLimit: 4, retryBackoff: true },
    );
    expect(boss.updateQueue).toHaveBeenCalledWith(
      QUEUES.contentBucketMigrate,
      { retryLimit: 4, retryBackoff: true },
    );
    expect(boss.createQueue).toHaveBeenCalledWith(
      QUEUES.sessionRecordingIngest,
      { retryLimit: 4, retryBackoff: true },
    );
    expect(registered).toContain(QUEUES.consentReevaluate);
    expect(registered).toContain(QUEUES.contentBucketMigrate);
    expect(registered).toContain(QUEUES.contentQuarantinePurge);
    expect(registered).toContain(QUEUES.uploadGc);

    // CREATE IF ABSENT is not a policy update. Every implemented queue is
    // reconciled before the rollout sweep, and no worker can consume until the
    // sweep has durably covered the live recording backlog.
    expect(boss.updateQueue).toHaveBeenCalledTimes(Object.values(QUEUES).length);
    for (const queue of Object.values(QUEUES)) {
      expect(boss.updateQueue).toHaveBeenCalledWith(queue, {
        retryLimit: 4,
        retryBackoff: true,
      });
    }
    expect(prisma.session.findMany).toHaveBeenCalledOnce();
    const lastQueueUpdate = Math.max(
      ...boss.updateQueue.mock.invocationCallOrder,
    );
    const sweepRead = vi.mocked(prisma.session.findMany).mock.invocationCallOrder[0];
    const firstWorker = boss.work.mock.invocationCallOrder[0];
    expect(sweepRead).toBeGreaterThan(lastQueueUpdate);
    expect(firstWorker).toBeGreaterThan(sweepRead ?? 0);
    expect(boss.schedule).toHaveBeenCalledWith(QUEUES.uploadGc, '30 3 * * *');
    expect(boss.schedule).not.toHaveBeenCalledWith(
      QUEUES.contentQuarantinePurge,
      expect.anything(),
    );
  });

  it('marks the subsystem failed when pg-boss startup rejects', async () => {
    const { boss } = fakeRunner();
    boss.start.mockRejectedValueOnce(new Error('fixture startup failure'));
    const readiness = new JobRunnerReadiness(boss, () => 1_000);

    await expect(
      startJobRunner(
        boss as unknown as PgBoss,
        fakePrisma(),
        CONFIG,
        readiness,
      ),
    ).rejects.toThrow('fixture startup failure');
    expect(readiness.snapshot()).toMatchObject({
      state: 'down',
      reason: 'startup_failed',
      registered_workers: 0,
    });
  });

  it('reports partial registration truthfully when a later worker fails', async () => {
    const { boss, live } = fakeRunner();
    boss.work.mockImplementation(async (name: string) => {
      if (boss.work.mock.calls.length === 3) {
        throw new Error('fixture registration failure');
      }
      live.push({
        name,
        state: 'active',
        count: 0,
        createdOn: 1_000,
        lastFetchedOn: 1_000,
      });
      return `${name}-worker`;
    });
    const readiness = new JobRunnerReadiness(boss, () => 1_000);

    await expect(
      startJobRunner(
        boss as unknown as PgBoss,
        fakePrisma(),
        CONFIG,
        readiness,
      ),
    ).rejects.toThrow('fixture registration failure');
    expect(readiness.snapshot()).toMatchObject({
      state: 'down',
      reason: 'startup_failed',
      // Eleven since the trash- and application-retention workers joined
      // (2026-09-04). The
      // number is asserted rather than derived deliberately: readiness claiming
      // "all workers up" while counting a shorter catalogue is exactly the
      // failure this test exists for.
      expected_workers: 11,
      registered_workers: 2,
      active_workers: 2,
    });
  });
});

describe('job runner shutdown readiness', () => {
  it('becomes unready before waiting for the bounded graceful drain', async () => {
    let finishStop: (() => void) | undefined;
    const boss = {
      stop: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishStop = resolve;
          }),
      ),
      getWipData: vi.fn(() => []),
    };
    const readiness = new JobRunnerReadiness(boss);

    const stopping = stopJobRunner(boss as unknown as PgBoss, readiness);

    expect(readiness.snapshot().reason).toBe('stopping');
    expect(boss.stop).toHaveBeenCalledWith({
      graceful: true,
      timeout: JOB_SHUTDOWN_TIMEOUT_MS,
    });

    finishStop?.();
    await stopping;
    expect(readiness.snapshot().reason).toBe('stopped');
  });
});
