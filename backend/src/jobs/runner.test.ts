import type { PgBoss } from 'pg-boss';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../generated/prisma/client.js';
import type { AppConfig } from '../lib/config.js';
import { JobRunnerReadiness } from './readiness.js';
import { QUEUES, startJobRunner } from './runner.js';

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

describe('job runner startup readiness', () => {
  it('derives expected workers from exactly the catalog it registers', async () => {
    const { boss } = fakeRunner();
    const readiness = new JobRunnerReadiness(boss, () => 1_000);

    await startJobRunner(
      boss as unknown as PgBoss,
      {} as PrismaClient,
      CONFIG,
      readiness,
    );

    const registered = boss.work.mock.calls.map(([name]) => name);
    expect(registered).toEqual([
      QUEUES.tokenPurge,
      QUEUES.rateLimitPurge,
      QUEUES.auditPurge,
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

    // Queue-only consent work is still registered for transactional enqueue,
    // but health does not invent a worker that this slice did not implement.
    expect(boss.createQueue).toHaveBeenCalledWith(
      QUEUES.consentReevaluate,
      expect.any(Object),
    );
    expect(boss.createQueue).toHaveBeenCalledWith(
      QUEUES.sessionRecordingIngest,
      { retryLimit: 5, retryBackoff: true },
    );
    expect(registered).not.toContain(QUEUES.consentReevaluate);
  });

  it('marks the subsystem failed when pg-boss startup rejects', async () => {
    const { boss } = fakeRunner();
    boss.start.mockRejectedValueOnce(new Error('fixture startup failure'));
    const readiness = new JobRunnerReadiness(boss, () => 1_000);

    await expect(
      startJobRunner(
        boss as unknown as PgBoss,
        {} as PrismaClient,
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
        {} as PrismaClient,
        CONFIG,
        readiness,
      ),
    ).rejects.toThrow('fixture registration failure');
    expect(readiness.snapshot()).toMatchObject({
      state: 'down',
      reason: 'startup_failed',
      expected_workers: 5,
      registered_workers: 2,
      active_workers: 2,
    });
  });
});
