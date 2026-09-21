/**
 * **Re-queues the import of recordings that were made but never reached the
 * library** (SRS Revision 166 §4).
 *
 * ## Why this exists
 *
 * `session-recording-ingest` retries under TD-7's backoff and then stops. That
 * is right for a transient failure and useless for a DEFECT: from Revision 163
 * until Revision 166 every recording of a filter-built class was refused with
 * *«the occurrence resolves to no Level»*, used its four attempts on the same
 * refusal, and was left `completed` with no content — while the classroom told
 * the مؤطِّرة *«ستُعاد المحاولة تلقائيًا»*. Once the cause is fixed the staging
 * object is still there and the import is still wanted, but no job remains to
 * try it. This puts one back.
 *
 * ## What it does, exactly
 *
 * For every recording that is `completed`, not deleted, has an output object
 * recorded and has NO `educational_content_id`, it enqueues the ordinary
 * import job — the same queue, payload and singleton key the provider callback
 * uses — and clears nothing: the job's own first step is its idempotency
 * anchor, so running this twice, or beside a job that is already pending, is
 * harmless. It prints COUNTS and recording ids only — no title, no name, no key.
 *
 * `--dry-run` lists what it would queue and writes nothing.
 *
 * ## Where it may be run
 *
 * Anywhere, by an operator: it touches the job queue and no beneficiary data.
 * On Staging and Production that is still a mutation and needs the Owner's
 * authorization like any other (CLAUDE.md, *Safe implementation*).
 */
import { loadConfig } from '../src/lib/config.js';
import { createPrismaClient } from '../src/lib/prisma.js';
import { enqueue, JOB_QUEUES } from '../src/repositories/jobs.repository.js';

const dryRun = process.argv.includes('--dry-run');
const prisma = createPrismaClient(loadConfig().DATABASE_URL, 2);

const stranded = await prisma.sessionRecording.findMany({
  where: {
    status: 'completed',
    deletedAt: null,
    educationalContentId: null,
    outputKey: { not: null },
  },
  select: { id: true, ingestionFailureReason: true },
  orderBy: { startedAt: 'asc' },
});

let queued = 0;
for (const recording of stranded) {
  if (dryRun) continue;
  const inserted = await prisma.$transaction((tx) =>
    enqueue(tx, JOB_QUEUES.sessionRecordingIngest, { recording_id: recording.id }, recording.id),
  );
  if (inserted) queued += 1;
}

process.stdout.write(
  `${JSON.stringify({
    stranded: stranded.length,
    queued: dryRun ? 0 : queued,
    already_pending: dryRun ? 0 : stranded.length - queued,
    dry_run: dryRun,
    // Why each one had stopped — the platform's own refusal text, never user data.
    reasons: [...new Set(stranded.map((r) => r.ingestionFailureReason ?? '(none recorded)'))],
    recording_ids: stranded.map((r) => r.id),
  })}\n`,
);
await prisma.$disconnect();
