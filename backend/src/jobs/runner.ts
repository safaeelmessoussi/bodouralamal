import { PgBoss } from 'pg-boss';

import type { PrismaClient } from '../generated/prisma/client.js';
import type { AppConfig } from '../lib/config.js';
import { purgeExpiredAuthRows } from '../repositories/audit.repository.js';
import { deleteExpired as deleteExpiredRefreshTokens } from '../repositories/refresh-token.repository.js';

/**
 * pg-boss bootstrap and job runner (SRS TD-7, §3.1, §20 rule 1).
 *
 * pg-boss is Postgres-backed, so job state survives container restarts. **No
 * in-memory queue, `setImmediate`, unawaited promise, or ad-hoc timer may ever
 * stand in for anything in the TD-7 catalog** (§20 rule 1) — and conversely the
 * Quran coverage recalculation must never be moved *into* a job, because §4.5
 * makes it synchronous by rule.
 *
 * Cron jobs implemented here are the three daily purges. The event-driven jobs
 * (`consent.reevaluate`, `content.bucket-migrate`) arrive with M6, and
 * `backup.replicate` with M7.
 */

/** TD-7 job names. Registering a queue not in the catalog is a defect. */
export const QUEUES = {
  tokenPurge: 'token.purge',
  rateLimitPurge: 'ratelimit.purge',
  auditPurge: 'audit.purge',
} as const;

/** Daily, small hours local time. TZ is pinned to Africa/Casablanca (TD-11). */
const DAILY_AT_0330 = '30 3 * * *';

/**
 * TD-13 pins the pg-boss pool at ≤ 5 — the real concurrency risk on the 4 GB
 * VPS is pool exhaustion, and these numbers are configuration, not suggestions.
 */
const PG_BOSS_MAX_CONNECTIONS = 5;

/**
 * TD-7 retry policy: exponential backoff, **max 5 attempts**, then dead-letter
 * with an Admin-visible failure. In pg-boss 12 this is a per-QUEUE option, not
 * a constructor one, so it is applied at `createQueue` for every queue.
 */
const TD7_RETRY_POLICY = { retryLimit: 5, retryBackoff: true } as const;

export function createBoss(config: AppConfig): PgBoss {
  return new PgBoss({
    connectionString: config.DATABASE_URL,
    max: PG_BOSS_MAX_CONNECTIONS,
  });
}

/**
 * Starts the queue and registers the TD-7 cron handlers. Idempotent per
 * process: pg-boss stores schedules in Postgres, so re-registering the same
 * cron on restart replaces rather than duplicates it.
 */
export async function startJobRunner(
  boss: PgBoss,
  prisma: PrismaClient,
): Promise<void> {
  await boss.start();

  const log = (queue: string, detail: Record<string, unknown>): void => {
    process.stdout.write(
      `${JSON.stringify({ time: new Date().toISOString(), level: 'info', job: queue, ...detail })}\n`,
    );
  };

  for (const queue of Object.values(QUEUES)) {
    await boss.createQueue(queue, TD7_RETRY_POLICY);
  }

  // ── token.purge (TD-7): ConsumedToken past its TTL horizon, and RefreshToken
  // past expires_at (Revision 16). Fail-closed: a presented token with no row
  // is rejected exactly as an expired one is, so collecting rows can never
  // widen access.
  await boss.work(QUEUES.tokenPurge, async () => {
    const consumed = await prisma.consumedToken.deleteMany({
      where: { expiresAt: { lte: new Date() } },
    });
    const refresh = await deleteExpiredRefreshTokens(prisma, new Date());
    log(QUEUES.tokenPurge, { consumed_tokens: consumed.count, refresh_tokens: refresh });
  });

  // ── ratelimit.purge (TD-7, Revision 14): elapsed quota windows. Housekeeping
  // only — the quota decision itself is synchronous and never depends on this.
  await boss.work(QUEUES.rateLimitPurge, async () => {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const deleted = await prisma.rateLimitCounter.deleteMany({
      where: { windowStart: { lt: cutoff } },
    });
    log(QUEUES.rateLimitPurge, { counters: deleted.count });
  });

  // ── audit.purge (TD-7, Revision 19): authentication-lifecycle rows past the
  // 12-month horizon, selected by an ENUMERATED allowlist AND the age horizon.
  // Never age alone, never an `auth.` prefix — every other action type,
  // including the indefinitely-retained security events, must survive.
  await boss.work(QUEUES.auditPurge, async () => {
    const deleted = await purgeExpiredAuthRows(prisma, new Date());
    log(QUEUES.auditPurge, { audit_rows: deleted });
  });

  await boss.schedule(QUEUES.tokenPurge, DAILY_AT_0330);
  await boss.schedule(QUEUES.rateLimitPurge, DAILY_AT_0330);
  await boss.schedule(QUEUES.auditPurge, DAILY_AT_0330);
}

export async function stopJobRunner(boss: PgBoss): Promise<void> {
  // Let in-flight handlers finish rather than severing them mid-transaction.
  await boss.stop({ graceful: true });
}
