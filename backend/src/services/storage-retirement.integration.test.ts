import { randomUUID } from 'node:crypto';
import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { afterAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import { createStorageClients, deleteObject, statObjectStrict, type StorageClients } from '../lib/storage.js';
import { createWorkerCatalog } from '../jobs/runner.js';
import { requireRetirement, reconcileRetirements, importLegacyRetirements, wakeRetirement } from '../repositories/storage-retirement.repository.js';
import { clearTestRetirements } from '../test-support/storage-retirement.js';
import { executeRetirement, acknowledgePlacementCopy } from './storage-retirement.service.js';

const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const storage = createStorageClients(config);
const owned: { contentId: string; storageKey: string }[] = [];

async function fixture(operation: 'discard_unreferenced' | 'placement_attempt' = 'discard_unreferenced') {
  const contentId = randomUUID();
  const storageKey = `content/${contentId}/${randomUUID()}/fixture.pdf`;
  owned.push({ contentId, storageKey });
  await storage.internal.send(new PutObjectCommand({ Bucket: 'private', Key: storageKey, Body: 'synthetic retirement' }));
  const record = await prisma.$transaction(async (tx) => {
    const created = await requireRetirement(tx, { contentId, bucket: 'private', storageKey, operation });
    // Deterministic execution ownership: the live API cannot consume this
    // fixture before the explicit production handler under test does.
    await tx.$executeRaw`UPDATE pgboss.job SET start_after = now() + interval '1 hour'
      WHERE name = 'content.quarantine-purge' AND data->>'retirement_id' = ${created.id}`;
    return created;
  });
  return record;
}

function failingDeletes(afterDelete: boolean): StorageClients {
  return { ...storage, internal: { send: async (command: unknown) => {
    if (command instanceof DeleteObjectCommand) {
      if (afterDelete) await storage.internal.send(command);
      throw new Error('synthetic object-store failure');
    }
    return storage.internal.send(command as never);
  } } as unknown as StorageClients['internal'] };
}

afterAll(async () => {
  await clearTestRetirements(prisma, owned.map((o) => o.contentId));
  for (const object of owned) await deleteObject(storage, 'private', object.storageKey);
  await prisma.$disconnect();
});

describe('B5 durable retirement authority against real PostgreSQL/MinIO/pg-boss', () => {
  it('persists positive copy settlement before an ambiguous delete, so absent retry can complete', async () => {
    const record = await fixture('placement_attempt');
    expect(record.copySettled).toBe(false);
    await expect(executeRetirement(prisma, failingDeletes(true), record.id)).rejects.toThrow('synthetic');
    expect(await statObjectStrict(storage, record.bucket, record.storageKey!)).toBeNull();
    expect(await prisma.storageRetirement.findUniqueOrThrow({ where: { id: record.id } }))
      .toMatchObject({ copySettled: true, completedAt: null, storageKey: record.storageKey });
    await executeRetirement(prisma, storage, record.id);
    expect((await prisma.storageRetirement.findUniqueOrThrow({ where: { id: record.id } })).completedAt).not.toBeNull();
  });

  it('never clears unknown absence, but can resolve positive evidence that no COPY was dispatched', async () => {
    const record = await fixture('placement_attempt');
    await deleteObject(storage, record.bucket, record.storageKey!);
    await executeRetirement(prisma, storage, record.id);
    expect(await prisma.storageRetirement.findUniqueOrThrow({ where: { id: record.id } }))
      .toMatchObject({ copySettled: false, completedAt: null, storageKey: record.storageKey,
        lastErrorCode: 'COPY_OUTCOME_UNKNOWN' });
    await expect(prisma.storageRetirement.update({ where: { id: record.id }, data: {
      completedAt: new Date(), storageKey: null,
    } })).rejects.toThrow(); // SQL refuses completion without settlement evidence
    await acknowledgePlacementCopy(prisma, record.id); // original caller's no-dispatch proof
    await executeRetirement(prisma, storage, record.id);
    expect((await prisma.storageRetirement.findUniqueOrThrow({ where: { id: record.id } })).completedAt).not.toBeNull();
  });

  it('serializes concurrent backlog wakeups and never duplicates an active exact operation', async () => {
    const record = await fixture();
    await prisma.$executeRaw`DELETE FROM pgboss.job WHERE name='content.quarantine-purge'
      AND data->>'retirement_id'=${record.id}`;
    let arrivals = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const outcomes = await Promise.all([1, 2].map(() => prisma.$transaction(async (tx) => {
      if (++arrivals === 2) release();
      await barrier;
      const inserted = await wakeRetirement(tx, record.id);
      await tx.$executeRaw`UPDATE pgboss.job SET start_after=now()+interval '1 hour'
        WHERE name='content.quarantine-purge' AND data->>'retirement_id'=${record.id}`;
      return inserted;
    })));
    expect(outcomes.sort()).toEqual([false, true]);
    await prisma.$executeRaw`UPDATE pgboss.job SET state='active', started_on=now()
      WHERE name='content.quarantine-purge' AND data->>'retirement_id'=${record.id}`;
    expect(await prisma.$transaction((tx) => wakeRetirement(tx, record.id))).toBe(false);
    const counts = await prisma.$queryRaw<{ count: bigint }[]>`SELECT count(*) AS count FROM pgboss.job
      WHERE name='content.quarantine-purge' AND data->>'retirement_id'=${record.id}`;
    expect(Number(counts[0]!.count)).toBe(1);
    await executeRetirement(prisma, storage, record.id);
    expect(await prisma.$transaction((tx) => wakeRetirement(tx, record.id))).toBe(false);
  });

  it('queue absence rolls back the obligation and its accompanying domain mutation', async () => {
    // Rename only the queue row within an ALWAYS-rolled-back transaction; its
    // partition and other processes remain intact. No shared state persists.
    const contentId = randomUUID();
    await expect(prisma.$transaction(async (tx) => {
      await tx.$executeRaw`DELETE FROM pgboss.schedule WHERE name='content.quarantine-purge'`;
      await tx.$executeRaw`UPDATE pgboss.queue SET name='fixture-temporarily-unavailable'
        WHERE name='content.quarantine-purge'`;
      await requireRetirement(tx, { contentId, bucket: 'private', storageKey: `content/${contentId}/test/fixture.pdf`, operation: 'discard_unreferenced' });
      throw new Error('test safety rollback: missing queue was incorrectly accepted');
    })).rejects.toThrow('pg-boss queue is not registered');
    expect(await prisma.storageRetirement.count({ where: { contentId } })).toBe(0);
  });

  it('completes through the production catalog; duplicate requests are idempotent and locators are minimized', async () => {
    const record = await fixture();
    await prisma.$executeRaw`UPDATE pgboss.job SET state='active', started_on=now()
      WHERE name='content.quarantine-purge' AND data->>'retirement_id'=${record.id}`;
    const duplicate = await prisma.$transaction((tx) => requireRetirement(tx, {
      contentId: record.contentId, bucket: record.bucket, storageKey: record.storageKey!, operation: 'discard_unreferenced',
    }));
    expect(duplicate.id).toBe(record.id);
    expect(duplicate.enqueued).toBe(false);
    const counts = await prisma.$queryRaw<{ count: bigint }[]>`SELECT count(*) AS count FROM pgboss.job
      WHERE name='content.quarantine-purge' AND data->>'retirement_id'=${record.id}`;
    expect(Number(counts[0]!.count)).toBe(1);
    const worker = createWorkerCatalog(prisma, storage, () => undefined).find((w) => w.name === 'content.quarantine-purge')!;
    await worker.handler([{ id: randomUUID(), data: { retirement_id: record.id } } as never]);
    expect(await statObjectStrict(storage, record.bucket, record.storageKey!)).toBeNull();
    expect(await prisma.storageRetirement.findUniqueOrThrow({ where: { id: record.id } }))
      .toMatchObject({ completedAt: expect.any(Date), storageKey: null });
    await executeRetirement(prisma, storage, record.id);
    const replay = await prisma.$transaction((tx) => requireRetirement(tx, {
      contentId: record.contentId, bucket: record.bucket, storageKey: record.storageKey!, operation: 'discard_unreferenced',
    }));
    expect(replay.completedAt).not.toBeNull();
  });

  it('retains failures beyond the retry budget and recovers after pg-boss history removal/restart reconciliation', async () => {
    const record = await fixture();
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await expect(executeRetirement(prisma, failingDeletes(false), record.id)).rejects.toThrow('synthetic');
    }
    await prisma.$executeRaw`DELETE FROM pgboss.job WHERE name = 'content.quarantine-purge'
      AND data->>'retirement_id' = ${record.id}`;
    expect(await prisma.storageRetirement.findUniqueOrThrow({ where: { id: record.id } }))
      .toMatchObject({ attempts: 6, completedAt: null, storageKey: record.storageKey, lastErrorCode: 'STORAGE_OPERATION_FAILED' });
    await prisma.storageRetirement.update({ where: { id: record.id }, data: { nextAttemptAt: new Date(0) } });
    expect(await reconcileRetirements(prisma)).toBeGreaterThan(0);
    await executeRetirement(prisma, storage, record.id);
    expect((await prisma.storageRetirement.findUniqueOrThrow({ where: { id: record.id } })).completedAt).not.toBeNull();
  });

  it('recovers after the store deleted bytes but its response was lost, and after a missing-object replay', async () => {
    const record = await fixture();
    await expect(executeRetirement(prisma, failingDeletes(true), record.id)).rejects.toThrow('synthetic');
    expect(await statObjectStrict(storage, record.bucket, record.storageKey!)).toBeNull();
    expect((await prisma.storageRetirement.findUniqueOrThrow({ where: { id: record.id } })).completedAt).toBeNull();
    await executeRetirement(prisma, storage, record.id);
    expect((await prisma.storageRetirement.findUniqueOrThrow({ where: { id: record.id } })).completedAt).not.toBeNull();
  });

  it('imports an exact legacy failed job before history disappears; repeated import is harmless', async () => {
    const contentId = randomUUID();
    const storageKey = `content/${contentId}/legacy/fixture.pdf`;
    owned.push({ contentId, storageKey });
    const id = randomUUID();
    await prisma.$executeRaw`INSERT INTO pgboss.job (id, name, data, state, completed_on)
      VALUES (${id}::uuid, 'content.quarantine-purge', ${JSON.stringify({ content_id: contentId, bucket: 'private', storage_key: storageKey, operation: 'manual_permanent_delete' })}::jsonb,
        'failed', now())`;
    await importLegacyRetirements(prisma);
    await importLegacyRetirements(prisma);
    const rows = await prisma.storageRetirement.findMany({ where: { contentId } });
    expect(rows).toHaveLength(1);
    await prisma.$executeRaw`DELETE FROM pgboss.job WHERE id = ${id}::uuid AND name = 'content.quarantine-purge'`;
    await executeRetirement(prisma, storage, rows[0]!.id);
    expect((await prisma.storageRetirement.findUniqueOrThrow({ where: { id: rows[0]!.id } })).completedAt).not.toBeNull();
  });
});
