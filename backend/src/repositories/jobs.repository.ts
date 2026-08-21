import type { Prisma } from '../generated/prisma/client.js';

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
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO pgboss.job (name, data, singleton_key)
    VALUES (${queue}, ${JSON.stringify(data)}::jsonb, ${singletonKey ?? null})
  `;
}
