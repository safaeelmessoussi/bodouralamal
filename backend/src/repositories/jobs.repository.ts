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

/**
 * Enqueues a consent re-evaluation for each group the student is enrolled in
 * (§4.1a, TD-7 payload `{ group_id }`).
 *
 * A student in no group enqueues nothing — there is no group whose consent state
 * could change — and that is a normal outcome, not an error.
 */
export async function enqueueConsentReevaluation(
  tx: Prisma.TransactionClient,
  studentId: string,
): Promise<string[]> {
  const enrolments = await tx.studentGroup.findMany({
    where: { studentId, deletedAt: null, group: { deletedAt: null } },
    select: { groupId: true },
  });
  const groupIds = [...new Set(enrolments.map((e) => e.groupId))];

  for (const groupId of groupIds) {
    await enqueue(tx, JOB_QUEUES.consentReevaluate, { group_id: groupId }, groupId);
  }
  return groupIds;
}
