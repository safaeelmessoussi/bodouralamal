import { createHash, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { PgBoss } from 'pg-boss';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../app.js';
import { TD7_RETRY_POLICY } from '../jobs/runner.js';
import { issueAccessToken } from '../lib/access-token.js';
import { loadConfig } from '../lib/config.js';
import { hashStoredObject } from '../lib/object-verification.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import {
  BUCKETS,
  createStorageClients,
  deleteObject,
  statObjectStrict,
  type StorageClients,
} from '../lib/storage.js';
import {
  ensureDurableLegacyFollowup,
  JOB_QUEUES,
} from '../repositories/jobs.repository.js';
import * as audit from '../repositories/audit.repository.js';
import {
  clearTeachingContext,
  createTeachingContext,
  enrol,
  type TeachingFixture,
} from '../test-support/educational-fixture.js';
import {
  captureConsentVersion,
  restoreConsentVersion,
  type SavedConsentVersion,
} from '../test-support/consent-setting.js';
import { CONSENT_TEXT_VERSION_KEY } from './registration.service.js';
import { visibleContentIds } from './library.service.js';
import {
  enqueueConsentReevaluationForStudent,
  migrateConsentForcedContent,
  reevaluateSessionConsent,
} from './consent-reevaluation.service.js';

/**
 * B-01 against real PostgreSQL, MinIO and pg-boss.
 *
 * These tests exercise the boundary mocks cannot prove: anonymous public bytes,
 * server-side copy metadata, full-stream SHA-256 equality, public-object
 * retirement, same-transaction pg-boss rows, retry, and process restart.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const clients = createStorageClients(config);
const TAG = '[b01-consent-safeguarding]';

interface Scenario {
  branchId: string;
  fixture: TeachingFixture;
  studentId: string;
  actorId: string;
  contentId: string;
  key: string;
  bytes: Buffer;
}

const trackedObjects = new Map<string, { bucket: string; key: string }>();
const trackedContentIds = new Set<string>();
const trackedUserIds = new Set<string>();
let server: Server;
let apiBase: string;
let savedConsentVersion: SavedConsentVersion;

function track(bucket: string, key: string): void {
  trackedObjects.set(`${bucket}\0${key}`, { bucket, key });
}

function publicObjectUrl(key: string): string {
  return `${config.MINIO_ENDPOINT}/${BUCKETS.public}/${key}`;
}

function canonicalBytes(label: string): Buffer {
  return Buffer.from(`%PDF-1.7\n${label}\n${'safe-canonical-bytes'.repeat(64)}`);
}

async function putCanonical(bucket: string, key: string, bytes: Buffer): Promise<void> {
  track(bucket, key);
  await clients.internal.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: bytes,
      ContentType: 'application/pdf',
    }),
  );
}

async function person(label: string): Promise<string> {
  const row = await prisma.user.create({
    data: {
      nameArabic: `${TAG} ${label}`,
      sex: 'female',
      accountStatus: 'active',
    },
  });
  trackedUserIds.add(row.id);
  return row.id;
}

async function scenario(label: string): Promise<Scenario> {
  const branch = await prisma.branch.create({
    data: {
      name: `${TAG} ${label} branch`,
      operationalStartDate: new Date('2026-01-01'),
    },
  });
  const fixture = await createTeachingContext(prisma, `${TAG} ${label}`, branch.id);
  const studentId = await person(`${label} student`);
  const actorId = await person(`${label} consent actor`);
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'admin' } });
  await prisma.userBranchRole.create({
    data: { userId: actorId, roleId: adminRole.id, branchId: branch.id },
  });
  await enrol(prisma, fixture, studentId);
  await prisma.consentRecord.create({
    data: {
      studentId,
      consentType: 'media_release',
      granted: true,
      method: 'staff_recorded',
      consentTextVersion: 'b01-test-v1',
      grantedByUserId: actorId,
    },
  });

  const contentId = randomUUID();
  const key = `content/${contentId}/b01-${label}.pdf`;
  const bytes = canonicalBytes(label);
  await putCanonical(BUCKETS.public, key, bytes);
  const academicYear = await prisma.academicYear.findFirstOrThrow({ select: { id: true } });
  await prisma.educationalContent.create({
    data: {
      id: contentId,
      title: `${TAG} ${label} recording`,
      visibility: 'public',
      consentForcedPrivate: false,
      levelId: fixture.levelId,
      branchId: branch.id,
      subjectId: fixture.subjectId,
      academicYearId: academicYear.id,
      origin: 'session_recording',
      storageBucket: BUCKETS.public,
      storageKey: key,
      originalFilename: `${label}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: BigInt(bytes.length),
    },
  });
  await prisma.sessionContent.create({
    data: { sessionId: fixture.sessionId, contentId },
  });
  trackedContentIds.add(contentId);
  return {
    branchId: branch.id,
    fixture,
    studentId,
    actorId,
    contentId,
    key,
    bytes,
  };
}

async function decide(
  s: Scenario,
  granted: boolean,
): Promise<string[]> {
  return prisma.$transaction(async (tx) => {
    await tx.consentRecord.create({
      data: {
        studentId: s.studentId,
        consentType: 'media_release',
        granted,
        method: 'staff_recorded',
        consentTextVersion: 'b01-test-v1',
        grantedByUserId: s.actorId,
        ...(granted
          ? {}
          : { revokedAt: new Date(), revokedByUserId: s.actorId }),
      },
    });
    return enqueueConsentReevaluationForStudent(tx, s.studentId);
  });
}

function failingPublicDelete(
  base: StorageClients,
  key: string,
  mode: 'before' | 'after',
): StorageClients {
  let failed = false;
  const internal = {
    send: async (command: unknown): Promise<unknown> => {
      if (
        !failed &&
        command instanceof DeleteObjectCommand &&
        command.input.Bucket === BUCKETS.public &&
        command.input.Key === key
      ) {
        failed = true;
        if (mode === 'before') throw new Error('controlled transient public-delete failure');
        await base.internal.send(command);
        throw new Error('controlled ambiguous delete response after success');
      }
      return base.internal.send(command as never);
    },
  } as unknown as StorageClients['internal'];
  return { ...base, internal };
}

async function jobCount(queue: string, field: string, value: string): Promise<number> {
  const rows = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT count(*)::bigint AS count
    FROM pgboss.job
    WHERE name = ${queue} AND data->>${field} = ${value}
  `;
  return Number(rows[0]?.count ?? 0);
}

async function waitUntil(
  predicate: () => Promise<boolean>,
  description: string,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${description}`);
}

function boss(): PgBoss {
  const instance = new PgBoss({ connectionString: config.DATABASE_URL, max: 2 });
  instance.on('error', () => undefined);
  return instance;
}

async function cleanup(): Promise<void> {
  const contentIds = [...trackedContentIds];
  const userIds = [...trackedUserIds];
  if (contentIds.length > 0) {
    await prisma.$executeRaw`
      DELETE FROM pgboss.job
      WHERE (name = ${JOB_QUEUES.contentBucketMigrate}
             AND data->>'content_id' = ANY(${contentIds}::text[]))
    `;
  }
  const taggedSessions = await prisma.session.findMany({
    where: { schedule: { subject: { name: { startsWith: TAG } } } },
    select: { id: true },
  });
  if (taggedSessions.length > 0) {
    const sessionIds = taggedSessions.map((row) => row.id);
    await prisma.$executeRaw`
      DELETE FROM pgboss.job
      WHERE name = ${JOB_QUEUES.consentReevaluate}
        AND data->>'session_id' = ANY(${sessionIds}::text[])
    `;
  }
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        ...(contentIds.length === 0 ? [] : [{ targetId: { in: contentIds } }]),
        ...(userIds.length === 0
          ? []
          : [{ actorUserId: { in: userIds } }, { targetId: { in: userIds } }]),
      ],
    },
  });
  await prisma.sessionContent.deleteMany({ where: { contentId: { in: contentIds } } });
  await prisma.educationalContent.deleteMany({ where: { id: { in: contentIds } } });
  await prisma.consentRecord.deleteMany({
    where: {
      OR: [
        { studentId: { in: userIds } },
        { grantedByUserId: { in: userIds } },
        { revokedByUserId: { in: userIds } },
      ],
    },
  });
  await clearTeachingContext(prisma, TAG);
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
  for (const object of trackedObjects.values()) {
    await deleteObject(clients, object.bucket, object.key).catch(() => undefined);
    // A migration writes the same key in private without going through `track`.
    await deleteObject(clients, BUCKETS.private, object.key).catch(() => undefined);
  }
  trackedObjects.clear();
  trackedContentIds.clear();
  trackedUserIds.clear();
}

beforeAll(async () => {
  // Same deployment prerequisite as `startJobRunner`: pg-boss partitions jobs
  // by registered queue name, so transactional inserts require both catalog
  // queues to exist before application writes begin.
  const setup = boss();
  await setup.start();
  try {
    await setup.createQueue(JOB_QUEUES.consentReevaluate, TD7_RETRY_POLICY);
    await setup.createQueue(JOB_QUEUES.contentBucketMigrate, TD7_RETRY_POLICY);
    await setup.updateQueue(JOB_QUEUES.consentReevaluate, TD7_RETRY_POLICY);
    await setup.updateQueue(JOB_QUEUES.contentBucketMigrate, TD7_RETRY_POLICY);
  } finally {
    await setup.stop({ graceful: true });
  }
  savedConsentVersion = await captureConsentVersion(prisma);
  await prisma.systemSetting.upsert({
    where: { key: CONSENT_TEXT_VERSION_KEY },
    update: { value: 'b01-test-v1' },
    create: { key: CONSENT_TEXT_VERSION_KEY, value: 'b01-test-v1' },
  });
  server = createServer(
    createApp(prisma, config, {
      snapshot: () => ({
        state: 'ok',
        reason: 'ready',
        expected_workers: 7,
        registered_workers: 7,
        active_workers: 7,
      }),
    }),
  );
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  apiBase = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
});
beforeEach(cleanup);
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await cleanup();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await restoreConsentVersion(prisma, savedConsentVersion);
  await prisma.$disconnect();
});

describe('B-01 consent safeguarding', () => {
  it('closes the real HTTP consent-withdrawal flow and preserves authorized private mint', async () => {
    const s = await scenario('http-withdrawal');
    const token = issueAccessToken(
      {
        userId: s.actorId,
        roleScopes: [{ role: 'admin', branches: [s.branchId] }],
        accountStatus: 'active',
      },
      config.JWT_SIGNING_KEY,
    ).token;
    const withdrawn = await fetch(`${apiBase}/students/${s.studentId}/consents`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        consent_type: 'media_release',
        granted: false,
        note: 'B-01 synthetic HTTP verification',
      }),
    });
    expect(withdrawn.status).toBe(201);
    expect(await withdrawn.json()).toMatchObject({ sessions_reevaluated: 1 });
    expect(
      await jobCount(JOB_QUEUES.consentReevaluate, 'session_id', s.fixture.sessionId),
    ).toBeGreaterThan(0);

    await reevaluateSessionConsent(prisma, s.fixture.sessionId);
    expect(await visibleContentIds(prisma, null, [s.contentId])).toEqual(new Set());
    await migrateConsentForcedContent(prisma, clients, s.contentId);
    expect((await fetch(publicObjectUrl(s.key))).status).toBe(404);

    const mint = await fetch(`${apiBase}/content/${s.contentId}/download-url`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(mint.status).toBe(200);
    expect(await mint.json()).toMatchObject({ expires_in: 600 });
  });

  it('withdrawal durably closes the application gate and migrates identical canonical bytes', async () => {
    const s = await scenario('withdrawal');
    expect((await fetch(publicObjectUrl(s.key))).status).toBe(200);
    expect(await visibleContentIds(prisma, null, [s.contentId])).toEqual(
      new Set([s.contentId]),
    );

    expect(await decide(s, false)).toContain(s.fixture.sessionId);
    expect(
      await jobCount(JOB_QUEUES.consentReevaluate, 'session_id', s.fixture.sessionId),
    ).toBeGreaterThan(0);

    const reevaluated = await reevaluateSessionConsent(prisma, s.fixture.sessionId);
    expect(reevaluated).toMatchObject({
      recordingsInspected: 1,
      recordingsForced: 1,
      migrationsEnqueued: 1,
    });
    const pending = await prisma.educationalContent.findUniqueOrThrow({
      where: { id: s.contentId },
    });
    expect(pending).toMatchObject({
      visibility: 'public',
      storageBucket: BUCKETS.public,
      consentForcedPrivate: true,
    });
    // Explicit pending lifecycle: application reads fail closed while the
    // physical public object still exists for the durable copy worker.
    expect(await visibleContentIds(prisma, null, [s.contentId])).toEqual(new Set());
    expect((await fetch(publicObjectUrl(s.key))).status).toBe(200);

    expect(await migrateConsentForcedContent(prisma, clients, s.contentId)).toMatchObject({
      state: 'completed',
    });
    const completed = await prisma.educationalContent.findUniqueOrThrow({
      where: { id: s.contentId },
    });
    expect(completed).toMatchObject({
      visibility: 'private',
      storageBucket: BUCKETS.private,
      storageKey: s.key,
      consentForcedPrivate: true,
    });
    expect((await fetch(publicObjectUrl(s.key))).status).toBe(404);
    expect(await hashStoredObject(clients, BUCKETS.private, s.key)).toEqual({
      sizeBytes: s.bytes.length,
      sha256: createHash('sha256').update(s.bytes).digest('hex'),
    });
    expect(
      await prisma.auditLog.count({
        where: {
          targetId: s.contentId,
          actionType: 'content.visibility_change',
        },
      }),
    ).toBe(2);
  });

  it('duplicates are idempotent and a grant committed before an old job runs wins', async () => {
    const safeNow = await scenario('regrant');
    await decide(safeNow, false);
    await decide(safeNow, true);
    const oldJob = await reevaluateSessionConsent(prisma, safeNow.fixture.sessionId);
    expect(oldJob.recordingsForced).toBe(0);
    expect(
      await prisma.educationalContent.findUniqueOrThrow({ where: { id: safeNow.contentId } }),
    ).toMatchObject({ consentForcedPrivate: false, visibility: 'public' });

    const unsafe = await scenario('duplicate');
    await decide(unsafe, false);
    await reevaluateSessionConsent(prisma, unsafe.fixture.sessionId);
    const duplicate = await reevaluateSessionConsent(prisma, unsafe.fixture.sessionId);
    expect(duplicate.recordingsForced).toBe(0);
    await Promise.all([
      migrateConsentForcedContent(prisma, clients, unsafe.contentId),
      migrateConsentForcedContent(prisma, clients, unsafe.contentId),
    ]);
    expect(
      await migrateConsentForcedContent(prisma, clients, unsafe.contentId),
    ).toMatchObject({ state: 'already_completed' });
    expect(await statObjectStrict(clients, BUCKETS.public, unsafe.key)).toBeNull();
    expect(await statObjectStrict(clients, BUCKETS.private, unsafe.key)).not.toBeNull();
  });

  it('a transient public-delete failure stays fail-closed and retryable', async () => {
    const s = await scenario('delete-retry');
    await decide(s, false);
    await reevaluateSessionConsent(prisma, s.fixture.sessionId);

    await expect(
      migrateConsentForcedContent(
        prisma,
        failingPublicDelete(clients, s.key, 'before'),
        s.contentId,
      ),
    ).rejects.toThrow('controlled transient public-delete failure');
    expect(
      await prisma.educationalContent.findUniqueOrThrow({ where: { id: s.contentId } }),
    ).toMatchObject({
      visibility: 'public',
      storageBucket: BUCKETS.public,
      consentForcedPrivate: true,
    });
    expect(await visibleContentIds(prisma, null, [s.contentId])).toEqual(new Set());
    expect(await statObjectStrict(clients, BUCKETS.public, s.key)).not.toBeNull();
    expect(await statObjectStrict(clients, BUCKETS.private, s.key)).not.toBeNull();

    await expect(migrateConsentForcedContent(prisma, clients, s.contentId)).resolves.toMatchObject({
      state: 'completed',
    });
    expect(await statObjectStrict(clients, BUCKETS.public, s.key)).toBeNull();
  });

  it('recovers when public delete succeeded but the database transaction rolled back', async () => {
    const s = await scenario('ambiguous-delete');
    await decide(s, false);
    await reevaluateSessionConsent(prisma, s.fixture.sessionId);

    await expect(
      migrateConsentForcedContent(
        prisma,
        failingPublicDelete(clients, s.key, 'after'),
        s.contentId,
      ),
    ).rejects.toThrow('controlled ambiguous delete response');
    expect(await statObjectStrict(clients, BUCKETS.public, s.key)).toBeNull();
    expect(
      await prisma.educationalContent.findUniqueOrThrow({ where: { id: s.contentId } }),
    ).toMatchObject({ visibility: 'public', storageBucket: BUCKETS.public });

    await expect(migrateConsentForcedContent(prisma, clients, s.contentId)).resolves.toMatchObject({
      state: 'completed',
    });
    expect(await hashStoredObject(clients, BUCKETS.private, s.key)).toEqual({
      sizeBytes: s.bytes.length,
      sha256: createHash('sha256').update(s.bytes).digest('hex'),
    });
  });

  it('keeps both safeguarding state transitions atomic with their mandatory audits', async () => {
    const flag = await scenario('flag-audit-rollback');
    await decide(flag, false);
    vi.spyOn(audit, 'write').mockRejectedValueOnce(
      new Error('controlled consent visibility audit failure'),
    );
    await expect(
      reevaluateSessionConsent(prisma, flag.fixture.sessionId),
    ).rejects.toThrow('controlled consent visibility audit failure');
    expect(
      await prisma.educationalContent.findUniqueOrThrow({ where: { id: flag.contentId } }),
    ).toMatchObject({
      consentForcedPrivate: false,
      visibility: 'public',
      storageBucket: BUCKETS.public,
    });
    expect(
      await jobCount(JOB_QUEUES.contentBucketMigrate, 'content_id', flag.contentId),
    ).toBe(0);
    vi.restoreAllMocks();

    const placement = await scenario('placement-audit-rollback');
    await decide(placement, false);
    await reevaluateSessionConsent(prisma, placement.fixture.sessionId);
    vi.spyOn(audit, 'write').mockRejectedValueOnce(
      new Error('controlled bucket migration audit failure'),
    );
    await expect(
      migrateConsentForcedContent(prisma, clients, placement.contentId),
    ).rejects.toThrow('controlled bucket migration audit failure');
    expect(
      await prisma.educationalContent.findUniqueOrThrow({
        where: { id: placement.contentId },
      }),
    ).toMatchObject({
      consentForcedPrivate: true,
      visibility: 'public',
      storageBucket: BUCKETS.public,
    });
    // Storage cannot roll back with PostgreSQL. The verified private copy and
    // its digest are the recovery boundary after the public delete succeeded.
    expect(await statObjectStrict(clients, BUCKETS.public, placement.key)).toBeNull();
    expect(await statObjectStrict(clients, BUCKETS.private, placement.key)).not.toBeNull();
    vi.restoreAllMocks();
    await expect(
      migrateConsentForcedContent(prisma, clients, placement.contentId),
    ).resolves.toMatchObject({ state: 'completed' });
  });

  it('a migration snapshot cannot overwrite a replacement or a deletion', async () => {
    const replacement = await scenario('replacement-race');
    await decide(replacement, false);
    await reevaluateSessionConsent(prisma, replacement.fixture.sessionId);
    const replacementKey = `content/${replacement.contentId}/replacement.pdf`;
    const replacementBytes = canonicalBytes('replacement-winner');
    await expect(
      migrateConsentForcedContent(prisma, clients, replacement.contentId, {
        afterVerifiedCopy: async () => {
          await putCanonical(BUCKETS.public, replacementKey, replacementBytes);
          await prisma.educationalContent.update({
            where: { id: replacement.contentId },
            data: {
              storageKey: replacementKey,
              sizeBytes: BigInt(replacementBytes.length),
              version: { increment: 1 },
            },
          });
        },
      }),
    ).resolves.toMatchObject({ state: 'stale' });
    expect(
      await prisma.educationalContent.findUniqueOrThrow({
        where: { id: replacement.contentId },
      }),
    ).toMatchObject({ storageKey: replacementKey, visibility: 'public' });
    expect(await hashStoredObject(clients, BUCKETS.public, replacementKey)).toEqual({
      sizeBytes: replacementBytes.length,
      sha256: createHash('sha256').update(replacementBytes).digest('hex'),
    });

    // A fresh full recompute migrates the winner, never the stale coordinate.
    await reevaluateSessionConsent(prisma, replacement.fixture.sessionId);
    await migrateConsentForcedContent(prisma, clients, replacement.contentId);
    expect(
      await prisma.educationalContent.findUniqueOrThrow({
        where: { id: replacement.contentId },
      }),
    ).toMatchObject({ storageKey: replacementKey, visibility: 'private' });

    const deleted = await scenario('deletion-race');
    await decide(deleted, false);
    await reevaluateSessionConsent(prisma, deleted.fixture.sessionId);
    await expect(
      migrateConsentForcedContent(prisma, clients, deleted.contentId, {
        afterVerifiedCopy: async () => {
          await prisma.educationalContent.update({
            where: { id: deleted.contentId },
            data: { deletedAt: new Date(), version: { increment: 1 } },
          });
        },
      }),
    ).resolves.toMatchObject({ state: 'deleted' });
    expect(await statObjectStrict(clients, BUCKETS.public, deleted.key)).not.toBeNull();
  });

  it('a durable obligation survives a worker restart and drains through pg-boss', async () => {
    const firstProcess = boss();
    await firstProcess.start();
    await firstProcess.createQueue(JOB_QUEUES.consentReevaluate, TD7_RETRY_POLICY);
    await firstProcess.createQueue(JOB_QUEUES.contentBucketMigrate, TD7_RETRY_POLICY);
    await firstProcess.updateQueue(JOB_QUEUES.consentReevaluate, TD7_RETRY_POLICY);
    await firstProcess.updateQueue(JOB_QUEUES.contentBucketMigrate, TD7_RETRY_POLICY);
    await firstProcess.stop({ graceful: true });

    const s = await scenario('restart');
    await decide(s, false);
    // This development database contains the deliberately preserved historical
    // queue-only backlog from before B-01. Raise only this tagged fixture so the
    // restart proof does not need to drain unrelated developer records first.
    await prisma.$executeRaw`
      UPDATE pgboss.job SET priority = 100
      WHERE name = ${JOB_QUEUES.consentReevaluate}
        AND data->>'session_id' = ${s.fixture.sessionId}
    `;
    expect(
      await jobCount(JOB_QUEUES.consentReevaluate, 'session_id', s.fixture.sessionId),
    ).toBeGreaterThan(0);

    const restarted = boss();
    await restarted.start();
    await restarted.work(
      JOB_QUEUES.consentReevaluate,
      { pollingIntervalSeconds: 0.5 },
      async ([job]) => {
        if (!job) throw new Error('consent worker received no job');
        const data = job.data as { session_id: string };
        await reevaluateSessionConsent(prisma, data.session_id);
      },
    );
    await restarted.work(
      JOB_QUEUES.contentBucketMigrate,
      { pollingIntervalSeconds: 0.5 },
      async ([job]) => {
        if (!job) throw new Error('bucket worker received no job');
        const data = job.data as { content_id: string };
        await migrateConsentForcedContent(prisma, clients, data.content_id);
      },
    );
    try {
      try {
        await waitUntil(async () => {
          const row = await prisma.educationalContent.findUniqueOrThrow({
            where: { id: s.contentId },
          });
          return row.visibility === 'private' && row.storageBucket === BUCKETS.private;
        }, 'consent and bucket workers to drain', 5_000);
      } catch (error) {
        const jobs = await prisma.$queryRaw<
          {
            name: string;
            state: string;
            retry_count: number;
            output: unknown;
            created_on: Date;
            start_after: Date;
            blocked: boolean;
            policy: string;
          }[]
        >`
          SELECT name, state::text, retry_count, output, created_on,
                 start_after, blocked, policy
          FROM pgboss.job
          WHERE (name = ${JOB_QUEUES.consentReevaluate}
                 AND data->>'session_id' = ${s.fixture.sessionId})
             OR (name = ${JOB_QUEUES.contentBucketMigrate}
                 AND data->>'content_id' = ${s.contentId})
          ORDER BY created_on
        `;
        const row = await prisma.educationalContent.findUniqueOrThrow({
          where: { id: s.contentId },
        });
        const wip = restarted.getWipData().map((entry) => ({
          name: entry.name,
          state: entry.state,
          lastFetchedOn: entry.lastFetchedOn,
          lastError: entry.lastError instanceof Error
            ? entry.lastError.message
            : String(entry.lastError),
        }));
        const queue = await restarted.getQueue(JOB_QUEUES.consentReevaluate);
        const routing = await prisma.$queryRaw<
          { table_name: string; actual_table: string; runnable: boolean }[]
        >`
          SELECT q.table_name,
                 j.tableoid::regclass::text AS actual_table,
                 (j.state < 'active'::pgboss.job_state
                  AND NOT j.blocked
                  AND j.start_after <= now()) AS runnable
          FROM pgboss.job j
          JOIN pgboss.queue q ON q.name = j.name
          WHERE j.name = ${JOB_QUEUES.consentReevaluate}
            AND j.data->>'session_id' = ${s.fixture.sessionId}
        `;
        throw new Error(
          `${String(error)}; queue=${JSON.stringify(queue)}; routing=${JSON.stringify(routing)}; jobs=${JSON.stringify(jobs)}; wip=${JSON.stringify(wip)}; content=${JSON.stringify({
            visibility: row.visibility,
            storageBucket: row.storageBucket,
            consentForcedPrivate: row.consentForcedPrivate,
          })}`,
        );
      }
    } finally {
      await restarted.stop({ graceful: true });
    }
    expect(await statObjectStrict(clients, BUCKETS.public, s.key)).toBeNull();
    expect(await statObjectStrict(clients, BUCKETS.private, s.key)).not.toBeNull();
  });

  it('pg-boss retries a transient storage failure with the registered TD-7 policy', async () => {
    const s = await scenario('pgboss-retry');
    await decide(s, false);
    await reevaluateSessionConsent(prisma, s.fixture.sessionId);
    await prisma.$executeRaw`
      UPDATE pgboss.job SET priority = 100
      WHERE name = ${JOB_QUEUES.contentBucketMigrate}
        AND data->>'content_id' = ${s.contentId}
    `;

    const flaky = failingPublicDelete(clients, s.key, 'before');
    const worker = boss();
    await worker.start();
    await worker.work(
      JOB_QUEUES.contentBucketMigrate,
      { pollingIntervalSeconds: 0.5 },
      async ([job]) => {
        if (!job) throw new Error('bucket worker received no job');
        const data = job.data as { content_id: string };
        await migrateConsentForcedContent(prisma, flaky, data.content_id);
      },
    );
    try {
      await waitUntil(async () => {
        const row = await prisma.educationalContent.findUniqueOrThrow({
          where: { id: s.contentId },
        });
        return row.visibility === 'private';
      }, 'TD-7 storage retry to complete');
    } finally {
      await worker.stop({ graceful: true });
    }
    const jobs = await prisma.$queryRaw<{ state: string; retry_count: number }[]>`
      SELECT state::text, retry_count
      FROM pgboss.job
      WHERE name = ${JOB_QUEUES.contentBucketMigrate}
        AND data->>'content_id' = ${s.contentId}
      ORDER BY created_on DESC
      LIMIT 1
    `;
    expect(jobs[0]).toMatchObject({ state: 'completed', retry_count: 1 });
    expect(await statObjectStrict(clients, BUCKETS.public, s.key)).toBeNull();
  });

  it('bounds a legacy queue-only row with one fully configured durable follow-up', async () => {
    const s = await scenario('legacy-job');
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO pgboss.job (
        name, data, singleton_key, state, started_on, priority
      ) VALUES (
        ${JOB_QUEUES.consentReevaluate},
        ${JSON.stringify({ session_id: s.fixture.sessionId })}::jsonb,
        ${s.fixture.sessionId},
        'active', now(), 100
      )
      RETURNING id
    `;
    const legacyId = rows[0]?.id;
    if (!legacyId) throw new Error('legacy fixture insert returned no id');

    await expect(
      ensureDurableLegacyFollowup(
        prisma,
        legacyId,
        JOB_QUEUES.consentReevaluate,
        { session_id: s.fixture.sessionId },
        s.fixture.sessionId,
      ),
    ).resolves.toBe(true);
    const obligations = await prisma.$queryRaw<
      { state: string; retry_limit: number | null; policy: string | null }[]
    >`
      SELECT state::text, retry_limit, policy
      FROM pgboss.job
      WHERE name = ${JOB_QUEUES.consentReevaluate}
        AND data->>'session_id' = ${s.fixture.sessionId}
      ORDER BY created_on
    `;
    expect(obligations).toContainEqual({
      state: 'created',
      retry_limit: TD7_RETRY_POLICY.retryLimit,
      policy: 'standard',
    });
    // Repeating the recovery check sees the existing created follow-up and
    // cannot fan out another pending obligation.
    await ensureDurableLegacyFollowup(
      prisma,
      legacyId,
      JOB_QUEUES.consentReevaluate,
      { session_id: s.fixture.sessionId },
      s.fixture.sessionId,
    );
    expect(
      await jobCount(JOB_QUEUES.consentReevaluate, 'session_id', s.fixture.sessionId),
    ).toBe(obligations.length);
  });

  it('a permanently malformed job remains a durable failed obligation', async () => {
    const queue = `b01-observable-${randomUUID()}`;
    const worker = boss();
    await worker.start();
    await worker.createQueue(queue, { retryLimit: 1 });
    const id = await worker.send(queue, { content_id: 'malformed' });
    if (!id) throw new Error('pg-boss did not return a job id');
    await worker.work(queue, async () => {
      throw new Error('controlled permanent safeguarding failure');
    });
    try {
      await waitUntil(async () => {
        const rows = await prisma.$queryRaw<{ state: string }[]>`
          SELECT state::text FROM pgboss.job
          WHERE name = ${queue} AND id = ${id}::uuid
        `;
        return rows[0]?.state === 'failed';
      }, 'permanent job failure to remain observable');
    } finally {
      await worker.deleteQueue(queue);
      await worker.stop({ graceful: true });
    }
  });
});
