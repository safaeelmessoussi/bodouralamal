import { PgBoss } from 'pg-boss';

import type { PrismaClient } from '../generated/prisma/client.js';
import type { AppConfig } from '../lib/config.js';
import { purgeExpiredAuthRows } from '../repositories/audit.repository.js';
import { deleteExpired as deleteExpiredRefreshTokens } from '../repositories/refresh-token.repository.js';
import { createStorageClients } from '../lib/storage.js';
import { runMaterialization } from '../services/session-materialize.service.js';
import { ingestRecording } from '../services/session-recording-ingest.service.js';

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
  /**
   * §4.1a: enqueued by every `ConsentRecord` change, roster change and upload.
   * The queue is **registered here but has no worker yet** — `pgboss.job` is
   * partitioned by queue name, so registration is what makes the §16.2
   * same-transaction insert possible at all. The handler recomputes a group's
   * consent state and force-corrects recording visibility, which needs the
   * content and bucket-migration machinery of M6; until then jobs accumulate and
   * drain on restart, exactly as TD-16 describes for a stopped worker.
   */
  consentReevaluate: 'consent.reevaluate',

  /**
   * `session.materialize` (TD-7, Revision 43) — turns a Recurring Course
   * Schedule into dated `Session` rows over a rolling horizon.
   *
   * **Unlike `consent.reevaluate`, this one HAS a worker**, below: schedule
   * writes materialize inside their own transaction (TD-4.6c) so the calendar is
   * never briefly empty, and this job exists to **advance the horizon nightly**
   * and to reconcile after an edit. It is a full idempotent reconcile keyed on
   * `(schedule_id, date)`, so running it twice creates nothing and a retry is
   * always safe.
   */
  sessionMaterialize: 'session.materialize',

  /**
   * **R99 C2 — `session-recording-ingest`.**
   *
   * Enqueued by the verified provider callback inside the same transaction as
   * the status write (§16.2, §20 rule 8). Payload `{ recording_id }`, singleton
   * per recording.
   *
   * **It is a job rather than part of the callback for two reasons.** A 500 MB
   * server-side copy inside an HTTP handler holds the request open long enough
   * for a provider to time out and retry, which turns one slow import into
   * several concurrent ones. And a transient storage failure must be a *retry*
   * under TD-7's backoff rather than a recording that is lost because a webhook
   * was answered once and never again (§20 rule 1).
   *
   * **The handler is idempotent independently of the singleton key**:
   * `session_recording.educational_content_id` is `UNIQUE` and is the first
   * thing read, so a duplicate delivery, a retried job and a worker killed after
   * committing all converge on one `EducationalContent`.
   *
   * **Not in the SRS's TD-7 table.** R99 authorises the ingestion pipeline
   * (R99.13/14) and specifies TD-2, TD-3, TD-8 and TD-13 additions, but names no
   * queue; §20 rule 1 leaves no compliant alternative to pg-boss for durable,
   * retryable work. Reported to the Document Owner as a TD-7 catalogue gap; the
   * handbook's catalogue carries it meanwhile.
   */
  sessionRecordingIngest: 'session-recording-ingest',
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
  config: AppConfig,
): Promise<void> {
  await boss.start();

  // R99 C2's worker needs object storage. Its own clients rather than the app's:
  // `createApp` builds them for the request path, and threading one instance
  // through two unrelated boot sequences to save an idle HTTP client would
  // couple them for nothing.
  const storage = createStorageClients(config);

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

  // TD-7: the nightly horizon extension. No payload — an empty `schedule_id`
  // sweeps every active schedule, which is what "rolling horizon" means.
  await boss.work(QUEUES.sessionMaterialize, async ([job]) => {
    const payload = (job?.data ?? {}) as { schedule_id?: string };
    const results = await runMaterialization(prisma, payload);
    log(QUEUES.sessionMaterialize, {
      schedules: results.length,
      created: results.reduce((n, r) => n + r.created, 0),
      // Reported, never silent: §4.4 makes "what did this leave alone" part of
      // the behaviour rather than a detail.
      left_alone: results.reduce((n, r) => n + r.protectedSessions.length, 0),
    });
  });

  /**
   * **R99 C2 — `session-recording-ingest`** (see the catalogue above).
   *
   * Event-driven, never scheduled: it runs because a provider reported a
   * completion, and there is nothing to sweep on a cron.
   *
   * The failure is deliberately **re-thrown**. `ingestRecording` has already
   * written why on the row — which is what a مؤطِّرة's «تعذّرت التهيئة» reads —
   * and throwing is what makes pg-boss apply TD-7's exponential backoff, so a
   * transient MinIO failure is retried and a genuinely bad staging object
   * eventually dead-letters with an Admin-visible failure rather than being
   * silently dropped.
   */
  await boss.work(QUEUES.sessionRecordingIngest, async ([job]) => {
    const payload = (job?.data ?? {}) as { recording_id?: string };
    if (!payload.recording_id) return;
    const outcome = await ingestRecording(prisma, storage, payload.recording_id);
    log(QUEUES.sessionRecordingIngest, {
      recording_id: outcome.recordingId,
      educational_content_id: outcome.contentId,
      already_ingested: outcome.alreadyIngested,
      // Reported rather than silent: a staging object that outlived a
      // successful import is a sweep to retry, not a failed ingestion.
      staging_cleaned: outcome.stagingCleaned ?? null,
    });
  });

  await boss.schedule(QUEUES.sessionMaterialize, DAILY_AT_0330);
  await boss.schedule(QUEUES.tokenPurge, DAILY_AT_0330);
  await boss.schedule(QUEUES.rateLimitPurge, DAILY_AT_0330);
  await boss.schedule(QUEUES.auditPurge, DAILY_AT_0330);
}

export async function stopJobRunner(boss: PgBoss): Promise<void> {
  // Let in-flight handlers finish rather than severing them mid-transaction.
  await boss.stop({ graceful: true });
}
