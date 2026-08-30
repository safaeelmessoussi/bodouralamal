import type { Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../generated/prisma/client.js';
import type { JobReadinessSnapshot } from '../jobs/readiness.js';
import type { AppConfig } from '../lib/config.js';
import type { StorageClients } from '../lib/storage.js';
import { healthController } from './health.controller.js';

const CONFIG = {
  RECORDING_STAGING_BUCKET: 'recordings-staging',
} as AppConfig;

const READY: JobReadinessSnapshot = {
  state: 'ok',
  reason: 'ready',
  expected_workers: 5,
  registered_workers: 5,
  active_workers: 5,
};

const NEVER_STARTED: JobReadinessSnapshot = {
  state: 'down',
  reason: 'not_started',
  expected_workers: 0,
  registered_workers: 0,
  active_workers: 0,
};

function prismaWithQueue(present: boolean): PrismaClient {
  return {
    $queryRaw: vi
      .fn()
      .mockResolvedValueOnce([{ one: 1 }])
      .mockResolvedValueOnce([{ present }]),
  } as unknown as PrismaClient;
}

async function callHealth(
  worker: JobReadinessSnapshot,
  queuePresent = true,
  storageSend = vi.fn().mockResolvedValue({}),
) {
  let statusCode = 0;
  let body: unknown;
  const response = {
    status: vi.fn((status: number) => {
      statusCode = status;
      return response;
    }),
    json: vi.fn((value: unknown) => {
      body = value;
      return response;
    }),
  };

  await healthController(
    prismaWithQueue(queuePresent),
    CONFIG,
    { internal: { send: storageSend } } as unknown as Pick<StorageClients, 'internal'>,
    { snapshot: () => worker },
  )({} as Request, response as unknown as Response);

  return { statusCode, body };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /healthz worker truthfulness', () => {
  it('returns healthy with queue infrastructure and the full live worker catalog', async () => {
    const storageSend = vi.fn().mockResolvedValue({});
    const result = await callHealth(READY, true, storageSend);

    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual({
      status: 'ok',
      components: {
        database: 'ok',
        storage: 'ok',
        jobs: 'ok',
        queue: 'ok',
      },
      details: { jobs: READY },
    });
    expect(storageSend.mock.calls.map(([command]) => command.input.Bucket)).toEqual([
      'public',
      'private',
      'recordings-staging',
    ]);
  });

  it('fails readiness when any required S3 bucket is absent or unauthorized', async () => {
    const storageSend = vi.fn(async (command: { input: { Bucket: string } }) => {
      if (command.input.Bucket === 'private') throw new Error('AccessDenied');
      return {};
    });

    const result = await callHealth(READY, true, storageSend);

    expect(result.statusCode).toBe(503);
    expect(result.body).toMatchObject({
      status: 'degraded',
      components: { database: 'ok', storage: 'down', queue: 'ok', jobs: 'ok' },
    });
  });

  it('does not treat a present pg-boss schema as proof that workers started', async () => {
    const result = await callHealth(NEVER_STARTED, true);

    expect(result.statusCode).toBe(503);
    expect(result.body).toMatchObject({
      status: 'degraded',
      components: { database: 'ok', storage: 'ok', queue: 'ok', jobs: 'down' },
      details: { jobs: { reason: 'not_started' } },
    });
  });

  it('reports runner startup failure as degraded despite healthy dependencies', async () => {
    const result = await callHealth({
      ...NEVER_STARTED,
      reason: 'startup_failed',
      expected_workers: 5,
    });

    expect(result.statusCode).toBe(503);
    expect(result.body).toMatchObject({
      status: 'degraded',
      components: { queue: 'ok', jobs: 'down' },
      details: { jobs: { reason: 'startup_failed' } },
    });
  });

  it('requires queue infrastructure independently of worker lifecycle state', async () => {
    const result = await callHealth(READY, false);

    expect(result.statusCode).toBe(503);
    expect(result.body).toMatchObject({
      status: 'degraded',
      components: { queue: 'not_configured', jobs: 'ok' },
    });
  });

  it('preserves the original status and component fields while adding detail', async () => {
    const result = await callHealth(READY);
    const body = result.body as {
      status: string;
      components: Record<string, string>;
    };

    expect(body.status).toBe('ok');
    expect(body.components.database).toBe('ok');
    expect(body.components.storage).toBe('ok');
    expect(body.components.jobs).toBe('ok');
  });
});
