import type { Request, Response } from 'express';

import type { AppConfig } from '../lib/config.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { JobRunnerReadiness } from '../jobs/readiness.js';
import { OUTBOUND_TIMEOUT_MS } from '../lib/oauth.js';
import { BUCKETS, headBucket, type StorageClients } from '../lib/storage.js';

/**
 * `GET /healthz` (SRS TD-14) — public and unauthenticated. Checks DB
 * connectivity, authenticated S3 bucket reachability, pg-boss infrastructure, and this process's
 * actual worker readiness. It returns `200` or **`503` with per-component
 * detail**, which is what the TD-16 degraded-operation matrix is read against
 * and what §19.1 step 8 asserts.
 */

type ComponentState = 'ok' | 'down' | 'not_configured';

async function checkDatabase(prisma: PrismaClient): Promise<ComponentState> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return 'ok';
  } catch {
    return 'down';
  }
}

async function checkStorage(
  storage: Pick<StorageClients, 'internal'>,
  config: AppConfig,
): Promise<ComponentState> {
  try {
    const signal = AbortSignal.timeout(OUTBOUND_TIMEOUT_MS);
    await Promise.all([
      headBucket(storage, BUCKETS.public, signal),
      headBucket(storage, BUCKETS.private, signal),
      headBucket(storage, config.RECORDING_STAGING_BUCKET, signal),
    ]);
    return 'ok';
  } catch {
    return 'down';
  }
}

/**
 * This checks durable queue infrastructure only. Worker readiness is a separate
 * process-local signal: the schema can survive while the runner never started,
 * failed startup, or stopped polling.
 */
async function checkQueueInfrastructure(
  prisma: PrismaClient,
): Promise<ComponentState> {
  try {
    const [row] = await prisma.$queryRaw<{ present: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.schemata WHERE schema_name = 'pgboss'
      ) AS present
    `;
    return row?.present ? 'ok' : 'not_configured';
  } catch {
    return 'down';
  }
}

export function healthController(
  prisma: PrismaClient,
  config: AppConfig,
  storage: Pick<StorageClients, 'internal'>,
  jobReadiness: Pick<JobRunnerReadiness, 'snapshot'>,
) {
  return async (_req: Request, res: Response): Promise<void> => {
    const [database, storageState, queue] = await Promise.all([
      checkDatabase(prisma),
      checkStorage(storage, config),
      checkQueueInfrastructure(prisma),
    ]);
    const jobDetail = jobReadiness.snapshot();
    const jobs: ComponentState = jobDetail.state;

    // Existing component names and value types remain intact. `queue` and the
    // worker detail are additive; `jobs` now means what its name always claimed:
    // this application's workers, not merely a surviving database schema.
    const components = { database, storage: storageState, jobs, queue };
    const healthy = Object.values(components).every((state) => state === 'ok');

    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      components,
      details: { jobs: jobDetail },
    });
  };
}
