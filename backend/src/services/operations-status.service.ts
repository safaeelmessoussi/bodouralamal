import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import type { Actor } from '../policies/actor.js';
import { assertFreshActive } from '../policies/freshness.policy.js';

/**
 * **What is failing quietly — told to the person who can do something about it**
 * (SRS Revision 169 §11; TD-14/TD-16 had required it and nothing provided it).
 *
 * A failed background job is durable and invisible: the recording that never
 * reached the library, the file that was never removed from storage, the purge
 * that did not run. Until now the only reader was the host's own monitor
 * (`scripts/backup/check-readiness.sh`), which speaks to whoever has SSH.
 *
 * ## One definition of «late» and «failed»
 *
 * The query below is **the monitor's own, verbatim** — the same two tables, the
 * same ten-minute grace, the same states. A second definition would be a second
 * opinion, and the day they disagreed nobody would know which to believe.
 *
 * ## Counts, and nothing else
 *
 * No job payload, no error text, no storage key, no name: a job's `data` may
 * carry ids of people and recordings, and an error message may quote a request.
 * The numbers say THAT something needs an operator; the runbook and the server's
 * logs say what (TD-14: nothing personal leaves them). Per-queue names ARE sent:
 * they are the platform's own fixed vocabulary (`jobs/runner.ts`), never data.
 *
 * ## What it cannot see, and says so
 *
 * Backup freshness and the certificate's expiry live on the HOST — the restic
 * repository and `/etc/letsencrypt` are deliberately not mounted into the API
 * container. They stay the host monitor's to watch, and the answer carries
 * `host_checks: 'not_visible_from_here'` rather than a reassuring blank.
 *
 * Super Admin only, asserted against LIVE role rows: the counts span every
 * branch, which no branch-scoped reader is shown anywhere else.
 */
export interface OperationsStatus {
  jobs: {
    failed: number;
    late: number;
    /** The queues with something failed or late, worst first. At most ten. */
    queues: { name: string; failed: number; late: number }[];
  };
  storage_retirement: { pending: number; failed: number; late: number; copy_unknown: number };
  host_checks: 'not_visible_from_here';
  checked_at: string;
}

export async function readOperationsStatus(
  prisma: PrismaClient,
  caller: Actor,
  now: Date = new Date(),
): Promise<OperationsStatus> {
  await assertFreshActive(prisma, caller.userId, ['super_admin'], caller.activeRole);

  const [backlog] = await prisma.$queryRaw<
    { pending: bigint; failed: bigint; late: bigint; copy_unknown: bigint }[]
  >(Prisma.sql`
    SELECT count(*) FILTER (WHERE completed_at IS NULL)                                   AS pending,
           count(*) FILTER (WHERE completed_at IS NULL AND last_error_code IS NOT NULL)   AS failed,
           count(*) FILTER (WHERE completed_at IS NULL
                              AND next_attempt_at < now() - interval '10 minutes')        AS late,
           count(*) FILTER (WHERE completed_at IS NULL AND NOT copy_settled)              AS copy_unknown
      FROM storage_retirement`);

  // pg-boss owns its schema and creates it when the worker first starts; an API
  // that has never had a worker beside it simply has no queue to report on.
  const present =
    (
      await prisma.$queryRaw<{ present: boolean }[]>(
        Prisma.sql`SELECT to_regclass('pgboss.job') IS NOT NULL AS present`,
      )
    )[0]?.present === true;
  const queues = present
    ? await prisma.$queryRaw<{ name: string; failed: bigint; late: bigint }[]>(Prisma.sql`
        SELECT name,
               count(*) FILTER (WHERE state = 'failed')                                    AS failed,
               count(*) FILTER (WHERE state IN ('created', 'retry')
                                  AND start_after < now() - interval '10 minutes')         AS late
          FROM pgboss.job
         GROUP BY name
        HAVING count(*) FILTER (WHERE state = 'failed') > 0
            OR count(*) FILTER (WHERE state IN ('created', 'retry')
                                  AND start_after < now() - interval '10 minutes') > 0
         ORDER BY 2 DESC, 3 DESC, 1
         LIMIT 10`)
    : [];
  const totals = present
    ? (
        await prisma.$queryRaw<{ failed: bigint; late: bigint }[]>(Prisma.sql`
          SELECT count(*) FILTER (WHERE state = 'failed')                                  AS failed,
                 count(*) FILTER (WHERE state IN ('created', 'retry')
                                    AND start_after < now() - interval '10 minutes')       AS late
            FROM pgboss.job`)
      )[0]!
    : { failed: 0n, late: 0n };

  return {
    jobs: {
      failed: Number(totals.failed),
      late: Number(totals.late),
      queues: queues.map((row) => ({ name: row.name, failed: Number(row.failed), late: Number(row.late) })),
    },
    storage_retirement: {
      pending: Number(backlog?.pending ?? 0n),
      failed: Number(backlog?.failed ?? 0n),
      late: Number(backlog?.late ?? 0n),
      copy_unknown: Number(backlog?.copy_unknown ?? 0n),
    },
    host_checks: 'not_visible_from_here',
    checked_at: now.toISOString(),
  };
}
