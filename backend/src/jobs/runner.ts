import { PgBoss, type WorkHandler } from 'pg-boss';

import type { PrismaClient } from '../generated/prisma/client.js';
import type { AppConfig } from '../lib/config.js';
import { purgeExpiredAuthRows } from '../repositories/audit.repository.js';
import { BUCKETS, createStorageClients } from '../lib/storage.js';
import { purgeExpired as purgeExpiredRefreshTokens } from '../services/refresh-token.service.js';
import { runMaterialization } from '../services/session-materialize.service.js';
import { ingestRecording } from '../services/session-recording-ingest.service.js';
import {
  collectAbandonedUploadPage,
  quarantineRetiredContentObject,
  retirePurgedContentObjects,
  uploadGcContinuationSingletonKey,
  type UploadGcPayload,
} from '../services/storage-lifecycle.service.js';
import {
  contentMigrationSingletonKey,
  enqueueConsentSafeguardingSweep,
  migrateConsentForcedContent,
  reevaluateSessionConsent,
  retireConsentPublicObject,
} from '../services/consent-reevaluation.service.js';
import { purgeElapsedApplications } from '../services/application-retention.service.js';
import { JobRunnerReadiness } from './readiness.js';
import {
  enqueue,
  ensureDurableLegacyFollowup,
  JOB_QUEUES,
} from '../repositories/jobs.repository.js';

/**
 * pg-boss bootstrap and job runner (SRS TD-7, §3.1, §20 rule 1).
 *
 * pg-boss is Postgres-backed, so job state survives container restarts. **No
 * in-memory queue, `setImmediate`, unawaited promise, or ad-hoc timer may ever
 * stand in for anything in the TD-7 catalog** (§20 rule 1) — and conversely the
 * Quran coverage recalculation must never be moved *into* a job, because §4.5
 * makes it synchronous by rule.
 *
 * This runner registers only handlers that exist below. Queues required by the
 * SRS but not implemented yet remain release-readiness gaps; runtime health
 * must not pretend that a missing implementation was started.
 */

/** TD-7 job names. Registering a queue not in the catalog is a defect. */
export const QUEUES = {
  tokenPurge: 'token.purge',
  rateLimitPurge: 'ratelimit.purge',
  auditPurge: 'audit.purge',
  /**
   * §4.10a's twelve-month maximum for applications (Owner, 2026-09-04).
   * Rejected from `decided_at`, never-converted pending from `created_at`.
   * Scheduled beside the other daily purges rather than given a scheduler of
   * its own — the retention boundary is a calendar fact, not an event.
   */
  applicationRetentionPurge: 'application.retention-purge',
  /**
   * §4.1a: enqueued by every `ConsentRecord` change, roster change and upload.
   * Full current-state recompute for an occurrence's resolved audience. The
   * worker closes the application read gate and durably hands any physical
   * public → private transition to `content.bucket-migrate`.
   */
  consentReevaluate: 'consent.reevaluate',
  /** Minimum TD-7 placement worker used by BR-2 safeguarding. It moves only an
   * already consent-forced canonical object from public to private. */
  contentBucketMigrate: 'content.bucket-migrate',
  /** R59.1 manual exact-coordinate retirement. Automatic `purge_after`
   * destruction remains deliberately unscheduled pending the Owner decision. */
  contentQuarantinePurge: 'content.quarantine-purge',
  /** TD-7's bounded, paginated abandoned browser-upload collector. */
  uploadGc: 'upload.gc',

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
   * **Normative since SRS Revision 100** (2026-08-21), which added the TD-7 row
   * and nothing else. R99 authorised the pipeline (R99.13/14) without naming a
   * queue, and §20 rule 1 forbids every in-memory substitute — so C2 built this
   * and reported the omission rather than inventing a specification for itself.
   * R100 states the order below as normative: verify → server-side copy →
   * content → link → relation → **staging swept last**.
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
 * Docker grants the API 120 seconds (`stop_grace_period`). Stop accepting new
 * work immediately, then give pg-boss most of that window to finish an active
 * handler or durably return it to retry. The remaining 15 seconds belong to
 * HTTP close, database-pool disconnect and process exit.
 */
export const JOB_SHUTDOWN_TIMEOUT_MS = 105_000;

/**
 * TD-7 retry policy: exponential backoff, **max 5 attempts**, then dead-letter
 * with an Admin-visible failure. In pg-boss 12 this is a per-QUEUE option, not
 * a constructor one, so it is applied at `createQueue` for every queue.
 * `retryLimit` counts retries after the initial execution, hence four.
 */
export const TD7_RETRY_POLICY = { retryLimit: 4, retryBackoff: true } as const;

interface WorkerDefinition {
  readonly name: string;
  readonly handler: WorkHandler<object, void>;
}

export function createBoss(config: AppConfig): PgBoss {
  return new PgBoss({
    connectionString: config.DATABASE_URL,
    max: PG_BOSS_MAX_CONNECTIONS,
  });
}

/**
 * The single catalog of workers this implementation actually starts.
 * `startJobRunner` registers this list and readiness derives its expectations
 * from the same list, so health cannot drift onto a second set of queue names.
 */
export function createWorkerCatalog(
  prisma: PrismaClient,
  storage: ReturnType<typeof createStorageClients>,
  log: (queue: string, detail: Record<string, unknown>) => void,
): readonly WorkerDefinition[] {
  return [
    {
      // token.purge (TD-7): ConsumedToken past its TTL horizon, and
      // RefreshToken past expires_at (Revision 16). Fail-closed: a presented
      // token with no row is rejected exactly as an expired one is.
      name: QUEUES.tokenPurge,
      handler: async () => {
        const consumed = await prisma.consumedToken.deleteMany({
          where: { expiresAt: { lte: new Date() } },
        });
        const refresh = await purgeExpiredRefreshTokens(prisma, new Date());
        log(QUEUES.tokenPurge, {
          consumed_tokens: consumed.count,
          refresh_tokens: refresh,
        });
      },
    },
    {
      // ratelimit.purge (TD-7, Revision 14): elapsed quota windows.
      // Housekeeping only; the synchronous quota decision never depends on it.
      name: QUEUES.rateLimitPurge,
      handler: async () => {
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const deleted = await prisma.rateLimitCounter.deleteMany({
          where: { windowStart: { lt: cutoff } },
        });
        log(QUEUES.rateLimitPurge, { counters: deleted.count });
      },
    },
    {
      // application.retention-purge (§4.10a, Owner 2026-09-04): the eligibility
      // rule lives in the service, so the job is the schedule and nothing else.
      name: QUEUES.applicationRetentionPurge,
      handler: async () => {
        const { deleted } = await purgeElapsedApplications(prisma, new Date());
        // A COUNT, never an id or a name (TD-14): the log line must not become
        // a record of who was deleted.
        log(QUEUES.applicationRetentionPurge, { applications: deleted });
      },
    },
    {
      // audit.purge (TD-7, Revision 19): both the authentication-action
      // allowlist and the age horizon are enforced by the repository.
      name: QUEUES.auditPurge,
      handler: async () => {
        const deleted = await purgeExpiredAuthRows(prisma, new Date());
        log(QUEUES.auditPurge, { audit_rows: deleted });
      },
    },
    {
      name: QUEUES.consentReevaluate,
      handler: async ([job]) => {
        const payload = (job?.data ?? {}) as { session_id?: string };
        if (!job || !payload.session_id) {
          throw new Error('consent.reevaluate requires session_id');
        }
        await ensureDurableLegacyFollowup(
          prisma,
          job.id,
          QUEUES.consentReevaluate,
          { session_id: payload.session_id },
          payload.session_id,
        );
        const outcome = await reevaluateSessionConsent(prisma, payload.session_id);
        log(QUEUES.consentReevaluate, {
          session_id: outcome.sessionId,
          recordings_inspected: outcome.recordingsInspected,
          recordings_forced: outcome.recordingsForced,
          migrations_enqueued: outcome.migrationsEnqueued,
        });
      },
    },
    {
      name: QUEUES.contentBucketMigrate,
      handler: async ([job]) => {
        const payload = (job?.data ?? {}) as {
          content_id?: string;
          target_bucket?: string;
          operation?: string;
          source_key?: string;
        };
        if (!job || !payload.content_id || payload.target_bucket !== BUCKETS.private) {
          throw new Error('content.bucket-migrate requires content_id and target_bucket=private');
        }
        if (payload.operation === 'retire_public' && !payload.source_key) {
          throw new Error('content.bucket-migrate retire_public requires source_key');
        }
        const durablePayload = {
          content_id: payload.content_id,
          target_bucket: BUCKETS.private,
          ...(payload.operation === undefined ? {} : { operation: payload.operation }),
          ...(payload.source_key === undefined ? {} : { source_key: payload.source_key }),
        };
        await ensureDurableLegacyFollowup(
          prisma,
          job.id,
          QUEUES.contentBucketMigrate,
          durablePayload,
          payload.source_key === undefined
            ? payload.content_id
            : contentMigrationSingletonKey(payload.content_id, payload.source_key),
        );
        const outcome = payload.operation === 'retire_public'
          ? await retireConsentPublicObject(
              storage,
              payload.content_id,
              payload.source_key!,
            ).then(() => ({ contentId: payload.content_id!, state: 'retired' as const }))
          : await migrateConsentForcedContent(
              prisma,
              storage,
              payload.content_id,
              payload.source_key,
            );
        log(QUEUES.contentBucketMigrate, {
          content_id: outcome.contentId,
          state: outcome.state,
        });
      },
    },
    {
      name: QUEUES.contentQuarantinePurge,
      handler: async ([job]) => {
        const payload = (job?.data ?? {}) as {
          operation?: string;
          content_id?: string;
          bucket?: string;
          storage_key?: string;
        };
        if (!job || !payload.content_id || !payload.bucket || !payload.storage_key) {
          throw new Error(
            'content.quarantine-purge requires an exact content coordinate',
          );
        }
        const coordinates = {
          contentId: payload.content_id,
          bucket: payload.bucket,
          storageKey: payload.storage_key,
        };
        if (payload.operation === 'manual_permanent_delete') {
          await retirePurgedContentObjects(storage, coordinates);
        } else if (payload.operation === 'quarantine_retired_object') {
          await quarantineRetiredContentObject(storage, coordinates);
          // A pending quarantine move and a later manual purge may overlap.
          // Re-read only the content identity after storage: if permanent purge
          // has committed, make the destructive state monotonic by retiring
          // both old coordinates again. If the row still exists (live after
          // replacement, or soft-deleted), quarantine remains recoverable.
          const retained = await prisma.educationalContent.findUnique({
            where: { id: payload.content_id },
            select: { id: true },
          });
          if (retained === null) {
            await retirePurgedContentObjects(storage, coordinates);
          }
        } else {
          throw new Error('content.quarantine-purge operation is unsupported');
        }
        log(QUEUES.contentQuarantinePurge, {
          operation: payload.operation,
          content_id: payload.content_id,
          state: 'retired',
        });
      },
    },
    {
      name: QUEUES.uploadGc,
      handler: async ([job]) => {
        if (!job) throw new Error('upload.gc requires a pg-boss job');
        const result = await collectAbandonedUploadPage(
          storage,
          (job.data ?? {}) as UploadGcPayload,
          job.id,
        );
        if (result.next) {
          await prisma.$transaction(async (tx) => {
            await enqueue(
              tx,
              JOB_QUEUES.uploadGc,
              { ...result.next! },
              uploadGcContinuationSingletonKey(result.next!),
            );
          });
        }
        log(QUEUES.uploadGc, {
          bucket: result.bucket,
          prefix: result.prefix,
          scanned: result.scanned,
          deleted: result.deleted,
          retained: result.retained,
          continuation_enqueued: result.next !== null,
        });
      },
    },
    {
      // Nightly rolling-horizon extension. An empty payload sweeps every active
      // schedule; per-schedule reconciliation uses the same handler.
      name: QUEUES.sessionMaterialize,
      handler: async ([job]) => {
        const payload = (job?.data ?? {}) as { schedule_id?: string };
        const results = await runMaterialization(prisma, payload);
        log(QUEUES.sessionMaterialize, {
          schedules: results.length,
          created: results.reduce((n, result) => n + result.created, 0),
          left_alone: results.reduce(
            (n, result) => n + result.protectedSessions.length,
            0,
          ),
        });
      },
    },
    {
      // Event-driven R100 ingestion. Failure is re-thrown by the service path
      // so pg-boss applies TD-7 retry/backoff instead of losing the recording.
      // That includes a post-commit staging-delete failure: the relation stays
      // authoritative, and the retry short-circuits to exact-key cleanup.
      name: QUEUES.sessionRecordingIngest,
      handler: async ([job]) => {
        const payload = (job?.data ?? {}) as { recording_id?: string };
        if (!payload.recording_id) return;
        const outcome = await ingestRecording(
          prisma,
          storage,
          payload.recording_id,
        );
        log(QUEUES.sessionRecordingIngest, {
          recording_id: outcome.recordingId,
          educational_content_id: outcome.contentId,
          already_ingested: outcome.alreadyIngested,
          staging_cleaned: outcome.stagingCleaned ?? null,
        });
      },
    },
  ];
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
  readiness: JobRunnerReadiness,
): Promise<void> {
  try {
    // R100's worker needs object storage. It owns its clients rather than
    // coupling the HTTP app and worker boot sequences to share an idle client.
    const storage = createStorageClients(config);
    const log = (queue: string, detail: Record<string, unknown>): void => {
      process.stdout.write(
        `${JSON.stringify({ time: new Date().toISOString(), level: 'info', job: queue, ...detail })}\n`,
      );
    };
    const workers = createWorkerCatalog(prisma, storage, log);

    readiness.starting(workers.map((worker) => worker.name));
    await boss.start();

    for (const queue of Object.values(QUEUES)) {
      await boss.createQueue(queue, TD7_RETRY_POLICY);
      // `createQueue` is CREATE-IF-ABSENT. Without an explicit update, a queue
      // created by an older deployment silently retains obsolete retry/policy
      // settings forever even though startup appears to apply the constants.
      await boss.updateQueue(queue, TD7_RETRY_POLICY);
    }

    // Deployment/bootstrap reconciliation runs before any handler can consume
    // work. Readiness stays `starting` until every live recording-linked Session
    // has an ordinary durable reevaluation obligation.
    const sweep = await enqueueConsentSafeguardingSweep(prisma);
    log('consent.safeguarding-sweep', {
      sessions_scanned: sweep.sessionsScanned,
      obligations_inserted: sweep.obligationsInserted,
      batches: sweep.batches,
      complete: true,
    });

    for (const worker of workers) {
      await boss.work(worker.name, worker.handler);
      readiness.workerRegistered(worker.name);
    }

    await boss.schedule(QUEUES.sessionMaterialize, DAILY_AT_0330);
    await boss.schedule(QUEUES.tokenPurge, DAILY_AT_0330);
    await boss.schedule(QUEUES.rateLimitPurge, DAILY_AT_0330);
    await boss.schedule(QUEUES.auditPurge, DAILY_AT_0330);
    await boss.schedule(QUEUES.applicationRetentionPurge, DAILY_AT_0330);
    await boss.schedule(QUEUES.uploadGc, DAILY_AT_0330);
    // R59.4: do NOT schedule content.quarantine-purge against `purge_after`
    // until the Document Owner authorises automatic production destruction.
    readiness.ready();
  } catch (error) {
    readiness.failed();
    throw error;
  }
}

export async function stopJobRunner(
  boss: PgBoss,
  readiness: JobRunnerReadiness,
): Promise<void> {
  // Let in-flight handlers finish rather than severing them mid-transaction.
  readiness.stopping();
  try {
    await boss.stop({
      graceful: true,
      timeout: JOB_SHUTDOWN_TIMEOUT_MS,
    });
  } finally {
    readiness.stopped();
  }
}
