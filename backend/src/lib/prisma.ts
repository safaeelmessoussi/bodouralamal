import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../generated/prisma/client.js';

/**
 * The single Prisma client for the process.
 *
 * Prisma 7 connects through a driver adapter rather than its own pool, which is
 * what lets the TD-13 connection budget be applied explicitly. Those numbers are
 * configuration, not suggestions — the real concurrency risk on the 4 GB VPS is
 * pool exhaustion, so nothing here may be left at a default:
 *
 *   Prisma pool      ≤ 10   (this file)
 *   pg-boss pool     ≤ 5    (job runner)
 *   Postgres max     = 30   (docker-compose)
 *   statement_timeout= 10s  (docker-compose)
 *
 * Repositories are the only layer that may touch this client (§16.2): services
 * go through repositories, and controllers go through services.
 */

/** TD-13 pinned Prisma connection limit. */
export const PRISMA_CONNECTION_LIMIT = 10;

/**
 * `maxConnections` exists for the integration suite, which runs many files each
 * holding their own client against one 30-connection server (TD-13). At the
 * production limit two overlapping test clients alone can exhaust the budget, so
 * the suite asks for a small pool. Production callers pass nothing and get the
 * pinned TD-13 limit; a larger value is never permitted.
 */
export function createPrismaClient(
  databaseUrl: string,
  maxConnections: number = PRISMA_CONNECTION_LIMIT,
): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: databaseUrl,
    max: Math.min(maxConnections, PRISMA_CONNECTION_LIMIT),
  });
  return new PrismaClient({ adapter });
}

/** Pool size for test clients — see `maxConnections` above. */
export const TEST_CONNECTION_LIMIT = 3;
