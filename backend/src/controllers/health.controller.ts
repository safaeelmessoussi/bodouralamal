import type { Request, Response } from 'express';

import type { AppConfig } from '../lib/config.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { OUTBOUND_TIMEOUT_MS } from '../lib/oauth.js';

/**
 * `GET /healthz` (SRS TD-14) — public and unauthenticated. Checks DB
 * connectivity, MinIO reachability and the pg-boss queue heartbeat, returning
 * `200` or **`503` with per-component detail**, which is what the TD-16
 * degraded-operation matrix is read against and what §19.1 step 8 asserts.
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

async function checkStorage(config: AppConfig): Promise<ComponentState> {
  try {
    const response = await fetch(`${config.MINIO_ENDPOINT}/minio/health/live`, {
      signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS),
    });
    return response.ok ? 'ok' : 'down';
  } catch {
    return 'down';
  }
}

/**
 * pg-boss stores its state in PostgreSQL, so "is the queue alive" is a question
 * about its schema. The runner is wired (M1.10), so this normally reports `ok`;
 * `not_configured` remains for an environment where the schema has not been
 * created yet — reporting that honestly beats a health endpoint that lies about
 * a component it has not checked.
 */
async function checkJobQueue(prisma: PrismaClient): Promise<ComponentState> {
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

export function healthController(prisma: PrismaClient, config: AppConfig) {
  return async (_req: Request, res: Response): Promise<void> => {
    const [database, storage, jobs] = await Promise.all([
      checkDatabase(prisma),
      checkStorage(config),
      checkJobQueue(prisma),
    ]);

    const components = { database, storage, jobs };
    // `not_configured` is not a failure — it is an honest statement about a
    // component this milestone has not built yet.
    const healthy = Object.values(components).every((state) => state !== 'down');

    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      components,
    });
  };
}
