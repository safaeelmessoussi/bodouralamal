import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { quarantineKeyFor } from '../lib/file-types.js';
import { hashStoredObject } from '../lib/object-verification.js';
import {
  BUCKETS,
  copyObject,
  deleteObject,
  statObjectStrict,
  type StorageClients,
} from '../lib/storage.js';
import { audienceForSession, resolveAudience } from '../policies/roster-resolution.js';
import * as audit from '../repositories/audit.repository.js';
import {
  isCurrentPublicObject,
  lockEducationalContent,
  lockLiveSessions,
} from '../repositories/consent-safeguarding.repository.js';
import { enqueue, JOB_QUEUES } from '../repositories/jobs.repository.js';

/**
 * BR-2 safeguarding and its durable storage transition (SRS §4.1a, §4.9,
 * TD-4.9 and TD-7).
 *
 * The two jobs deliberately have different responsibilities:
 *
 * - `consent.reevaluate` resolves the current audience and commits the
 *   monotonic application/public-proxy gate immediately. Public content also
 *   receives a durable, exact-key migration obligation.
 * - `content.bucket-migrate` revalidates the monotonic safeguard, copies and
 *   verifies the immutable canonical bytes, retires the public object, and
 *   commits authoritative private placement.
 *
 * Nginx authorizes every public GET/HEAD against that exact database coordinate,
 * so the committed flag makes an object unreachable at the public origin even
 * while copy–verify–delete is still pending. Direct MinIO is network-internal in
 * production; the migration then closes the physical storage obligation.
 */

export interface ConsentReevaluationOutcome {
  sessionId: string;
  recordingsInspected: number;
  recordingsForced: number;
  migrationsEnqueued: number;
}

export interface BucketMigrationOutcome {
  contentId: string;
  state: 'completed' | 'already_completed' | 'retired' | 'stale' | 'deleted';
}

export interface ConsentSweepOutcome {
  sessionsScanned: number;
  obligationsInserted: number;
  batches: number;
}

export interface ConsentSweepOptions {
  batchSize?: number;
  /** Integration isolation only. Production startup always omits this and
   * scans the complete live recording set. */
  onlySessionIds?: readonly string[];
}

export interface BucketMigrationTestHooks {
  /** Deterministic concurrency barrier used only by real-stack regression
   * tests. Production callers never provide hooks. */
  afterVerifiedCopy?: (snapshot: {
    contentId: string;
    version: number;
    storageKey: string;
  }) => Promise<void>;
}

export interface ConsentReevaluationTestHooks {
  /** Pauses after the complete candidate graph is discovered and before any
   * Session row is locked. Reverting to seed-first locking makes the opposing
   * deterministic regression block before its barrier. */
  beforeSessionLocks?: (sessionIds: readonly string[]) => Promise<void>;
}

const CONSENT_SWEEP_BATCH_SIZE = 100;

class ConsentGraphChangedError extends Error {
  override readonly name = 'ConsentGraphChangedError';
}

/** Same-transaction enqueue for a known set of affected occurrences. */
export async function enqueueConsentReevaluationForSessions(
  tx: Prisma.TransactionClient,
  sessionIds: readonly string[],
): Promise<string[]> {
  const locked = await lockLiveSessions(tx, sessionIds);
  for (const sessionId of locked) {
    await enqueue(
      tx,
      JOB_QUEUES.consentReevaluate,
      { session_id: sessionId },
      sessionId,
    );
  }
  return locked;
}

export function contentMigrationSingletonKey(contentId: string, sourceKey: string): string {
  return `${contentId}:consent:${sourceKey}`;
}

export async function enqueueConsentContentMigration(
  tx: Prisma.TransactionClient,
  contentId: string,
  sourceKey: string,
): Promise<boolean> {
  return enqueue(
    tx,
    JOB_QUEUES.contentBucketMigrate,
    {
      content_id: contentId,
      target_bucket: BUCKETS.private,
      source_key: sourceKey,
    },
    contentMigrationSingletonKey(contentId, sourceKey),
  );
}

/** Nginx auth-subrequest decision for an anonymous public object read. */
export async function publicObjectIsReadable(
  prisma: PrismaClient,
  storageKey: string,
): Promise<boolean> {
  return isCurrentPublicObject(prisma, storageKey);
}

/** A B-01 exact-coordinate obligation. It shares TD-7's placement worker rather
 * than inventing a general quarantine worker: only a public canonical key that
 * consent safeguarding has made unreachable enters this path. */
export async function enqueueConsentPublicRetirement(
  tx: Prisma.TransactionClient,
  contentId: string,
  sourceKey: string,
): Promise<boolean> {
  return enqueue(
    tx,
    JOB_QUEUES.contentBucketMigrate,
    {
      content_id: contentId,
      target_bucket: BUCKETS.private,
      operation: 'retire_public',
      source_key: sourceKey,
    },
    contentMigrationSingletonKey(contentId, sourceKey),
  );
}

/**
 * Startup/rollout reconciliation for data predating the complete trigger graph.
 * It scans only live Session-recording links, in bounded UUID batches, and uses
 * the ordinary transactional singleton enqueue. A restart repeats safely; it
 * never mutates owner content or guesses consent itself.
 */
export async function enqueueConsentSafeguardingSweep(
  prisma: PrismaClient,
  options: ConsentSweepOptions = {},
): Promise<ConsentSweepOutcome> {
  const batchSize = options.batchSize ?? CONSENT_SWEEP_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1_000) {
    throw new Error('consent safeguarding sweep batch size must be 1..1000');
  }

  let cursor: string | undefined;
  let sessionsScanned = 0;
  let obligationsInserted = 0;
  let batches = 0;
  while (true) {
    const rows = await prisma.session.findMany({
      where: {
        deletedAt: null,
        id: {
          ...(options.onlySessionIds === undefined
            ? {}
            : { in: [...options.onlySessionIds] }),
          ...(cursor === undefined ? {} : { gt: cursor }),
        },
        linkedContent: {
          some: {
            deletedAt: null,
            content: { deletedAt: null, origin: 'session_recording' },
          },
        },
      },
      orderBy: { id: 'asc' },
      take: batchSize,
      select: { id: true },
    });
    if (rows.length === 0) break;

    const ids = rows.map((row) => row.id);
    obligationsInserted += await prisma.$transaction(async (tx) => {
      const locked = await lockLiveSessions(tx, ids);
      let inserted = 0;
      for (const sessionId of locked) {
        if (
          await enqueue(
            tx,
            JOB_QUEUES.consentReevaluate,
            { session_id: sessionId },
            sessionId,
          )
        ) {
          inserted += 1;
        }
      }
      return inserted;
    });
    sessionsScanned += rows.length;
    batches += 1;
    cursor = rows.at(-1)?.id;
    if (rows.length < batchSize) break;
  }

  return { sessionsScanned, obligationsInserted, batches };
}

/**
 * The inverse of canonical roster resolution: every current occurrence whose
 * resolved audience contains this student. It includes R92 occurrence-level
 * branch overrides instead of assuming an entire-Level occurrence always uses
 * its schedule's branch.
 *
 * Removal callers invoke this before tombstoning membership; creation callers
 * invoke it after insertion. Moves invoke both sides in one transaction.
 */
export async function enqueueConsentReevaluationForStudent(
  tx: Prisma.TransactionClient,
  studentId: string,
): Promise<string[]> {
  return enqueueConsentReevaluationForSessions(
    tx,
    await consentSessionIdsForStudent(tx, studentId),
  );
}

/** Read-only half exposed for a move that must union its before/after audience
 * before taking deterministic locks. Ordinary mutations use the enqueue helper
 * above so callers cannot accidentally forget the durable obligation. */
export async function consentSessionIdsForStudent(
  tx: Prisma.TransactionClient,
  studentId: string,
): Promise<string[]> {
  const [enrolments, seats] = await Promise.all([
    tx.enrollment.findMany({
      where: { studentId, deletedAt: null },
      select: {
        levelId: true,
        branchId: true,
        administrativeGroupId: true,
      },
    }),
    tx.studentTeachingGroup.findMany({
      where: { studentId, deletedAt: null, teachingGroup: { deletedAt: null } },
      select: { teachingGroupId: true },
    }),
  ]);

  const levelIds = [...new Set(enrolments.map((row) => row.levelId))];
  const administrativeGroupIds = enrolments
    .map((row) => row.administrativeGroupId)
    .filter((id): id is string => id !== null);
  const teachingGroupIds = seats.map((row) => row.teachingGroupId);
  if (
    levelIds.length === 0 &&
    administrativeGroupIds.length === 0 &&
    teachingGroupIds.length === 0
  ) {
    return [];
  }

  const candidates = await tx.session.findMany({
    where: {
      deletedAt: null,
      schedule: {
        OR: [
          ...(levelIds.length === 0
            ? []
            : [{ teachingMode: 'entire_level' as const, levelId: { in: levelIds } }]),
          ...(administrativeGroupIds.length === 0
            ? []
            : [
                {
                  teachingMode: 'administrative_group' as const,
                  administrativeGroupId: { in: administrativeGroupIds },
                },
              ]),
          ...(teachingGroupIds.length === 0
            ? []
            : [
                {
                  teachingMode: 'teaching_group' as const,
                  teachingGroupId: { in: teachingGroupIds },
                },
              ]),
        ],
      },
    },
    select: {
      id: true,
      audienceBranches: { select: { branchId: true } },
      schedule: {
        select: {
          teachingMode: true,
          levelId: true,
          branchId: true,
        },
      },
    },
  });

  const branchesByLevel = new Map<string, Set<string>>();
  for (const row of enrolments) {
    const branches = branchesByLevel.get(row.levelId) ?? new Set<string>();
    branches.add(row.branchId);
    branchesByLevel.set(row.levelId, branches);
  }
  const affected = candidates
    .filter((session) => {
      if (session.schedule?.teachingMode !== 'entire_level') return true;
      if (session.schedule.levelId === null) return false;
      const enrolledBranches = branchesByLevel.get(session.schedule.levelId);
      if (!enrolledBranches) return false;
      const audienceBranches =
        session.audienceBranches.length > 0
          ? session.audienceBranches.map((row) => row.branchId)
          : [session.schedule.branchId];
      return audienceBranches.some((branchId) => enrolledBranches.has(branchId));
    })
    .map((session) => session.id);

  return affected;
}

function latestMediaConsent(
  rows: readonly { studentId: string; granted: boolean }[],
): Map<string, boolean> {
  const result = new Map<string, boolean>();
  for (const row of rows) {
    if (!result.has(row.studentId)) result.set(row.studentId, row.granted);
  }
  return result;
}

async function recordingContentIdsForSession(
  tx: Prisma.TransactionClient,
  sessionId: string,
): Promise<string[]> {
  return (
    await tx.educationalContent.findMany({
      where: {
        deletedAt: null,
        origin: 'session_recording',
        sessionLinks: {
          some: { sessionId, deletedAt: null, session: { deletedAt: null } },
        },
      },
      select: { id: true },
    })
  ).map((row) => row.id);
}

async function linkedSessionIdsForContent(
  tx: Prisma.TransactionClient,
  contentIds: readonly string[],
): Promise<string[]> {
  if (contentIds.length === 0) return [];
  return (
    await tx.sessionContent.findMany({
      where: {
        contentId: { in: [...contentIds] },
        deletedAt: null,
        session: { deletedAt: null },
      },
      select: { sessionId: true },
    })
  ).map((row) => row.sessionId);
}

async function unsafeRecordingContentIds(
  tx: Prisma.TransactionClient,
  contentIds: readonly string[],
  lockedSessionIds: readonly string[],
): Promise<Set<string>> {
  if (contentIds.length === 0 || lockedSessionIds.length === 0) return new Set();
  const lockedSet = new Set(lockedSessionIds);
  const currentLinks = await linkedSessionIdsForContent(tx, contentIds);
  if (currentLinks.some((id) => !lockedSet.has(id))) {
    throw new ConsentGraphChangedError('recording link graph changed while acquiring locks');
  }

  const audienceBySession = new Map<string, string[]>();
  for (const linkedSessionId of lockedSessionIds) {
    const spec = await audienceForSession(tx, linkedSessionId);
    if (spec === null) continue;
    const audience = await resolveAudience(tx, spec);
    audienceBySession.set(linkedSessionId, audience.map((row) => row.id));
  }
  const studentIds = [...new Set([...audienceBySession.values()].flat())];
  const consentRows =
    studentIds.length === 0
      ? []
      : await tx.consentRecord.findMany({
          where: {
            studentId: { in: studentIds },
            consentType: 'media_release',
          },
          orderBy: [{ grantedAt: 'desc' }, { id: 'desc' }],
          select: { studentId: true, granted: true },
        });
  const consent = latestMediaConsent(consentRows);
  const links = await tx.sessionContent.findMany({
    where: {
      contentId: { in: [...contentIds] },
      deletedAt: null,
      sessionId: { in: [...lockedSessionIds] },
    },
    select: { contentId: true, sessionId: true },
  });

  const unsafe = new Set<string>();
  for (const link of links) {
    const audience = audienceBySession.get(link.sessionId) ?? [];
    if (audience.length > 0 && audience.some((id) => consent.get(id) !== true)) {
      unsafe.add(link.contentId);
    }
  }
  return unsafe;
}

/** Caller must already hold every supplied Session anchor in sorted order. */
export async function recordingContentRequiresSafeguardUnderLocks(
  tx: Prisma.TransactionClient,
  contentId: string,
  lockedSessionIds: readonly string[],
): Promise<boolean> {
  return (await unsafeRecordingContentIds(tx, [contentId], lockedSessionIds)).has(contentId);
}

async function reevaluateSessionConsentOnce(
  prisma: PrismaClient,
  sessionId: string,
  hooks: ConsentReevaluationTestHooks,
): Promise<ConsentReevaluationOutcome> {
  return prisma.$transaction(async (tx) => {
    const initialContentIds = await recordingContentIdsForSession(tx, sessionId);
    const initialSessionIds = [
      sessionId,
      ...(await linkedSessionIdsForContent(tx, initialContentIds)),
    ];
    await hooks.beforeSessionLocks?.([...new Set(initialSessionIds)].sort());
    const lockedSessionIds = await lockLiveSessions(tx, initialSessionIds);
    if (!lockedSessionIds.includes(sessionId)) {
      return {
        sessionId,
        recordingsInspected: 0,
        recordingsForced: 0,
        migrationsEnqueued: 0,
      };
    }

    // Re-read after the one global lock acquisition. A link writer also locks
    // this graph and enqueues a follow-up; if it won just before us and enlarged
    // the graph, retry the transaction rather than taking a lower lock late.
    const contentIds = await recordingContentIdsForSession(tx, sessionId);
    const linkedSessionIds = await linkedSessionIdsForContent(tx, contentIds);
    const lockedSet = new Set(lockedSessionIds);
    if (linkedSessionIds.some((id) => !lockedSet.has(id))) {
      throw new ConsentGraphChangedError('recording graph grew before Session locks settled');
    }
    if (contentIds.length === 0) {
      return {
        sessionId,
        recordingsInspected: 0,
        recordingsForced: 0,
        migrationsEnqueued: 0,
      };
    }

    const unsafeContentIds = await unsafeRecordingContentIds(
      tx,
      contentIds,
      lockedSessionIds,
    );
    const sortedContentIds = [...new Set(contentIds)].sort();
    await lockEducationalContent(tx, sortedContentIds);
    const contents = await tx.educationalContent.findMany({
      where: { id: { in: sortedContentIds }, deletedAt: null },
      select: {
        id: true,
        visibility: true,
        consentForcedPrivate: true,
        storageBucket: true,
        storageKey: true,
      },
    });

    let recordingsForced = 0;
    let migrationsEnqueued = 0;
    for (const content of contents.sort((a, b) => a.id.localeCompare(b.id))) {
      if (!unsafeContentIds.has(content.id)) continue;
      const expectedBucket = content.visibility === 'public' ? BUCKETS.public : BUCKETS.private;
      if (content.storageBucket !== expectedBucket) {
        throw new Error(
          `content ${content.id} violates visibility/bucket placement before consent reconciliation`,
        );
      }

      if (!content.consentForcedPrivate) {
        await tx.educationalContent.update({
          where: { id: content.id },
          data: { consentForcedPrivate: true, version: { increment: 1 } },
        });
        await audit.write(tx, {
          actorUserId: null,
          actionType: 'content.visibility_change',
          targetEntity: 'EducationalContent',
          targetId: content.id,
          detail: {
            reason: 'consent_gate',
            old_visibility: content.visibility,
            new_visibility: content.visibility,
            old_consent_forced_private: false,
            new_consent_forced_private: true,
            bucket_migration_pending: content.visibility === 'public',
            source_session_id: sessionId,
          },
        });
        recordingsForced += 1;
      }

      // Re-enqueue even when the flag was already true. The exact source key
      // makes a stale retry safe across replacement/deletion, while the public
      // proxy gate above already denies this coordinate after COMMIT.
      if (
        content.visibility === 'public' &&
        await enqueueConsentContentMigration(tx, content.id, content.storageKey)
      ) {
        migrationsEnqueued += 1;
      }
    }

    return {
      sessionId,
      recordingsInspected: contents.length,
      recordingsForced,
      migrationsEnqueued,
    };
  });
}

/** Full, idempotent recompute for one occurrence and every recording it shares. */
export async function reevaluateSessionConsent(
  prisma: PrismaClient,
  sessionId: string,
  hooks: ConsentReevaluationTestHooks = {},
): Promise<ConsentReevaluationOutcome> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await reevaluateSessionConsentOnce(prisma, sessionId, hooks);
    } catch (error) {
      if (!(error instanceof ConsentGraphChangedError) || attempt === 2) throw error;
    }
  }
  throw new Error('unreachable consent reevaluation retry state');
}

/** Moves one obsolete consent-governed public coordinate into private
 * quarantine and retires the anonymous source. Missing source is success: a
 * repeated or ambiguous delete has already reached the required state. */
export async function retireConsentPublicObject(
  clients: StorageClients,
  contentId: string,
  sourceKey: string,
): Promise<void> {
  const sourceStat = await statObjectStrict(clients, BUCKETS.public, sourceKey);
  if (sourceStat === null) return;

  const source = await hashStoredObject(clients, BUCKETS.public, sourceKey);
  if (source === null) return;
  const quarantineKey = quarantineKeyFor(contentId, sourceKey);
  const destinationStat = await statObjectStrict(clients, BUCKETS.private, quarantineKey);
  if (destinationStat === null) {
    await copyObject(
      clients,
      { bucket: BUCKETS.public, key: sourceKey },
      { bucket: BUCKETS.private, key: quarantineKey },
      undefined,
      {
        ...(sourceStat.etag === null ? {} : { sourceIfMatch: sourceStat.etag }),
        sha256: source.sha256,
      },
    );
  }
  const destination = await hashStoredObject(clients, BUCKETS.private, quarantineKey);
  const verifiedDestinationStat = await statObjectStrict(
    clients,
    BUCKETS.private,
    quarantineKey,
  );
  if (
    destination === null ||
    destination.sha256 !== source.sha256 ||
    destination.sizeBytes !== source.sizeBytes ||
    verifiedDestinationStat?.sha256 !== source.sha256
  ) {
    throw new Error(`private consent quarantine verification failed for ${contentId}`);
  }
  await deleteObject(clients, BUCKETS.public, sourceKey);
}

/**
 * TD-7 `content.bucket-migrate`, restricted to BR-2's public → private arm.
 * `sourceKey` pins the exact object named when the obligation was committed, so
 * a replacement/deletion cannot turn a retry into a delete of newer bytes.
 */
export async function migrateConsentForcedContent(
  prisma: PrismaClient,
  clients: StorageClients,
  contentId: string,
  sourceKeyOrHooks?: string | BucketMigrationTestHooks,
  hooks: BucketMigrationTestHooks = {},
): Promise<BucketMigrationOutcome> {
  const sourceKey =
    typeof sourceKeyOrHooks === 'string' ? sourceKeyOrHooks : undefined;
  const testHooks =
    typeof sourceKeyOrHooks === 'object' ? sourceKeyOrHooks : hooks;
  const snapshot = await prisma.educationalContent.findUnique({
    where: { id: contentId },
    select: {
      id: true,
      deletedAt: true,
      visibility: true,
      consentForcedPrivate: true,
      storageBucket: true,
      storageKey: true,
      mimeType: true,
      sizeBytes: true,
      version: true,
    },
  });
  if (
    sourceKey !== undefined &&
    (snapshot === null || snapshot.deletedAt !== null || snapshot.storageKey !== sourceKey)
  ) {
    await retireConsentPublicObject(clients, contentId, sourceKey);
    return { contentId, state: 'retired' };
  }
  if (snapshot === null || snapshot.deletedAt !== null) {
    return { contentId, state: 'deleted' };
  }

  const exactSourceKey = sourceKey ?? snapshot.storageKey;
  if (
    snapshot.storageBucket === BUCKETS.private &&
    snapshot.visibility !== 'public' &&
    snapshot.consentForcedPrivate
  ) {
    const destination = await statObjectStrict(clients, BUCKETS.private, exactSourceKey);
    if (destination === null) {
      throw new Error(`private canonical object is missing for content ${contentId}`);
    }
    await deleteObject(clients, BUCKETS.public, exactSourceKey);
    return { contentId, state: 'already_completed' };
  }
  if (
    snapshot.visibility !== 'public' ||
    snapshot.storageBucket !== BUCKETS.public
  ) {
    return { contentId, state: 'stale' };
  }

  const sourceStat = await statObjectStrict(clients, BUCKETS.public, exactSourceKey);
  const destinationStat = await statObjectStrict(clients, BUCKETS.private, exactSourceKey);
  let expectedSha256: string;
  if (sourceStat !== null) {
    const source = await hashStoredObject(clients, BUCKETS.public, exactSourceKey);
    if (source === null) throw new Error(`public canonical object disappeared for ${contentId}`);
    if (BigInt(source.sizeBytes) !== snapshot.sizeBytes) {
      throw new Error(`public canonical object size changed for content ${contentId}`);
    }
    expectedSha256 = source.sha256;
    if (destinationStat === null) {
      await copyObject(
        clients,
        { bucket: BUCKETS.public, key: exactSourceKey },
        { bucket: BUCKETS.private, key: exactSourceKey },
        snapshot.mimeType,
        {
          ...(sourceStat.etag === null ? {} : { sourceIfMatch: sourceStat.etag }),
          sha256: expectedSha256,
        },
      );
    }
  } else {
    if (destinationStat?.sha256 === null || destinationStat === null) {
      throw new Error(`no recoverable canonical object exists for content ${contentId}`);
    }
    expectedSha256 = destinationStat.sha256;
  }

  const destination = await hashStoredObject(clients, BUCKETS.private, exactSourceKey);
  const verifiedDestinationStat = await statObjectStrict(
    clients,
    BUCKETS.private,
    exactSourceKey,
  );
  if (
    destination === null ||
    destination.sha256 !== expectedSha256 ||
    BigInt(destination.sizeBytes) !== snapshot.sizeBytes ||
    verifiedDestinationStat?.sha256 !== expectedSha256
  ) {
    throw new Error(`private copy verification failed for content ${contentId}`);
  }

  await testHooks.afterVerifiedCopy?.({
    contentId,
    version: snapshot.version,
    storageKey: exactSourceKey,
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const outcome = await prisma.$transaction(async (tx) => {
        const initialSessionIds = await linkedSessionIdsForContent(tx, [contentId]);
        const lockedSessionIds = await lockLiveSessions(tx, initialSessionIds);
        const currentSessionIds = await linkedSessionIdsForContent(tx, [contentId]);
        const lockedSet = new Set(lockedSessionIds);
        if (currentSessionIds.some((id) => !lockedSet.has(id))) {
          throw new ConsentGraphChangedError('recording graph grew before migration locks settled');
        }

        await lockEducationalContent(tx, [contentId]);
        const current = await tx.educationalContent.findUnique({
          where: { id: contentId },
          select: {
            deletedAt: true,
            visibility: true,
            consentForcedPrivate: true,
            storageBucket: true,
            storageKey: true,
            version: true,
          },
        });
        if (
          current === null ||
          current.deletedAt !== null ||
          current.storageKey !== exactSourceKey
        ) {
          return 'retire' as const;
        }
        if (
          current.visibility !== 'public' ||
          current.storageBucket !== BUCKETS.public
        ) {
          return current.consentForcedPrivate ? 'already_completed' as const : 'stale' as const;
        }
        if (current.version !== snapshot.version) {
          throw new Error(`content ${contentId} changed without replacing its canonical key`);
        }

        const unsafe = current.consentForcedPrivate ||
          (await recordingContentRequiresSafeguardUnderLocks(
            tx,
            contentId,
            lockedSessionIds,
          ));
        if (!unsafe) return 'stale' as const;

        await deleteObject(clients, BUCKETS.public, exactSourceKey);
        await tx.educationalContent.update({
          where: { id: contentId },
          data: {
            consentForcedPrivate: true,
            visibility: 'private',
            storageBucket: BUCKETS.private,
            version: { increment: 1 },
          },
        });
        if (!current.consentForcedPrivate) {
          await audit.write(tx, {
            actorUserId: null,
            actionType: 'content.visibility_change',
            targetEntity: 'EducationalContent',
            targetId: contentId,
            detail: {
              reason: 'consent_gate',
              old_visibility: 'public',
              new_visibility: 'public',
              old_consent_forced_private: false,
              new_consent_forced_private: true,
              anonymous_source_retired_before_commit: true,
            },
          });
        }
        await audit.write(tx, {
          actorUserId: null,
          actionType: 'content.visibility_change',
          targetEntity: 'EducationalContent',
          targetId: contentId,
          detail: {
            reason: 'consent_gate',
            old_visibility: 'public',
            new_visibility: 'private',
            old_bucket: BUCKETS.public,
            new_bucket: BUCKETS.private,
            consent_forced_private: true,
            source_retired_before_commit: true,
            content_sha256: expectedSha256,
          },
        });
        return 'completed' as const;
      });

      if (outcome === 'retire') {
        await retireConsentPublicObject(clients, contentId, exactSourceKey);
        return { contentId, state: 'retired' };
      }
      return { contentId, state: outcome };
    } catch (error) {
      if (!(error instanceof ConsentGraphChangedError) || attempt === 2) throw error;
    }
  }
  throw new Error('unreachable consent migration retry state');
}
