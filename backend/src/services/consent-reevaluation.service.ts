import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
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
import { enqueue, JOB_QUEUES } from '../repositories/jobs.repository.js';

/**
 * BR-2 safeguarding and its durable storage transition (SRS §4.1a, §4.9,
 * TD-4.9 and TD-7).
 *
 * The two jobs deliberately have different responsibilities:
 *
 * - `consent.reevaluate` resolves the current audience and closes every
 *   application read gate by setting `consent_forced_private` transactionally.
 * - `content.bucket-migrate` copies and verifies the immutable canonical bytes,
 *   retires the public object, and only then changes authoritative visibility
 *   and placement together.
 *
 * During that bounded transition the row remains `visibility = public` and
 * `storage_bucket = public`, so B-02 still has one placement authority. The
 * consent flag is the explicit fail-closed application gate; the database is
 * never allowed to claim `private` while the old anonymous object still exists.
 */

export interface ConsentReevaluationOutcome {
  sessionId: string;
  recordingsInspected: number;
  recordingsForced: number;
  migrationsEnqueued: number;
}

export interface BucketMigrationOutcome {
  contentId: string;
  state: 'completed' | 'already_completed' | 'stale' | 'deleted';
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

/** Deterministic Session anchors serialize roster/link mutations with the full
 * recompute. Row locks are the sanctioned §16.2 raw-SQL exception. */
export async function lockConsentSessions(
  tx: Prisma.TransactionClient,
  sessionIds: readonly string[],
): Promise<string[]> {
  const ids = [...new Set(sessionIds)].sort();
  if (ids.length === 0) return [];
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id"
    FROM "session"
    WHERE "id" = ANY(${ids}::uuid[])
      AND "deleted_at" IS NULL
    ORDER BY "id"
    FOR UPDATE
  `;
  return rows.map((row) => row.id);
}

/** Same-transaction enqueue for a known set of affected occurrences. */
export async function enqueueConsentReevaluationForSessions(
  tx: Prisma.TransactionClient,
  sessionIds: readonly string[],
): Promise<string[]> {
  const locked = await lockConsentSessions(tx, sessionIds);
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
        deletedAt: null,
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

/** Full, idempotent recompute for one occurrence and every recording it shares. */
export async function reevaluateSessionConsent(
  prisma: PrismaClient,
  sessionId: string,
): Promise<ConsentReevaluationOutcome> {
  return prisma.$transaction(async (tx) => {
    const seed = await lockConsentSessions(tx, [sessionId]);
    if (seed.length === 0) {
      return {
        sessionId,
        recordingsInspected: 0,
        recordingsForced: 0,
        migrationsEnqueued: 0,
      };
    }

    // A recording can be shared by several occurrences. The consent gate is
    // the union: one unsafe linked audience makes the content non-public.
    const contentIds = (
      await tx.educationalContent.findMany({
        where: {
          deletedAt: null,
          origin: 'session_recording',
          sessionLinks: { some: { sessionId, deletedAt: null } },
        },
        select: { id: true },
      })
    ).map((row) => row.id);
    if (contentIds.length === 0) {
      return {
        sessionId,
        recordingsInspected: 0,
        recordingsForced: 0,
        migrationsEnqueued: 0,
      };
    }

    const linkedSessionIds = (
      await tx.sessionContent.findMany({
        where: {
          contentId: { in: contentIds },
          deletedAt: null,
          session: { deletedAt: null },
        },
        select: { sessionId: true },
      })
    ).map((row) => row.sessionId);
    const lockedSessionIds = await lockConsentSessions(tx, linkedSessionIds);
    const lockedSet = new Set(lockedSessionIds);

    const audienceBySession = new Map<string, string[]>();
    for (const linkedSessionId of lockedSessionIds) {
      const spec = await audienceForSession(tx, linkedSessionId);
      if (spec === null) continue;
      const audience = await resolveAudience(tx, spec);
      audienceBySession.set(
        linkedSessionId,
        audience.map((row) => row.id),
      );
    }
    const studentIds = [
      ...new Set([...audienceBySession.values()].flat()),
    ];
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
        contentId: { in: contentIds },
        deletedAt: null,
        sessionId: { in: lockedSessionIds },
      },
      select: { contentId: true, sessionId: true },
    });
    const unsafeContentIds = new Set<string>();
    for (const link of links) {
      if (!lockedSet.has(link.sessionId)) continue;
      const audience = audienceBySession.get(link.sessionId) ?? [];
      // R43: an empty resolved audience disengages the gate.
      if (audience.length > 0 && audience.some((id) => consent.get(id) !== true)) {
        unsafeContentIds.add(link.contentId);
      }
    }

    const sortedContentIds = [...new Set(contentIds)].sort();
    await tx.$queryRaw`
      SELECT "id"
      FROM "educational_content"
      WHERE "id" = ANY(${sortedContentIds}::uuid[])
      ORDER BY "id"
      FOR UPDATE
    `;
    const contents = await tx.educationalContent.findMany({
      where: { id: { in: sortedContentIds }, deletedAt: null },
      select: {
        id: true,
        visibility: true,
        consentForcedPrivate: true,
        storageBucket: true,
        version: true,
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

      // Re-enqueue even when the flag was already true: this repairs historical
      // queue-only states and makes a duplicate reevaluation a durable recovery
      // mechanism rather than a no-op that strands a public object.
      if (content.visibility === 'public') {
        await enqueue(
          tx,
          JOB_QUEUES.contentBucketMigrate,
          { content_id: content.id, target_bucket: BUCKETS.private },
          content.id,
        );
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

/**
 * Minimum TD-7 `content.bucket-migrate`: consent-forced public → private only.
 * It intentionally does not implement general placement repair or publication.
 */
export async function migrateConsentForcedContent(
  prisma: PrismaClient,
  clients: StorageClients,
  contentId: string,
  hooks: BucketMigrationTestHooks = {},
): Promise<BucketMigrationOutcome> {
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
  if (snapshot === null || snapshot.deletedAt !== null) {
    return { contentId, state: 'deleted' };
  }

  if (
    snapshot.storageBucket === BUCKETS.private &&
    snapshot.visibility !== 'public' &&
    snapshot.consentForcedPrivate
  ) {
    const destination = await statObjectStrict(clients, BUCKETS.private, snapshot.storageKey);
    if (destination === null) {
      throw new Error(`private canonical object is missing for content ${contentId}`);
    }
    // A retry after COMMIT also closes the storage-side idempotency boundary.
    await deleteObject(clients, BUCKETS.public, snapshot.storageKey);
    return { contentId, state: 'already_completed' };
  }
  if (
    snapshot.visibility !== 'public' ||
    snapshot.storageBucket !== BUCKETS.public ||
    !snapshot.consentForcedPrivate
  ) {
    return { contentId, state: 'stale' };
  }

  const sourceStat = await statObjectStrict(clients, BUCKETS.public, snapshot.storageKey);
  const destinationStat = await statObjectStrict(clients, BUCKETS.private, snapshot.storageKey);
  let expectedSha256: string;

  if (sourceStat !== null) {
    const source = await hashStoredObject(clients, BUCKETS.public, snapshot.storageKey);
    if (source === null) throw new Error(`public canonical object disappeared for ${contentId}`);
    if (BigInt(source.sizeBytes) !== snapshot.sizeBytes) {
      throw new Error(`public canonical object size changed for content ${contentId}`);
    }
    expectedSha256 = source.sha256;

    if (destinationStat === null) {
      await copyObject(
        clients,
        { bucket: BUCKETS.public, key: snapshot.storageKey },
        { bucket: BUCKETS.private, key: snapshot.storageKey },
        snapshot.mimeType,
        {
          ...(sourceStat.etag === null ? {} : { sourceIfMatch: sourceStat.etag }),
          sha256: expectedSha256,
        },
      );
    }
  } else {
    // Crash recovery after verified copy + public delete but before DB COMMIT.
    // The private object's server-written digest is the durable proof; without
    // it this worker refuses to guess that an arbitrary destination is safe.
    if (destinationStat?.sha256 === null || destinationStat === null) {
      throw new Error(`no recoverable canonical object exists for content ${contentId}`);
    }
    expectedSha256 = destinationStat.sha256;
  }

  const destination = await hashStoredObject(clients, BUCKETS.private, snapshot.storageKey);
  const verifiedDestinationStat = await statObjectStrict(
    clients,
    BUCKETS.private,
    snapshot.storageKey,
  );
  if (
    destination === null ||
    destination.sha256 !== expectedSha256 ||
    BigInt(destination.sizeBytes) !== snapshot.sizeBytes ||
    verifiedDestinationStat?.sha256 !== expectedSha256
  ) {
    throw new Error(`private copy verification failed for content ${contentId}`);
  }

  await hooks.afterVerifiedCopy?.({
    contentId,
    version: snapshot.version,
    storageKey: snapshot.storageKey,
  });

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT "id" FROM "educational_content"
      WHERE "id" = ${contentId}::uuid
      FOR UPDATE
    `;
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
    if (current === null || current.deletedAt !== null) {
      return { contentId, state: 'deleted' as const };
    }
    if (
      current.version !== snapshot.version ||
      current.visibility !== 'public' ||
      current.storageBucket !== BUCKETS.public ||
      current.storageKey !== snapshot.storageKey ||
      !current.consentForcedPrivate
    ) {
      return { contentId, state: 'stale' as const };
    }

    // This external delete is inside the short row-lock transaction on
    // purpose. A failure rolls the DB transition back; success retires the
    // anonymous object before the row is ever allowed to say `private`.
    await deleteObject(clients, BUCKETS.public, snapshot.storageKey);
    await tx.educationalContent.update({
      where: { id: contentId },
      data: {
        visibility: 'private',
        storageBucket: BUCKETS.private,
        version: { increment: 1 },
      },
    });
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
    return { contentId, state: 'completed' as const };
  });
}
