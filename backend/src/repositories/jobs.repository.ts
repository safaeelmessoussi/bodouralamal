import type { Prisma, PrismaClient } from '../generated/prisma/client.js';

/**
 * Same-transaction job enqueue (SRS §16.2, TD-4, TD-7, TD-16).
 *
 * §4.1a makes the consent re-evaluation enqueue a **hard requirement** of any
 * `ConsentRecord` change, and TD-4 requires it to happen inside the same
 * transaction as the change itself. That is the whole point: if the consent
 * write rolls back the job must vanish with it, and if the write commits the job
 * must be guaranteed — a `boss.send()` on a separate connection can satisfy
 * neither, because it would either enqueue work for a change that never happened
 * or lose work for a change that did.
 *
 * TD-16 states the same property from the availability side: *"enqueues keep
 * succeeding (they are DB inserts inside the app transaction)"* while workers are
 * down. Jobs accumulate and drain on restart.
 *
 * **Raw SQL here is the §16.2 sanctioned exception**, which permits it for
 * exactly two cases — row locks and same-transaction pg-boss inserts. It is not
 * a licence to reach past the repository layer anywhere else.
 *
 * `pgboss.job` is **partitioned by queue name**, so a queue must be registered
 * with `boss.createQueue()` before any row can be inserted for it; the runner
 * registers every queue in the TD-7 catalogue at boot for this reason.
 */

/** TD-7 job names. Kept here so the enqueue side cannot drift from the runner. */
export const JOB_QUEUES = {
  consentReevaluate: 'consent.reevaluate',
  /** TD-7's canonical-object placement transition. B-01 implements only the
   * consent-forced public → private arm; publication remains a separate,
   * explicitly authorised operation. */
  contentBucketMigrate: 'content.bucket-migrate',
  /** TD-7, Revision 43. Singleton per schedule: several edits collapse into one
   *  pending job, which is safe because materialization is a full idempotent
   *  reconcile rather than a delta. */
  sessionMaterialize: 'session.materialize',
  /**
   * **R99 C2 — turning a provider's staging object into a library item.**
   *
   * Enqueued by the verified provider callback, inside the same transaction as
   * the status write, **singleton per recording**: a provider delivering the
   * same completion three times leaves one pending job rather than three
   * concurrent copies racing for the same key. The handler is idempotent
   * independently of that — `session_recording.educational_content_id` is
   * `UNIQUE` and is the first thing it reads — so the singleton is an
   * efficiency, not the guarantee.
   */
  sessionRecordingIngest: 'session-recording-ingest',
} as const;

/**
 * Enqueues a job inside the caller's transaction.
 *
 * `singletonKey` implements TD-7's *"singleton per group"* rule: several changes
 * affecting one group collapse into a single pending job, which is safe because
 * the handler is a full, idempotent recompute rather than a delta.
 */
export async function enqueue(
  tx: Prisma.TransactionClient,
  queue: string,
  data: Record<string, unknown>,
  singletonKey?: string,
): Promise<boolean> {
  // pg-boss 12 intentionally keeps execution policy on the QUEUE row and its
  // own `send()` copies those values into each job. A three-column raw INSERT
  // produces a row whose retry/expiry/policy contract is NULL: it may be
  // fetched, but a transient failure is not governed by TD-7's configured
  // retry boundary. Mirror only that queue-default copy here; lifecycle
  // timestamps/state keep their table defaults.
  const result = await tx.$queryRaw<{ registered: boolean; inserted: boolean }[]>`
    WITH queue AS (
      SELECT * FROM pgboss.queue WHERE name = ${queue}
    ), inserted AS (
    INSERT INTO pgboss.job (
      name,
      data,
      singleton_key,
      expire_seconds,
      deletion_seconds,
      keep_until,
      retry_limit,
      retry_delay,
      retry_backoff,
      retry_delay_max,
      policy,
      dead_letter,
      heartbeat_seconds
    )
    SELECT
      q.name,
      ${JSON.stringify(data)}::jsonb,
      ${singletonKey ?? null},
      q.expire_seconds,
      q.deletion_seconds,
      now() + q.retention_seconds * interval '1 second',
      q.retry_limit,
      q.retry_delay,
      q.retry_backoff,
      q.retry_delay_max,
      q.policy,
      q.dead_letter,
      q.heartbeat_seconds
    FROM queue q
    WHERE ${singletonKey ?? null}::text IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM pgboss.job existing
         WHERE existing.name = q.name
           AND existing.singleton_key = ${singletonKey ?? null}
           AND existing.state IN ('created', 'retry')
       )
    RETURNING 1
    )
    SELECT
      EXISTS (SELECT 1 FROM queue) AS registered,
      EXISTS (SELECT 1 FROM inserted) AS inserted
  `;
  if (result[0]?.registered !== true) {
    throw new Error(`pg-boss queue is not registered: ${queue}`);
  }
  return result[0]?.inserted === true;
}

/**
 * Pre-B-01 transactional inserts populated only name/data/singleton_key. Those
 * historical rows can execute, but they do not carry queue retry/expiry policy.
 * When one becomes active, commit one correctly configured full-recompute
 * follow-up before doing its work. Pending-key deduplication bounds hundreds of
 * legacy rows for the same subject to one recovery obligation.
 *
 * This avoids an unsafe bulk rewrite of historical jobs and closes the one-shot
 * failure window during ordinary draining. New rows are a cheap no-op here.
 */
export async function ensureDurableLegacyFollowup(
  prisma: PrismaClient,
  jobId: string,
  queue: string,
  data: Record<string, unknown>,
  singletonKey: string,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ legacy: boolean }[]>`
      SELECT (
        retry_limit IS NULL OR expire_seconds IS NULL OR
        deletion_seconds IS NULL OR keep_until IS NULL OR policy IS NULL
      ) AS legacy
      FROM pgboss.job
      WHERE id = ${jobId}::uuid AND name = ${queue}
      FOR UPDATE
    `;
    if (rows[0]?.legacy !== true) return false;
    await enqueue(tx, queue, data, singletonKey);
    return true;
  });
}
