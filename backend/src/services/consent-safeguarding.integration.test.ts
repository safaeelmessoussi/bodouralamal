import { createHash, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { PrismaClient } from '../generated/prisma/client.js';

import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { PgBoss } from 'pg-boss';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../app.js';
import { createWorkerCatalog, TD7_RETRY_POLICY } from '../jobs/runner.js';
import { issueAccessToken } from '../lib/access-token.js';
import { loadConfig } from '../lib/config.js';
import { quarantineKeyFor } from '../lib/file-types.js';
import { hashStoredObject } from '../lib/object-verification.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import {
  BUCKETS,
  createStorageClients,
  deleteObject,
  statObjectStrict,
  type StorageClients,
} from '../lib/storage.js';
import type { Actor } from '../policies/actor.js';
import {
  ensureDurableLegacyFollowup,
  JOB_QUEUES,
} from '../repositories/jobs.repository.js';
import * as audit from '../repositories/audit.repository.js';
import { clearTestRetirements } from '../test-support/storage-retirement.js';
import { requireRetirement } from '../repositories/storage-retirement.repository.js';
import { executeRetirement } from './storage-retirement.service.js';
import {
  clearTeachingContext,
  createTeachingContext,
  enrol,
  type TeachingFixture,
} from '../test-support/educational-fixture.js';
import {
  deleteTestConsentText,
  installTestConsentText,
  removeTestConsentText,
  type InstalledConsentText,
} from '../test-support/legal-consent-text.js';
import {
  completeUpload,
  deleteContent,
  initiateUpload,
  updateContentMetadata,
} from './content.service.js';
import { deleteCourseSchedule } from './course-schedule.service.js';
import { visibleContentIds } from './library.service.js';
import {
  enqueueConsentSafeguardingSweep,
  enqueueConsentReevaluationForStudent,
  reevaluateSessionConsent,
} from './consent-reevaluation.service.js';

/**
 * B-01 against real PostgreSQL, MinIO and pg-boss — restated for SRS Revision
 * 170 §3, under which the consent gate is a WARNING (`media_consent_missing`)
 * and nothing is forced private any more.
 *
 * These tests exercise the boundary mocks cannot prove: anonymous public bytes
 * that stay readable under a warning, the Nginx auth subrequest deciding on
 * `visibility` and the exact current key alone, the ordinary quarantine of an
 * exact old key on replacement/deletion, same-transaction pg-boss rows, retry,
 * and process restart.
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
let consentText: InstalledConsentText | null = null;

function track(bucket: string, key: string): void {
  trackedObjects.set(`${bucket}\0${key}`, { bucket, key });
}

function publicObjectUrl(key: string): string {
  return `${config.MINIO_ENDPOINT}/${BUCKETS.public}/${key}`;
}

function proxiedPublicObjectUrl(key: string): string {
  return `${config.STORAGE_BASE_URL}/${BUCKETS.public}/${key}`;
}

const S3_SELECT_REQUEST = `<?xml version="1.0" encoding="UTF-8"?>
<SelectObjectContentRequest xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Expression>SELECT * FROM S3Object</Expression>
  <ExpressionType>SQL</ExpressionType>
  <InputSerialization><CSV /></InputSerialization>
  <OutputSerialization><CSV /></OutputSerialization>
</SelectObjectContentRequest>`;

async function expectMethodDeniedAtNginx(
  url: string,
  method: string,
  body?: string,
): Promise<void> {
  const response = await fetch(url, {
    method,
    ...(body === undefined
      ? {}
      : { body, headers: { 'content-type': 'application/xml' } }),
    redirect: 'manual',
  });
  expect(response.status, `${method} ${url}`).toBe(405);
  const responseBody = await response.text();
  expect(responseBody.toLowerCase()).not.toContain('<error>');
  expect(responseBody.toLowerCase()).not.toContain('<listbucketresult');
}

async function expectNoBucketListing(url: string): Promise<void> {
  const response = await fetch(url, { redirect: 'manual' });
  expect(response.ok, url).toBe(false);
  expect(response.status, url).toBeGreaterThanOrEqual(400);
  const responseBody = await response.text();
  expect(responseBody.toLowerCase()).not.toContain('<listbucketresult');
  expect(response.headers.get('content-type') ?? '').not.toContain('application/xml');
}

/** The production delivery path: Nginx admits an anonymous GET/HEAD only while
 * the database names that exact public key on a live public row (R170 §3: on
 * `visibility` alone — a warned recording is served like any other). */
async function expectServedAtNginx(key: string): Promise<void> {
  expect((await fetch(proxiedPublicObjectUrl(key))).status, `GET ${key}`).toBe(200);
  expect(
    (await fetch(proxiedPublicObjectUrl(key), { method: 'HEAD', redirect: 'manual' })).status,
    `HEAD ${key}`,
  ).toBe(200);
}

async function expectUnavailableAtNginx(key: string): Promise<void> {
  const response = await fetch(proxiedPublicObjectUrl(key), { redirect: 'manual' });
  expect(response.status, key).toBe(302);
  expect(
    new URL(response.headers.get('location') ?? '', config.STORAGE_BASE_URL).pathname,
  ).toBe('/content-unavailable');
}

function adminActor(s: Pick<Scenario, 'actorId' | 'branchId'>): Actor {
  return {
    userId: s.actorId,
    roles: ['admin'],
    activeRole: 'admin',
    accountStatus: 'active',
    roleScopes: [{ role: 'admin', branches: [s.branchId] }],
  };
}

function canonicalBytes(label: string): Buffer {
  return Buffer.from(`%PDF-1.7\n${label}\n${'safe-canonical-bytes'.repeat(64)}`);
}

function digestOf(bytes: Buffer): { sizeBytes: number; sha256: string } {
  return { sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
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
      mediaConsentMissing: false,
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

/**
 * Holds the LIVE worker off one Session's pending obligation. The stack's own
 * API shares this database and drains `consent.reevaluate`; a test that pins
 * the exact counters of ITS OWN call must be the only evaluator, or the worker
 * can legitimately write the same warning first and the direct call reports it
 * unchanged. The obligation's existence is still asserted; only its delivery
 * is deferred, and the fixture teardown removes it.
 */
async function deferLiveDelivery(sessionId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE pgboss.job SET start_after = now() + interval '1 hour'
    WHERE name = ${JOB_QUEUES.consentReevaluate}
      AND data->>'session_id' = ${sessionId}
      AND state = 'created'
  `;
}

/** The precondition of a recording that IS warned, set without a job: the
 * release is gone from the ledger and the flag already says so, so the live
 * worker, wherever it wakes, finds nothing to change. */
async function warnedWithoutJob(s: Scenario): Promise<void> {
  await prisma.consentRecord.deleteMany({ where: { studentId: s.studentId } });
  await prisma.educationalContent.update({
    where: { id: s.contentId },
    data: { mediaConsentMissing: true },
  });
}

function contentRow(contentId: string) {
  return prisma.educationalContent.findUniqueOrThrow({ where: { id: contentId } });
}

function consentWarningAudits(contentId: string) {
  return prisma.auditLog.findMany({
    where: { targetId: contentId, actionType: 'content.consent_warning' },
    orderBy: { createdAt: 'asc' },
    select: { detail: true },
  });
}

async function replaceScenarioFile(
  s: Scenario,
  label: string,
): Promise<{ key: string; bytes: Buffer }> {
  const metadata = await prisma.educationalContent.findUniqueOrThrow({
    where: { id: s.contentId },
    select: {
      levelId: true,
      subjectId: true,
      academicYearId: true,
      branchId: true,
    },
  });
  const bytes = canonicalBytes(label);
  const initiated = await initiateUpload(prisma, clients, config.JWT_SIGNING_KEY, adminActor(s), {
    filename: `${label}.pdf`,
    size: bytes.length,
    mime: 'application/pdf',
    meta: {
      ...metadata,
      visibility: 'public',
      origin: 'session_recording',
      replacesContentId: s.contentId,
    },
  });
  track(BUCKETS.public, initiated.key);
  const uploaded = await fetch(initiated.putUrl, {
    method: 'PUT',
    headers: { 'content-type': 'application/pdf' },
    body: bytes,
  });
  expect(uploaded.status).toBe(200);
  await expectUnavailableAtNginx(initiated.key);
  expect(
    (
      await fetch(`${config.STORAGE_BASE_URL}/${BUCKETS.public}/${initiated.key}`, {
        method: 'HEAD',
        redirect: 'manual',
      })
    ).status,
  ).toBe(302);
  await completeUpload(
    prisma,
    clients,
    config.JWT_SIGNING_KEY,
    adminActor(s),
    initiated.uploadId,
    { title: `${TAG} ${label}`, description: null },
  );
  const current = await prisma.educationalContent.findUniqueOrThrow({
    where: { id: s.contentId },
    select: { storageBucket: true, storageKey: true },
  });
  track(current.storageBucket, current.storageKey);
  return { key: current.storageKey, bytes };
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

async function runProductionJob(
  queue: string,
  field: string,
  value: string,
  operation?: string | null,
): Promise<void> {
  const rows = await prisma.$queryRaw<
    { id: string; data: Record<string, unknown> }[]
  >`
    SELECT id, data
    FROM pgboss.job
    WHERE name = ${queue}
      AND data->>${field} = ${value}
    ORDER BY created_on DESC
  `;
  const job = rows.find((candidate) => {
    if (operation === undefined) return true;
    if (operation === null) return candidate.data['operation'] === undefined;
    return candidate.data['operation'] === operation;
  });
  if (!job) throw new Error(`no ${queue} fixture job for ${field}=${value}`);
  const worker = createWorkerCatalog(prisma, clients, () => undefined)
    .find((candidate) => candidate.name === queue);
  if (!worker) throw new Error(`production catalog has no ${queue} handler`);
  await worker.handler([{ id: job.id, data: job.data } as never]);
}

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function twoPartyBarrier(): () => Promise<void> {
  const release = deferred();
  let arrivals = 0;
  return async () => {
    arrivals += 1;
    if (arrivals === 2) release.resolve();
    await release.promise;
  };
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
  await clearTestRetirements(prisma, contentIds);
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
    await prisma.sessionAudienceBranch.deleteMany({
      where: { sessionId: { in: sessionIds } },
    });
    await prisma.trash.deleteMany({
      where: { targetId: { in: sessionIds } },
    });
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
  await prisma.trash.deleteMany({ where: { deletedById: { in: userIds } } });
  await prisma.sessionContent.deleteMany({ where: { contentId: { in: contentIds } } });
  if (contentIds.length > 0) {
    await prisma.trash.deleteMany({ where: { targetId: { in: contentIds } } });
  }
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
    await deleteObject(clients, BUCKETS.private, object.key).catch(() => undefined);
    // The ordinary quarantine transition copies an exact old key to
    // `quarantine/…` in ITS OWN bucket, without going through `track`.
    for (const contentId of contentIds) {
      for (const bucket of [BUCKETS.public, BUCKETS.private]) {
        await deleteObject(
          clients,
          bucket,
          quarantineKeyFor(contentId, object.key),
        ).catch(() => undefined);
      }
    }
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
  // **Installed ONCE**, not per test: a second install would take the
  // suite's own row as *what was there before* and lose the installation's,
  // leaving it superseded after the run (P1.2).
  consentText ??= await installTestConsentText(prisma, 'b01-test-v1');
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
  // **Restored FIRST, not last** (B10): the restore used to sit after the
  // fixture teardown, so any failure there skipped it and left this suite's
  // scratch wording in the shared database. See `test-support/legal-consent-text`.
  await removeTestConsentText(prisma, consentText);
  await cleanup();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  // **Last, after the fixture teardown**: `consent_text_id` is RESTRICT, so a
  // row is only free to go once this suite's own consent records have gone.
  await deleteTestConsentText(prisma, consentText);
  await prisma.$disconnect();
});

// R170 §3 withdrew the consent-forced migration; these cases pinned it and are
// gone: «withdrawal durably closes the application gate and migrates identical
// canonical bytes» (its warning half lives on below), «B5: a new revocation
// before/after completion cannot be lost behind an old stale migration» (its
// obligation now completes as `withdrawn_r170`, pinned below), «a transient
// public-delete failure stays fail-closed and retryable» (the consent
// migration's retry; the ordinary obligation's retry is pinned below), «a
// migration snapshot cannot overwrite a replacement or a deletion» (the
// replacement and deletion cases below pin the ordinary transition instead),
// and the bucket-migration half of «keeps both safeguarding state transitions
// atomic with their mandatory audits».
describe('B-01 consent safeguarding', () => {
  it('rolls metadata, warning and jobs back when the mandatory warning audit fails', async () => {
    const s = await scenario('h6-retag-rollback');
    await prisma.educationalContent.update({ where: { id: s.contentId }, data: { origin: 'uploaded' } });
    await prisma.consentRecord.deleteMany({ where: { studentId: s.studentId } });
    const before = await contentRow(s.contentId);
    const jobsBefore = await jobCount(JOB_QUEUES.consentReevaluate, 'session_id', s.fixture.sessionId);
    vi.spyOn(audit, 'write').mockRejectedValueOnce(new Error('controlled retag audit failure'));
    try {
      await expect(updateContentMetadata(prisma, clients, adminActor(s), s.contentId,
        { origin: 'session_recording' })).rejects.toThrow('controlled retag audit failure');
    } finally {
      vi.restoreAllMocks();
    }
    expect(await contentRow(s.contentId)).toEqual(before);
    expect(await jobCount(JOB_QUEUES.consentReevaluate, 'session_id', s.fixture.sessionId)).toBe(jobsBefore);
    expect(await prisma.storageRetirement.count({ where: { contentId: s.contentId } })).toBe(0);
    expect(await statObjectStrict(clients, BUCKETS.public, s.key)).not.toBeNull();
  });

  it('refuses a retag if the first Session link commits between discovery and Content locking', async () => {
    const s = await scenario('h6-first-link');
    await prisma.educationalContent.update({ where: { id: s.contentId }, data: { origin: 'uploaded' } });
    await prisma.consentRecord.deleteMany({ where: { studentId: s.studentId } });
    await prisma.sessionContent.deleteMany({ where: { contentId: s.contentId } });
    const before = await contentRow(s.contentId);
    let inserted = false;
    const racing = prisma.$extends({ query: { sessionContent: { async findMany({ args, query }) {
      const rows = await query(args);
      if (!inserted && args.where?.contentId === s.contentId) {
        inserted = true;
        expect(rows).toHaveLength(0);
        // A real second connection commits after the actual discovery query.
        await prisma.sessionContent.create({ data: { contentId: s.contentId, sessionId: s.fixture.sessionId } });
      }
      return rows;
    } } } }) as unknown as PrismaClient;
    await expect(updateContentMetadata(racing, clients, adminActor(s), s.contentId,
      { origin: 'session_recording' })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    expect(inserted).toBe(true);
    expect(await contentRow(s.contentId)).toEqual(before);
  });

  it.each(['session_recording', 'uploaded'] as const)(
    'retagging to %s commits the warning with the edit, without a bucket move or a change of visibility', async (origin) => {
      const s = await scenario(`h6-retag-${origin}`);
      // Establish a linked file whose consent is missing, without enqueueing a
      // worker first: the metadata transaction itself must write the warning
      // (R170 §3). A warning describes the PRESENT: an item retagged TO a
      // recording is warned; one retagged AWAY from it is outside the graph
      // the job re-evaluates, so it carries none (a warning nothing could ever
      // clear would be a stale one, and R170 §3 has no closed state to fail
      // into). Seeded warned when retagging away, so the CLEAR is asserted.
      const becomesRecording = origin === 'session_recording';
      await prisma.educationalContent.update({ where: { id: s.contentId }, data: {
        origin: becomesRecording ? 'uploaded' : 'session_recording',
        mediaConsentMissing: !becomesRecording,
      } });
      await prisma.consentRecord.deleteMany({ where: { studentId: s.studentId } });
      await updateContentMetadata(prisma, clients, adminActor(s), s.contentId, { origin });
      const row = await contentRow(s.contentId);
      expect(row).toMatchObject({
        origin,
        mediaConsentMissing: becomesRecording,
        consentForcedPrivate: false,
        visibility: 'public',
        storageBucket: BUCKETS.public,
        storageKey: s.key,
      });
      expect(await consentWarningAudits(s.contentId)).toEqual([
        { detail: { reason: 'consent_gate', media_consent_missing: becomesRecording } },
      ]);
      // Nothing moved and nothing closed: the same public bytes, still served.
      expect(await hashStoredObject(clients, BUCKETS.public, s.key)).toEqual(digestOf(s.bytes));
      expect(await statObjectStrict(clients, BUCKETS.private, s.key)).toBeNull();
      expect(await visibleContentIds(prisma, null, [s.contentId])).toEqual(new Set([s.contentId]));
      await expectServedAtNginx(s.key);
      expect(await prisma.storageRetirement.count({ where: { contentId: s.contentId } })).toBe(0);
    },
  );

  it('a pre-R170 consent migration obligation completes as withdrawn and moves nothing', async () => {
    const s = await scenario('withdrawn-consent-migrate');
    // Even one the old rule would have OWED — the release is gone — because
    // there is nothing left to converge to (R170 §3): the row is completed with
    // the code that says why, through the production handler that still
    // receives such a durable job, and no byte moves.
    await prisma.consentRecord.deleteMany({ where: { studentId: s.studentId } });
    const obligation = await prisma.$transaction((tx) => requireRetirement(tx, {
      contentId: s.contentId, bucket: BUCKETS.public, storageKey: s.key, operation: 'consent_migrate',
    }));
    await runProductionJob(JOB_QUEUES.contentBucketMigrate, 'retirement_id', obligation.id);
    expect(
      await prisma.storageRetirement.findUniqueOrThrow({ where: { id: obligation.id } }),
    ).toMatchObject({ completedAt: expect.any(Date), storageKey: null, lastErrorCode: 'withdrawn_r170' });
    expect(await contentRow(s.contentId)).toMatchObject({
      visibility: 'public',
      storageBucket: BUCKETS.public,
      storageKey: s.key,
      consentForcedPrivate: false,
      mediaConsentMissing: false,
    });
    expect(await hashStoredObject(clients, BUCKETS.public, s.key)).toEqual(digestOf(s.bytes));
    expect(await statObjectStrict(clients, BUCKETS.private, s.key)).toBeNull();
    await expectServedAtNginx(s.key);
    // A repeat delivery finds it completed and does nothing again.
    await executeRetirement(prisma, clients, obligation.id);
    expect(await statObjectStrict(clients, BUCKETS.public, s.key)).not.toBeNull();
  });

  it('allows only exact public reads and signed PUTs at the production Nginx origin', async () => {
    const s = await scenario('nginx-public-allowlist');
    const canonicalUrl = proxiedPublicObjectUrl(s.key);

    expect((await fetch(canonicalUrl)).status).toBe(200);
    expect((await fetch(canonicalUrl, { method: 'HEAD' })).status).toBe(200);

    for (const method of ['POST', 'DELETE', 'PATCH', 'OPTIONS', 'PROPFIND']) {
      await expectMethodDeniedAtNginx(canonicalUrl, method);
    }
    await expectMethodDeniedAtNginx(
      `${canonicalUrl}?select&select-type=2`,
      'POST',
      S3_SELECT_REQUEST,
    );

    // PUT is the sole write-shaped exception, and MinIO must still require its
    // SigV4 capability. An unsigned request must not overwrite canonical bytes.
    const unsignedCanonicalPut = await fetch(canonicalUrl, {
      method: 'PUT',
      headers: { 'content-type': 'application/pdf' },
      body: canonicalBytes('unsigned-canonical-overwrite'),
      redirect: 'manual',
    });
    expect(unsignedCanonicalPut.status).toBe(403);
    expect(await hashStoredObject(clients, BUCKETS.public, s.key)).toEqual(digestOf(s.bytes));

    const initiated = await initiateUpload(
      prisma,
      clients,
      config.JWT_SIGNING_KEY,
      adminActor(s),
      {
        filename: 'nginx-public-allowlist.pdf',
        size: s.bytes.length,
        mime: 'application/pdf',
        meta: {
          levelId: s.fixture.levelId,
          subjectId: s.fixture.subjectId,
          academicYearId: (
            await prisma.academicYear.findFirstOrThrow({ select: { id: true } })
          ).id,
          branchId: s.branchId,
          visibility: 'public',
          origin: 'session_recording',
        },
      },
    );
    track(BUCKETS.public, initiated.key);
    const stagingUrl = `${config.STORAGE_BASE_URL}/${BUCKETS.public}/${initiated.key}`;
    expect(
      (
        await fetch(initiated.putUrl, {
          method: 'PUT',
          headers: { 'content-type': 'application/pdf' },
          body: s.bytes,
        })
      ).status,
    ).toBe(200);
    for (const method of ['GET', 'HEAD']) {
      const denied = await fetch(stagingUrl, { method, redirect: 'manual' });
      expect(denied.status, `${method} ${stagingUrl}`).toBe(302);
      expect(
        new URL(denied.headers.get('location') ?? '', config.STORAGE_BASE_URL).pathname,
      ).toBe('/content-unavailable');
    }
    await expectMethodDeniedAtNginx(
      `${stagingUrl}?select&select-type=2`,
      'POST',
      S3_SELECT_REQUEST,
    );
    await expectMethodDeniedAtNginx(stagingUrl, 'DELETE');

    const unsignedStagingPutUrl = new URL(initiated.putUrl);
    unsignedStagingPutUrl.search = '';
    expect(
      (
        await fetch(unsignedStagingPutUrl, {
          method: 'PUT',
          headers: { 'content-type': 'application/pdf' },
          body: canonicalBytes('unsigned-staging-overwrite'),
          redirect: 'manual',
        })
      ).status,
    ).toBe(403);
    expect(await hashStoredObject(clients, BUCKETS.public, initiated.key)).toEqual(digestOf(s.bytes));

    const publicRoot = `${config.STORAGE_BASE_URL}/${BUCKETS.public}`;
    for (const rootUrl of [
      publicRoot,
      `${publicRoot}?list-type=2&prefix=content%2F`,
      `${publicRoot}/`,
      `${publicRoot}/?list-type=2`,
      `${config.STORAGE_BASE_URL}//${BUCKETS.public}?list-type=2`,
      `${config.STORAGE_BASE_URL}/%70ublic?list-type=2`,
      `${config.STORAGE_BASE_URL}/${BUCKETS.public}%2F?list-type=2`,
    ]) {
      await expectNoBucketListing(rootUrl);
    }

    // Nginx normalizes location matching, but the authorizer receives the
    // original coordinate. Alternate path spellings therefore fail closed
    // instead of slipping through the generic /storage/ proxy.
    for (const normalizedUrl of [
      `${config.STORAGE_BASE_URL}//${BUCKETS.public}/${s.key}`,
      `${config.STORAGE_BASE_URL}/%70ublic/${s.key}`,
      `${config.STORAGE_BASE_URL}/${BUCKETS.public}%2F${s.key}`,
    ]) {
      const response = await fetch(normalizedUrl, { redirect: 'manual' });
      expect(response.status, normalizedUrl).not.toBe(200);
    }
  });

  it('the real HTTP consent-withdrawal flow warns, keeps the recording public and preserves the authorized mint', async () => {
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

    await runProductionJob(
      JOB_QUEUES.consentReevaluate,
      'session_id',
      s.fixture.sessionId,
    );
    // R170 §3: warned, and public exactly as before — nothing was forced, no
    // migration was owed, and the anonymous reader still gets the bytes.
    expect(await contentRow(s.contentId)).toMatchObject({
      mediaConsentMissing: true,
      consentForcedPrivate: false,
      visibility: 'public',
      storageBucket: BUCKETS.public,
    });
    expect(await jobCount(JOB_QUEUES.contentBucketMigrate, 'content_id', s.contentId)).toBe(0);
    expect(await prisma.storageRetirement.count({ where: { contentId: s.contentId } })).toBe(0);
    expect(await visibleContentIds(prisma, null, [s.contentId])).toEqual(new Set([s.contentId]));
    expect((await fetch(publicObjectUrl(s.key))).status).toBe(200);
    await expectServedAtNginx(s.key);

    const mint = await fetch(`${apiBase}/content/${s.contentId}/download-url`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(mint.status).toBe(200);
    expect(await mint.json()).toMatchObject({ expires_in: 600 });
  });

  it('withdrawal raises the warning, leaves the public object readable and audits the change', async () => {
    const s = await scenario('withdrawal');
    expect((await fetch(publicObjectUrl(s.key))).status).toBe(200);
    await expectServedAtNginx(s.key);
    const internalAuthorizeUrl = new URL(
      '/internal/storage/public-authorize',
      apiBase,
    );
    const authorize = async (): Promise<number> =>
      (
        await fetch(internalAuthorizeUrl, {
          headers: { 'x-original-uri': `/storage/public/${s.key}` },
        })
      ).status;
    expect(await authorize()).toBe(204);
    expect(await visibleContentIds(prisma, null, [s.contentId])).toEqual(
      new Set([s.contentId]),
    );

    expect(await decide(s, false)).toContain(s.fixture.sessionId);
    expect(
      await jobCount(JOB_QUEUES.consentReevaluate, 'session_id', s.fixture.sessionId),
    ).toBeGreaterThan(0);
    await deferLiveDelivery(s.fixture.sessionId);

    const reevaluated = await reevaluateSessionConsent(prisma, s.fixture.sessionId);
    expect(reevaluated).toEqual({
      sessionId: s.fixture.sessionId,
      recordingsInspected: 1,
      warningsRaised: 1,
      warningsCleared: 0,
    });
    const warned = await contentRow(s.contentId);
    expect(warned).toMatchObject({
      visibility: 'public',
      storageBucket: BUCKETS.public,
      storageKey: s.key,
      mediaConsentMissing: true,
      // Retired by R170 §3: never written again.
      consentForcedPrivate: false,
    });
    // The warning is a fact told to staff; it closes NOTHING — not the
    // application read, not the database-authorized public origin, not the
    // storage object itself.
    expect(await visibleContentIds(prisma, null, [s.contentId])).toEqual(
      new Set([s.contentId]),
    );
    expect((await fetch(publicObjectUrl(s.key))).status).toBe(200);
    await expectServedAtNginx(s.key);
    expect(await authorize()).toBe(204);
    expect(await hashStoredObject(clients, BUCKETS.public, s.key)).toEqual(digestOf(s.bytes));
    expect(await statObjectStrict(clients, BUCKETS.private, s.key)).toBeNull();
    // No migration is owed and none is enqueued.
    expect(await jobCount(JOB_QUEUES.contentBucketMigrate, 'content_id', s.contentId)).toBe(0);
    expect(await prisma.storageRetirement.count({ where: { contentId: s.contentId } })).toBe(0);
    // One audit row says what changed and from where (TD-14: never who lacks
    // the release); the visibility never changed, so no such row exists.
    expect(await consentWarningAudits(s.contentId)).toEqual([
      {
        detail: {
          reason: 'consent_gate',
          media_consent_missing: true,
          source_session_id: s.fixture.sessionId,
        },
      },
    ]);
    expect(
      await prisma.auditLog.count({
        where: { targetId: s.contentId, actionType: 'content.visibility_change' },
      }),
    ).toBe(0);
  });

  it('an R92 audience override transaction enqueues and warns a newly unsafe recording', async () => {
    const s = await scenario('r92-audience');
    await prisma.recurringCourseSchedule.update({
      where: { id: s.fixture.scheduleId },
      data: {
        teachingMode: 'entire_level',
        levelId: s.fixture.levelId,
        administrativeGroupId: null,
      },
    });
    const secondBranch = await prisma.branch.create({
      data: {
        name: `${TAG} r92 second branch`,
        operationalStartDate: new Date('2026-01-01'),
      },
    });
    const secondGroup = await prisma.administrativeGroup.create({
      data: {
        name: `${TAG} r92 second group`,
        levelId: s.fixture.levelId,
        branchId: secondBranch.id,
      },
    });
    const noConsentStudent = await person('r92 no-consent student');
    await prisma.enrollment.create({
      data: {
        studentId: noConsentStudent,
        levelId: s.fixture.levelId,
        branchId: secondBranch.id,
        administrativeGroupId: secondGroup.id,
      },
    });
    /**
     * **The actor must reach BOTH branches, expressed in the current model.**
     *
     * This created a second `admin` assignment at the other branch. A role is
     * now held **once** per account (Owner, 2026-08-28) — enforced by
     * `user_branch_role_one_live_role_per_user` — so multi-branch reach is the
     * all-branches scope rather than two rows. `branch_id: null` is *all
     * branches* (§7 R24), never *no branch*, so this widens the existing
     * assignment instead of adding beside it. The token below already claims
     * both branches; this makes the live rows agree with it.
     */
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'admin' } });
    await prisma.userBranchRole.updateMany({
      where: { userId: s.actorId, roleId: adminRole.id, deletedAt: null },
      data: { branchId: null },
    });
    const version = await prisma.session.findUniqueOrThrow({
      where: { id: s.fixture.sessionId },
      select: { version: true },
    });
    const token = issueAccessToken(
      {
        userId: s.actorId,
        roleScopes: [{ role: 'admin', branches: [s.branchId, secondBranch.id] }],
        accountStatus: 'active',
      },
      config.JWT_SIGNING_KEY,
    ).token;

    const changed = await fetch(
      `${apiBase}/sessions/${s.fixture.sessionId}/audience`,
      {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          version: version.version,
          branch_ids: [s.branchId, secondBranch.id],
          category_ids: [],
          level_ids: [],
          administrative_group_ids: [],
          teaching_group_ids: [],
        }),
      },
    );
    expect(changed.status).toBe(200);
    expect(
      await jobCount(JOB_QUEUES.consentReevaluate, 'session_id', s.fixture.sessionId),
    ).toBeGreaterThan(0);

    await runProductionJob(
      JOB_QUEUES.consentReevaluate,
      'session_id',
      s.fixture.sessionId,
    );
    expect(await contentRow(s.contentId)).toMatchObject({
      mediaConsentMissing: true,
      consentForcedPrivate: false,
      visibility: 'public',
    });
    expect((await fetch(publicObjectUrl(s.key))).status).toBe(200);
    await expectServedAtNginx(s.key);
  });

  it('a consent change still reaches a protected Session after its schedule is soft-deleted', async () => {
    const s = await scenario('retained-session');
    const removed = await deleteCourseSchedule(
      prisma,
      adminActor(s),
      s.fixture.scheduleId,
      new Date('2026-08-24T00:00:00Z'),
    );
    expect(removed.retained).toBe(1);
    expect(
      await prisma.session.findUniqueOrThrow({ where: { id: s.fixture.sessionId } }),
    ).toMatchObject({ deletedAt: null });

    expect(await decide(s, false)).toContain(s.fixture.sessionId);
    await runProductionJob(
      JOB_QUEUES.consentReevaluate,
      'session_id',
      s.fixture.sessionId,
    );
    expect(await contentRow(s.contentId)).toMatchObject({
      mediaConsentMissing: true,
      visibility: 'public',
    });
    expect((await fetch(publicObjectUrl(s.key))).status).toBe(200);
  });

  it('the bounded rollout sweep discovers a live recording with no historical job', async () => {
    const s = await scenario('rollout-sweep');
    await prisma.consentRecord.create({
      data: {
        studentId: s.studentId,
        consentType: 'media_release',
        granted: false,
        method: 'staff_recorded',
        consentTextVersion: 'b01-test-v1',
        grantedByUserId: s.actorId,
        revokedAt: new Date(),
        revokedByUserId: s.actorId,
      },
    });
    await prisma.$executeRaw`
      DELETE FROM pgboss.job
      WHERE name = ${JOB_QUEUES.consentReevaluate}
        AND data->>'session_id' = ${s.fixture.sessionId}
    `;

    const first = await enqueueConsentSafeguardingSweep(prisma, {
      batchSize: 1,
      onlySessionIds: [s.fixture.sessionId],
    });
    expect(first).toEqual({ sessionsScanned: 1, obligationsInserted: 1, batches: 1 });
    const duplicate = await enqueueConsentSafeguardingSweep(prisma, {
      batchSize: 1,
      onlySessionIds: [s.fixture.sessionId],
    });
    expect(duplicate).toMatchObject({ sessionsScanned: 1, batches: 1 });
    // The real integration stack has live workers. If one claims/completes the
    // first full-recompute between these calls, pg-boss no longer considers it
    // a pending singleton and the repeat sweep legitimately writes one fresh
    // follow-up. Both are converged production states: either one pending job,
    // or the claimed/completed job plus exactly one replacement obligation.
    // Pin the exact accounting instead of racing the worker for a cosmetic 0.
    expect([0, 1]).toContain(duplicate.obligationsInserted);
    const represented = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*)::bigint AS count
      FROM pgboss.job
      WHERE name = ${JOB_QUEUES.consentReevaluate}
        AND data->>'session_id' = ${s.fixture.sessionId}
    `;
    expect(Number(represented[0]!.count)).toBe(1 + duplicate.obligationsInserted);

    await runProductionJob(
      JOB_QUEUES.consentReevaluate,
      'session_id',
      s.fixture.sessionId,
    );
    expect(await contentRow(s.contentId)).toMatchObject({
      mediaConsentMissing: true,
      visibility: 'public',
    });
    expect((await fetch(publicObjectUrl(s.key))).status).toBe(200);
  });

  it('locks a shared recording graph once in global order and warns on the union audience', async () => {
    const first = await scenario('shared-lock-first');
    const second = await scenario('shared-lock-second');
    await prisma.sessionContent.updateMany({
      where: {
        sessionId: second.fixture.sessionId,
        contentId: second.contentId,
        deletedAt: null,
      },
      data: { deletedAt: new Date(), deletedById: second.actorId },
    });
    await prisma.sessionContent.create({
      data: { sessionId: second.fixture.sessionId, contentId: first.contentId },
    });
    await decide(second, false);
    await deferLiveDelivery(second.fixture.sessionId);

    const barrier = twoPartyBarrier();
    const discovered: string[][] = [];
    const run = (sessionId: string) =>
      reevaluateSessionConsent(prisma, sessionId, {
        beforeSessionLocks: async (sessionIds) => {
          discovered.push([...sessionIds]);
          await barrier();
        },
      });
    const outcomes = await Promise.all([
      run(first.fixture.sessionId),
      run(second.fixture.sessionId),
    ]);

    const expectedGraph = [first.fixture.sessionId, second.fixture.sessionId].sort();
    expect(discovered).toEqual([expectedGraph, expectedGraph]);
    // Both passes inspect the one shared recording; whichever commits first
    // raises its warning, the other finds it already said.
    expect(outcomes.map((outcome) => outcome.recordingsInspected)).toEqual([1, 1]);
    expect(outcomes.reduce((sum, outcome) => sum + outcome.warningsRaised, 0)).toBe(1);
    expect(outcomes.reduce((sum, outcome) => sum + outcome.warningsCleared, 0)).toBe(0);
    expect(await contentRow(first.contentId)).toMatchObject({
      mediaConsentMissing: true,
      visibility: 'public',
      storageBucket: BUCKETS.public,
    });
    expect(await consentWarningAudits(first.contentId)).toHaveLength(1);
    // The recording whose link was retired is outside the graph: untouched.
    expect(await contentRow(second.contentId)).toMatchObject({ mediaConsentMissing: false });
    await expectServedAtNginx(first.key);
  });

  it('duplicates are idempotent and a grant committed before an old job runs wins', async () => {
    const safeNow = await scenario('regrant');
    await decide(safeNow, false);
    await decide(safeNow, true);
    const oldJob = await reevaluateSessionConsent(prisma, safeNow.fixture.sessionId);
    expect(oldJob).toMatchObject({ recordingsInspected: 1, warningsRaised: 0, warningsCleared: 0 });
    expect(await contentRow(safeNow.contentId)).toMatchObject({
      mediaConsentMissing: false,
      visibility: 'public',
    });
    expect(await consentWarningAudits(safeNow.contentId)).toEqual([]);

    const unsafe = await scenario('duplicate');
    await decide(unsafe, false);
    await reevaluateSessionConsent(prisma, unsafe.fixture.sessionId);
    const duplicate = await reevaluateSessionConsent(prisma, unsafe.fixture.sessionId);
    expect(duplicate).toMatchObject({ recordingsInspected: 1, warningsRaised: 0, warningsCleared: 0 });
    const row = await contentRow(unsafe.contentId);
    expect(row).toMatchObject({ mediaConsentMissing: true, visibility: 'public' });
    // A repeat says nothing new: one audit row, one version step, whoever
    // (this call or the live worker) wrote the warning first.
    expect(await consentWarningAudits(unsafe.contentId)).toHaveLength(1);
    expect(await reevaluateSessionConsent(prisma, unsafe.fixture.sessionId)).toMatchObject({
      warningsRaised: 0,
      warningsCleared: 0,
    });
    expect((await contentRow(unsafe.contentId)).version).toBe(row.version);
  });

  it('a later grant CLEARS the warning: it describes the present, unlike the safeguard it replaced', async () => {
    const s = await scenario('regrant-clears');
    await decide(s, false);
    await deferLiveDelivery(s.fixture.sessionId);
    expect(await reevaluateSessionConsent(prisma, s.fixture.sessionId)).toMatchObject({
      recordingsInspected: 1,
      warningsRaised: 1,
      warningsCleared: 0,
    });
    const warned = await contentRow(s.contentId);
    expect(warned).toMatchObject({
      mediaConsentMissing: true,
      consentForcedPrivate: false,
      visibility: 'public',
      storageBucket: BUCKETS.public,
    });
    await expectServedAtNginx(s.key);

    // The reverse of the withdrawn «never lifts a committed safeguard»: the
    // same trigger, the same engine, and the warning goes with the reason for
    // it (R170 §3 — «in BOTH directions»).
    await decide(s, true);
    expect(await reevaluateSessionConsent(prisma, s.fixture.sessionId)).toMatchObject({
      recordingsInspected: 1,
      warningsRaised: 0,
      warningsCleared: 1,
    });
    const cleared = await contentRow(s.contentId);
    expect(cleared).toMatchObject({
      mediaConsentMissing: false,
      consentForcedPrivate: false,
      visibility: 'public',
      storageBucket: BUCKETS.public,
      storageKey: s.key,
      version: warned.version + 1,
    });
    expect(await consentWarningAudits(s.contentId)).toEqual([
      {
        detail: {
          reason: 'consent_gate',
          media_consent_missing: true,
          source_session_id: s.fixture.sessionId,
        },
      },
      {
        detail: {
          reason: 'consent_gate',
          media_consent_missing: false,
          source_session_id: s.fixture.sessionId,
        },
      },
    ]);
    expect(await hashStoredObject(clients, BUCKETS.public, s.key)).toEqual(digestOf(s.bytes));
    await expectServedAtNginx(s.key);
  });

  it('keeps the warning atomic with its mandatory audit', async () => {
    const s = await scenario('warning-audit-rollback');
    await decide(s, false);
    await deferLiveDelivery(s.fixture.sessionId);
    const before = await contentRow(s.contentId);
    vi.spyOn(audit, 'write').mockRejectedValueOnce(
      new Error('controlled consent warning audit failure'),
    );
    try {
      await expect(
        reevaluateSessionConsent(prisma, s.fixture.sessionId),
      ).rejects.toThrow('controlled consent warning audit failure');
    } finally {
      vi.restoreAllMocks();
    }
    // The flag and its version step rolled back with the audit row (TD-4).
    expect(await contentRow(s.contentId)).toEqual(before);
    expect(await consentWarningAudits(s.contentId)).toEqual([]);
    expect(
      await jobCount(JOB_QUEUES.contentBucketMigrate, 'content_id', s.contentId),
    ).toBe(0);

    // The obligation is durable: the retry commits the warning with its audit.
    expect(await reevaluateSessionConsent(prisma, s.fixture.sessionId)).toMatchObject({
      warningsRaised: 1,
    });
    expect(await contentRow(s.contentId)).toMatchObject({
      mediaConsentMissing: true,
      visibility: 'public',
      version: before.version + 1,
    });
    expect(await consentWarningAudits(s.contentId)).toHaveLength(1);
  });

  it('replacement of a warned public recording goes through the ordinary quarantine transition and the old public key stops being served', async () => {
    const s = await scenario('service-replacement');
    // This test owns replacement behavior, not asynchronous consent delivery.
    // Replacement itself wakes the consent worker for every linked Session, so
    // the precondition is set directly AND made genuine: the worker must find
    // the warning already right, or it could clear it — and move the
    // optimistic version — between upload initiation and commit.
    await warnedWithoutJob(s);
    const replacement = await replaceScenarioFile(s, 'service-replacement-winner');

    const current = await contentRow(s.contentId);
    expect(current).toMatchObject({
      storageKey: replacement.key,
      storageBucket: BUCKETS.public,
      visibility: 'public',
      mediaConsentMissing: true,
      consentForcedPrivate: false,
    });
    // The exact old key was copied to `quarantine/…` in its own bucket and
    // removed (TD-9), never migrated to private on consent grounds (R170 §3).
    expect(await statObjectStrict(clients, BUCKETS.public, s.key)).toBeNull();
    expect(await hashStoredObject(
      clients,
      BUCKETS.public,
      quarantineKeyFor(s.contentId, s.key),
    )).toEqual(digestOf(s.bytes));
    expect(await statObjectStrict(clients, BUCKETS.private, s.key)).toBeNull();
    expect(await statObjectStrict(
      clients,
      BUCKETS.private,
      quarantineKeyFor(s.contentId, s.key),
    )).toBeNull();
    // The old coordinate is no longer named by any live row, so Nginx refuses
    // it; the quarantine copy is never a public coordinate at all.
    await expectUnavailableAtNginx(s.key);
    await expectUnavailableAtNginx(quarantineKeyFor(s.contentId, s.key));
    // The NEW key is public and served: the warning forced nothing.
    expect((await fetch(publicObjectUrl(replacement.key))).status).toBe(200);
    await expectServedAtNginx(replacement.key);
    expect(await hashStoredObject(clients, BUCKETS.public, replacement.key)).toEqual(
      digestOf(replacement.bytes),
    );

    // One obligation, the ordinary one, settled with the request.
    expect(
      await prisma.storageRetirement.findMany({ where: { contentId: s.contentId } }),
    ).toEqual([
      expect.objectContaining({
        operation: 'quarantine_retired_object',
        bucket: BUCKETS.public,
        storageKey: null,
        completedAt: expect.any(Date),
      }),
    ]);
    expect(await jobCount(JOB_QUEUES.contentBucketMigrate, 'content_id', s.contentId)).toBe(0);
  });

  it('deletion of a warned public recording quarantines the exact old key through the ordinary transition and recovers its retirement job', async () => {
    const s = await scenario('service-deletion');
    await warnedWithoutJob(s);
    await deleteContent(
      prisma,
      failingPublicDelete(clients, s.key, 'before'),
      adminActor(s),
      s.contentId,
    );

    expect(await contentRow(s.contentId)).toMatchObject({ deletedAt: expect.any(Date) });
    // The stale coordinate is denied by the database gate at once, even while
    // the failed delete has left the object in place.
    expect(await statObjectStrict(clients, BUCKETS.public, s.key)).not.toBeNull();
    await expectUnavailableAtNginx(s.key);
    expect(
      await prisma.storageRetirement.findMany({
        where: { contentId: s.contentId },
        select: { operation: true, bucket: true },
      }),
    ).toEqual([{ operation: 'quarantine_retired_object', bucket: BUCKETS.public }]);

    await runProductionJob(
      JOB_QUEUES.contentQuarantinePurge,
      'content_id',
      s.contentId,
      'quarantine_retired_object',
    );
    expect(await statObjectStrict(clients, BUCKETS.public, s.key)).toBeNull();
    expect(await hashStoredObject(
      clients,
      BUCKETS.public,
      quarantineKeyFor(s.contentId, s.key),
    )).toEqual(digestOf(s.bytes));
    expect(await statObjectStrict(clients, BUCKETS.private, s.key)).toBeNull();
    expect(
      await prisma.storageRetirement.findFirstOrThrow({ where: { contentId: s.contentId } }),
    ).toMatchObject({ completedAt: expect.any(Date), storageKey: null });
  });

  it('recovers when the quarantine delete succeeded but the transaction rolled back', async () => {
    const s = await scenario('ambiguous-delete');
    await warnedWithoutJob(s);
    await deleteContent(
      prisma,
      failingPublicDelete(clients, s.key, 'after'),
      adminActor(s),
      s.contentId,
    );
    // The delete really happened; only its reply was lost. A missing source is
    // success on retry: the verified quarantine copy is the recovery boundary.
    expect(await statObjectStrict(clients, BUCKETS.public, s.key)).toBeNull();
    expect(await hashStoredObject(
      clients,
      BUCKETS.public,
      quarantineKeyFor(s.contentId, s.key),
    )).toEqual(digestOf(s.bytes));

    await runProductionJob(
      JOB_QUEUES.contentQuarantinePurge,
      'content_id',
      s.contentId,
      'quarantine_retired_object',
    );
    expect(
      await prisma.storageRetirement.findFirstOrThrow({ where: { contentId: s.contentId } }),
    ).toMatchObject({
      operation: 'quarantine_retired_object',
      completedAt: expect.any(Date),
      storageKey: null,
    });
    expect(await hashStoredObject(
      clients,
      BUCKETS.public,
      quarantineKeyFor(s.contentId, s.key),
    )).toEqual(digestOf(s.bytes));
  });

  it('a durable obligation survives a worker restart and drains through pg-boss', async () => {
    const firstProcess = boss();
    await firstProcess.start();
    await firstProcess.createQueue(JOB_QUEUES.consentReevaluate, TD7_RETRY_POLICY);
    await firstProcess.updateQueue(JOB_QUEUES.consentReevaluate, TD7_RETRY_POLICY);
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
    try {
      try {
        await waitUntil(async () => {
          const row = await contentRow(s.contentId);
          return row.mediaConsentMissing;
        }, 'consent worker to drain', 5_000);
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
          WHERE name = ${JOB_QUEUES.consentReevaluate}
            AND data->>'session_id' = ${s.fixture.sessionId}
          ORDER BY created_on
        `;
        const row = await contentRow(s.contentId);
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
            mediaConsentMissing: row.mediaConsentMissing,
          })}`,
        );
      }
    } finally {
      await restarted.stop({ graceful: true });
    }
    // Drained into a warning, and nothing else: the object stayed where it was.
    expect(await contentRow(s.contentId)).toMatchObject({
      visibility: 'public',
      storageBucket: BUCKETS.public,
    });
    expect(await statObjectStrict(clients, BUCKETS.public, s.key)).not.toBeNull();
    expect(await statObjectStrict(clients, BUCKETS.private, s.key)).toBeNull();
  });

  it('pg-boss retries a transient storage failure with the registered TD-7 policy', async () => {
    const s = await scenario('pgboss-retry');
    // Establish an ordinary exact-key obligation WITHOUT putting it on the live
    // application's shared queue: its worker would otherwise complete the row
    // first and nothing would isolate which execution consumed the injected
    // storage failure. The row is soft-deleted directly so the coordinate is
    // no longer canonical, and the obligation is written as `requireRetirement`
    // would, minus its wake-up.
    await prisma.educationalContent.update({
      where: { id: s.contentId },
      data: { deletedAt: new Date(), deletedById: s.actorId },
    });
    const obligation = await prisma.storageRetirement.create({
      data: {
        dedupKey: createHash('sha256').update(`b01-storage-retry:${s.contentId}`).digest('hex'),
        contentId: s.contentId,
        operation: 'quarantine_retired_object',
        bucket: BUCKETS.public,
        storageKey: s.key,
      },
    });

    const flaky = failingPublicDelete(clients, s.key, 'before');
    const queue = `b01-storage-retry-${randomUUID()}`;
    const worker = boss();
    await worker.start();
    const registered = await worker.getQueue(JOB_QUEUES.contentQuarantinePurge);
    expect(registered).toMatchObject(TD7_RETRY_POLICY);
    await worker.createQueue(queue, TD7_RETRY_POLICY);
    const id = await worker.send(queue, { retirement_id: obligation.id });
    if (!id) throw new Error('pg-boss did not return a storage retry job id');
    await worker.work(
      queue,
      { pollingIntervalSeconds: 0.5 },
      async ([job]) => {
        if (!job) throw new Error('quarantine worker received no job');
        const data = job.data as { retirement_id: string };
        await executeRetirement(prisma, flaky, data.retirement_id);
      },
    );
    try {
      await waitUntil(async () => {
        const record = await prisma.storageRetirement.findUniqueOrThrow({
          where: { id: obligation.id },
        });
        return record.completedAt !== null;
      }, 'TD-7 storage retry to complete');
      await waitUntil(async () => {
        const [job] = await prisma.$queryRaw<{ state: string; retry_count: number }[]>`
          SELECT state::text, retry_count
          FROM pgboss.job
          WHERE name = ${queue} AND id = ${id}::uuid
        `;
        return job?.state === 'completed' && job.retry_count === 1;
      }, 'TD-7 storage retry job to reach its terminal state');
      const jobs = await prisma.$queryRaw<{ state: string; retry_count: number }[]>`
        SELECT state::text, retry_count
        FROM pgboss.job
        WHERE name = ${queue} AND id = ${id}::uuid
      `;
      expect(jobs[0]).toMatchObject({ state: 'completed', retry_count: 1 });
      // The first attempt recorded its failure on the domain row; the retry
      // found the verified quarantine copy and finished the exact-key delete.
      expect(
        await prisma.storageRetirement.findUniqueOrThrow({ where: { id: obligation.id } }),
      ).toMatchObject({ attempts: 1, lastErrorCode: null, storageKey: null });
      expect(await statObjectStrict(clients, BUCKETS.public, s.key)).toBeNull();
      expect(await hashStoredObject(
        clients,
        BUCKETS.public,
        quarantineKeyFor(s.contentId, s.key),
      )).toEqual(digestOf(s.bytes));
    } finally {
      await worker.deleteQueue(queue);
      await worker.stop({ graceful: true });
    }
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
