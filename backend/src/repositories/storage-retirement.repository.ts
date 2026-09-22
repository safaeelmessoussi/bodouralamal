import { AppError } from '../lib/errors.js';
import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { assertQueueRegistered, enqueue, JOB_QUEUES, legacyStorageJobs } from './jobs.repository.js';

export type RetirementOperation = 'quarantine_retired_object' | 'manual_permanent_delete' |
  'discard_unreferenced' | 'placement_attempt' | 'retire_public' | 'consent_migrate';
export interface RetirementInput {
  contentId: string;
  bucket: string;
  storageKey: string;
  operation: RetirementOperation;
}

/** Operational locator, never an audit payload. Drop it on completion. */
export async function requireRetirement(tx: Prisma.TransactionClient, input: RetirementInput, renewResolved = false) {
  if (!['public', 'private'].includes(input.bucket) ||
      !input.storageKey.startsWith(`content/${input.contentId}/`)) {
    // A coded refusal, not a crash: a row whose key is not `content/<id>/…`
    // cannot be given a storage obligation, and the person deleting it must
    // be told so rather than shown «حدث خطأ غير متوقع» (Staging, 2026-09-22:
    // four fixture rows keyed `content/fixture-N/…`). The row is untouched.
    throw new AppError('STATE_CONFLICT', 'this item has no canonical storage coordinate', {
      reason: 'NON_CANONICAL_COORDINATE',
    });
  }
  const dedupKey = createHash('sha256').update(JSON.stringify([
    'storage-retirement-v1', input.operation, input.bucket, input.storageKey,
  ])).digest('hex');
  const inserted = await tx.storageRetirement.createMany({
    data: [{ ...input, dedupKey, copySettled: input.operation !== 'placement_attempt' }], skipDuplicates: true,
  });
  let needsWake = inserted.count === 1;
  let record = await tx.storageRetirement.findUniqueOrThrow({ where: { dedupKey } });
  // A supported restore can make the same immutable bytes canonical again.
  // Only a new, Content-locked domain transition renews a resolved obligation;
  // duplicate deliveries and legacy imports never reopen completed work.
  if (renewResolved && record.completedAt !== null) {
    record = await tx.storageRetirement.update({ where: { id: record.id }, data: {
      completedAt: null, storageKey: input.storageKey, nextAttemptAt: new Date(), lastErrorCode: null,
      copySettled: input.operation !== 'placement_attempt',
    } });
    needsWake = true;
  }
  // One wakeup belongs to the new domain obligation, not to every caller that
  // rediscovers it while its worker is active. Recovery re-enqueues explicitly
  // from the durable backlog, independently of pg-boss delivery history.
  const enqueued = needsWake ? await wakeRetirement(tx, record.id) : false;
  if (!needsWake && record.completedAt === null) await assertQueueRegistered(tx, retirementQueue(record.operation));
  return { ...record, enqueued };
}

function retirementQueue(operation: string) {
  return ['consent_migrate', 'retire_public'].includes(operation)
    ? JOB_QUEUES.contentBucketMigrate : JOB_QUEUES.contentQuarantinePurge;
}

export async function wakeRetirement(tx: Prisma.TransactionClient, id: string): Promise<boolean> {
  // Concurrent startup/daily reconcilers share this serialization anchor.
  // pg-boss's ordinary queue does not uniquely constrain singleton_key.
  await lockRetirement(tx, id);
  const record = await tx.storageRetirement.findUniqueOrThrow({ where: { id },
    select: { operation: true, contentId: true, completedAt: true } });
  if (record.completedAt !== null) return false;
  return enqueue(tx, retirementQueue(record.operation), { retirement_id: id, content_id: record.contentId,
    ...(record.operation === 'consent_migrate' ? {} : { operation: record.operation }) }, `retirement:${id}`,
    record.operation === 'placement_attempt' ? 30 : 0, true);
}

export const findRetirement = (db: PrismaClient | Prisma.TransactionClient, id: string) =>
  db.storageRetirement.findUnique({ where: { id } });

export const currentContent = (tx: Prisma.TransactionClient, id: string) =>
  tx.educationalContent.findUnique({ where: { id } });

export async function lockRetirement(tx: Prisma.TransactionClient, id: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM storage_retirement WHERE id = ${id}::uuid FOR UPDATE`;
}

export async function completeRetirement(
  tx: Prisma.TransactionClient,
  id: string,
  /** A fixed code saying WHY a completion did no work (R170 §3's withdrawn
   *  consent migration); `null` — the ordinary case — is a completion that did. */
  reason: string | null = null,
): Promise<void> {
  await tx.storageRetirement.updateMany({
    where: { id, completedAt: null },
    data: { completedAt: new Date(), storageKey: null, lastErrorCode: reason },
  });
}

/** Persist proof BEFORE destructive I/O, so a lost delete reply cannot erase
 * the fact that the one possible placement write has already settled. */
export async function settlePlacementCopy(tx: Prisma.TransactionClient, id: string): Promise<void> {
  await tx.storageRetirement.updateMany({
    where: { id, operation: 'placement_attempt', completedAt: null },
    data: { copySettled: true, lastErrorCode: null, nextAttemptAt: new Date() },
  });
}

export async function recordRetirementFailure(prisma: PrismaClient | Prisma.TransactionClient, id: string,
  code: 'STORAGE_OPERATION_FAILED' | 'COPY_OUTCOME_UNKNOWN' = 'STORAGE_OPERATION_FAILED'): Promise<void> {
  await prisma.storageRetirement.updateMany({
    where: { id, completedAt: null },
    data: { attempts: { increment: 1 }, lastErrorCode: code,
      nextAttemptAt: new Date(Date.now() + 5 * 60_000) },
  });
}

/** Keyset pages, independent of whether the execution job exists or is failed. */
export async function reconcileRetirements(prisma: PrismaClient): Promise<number> {
  const now = new Date();
  let cursor: string | undefined;
  let count = 0;
  for (;;) {
    const rows = await prisma.storageRetirement.findMany({
      where: { completedAt: null, nextAttemptAt: { lte: now }, ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: 'asc' }, take: 250, select: { id: true },
    });
    if (rows.length === 0) return count;
    // Release each retirement lock before taking another: domain publication
    // may need an attempt and its source, and must not deadlock with a page.
    for (const row of rows) {
      if (await prisma.$transaction((tx) => wakeRetirement(tx, row.id))) count += 1;
    }
    cursor = rows.at(-1)!.id;
  }
}

/** Old jobs are imported before workers start. Their retention is no longer
 * authority after import. Malformed coordinates fail startup visibly. */
export async function importLegacyRetirements(prisma: PrismaClient): Promise<void> {
  let cursor: string | undefined;
  for (;;) {
    const rows = await legacyStorageJobs(prisma, cursor);
    if (rows.length === 0) return;
    for (const row of rows) {
      await prisma.$transaction((tx) => importLegacyRetirement(tx, row.data));
    }
    cursor = rows.at(-1)!.id;
  }
}

export async function importLegacyRetirement(tx: Prisma.TransactionClient, data: Prisma.JsonObject) {
  const operation = data['operation'] ?? 'consent_migrate';
  const contentId = data['content_id'];
  const storageKey = data['storage_key'] ?? data['source_key'];
  const bucket = data['bucket'] ?? 'public';
  if (!['quarantine_retired_object', 'manual_permanent_delete', 'retire_public', 'consent_migrate'].includes(String(operation)) ||
      typeof contentId !== 'string' || typeof bucket !== 'string' || typeof storageKey !== 'string') {
    throw new Error('invalid legacy retirement obligation');
  }
  return requireRetirement(tx, { contentId, storageKey, bucket, operation: operation as RetirementOperation });
}

/**
 * **Is a quarantined object of this content still OWED to something?** (R170 §10)
 *
 * The 90-day sweep deletes by age, so it asks first. Two things own such an
 * object: a Trash entry for the item (its own purge destroys the object, and a
 * restore brings it back — the sweep must pre-empt neither), and an exact
 * storage obligation that has not finished.
 */
export async function quarantinedObjectIsOwed(
  db: PrismaClient | Prisma.TransactionClient,
  contentId: string,
): Promise<boolean> {
  const [trashed, pending] = await Promise.all([
    db.trash.count({ where: { targetEntity: 'EducationalContent', targetId: contentId } }),
    db.storageRetirement.count({ where: { contentId, completedAt: null } }),
  ]);
  return trashed > 0 || pending > 0;
}
