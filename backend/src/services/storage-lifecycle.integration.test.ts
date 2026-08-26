import { randomUUID } from 'node:crypto';

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createWorkerCatalog, TD7_RETRY_POLICY } from '../jobs/runner.js';
import { loadConfig } from '../lib/config.js';
import { quarantineKeyFor } from '../lib/file-types.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import {
  BUCKETS,
  createStorageClients,
  listObjectsPage,
  statObjectStrict,
  type StorageClients,
} from '../lib/storage.js';
import type { Actor } from '../policies/actor.js';
import { JOB_QUEUES } from '../repositories/jobs.repository.js';
import {
  collectAbandonedUploadPage,
  type UploadGcPayload,
  UPLOAD_GC_MIN_AGE_MS,
} from './storage-lifecycle.service.js';
import { completeUpload, initiateUpload } from './content.service.js';
import { purgeEntry } from './trash.service.js';

/**
 * Destructive storage-lifecycle proof. It is intentionally excluded from a
 * shared development stack: the age sweep must be free to inspect its complete
 * prefixes, so `scripts/storage/verify-storage-lifecycle.sh` gives it uniquely
 * named disposable PostgreSQL/MinIO volumes and opts in explicitly.
 */
const enabled = process.env.STORAGE_LIFECYCLE_DESTRUCTIVE_FIXTURE === '1';
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const storage = createStorageClients(config);
const TAG = '[storage-lifecycle-drill]';

let boss: PgBoss;
let actor: Actor;
let levelId: string;
let subjectId: string;
let academicYearId: string;

async function put(bucket: string, key: string, body: string): Promise<void> {
  await storage.internal.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: Buffer.from(body) }),
  );
}

async function lastModified(bucket: string, key: string): Promise<Date> {
  const page = await listObjectsPage(storage, bucket, key, { maxKeys: 10 });
  const found = page.objects.find((object) => object.key === key)?.lastModified;
  if (!found) throw new Error(`fixture object has no LastModified: ${bucket}/${key}`);
  return found;
}

async function contentFixture(label: string): Promise<{
  contentId: string;
  storageKey: string;
  trashId: string;
}> {
  const contentId = randomUUID();
  const storageKey = `content/${contentId}/${label}/file.pdf`;
  const deletedAt = new Date();
  await prisma.educationalContent.create({
    data: {
      id: contentId,
      title: `${TAG} ${label}`,
      visibility: 'private',
      levelId,
      subjectId,
      academicYearId,
      storageBucket: BUCKETS.private,
      storageKey,
      originalFilename: 'file.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 12n,
      deletedAt,
      deletedById: actor.userId,
    },
  });
  const trash = await prisma.trash.create({
    data: {
      targetEntity: 'EducationalContent',
      targetId: contentId,
      snapshot: {
        id: contentId,
        title: `${TAG} ${label}`,
        storageBucket: BUCKETS.private,
        storageKey,
        sizeBytes: '12',
        deletedAt: deletedAt.toISOString(),
      },
      deletedById: actor.userId,
      purgeAfter: new Date(deletedAt.getTime() + 90 * 24 * 60 * 60 * 1_000),
    },
  });
  return { contentId, storageKey, trashId: trash.id };
}

async function jobRow(contentId: string): Promise<{
  id: string;
  state: string;
  retry_count: number;
  retry_limit: number | null;
  retry_backoff: boolean | null;
  operation: string | null;
  storage_key: string | null;
}> {
  const rows = await prisma.$queryRaw<
    {
      id: string;
      state: string;
      retry_count: number;
      retry_limit: number | null;
      retry_backoff: boolean | null;
      operation: string | null;
      storage_key: string | null;
    }[]
  >`
    SELECT id::text, state::text, retry_count, retry_limit, retry_backoff,
           data->>'operation' AS operation, data->>'storage_key' AS storage_key
    FROM pgboss.job
    WHERE name = ${JOB_QUEUES.contentQuarantinePurge}
      AND data->>'content_id' = ${contentId}
    ORDER BY created_on DESC
    LIMIT 1
  `;
  if (!rows[0]) throw new Error(`no lifecycle job for ${contentId}`);
  return rows[0];
}

async function waitForTerminal(contentId: string): Promise<ReturnType<typeof jobRow> extends Promise<infer T> ? T : never> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const row = await jobRow(contentId);
    if (row.state === 'completed' || row.state === 'failed') return row;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`lifecycle job did not reach terminal state for ${contentId}`);
}

describe.skipIf(!enabled)('P0.3 durable storage lifecycle on disposable PostgreSQL/MinIO', () => {
  beforeAll(async () => {
    boss = new PgBoss({ connectionString: config.DATABASE_URL, max: 2 });
    await boss.start();
    await boss.createQueue(JOB_QUEUES.contentQuarantinePurge, TD7_RETRY_POLICY);
    await boss.updateQueue(JOB_QUEUES.contentQuarantinePurge, TD7_RETRY_POLICY);

    const role = await prisma.role.create({ data: { name: 'super_admin' } });
    const user = await prisma.user.create({
      data: { nameArabic: `${TAG} actor`, sex: 'female', accountStatus: 'active' },
    });
    await prisma.userBranchRole.create({
      data: { userId: user.id, roleId: role.id, branchId: null },
    });
    actor = {
      userId: user.id,
      roles: ['super_admin'],
      activeRole: 'super_admin',
      accountStatus: 'active',
      roleScopes: [{ role: 'super_admin', branches: null }],
    };
    const category = await prisma.category.create({ data: { name: `${TAG} category` } });
    levelId = (
      await prisma.level.create({
        data: { name: `${TAG} level`, categoryId: category.id },
      })
    ).id;
    subjectId = (
      await prisma.subject.create({ data: { name: `${TAG} subject` } })
    ).id;
    await prisma.levelSubject.create({ data: { levelId, subjectId } });
    academicYearId = (
      await prisma.academicYear.create({ data: { label: '2098-2099' } })
    ).id;
  });

  afterAll(async () => {
    if (boss) await boss.stop({ graceful: true });
    await prisma.$disconnect();
  });

  it('walks all staging scopes in bounded pages, retains the 48-hour boundary, and never touches canonical keys', async () => {
    const paginated = Array.from({ length: 251 }, (_, index) => ({
      bucket: BUCKETS.public,
      key: `staging/content/${TAG}/page-${String(index).padStart(3, '0')}.pdf`,
    }));
    const old = [
      { bucket: BUCKETS.public, key: `staging/content/${TAG}/public-old.pdf` },
      { bucket: BUCKETS.private, key: `staging/content/${TAG}/private-old.pdf` },
      {
        bucket: BUCKETS.private,
        key: `staging/server-finalization/${TAG}/server-old`,
      },
    ];
    for (let index = 0; index < paginated.length; index += 25) {
      await Promise.all(
        paginated
          .slice(index, index + 25)
          .map((object) => put(object.bucket, object.key, 'paginated-abandoned')),
      );
    }
    for (const object of old) await put(object.bucket, object.key, 'abandoned');
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const boundary = {
      bucket: BUCKETS.public,
      key: `staging/content/${TAG}/boundary.pdf`,
    };
    await put(boundary.bucket, boundary.key, 'still-protected');
    const cutoff = await lastModified(boundary.bucket, boundary.key);
    const canonical = `content/${randomUUID()}/current/file.pdf`;
    await put(BUCKETS.private, canonical, 'canonical-must-survive');

    let payload: UploadGcPayload | null = {
      run_id: 'fixture-run',
      cutoff: cutoff.toISOString(),
      scope_index: 0,
    };
    let page = 0;
    let sawRealContinuation = false;
    while (payload !== null) {
      const result = await collectAbandonedUploadPage(
        storage,
        payload,
        `fixture-page-${page}`,
        new Date(cutoff.getTime() + UPLOAD_GC_MIN_AGE_MS),
      );
      sawRealContinuation ||= result.next?.continuation_token !== undefined;
      payload = result.next;
      page += 1;
      expect(page).toBeLessThan(10);
    }

    expect(sawRealContinuation).toBe(true);
    expect(page).toBeGreaterThanOrEqual(4);
    for (const object of old) {
      expect(await statObjectStrict(storage, object.bucket, object.key)).toBeNull();
    }
    expect(
      await statObjectStrict(storage, paginated[0]!.bucket, paginated[0]!.key),
    ).toBeNull();
    expect(
      await statObjectStrict(storage, paginated.at(-1)!.bucket, paginated.at(-1)!.key),
    ).toBeNull();
    expect(await statObjectStrict(storage, boundary.bucket, boundary.key)).not.toBeNull();
    expect(await statObjectStrict(storage, BUCKETS.private, canonical)).not.toBeNull();
  });

  it('rolls back database destruction if its durable queue is absent', async () => {
    const fixture = await contentFixture('queue-missing');
    await boss.deleteQueue(JOB_QUEUES.contentQuarantinePurge);

    await expect(purgeEntry(prisma, actor, fixture.trashId)).rejects.toThrow(
      /queue is not registered/,
    );
    expect(
      await prisma.educationalContent.count({ where: { id: fixture.contentId } }),
    ).toBe(1);
    expect(await prisma.trash.count({ where: { id: fixture.trashId } })).toBe(1);

    await boss.createQueue(JOB_QUEUES.contentQuarantinePurge, TD7_RETRY_POLICY);
    await boss.updateQueue(JOB_QUEUES.contentQuarantinePurge, TD7_RETRY_POLICY);
  });

  it('turns replacement quarantine failure into an exact durable retry without touching the new canonical key', async () => {
    const contentId = randomUUID();
    const oldKey = `content/${contentId}/old/file.pdf`;
    const oldBytes = Buffer.from('%PDF-1.7\nold canonical bytes');
    await put(BUCKETS.private, oldKey, oldBytes.toString());
    await prisma.educationalContent.create({
      data: {
        id: contentId,
        title: `${TAG} replacement source`,
        visibility: 'private',
        levelId,
        subjectId,
        academicYearId,
        storageBucket: BUCKETS.private,
        storageKey: oldKey,
        originalFilename: 'old.pdf',
        mimeType: 'application/pdf',
        sizeBytes: BigInt(oldBytes.length),
      },
    });
    const replacementBytes = Buffer.from('%PDF-1.7\nnew immutable canonical bytes');
    const initiated = await initiateUpload(prisma, storage, config.JWT_SIGNING_KEY, actor, {
      filename: 'replacement.pdf',
      size: replacementBytes.length,
      mime: 'application/pdf',
      meta: {
        levelId,
        subjectId,
        academicYearId,
        branchId: null,
        replacesContentId: contentId,
      },
    });
    const putResponse = await fetch(initiated.putUrl, {
      method: 'PUT',
      body: replacementBytes,
      headers: { 'content-type': 'application/pdf' },
    });
    expect(putResponse.status).toBe(200);

    const failedFastPath: StorageClients = {
      ...storage,
      internal: {
        send: async (command: unknown, options?: unknown) => {
          if (
            command instanceof CopyObjectCommand &&
            command.input.CopySource?.includes(oldKey)
          ) {
            throw new Error('fixture quarantine copy unavailable');
          }
          return storage.internal.send(command as never, options as never);
        },
      } as never,
    };
    await completeUpload(
      prisma,
      failedFastPath,
      config.JWT_SIGNING_KEY,
      actor,
      initiated.uploadId,
      { title: `${TAG} replacement`, description: null },
    );

    const current = await prisma.educationalContent.findUniqueOrThrow({
      where: { id: contentId },
      select: { storageKey: true },
    });
    expect(current.storageKey).not.toBe(oldKey);
    expect(await statObjectStrict(storage, BUCKETS.private, oldKey)).not.toBeNull();
    expect(
      await statObjectStrict(storage, BUCKETS.private, quarantineKeyFor(contentId, oldKey)),
    ).toBeNull();
    expect(await jobRow(contentId)).toMatchObject({
      state: 'created',
      operation: 'quarantine_retired_object',
      storage_key: oldKey,
      retry_limit: TD7_RETRY_POLICY.retryLimit,
    });

    const worker = createWorkerCatalog(prisma, storage, () => undefined).find(
      (candidate) => candidate.name === JOB_QUEUES.contentQuarantinePurge,
    );
    if (!worker) throw new Error('content.quarantine-purge missing from production catalog');
    await boss.work(JOB_QUEUES.contentQuarantinePurge, worker.handler);
    expect((await waitForTerminal(contentId)).state).toBe('completed');
    await boss.offWork(JOB_QUEUES.contentQuarantinePurge);

    expect(await statObjectStrict(storage, BUCKETS.private, oldKey)).toBeNull();
    expect(
      await statObjectStrict(storage, BUCKETS.private, quarantineKeyFor(contentId, oldKey)),
    ).not.toBeNull();
    expect(await statObjectStrict(storage, BUCKETS.private, current.storageKey)).not.toBeNull();
  });

  it('commits exact retirement with purge, retries an ambiguous delete, and cannot touch a newer key', async () => {
    const fixture = await contentFixture('durable-purge');
    const quarantineKey = quarantineKeyFor(fixture.contentId, fixture.storageKey);
    const newerKey = `content/${fixture.contentId}/newer/file.pdf`;
    await put(BUCKETS.private, fixture.storageKey, 'old-canonical');
    await put(BUCKETS.private, quarantineKey, 'old-quarantine');
    await put(BUCKETS.private, newerKey, 'newer-canonical');

    await purgeEntry(prisma, actor, fixture.trashId);
    expect(
      await prisma.educationalContent.count({ where: { id: fixture.contentId } }),
    ).toBe(0);
    expect(await prisma.trash.count({ where: { id: fixture.trashId } })).toBe(0);
    expect(await jobRow(fixture.contentId)).toMatchObject({
      state: 'created',
      retry_limit: TD7_RETRY_POLICY.retryLimit,
      retry_backoff: true,
    });

    // The database job, not this process, owns the obligation. A complete
    // runner stop/restart before first execution must retain it unchanged.
    await boss.stop({ graceful: true });
    boss = new PgBoss({ connectionString: config.DATABASE_URL, max: 2 });
    await boss.start();
    await boss.createQueue(JOB_QUEUES.contentQuarantinePurge, TD7_RETRY_POLICY);
    await boss.updateQueue(JOB_QUEUES.contentQuarantinePurge, TD7_RETRY_POLICY);

    let loseFirstDeleteResponse = true;
    const ambiguousStorage: StorageClients = {
      ...storage,
      internal: {
        send: async (command: unknown, options?: unknown) => {
          const result = await storage.internal.send(command as never, options as never);
          if (command instanceof DeleteObjectCommand && loseFirstDeleteResponse) {
            loseFirstDeleteResponse = false;
            throw new Error('fixture lost delete response');
          }
          return result;
        },
      } as never,
    };
    const worker = createWorkerCatalog(prisma, ambiguousStorage, () => undefined).find(
      (candidate) => candidate.name === JOB_QUEUES.contentQuarantinePurge,
    );
    if (!worker) throw new Error('content.quarantine-purge missing from production catalog');
    await boss.work(JOB_QUEUES.contentQuarantinePurge, worker.handler);

    const terminal = await waitForTerminal(fixture.contentId);
    expect(terminal.state).toBe('completed');
    expect(terminal.retry_count).toBeGreaterThanOrEqual(1);
    expect(await statObjectStrict(storage, BUCKETS.private, fixture.storageKey)).toBeNull();
    expect(await statObjectStrict(storage, BUCKETS.private, quarantineKey)).toBeNull();
    expect(await statObjectStrict(storage, BUCKETS.private, newerKey)).not.toBeNull();

    // Model the last possible interleaving: an already-fetched stale
    // quarantine job copies its exact old source after permanent purge. The
    // production handler's post-move row check must make destruction monotonic
    // and remove that recreated quarantine object, never the newer key.
    await put(BUCKETS.private, fixture.storageKey, 'late stale old bytes');
    const staleJobId = await boss.send(JOB_QUEUES.contentQuarantinePurge, {
      operation: 'quarantine_retired_object',
      content_id: fixture.contentId,
      bucket: BUCKETS.private,
      storage_key: fixture.storageKey,
    });
    expect(staleJobId).not.toBeNull();
    expect((await waitForTerminal(fixture.contentId)).state).toBe('completed');
    expect(await statObjectStrict(storage, BUCKETS.private, fixture.storageKey)).toBeNull();
    expect(await statObjectStrict(storage, BUCKETS.private, quarantineKey)).toBeNull();
    expect(await statObjectStrict(storage, BUCKETS.private, newerKey)).not.toBeNull();
    await boss.offWork(JOB_QUEUES.contentQuarantinePurge);
  });
});
