import { createHash, randomUUID } from 'node:crypto';

import type { ContentOrigin, Prisma, PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import {
  buildStorageKey,
  buildServerFinalizationKey,
  buildUploadStagingKey,
  isUploadableMime,
  mimeEssence,
  quarantineKeyFor,
  sizeCapFor,
  storageCoordinateId,
  type AcceptedMime,
} from '../lib/file-types.js';
import {
  discardObject,
  hashStoredObject,
  streamObjectToStorageWithSha256,
  streamVerifiedObjectToStorage,
} from '../lib/object-verification.js';
import {
  BUCKETS,
  copyObject,
  deleteObject,
  presignGetUrl,
  presignPutUrl,
  statObjectStrict,
  PRESIGN_TTL_SECONDS,
  type BucketName,
  type StorageClients,
} from '../lib/storage.js';
import { issueUploadTicket, verifyUploadTicket, type UploadTicketClaims } from '../lib/upload-token.js';
import { resolveActingStudent } from '../middleware/child-context.js';
import type { Actor } from '../policies/actor.js';
import * as scope from '../policies/branch-scope.js';
import { assertSubjectTaughtAtLevel } from '../policies/curriculum.js';
import { assertFreshActive } from '../policies/freshness.policy.js';
import { teacherBranchIds } from '../policies/roster-resolution.js';
import * as audit from '../repositories/audit.repository.js';
import { enqueue, JOB_QUEUES } from '../repositories/jobs.repository.js';
import { snapshot } from '../repositories/trash.repository.js';
import * as users from '../repositories/user.repository.js';
import { visibleContentIds } from './library.service.js';
import {
  enqueueConsentContentMigration,
  enqueueConsentPublicRetirement,
  enqueueConsentReevaluationForSessions,
  recordingContentRequiresSafeguardUnderLocks,
  retireConsentPublicObject,
} from './consent-reevaluation.service.js';
import { lockLiveSessions } from '../repositories/consent-safeguarding.repository.js';

/**
 * Educational content storage — the TD-3.5 upload flow and the presigned-GET
 * mint (§4.9, TD-9, TD-12).
 *
 * ## The two phases, and why the split is not an implementation detail
 *
 * A browser uploads **straight to a MinIO staging key** through a presigned PUT;
 * the file never passes through this process (§2.3 — the VPS is small and the
 * connections are mobile). That means the server sees the object only *after*
 * it exists, so validation splits in two:
 *
 * * **`/initiate`** decides everything that can be decided before a byte moves —
 *   the §4.9 branch scope, the declared type against TD-9's whitelist, the
 *   declared size against TD-9's cap, and the per-user quota (TD-4.12). A
 *   Teacher on a phone connection must learn they cannot publish Globally
 *   *before* uploading 80 MB, not after.
 * * **`/complete`** decides what only the object itself can answer: are these
 *   really the bytes that were declared? It opens one full staging read, holds
 *   its prefix until magic validation succeeds, enforces the exact byte count,
 *   and hashes every accepted byte with SHA-256 while streaming to a private,
 *   server-owned object. The canonical PUT re-hashes that immutable source;
 *   only then may the row/audit transaction publish its coordinate (R103).
 *
 * ## What holds the two phases together
 *
 * A signed ticket, not a table — see `lib/upload-token.ts` for why. It binds
 * every authorization decision taken at phase one and identifies one immutable
 * finalization, so `/complete` cannot restate them.
 *
 * ## Where consent joins this lifecycle
 *
 * The **consent gate** (BR-2/BR-3) attaches to a *Session's resolved audience*,
 * and content is not owned by a session — it is *referenced* by one (§4.9,
 * Revision 43). A new upload has no audience at initiation, so linking/import
 * enqueues the full current-state engine. A replacement is different: it keeps
 * the existing links, takes their Session anchors, and must preserve or engage
 * the monotonic consent safeguard before publishing its new coordinate.
 * `visibility` remains the existing row's/defaulted domain tier; BR-2 may only
 * force it toward private, never use replacement as a publication override.
 */

/* ── Shared helpers ──────────────────────────────────────────────────────── */

const STAFF_ROLES = ['super_admin', 'admin', 'teacher'] as const;

function isStaff(actor: Actor): boolean {
  return actor.roles.some((r) => (STAFF_ROLES as readonly string[]).includes(r));
}

/** §7: the bucket carries visibility, the key never does (TD-9). */
export function bucketFor(visibility: string): BucketName {
  return visibility === 'public' ? BUCKETS.public : BUCKETS.private;
}

/**
 * §4.9's Global-scope rule, which is the one authorization decision on this
 * endpoint that is not a plain branch check.
 *
 * > Only Super Admins and Admins may assign content to the Global scope.
 * > Teachers are strictly locked to `branch_id` values within their assigned
 * > branch scope (resolved per §4.4c) … a Teacher upload with `branch_id = null`
 * > or an out-of-scope branch is rejected with `403 FORBIDDEN`.
 *
 * **A Teacher's branches resolve through `CourseScheduleStaff`**, not through
 * their role assignment — §4.4c is the single definition of a teacher's reach,
 * and `teacherBranchIds` is the single implementation of it. Reading the role
 * scope instead would be a second, quieter answer to the same question.
 */
async function assertUploadScope(
  prisma: PrismaClient,
  actor: Actor,
  branchId: string | null,
): Promise<void> {
  const admin = scope.isSuperAdmin(actor.roleScopes) || scope.hasRole(actor.roleScopes, 'admin');

  if (admin) {
    // Global is theirs to assign; a named branch still has to be in scope.
    if (branchId !== null) scope.assertCanActOnBranch(actor.roleScopes, 'admin', branchId);
    return;
  }

  if (!scope.hasRole(actor.roleScopes, 'teacher')) {
    throw new AppError('FORBIDDEN', 'only staff may upload educational content (TD-2)');
  }

  if (branchId === null) {
    throw new AppError('FORBIDDEN', 'teachers cannot assign content to the Global scope (§4.9)', {
      reason: 'GLOBAL_SCOPE_FORBIDDEN',
    });
  }

  const branches = await teacherBranchIds(prisma, actor.userId);
  if (!branches.includes(branchId)) {
    throw new AppError('FORBIDDEN', 'branch outside this teacher’s scope (§4.4c, §4.9)', {
      reason: 'BRANCH_OUT_OF_SCOPE',
    });
  }
}

/**
 * TD-4.12 item 12 — the per-user upload quota, **inside the initiating
 * transaction**.
 *
 * > lock the caller's `RateLimitCounter` row for the current window → verify the
 * > count is below the `upload.initiate` limit → increment → create the upload.
 *
 * The lock is the point (TD-15.2). Reading the count outside the transaction
 * would let two initiations at the boundary both see 29 and both pass, which is
 * exactly the check-then-write race the row lock exists to close. Revision 14 is
 * equally explicit about where this may *not* live: not in process memory (dies
 * with the container, wrong across replicas) and not in pg-boss (a quota
 * decision is synchronous).
 */
export const UPLOAD_QUOTA = { bucket: 'upload.initiate', perHour: 30 } as const;

/**
 * R111 final-deletion boundary for upload authority.
 *
 * The access token and upload ticket can both outlive a concurrent account
 * deletion. Without the governing User lock, initiation can recreate the
 * deleted `RateLimitCounter` satellite and mint a new PUT, while completion can
 * publish after the person has been finally de-identified. A publication that
 * commits first remains institutional history and is preserved; a deletion
 * that commits first makes the stale capability unusable.
 */
async function assertUploadAccountAvailable(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  if (!(await users.lockUser(tx, userId))) {
    throw new AppError('FORBIDDEN', 'account is unavailable');
  }
  const account = await tx.user.findFirst({
    where: { id: userId, deletedAt: null, accountStatus: 'active' },
    select: { id: true },
  });
  if (!account) throw new AppError('FORBIDDEN', 'account is unavailable');
}

function windowStartOf(now: Date): Date {
  const start = new Date(now);
  start.setUTCMinutes(0, 0, 0);
  return start;
}

async function consumeUploadQuota(
  tx: Prisma.TransactionClient,
  userId: string,
  now: Date,
): Promise<void> {
  const windowStart = windowStartOf(now);

  // Insert-or-lock: the row may not exist yet, and two concurrent initiations
  // must not both create one. `ON CONFLICT … DO UPDATE` returning the locked row
  // does both in a single statement — the update takes the row lock that a bare
  // `DO NOTHING` would not.
  const [row] = await tx.$queryRaw<{ count: number }[]>`
    INSERT INTO "rate_limit_counter" ("id", "user_id", "bucket", "window_start", "count", "updated_at")
    VALUES (gen_random_uuid(), ${userId}::uuid, ${UPLOAD_QUOTA.bucket}, ${windowStart}, 0, now())
    ON CONFLICT ("user_id", "bucket", "window_start")
      DO UPDATE SET "updated_at" = "rate_limit_counter"."updated_at"
    RETURNING "count"`;

  if ((row?.count ?? 0) >= UPLOAD_QUOTA.perHour) {
    throw new AppError('RATE_LIMITED', 'upload quota exhausted for this hour (TD-4.12)', {
      limit: UPLOAD_QUOTA.perHour,
      window: 'hour',
    });
  }

  await tx.$executeRaw`
    UPDATE "rate_limit_counter"
       SET "count" = "count" + 1, "updated_at" = now()
     WHERE "user_id" = ${userId}::uuid
       AND "bucket" = ${UPLOAD_QUOTA.bucket}
       AND "window_start" = ${windowStart}`;
}

/* ── POST /uploads/initiate ──────────────────────────────────────────────── */

export interface InitiateInput {
  filename: string;
  size: number;
  mime: string;
  meta: {
    levelId: string;
    subjectId: string;
    academicYearId: string;
    branchId: string | null;
    visibility?: string;
    /** R99.12 — *this is a class recording*, stated at the boundary. Defaults to
     *  `uploaded`, and never widens what may be uploaded. */
    origin?: ContentOrigin;
    /** TD-9: replacing a file mints a NEW key and quarantines the old object. */
    replacesContentId?: string;
  };
}

export interface InitiateResult {
  uploadId: string;
  key: string;
  putUrl: string;
  expiresIn: number;
}

/**
 * The Category default (§4.9) when the caller states no visibility.
 *
 * §7 is explicit that `Category` carries **no** default-visibility column and
 * that the default lives in `SystemSetting` (`content.default_visibility.
 * category.{id}`, seeded in §15.1). Reading it here rather than defaulting to
 * `private` in code is what makes the Admin-configurable default real.
 */
export async function categoryDefaultVisibility(
  prisma: PrismaClient,
  levelId: string,
): Promise<string> {
  const level = await prisma.level.findFirst({
    where: { id: levelId, deletedAt: null },
    select: { categoryId: true },
  });
  if (!level) throw new AppError('NOT_FOUND', 'no such level');

  const setting = await prisma.systemSetting.findFirst({
    where: { key: `content.default_visibility.category.${level.categoryId}` },
    select: { value: true },
  });
  const value = setting?.value;
  return typeof value === 'string' && value !== '' ? value : 'private';
}

export async function initiateUpload(
  prisma: PrismaClient,
  clients: StorageClients,
  signingKey: string,
  actor: Actor,
  input: InitiateInput,
): Promise<InitiateResult> {
  if (!isUploadableMime(input.mime)) {
    throw new AppError('VALIDATION_FAILED', 'MIME type is not on the TD-9 whitelist', {
      mime: input.mime,
    });
  }
  const mime: AcceptedMime = input.mime;
  const cap = sizeCapFor(mime);
  if (input.size > cap) {
    throw new AppError('PAYLOAD_TOO_LARGE', 'declared size exceeds the TD-9 cap', {
      declared: input.size,
      cap,
    });
  }

  await assertUploadScope(prisma, actor, input.meta.branchId);

  // **The Subject must actually be taught at this Level.** §4.9 stores both
  // because a Subject spans several Levels and the derivation is many-valued;
  // the pair still has to be one that exists, or the library would group an item
  // under a heading no Level ever offers. `LevelSubject` is where that lives
  // (Revision 43) and is not restated here.
  await assertSubjectTaughtAtLevel(prisma, input.meta.levelId, input.meta.subjectId);

  const year = await prisma.academicYear.findFirst({
    where: { id: input.meta.academicYearId },
    select: { id: true },
  });
  if (!year) throw new AppError('NOT_FOUND', 'no such academic year');

  // Replacement keeps the record and its identity; only the object changes
  // (R53, TD-9). Its existing visibility is therefore authoritative: a
  // replacement is not the distinct TD-1 visibility transition and must not
  // choose a bucket from either a client value or the Category default.
  // Resolving it here also means an unauthorized replacement is refused before
  // a presigned PUT is ever minted.
  let contentId: string = randomUUID();
  let visibility: string;
  let replacesVersion: number | undefined;
  if (input.meta.replacesContentId) {
    const existing = await loadWritableContent(prisma, actor, input.meta.replacesContentId);
    contentId = existing.id;
    visibility = existing.visibility;
    replacesVersion = existing.version;
  } else {
    visibility =
      input.meta.visibility ?? (await categoryDefaultVisibility(prisma, input.meta.levelId));
  }

  // The browser receives a capability for this disposable key only. The
  // authoritative `content/...` key does not exist until the server has
  // validated and promoted this exact object version (B-03).
  const key = buildUploadStagingKey(contentId, input.filename);
  const bucket = bucketFor(visibility);
  const finalizationId = randomUUID();

  const putUrl = await prisma.$transaction(async (tx) => {
    await assertUploadAccountAvailable(tx, actor.userId);
    await consumeUploadQuota(tx, actor.userId, new Date());
    // Minting inside the transaction keeps the quota and the grant atomic: a URL
    // handed out after a failed increment would be an unaccounted upload.
    return presignPutUrl(clients, bucket, key);
  });

  const { token } = issueUploadTicket(
    {
      sub: actor.userId,
      cid: contentId,
      bucket,
      key,
      finalization_id: finalizationId,
      filename: input.filename,
      mime,
      size: input.size,
      level_id: input.meta.levelId,
      subject_id: input.meta.subjectId,
      academic_year_id: input.meta.academicYearId,
      branch_id: input.meta.branchId,
      visibility,
      origin: input.meta.origin ?? 'uploaded',
      ...(input.meta.replacesContentId ? { replaces: input.meta.replacesContentId } : {}),
      ...(replacesVersion === undefined ? {} : { replaces_version: replacesVersion }),
    },
    signingKey,
  );

  return { uploadId: token, key, putUrl, expiresIn: PRESIGN_TTL_SECONDS.put };
}

/* ── POST /uploads/{upload_id}/complete ──────────────────────────────────── */

function claimsOf(uploadId: string, signingKey: string, actor: Actor): UploadTicketClaims {
  const verified = verifyUploadTicket(uploadId, signingKey);
  if (!verified.valid) {
    // An expired ticket is a distinct, actionable state — the client should
    // restart the upload rather than retry the completion.
    throw new AppError('NOT_FOUND', `upload ticket ${verified.reason}`, {
      reason: verified.reason.toUpperCase(),
    });
  }
  // A ticket is bearer-shaped, so ownership is checked rather than assumed: one
  // teacher must not be able to complete another's upload into their own scope.
  if (verified.claims.sub !== actor.userId) {
    throw new AppError('NOT_FOUND', 'upload ticket belongs to another caller');
  }
  return verified.claims;
}

/**
 * §4.9 (Revision 8) verification, **through the shared validator**
 * (`lib/object-verification.ts`).
 *
 * The four checks used to be written out here against `UploadTicketClaims`.
 * R99's ingestion has to make the same assertions about an object no ticket
 * describes, so the parameter became the *object* and this function is now the
 * upload boundary's translation of the shared outcome into TD-3.8's envelope —
 * which is the part that genuinely differs. The ingestion worker's translation
 * is a retryable job failure, not an HTTP status, and neither should have to
 * know the other's vocabulary.
 *
 * **The delete stays here**, because deleting is the upload's own rule: TD-9
 * says a mismatched upload is destroyed at once, while a recording's staging
 * object must survive so the attempt can be retried (R99.14).
 */
async function streamAndVerifyObject(
  clients: StorageClients,
  claims: UploadTicketClaims,
  serverStagingKey: string,
  hooks: UploadCompletionHooks,
): Promise<{
  size: number;
  sourceEtag: string;
  serverStagingEtag: string | null;
  contentSha256: string;
}> {
  let outcome;
  try {
    outcome = await streamVerifiedObjectToStorage(
      clients,
      {
        bucket: claims.bucket,
        key: claims.key,
        mime: claims.mime,
        // The browser declared it at `/initiate`; a different number means the
        // object is not the one that was authorised.
        declaredSize: claims.size,
        cap: sizeCapFor(claims.mime as AcceptedMime),
      },
      { bucket: BUCKETS.private, key: serverStagingKey },
      {
        onMagicValidated: async () =>
          hooks.afterSourceMagicValidated?.({
            bucket: claims.bucket,
            stagingKey: claims.key,
          }),
      },
    );
  } catch {
    await discardObject(clients, BUCKETS.private, serverStagingKey);
    throw new AppError('SERVICE_UNAVAILABLE', 'storage verification failed', {
      reason: 'STORAGE_VERIFICATION_FAILED',
    });
  }
  if (outcome.ok) {
    return {
      size: outcome.sizeBytes,
      sourceEtag: outcome.sourceEtag,
      serverStagingEtag: outcome.destinationEtag,
      contentSha256: outcome.sha256,
    };
  }

  await discardObject(clients, BUCKETS.private, serverStagingKey);

  if (outcome.reason === 'MISSING') {
    // Nothing was ever PUT, or the PUT failed. This is the state
    // `UPLOAD_INCOMPLETE` exists for (TD-3.8) — not a validation failure.
    throw new AppError('UPLOAD_INCOMPLETE', 'no object at the initiated key');
  }

  // A changed key is a retryable race, not corrupt bytes. Deleting the newer
  // version here could sabotage a concurrent completion that is validating it.
  if (outcome.reason !== 'CHANGED') {
    await discardObject(clients, claims.bucket, claims.key);
  }
  throw new AppError(
    'VALIDATION_FAILED',
    outcome.reason === 'CHANGED'
      ? 'the staged object changed while it was being verified'
      : outcome.reason === 'MAGIC'
      ? 'magic bytes do not match the declared MIME type'
      : 'stored size does not match the declared size',
    outcome.detail,
    // §4.9: a mismatch at completion is a 409, not a 400 — TD-3.8 records this
    // as the "409 variant on upload complete". The request was well-formed; the
    // object it refers to is not what it claimed.
    409,
  );
}

export interface CompleteInput {
  title: string;
  description: string | null;
}

/** Narrow deterministic barriers for concurrency tests. Production passes no
 * hooks; tests pause immediately between real storage operations. */
export interface UploadCompletionHooks {
  /** Pauses after the real full-object GET is open and its magic prefix has
   * been accepted, before those bytes are written to server-owned staging. */
  afterSourceMagicValidated?: (context: {
    bucket: string;
    stagingKey: string;
  }) => Promise<void>;
  afterVerification?: (context: {
    bucket: string;
    stagingKey: string;
    serverStagingKey: string;
    sourceEtag: string;
    sha256: string;
  }) => Promise<void>;
  afterPromotion?: (context: {
    bucket: string;
    stagingKey: string;
    canonicalKey: string;
  }) => Promise<void>;
}

/**
 * B-02 — the database visibility is the authority and the bucket follows it.
 *
 * Initiation derives this relationship, but completion checks it again because
 * an upload ticket lives for two hours: a ticket minted by an older release may
 * otherwise survive a deployment and reintroduce the contradiction. The wrong
 * object is discarded before any database write, just like every other upload
 * completion validation failure (§4.9).
 */
async function assertStoragePlacement(
  clients: StorageClients,
  claims: UploadTicketClaims,
  authoritativeVisibility: string,
): Promise<BucketName> {
  const knownVisibility = ['public', 'private', 'hidden'].includes(
    authoritativeVisibility,
  );
  const expectedBucket = bucketFor(authoritativeVisibility);
  if (
    !knownVisibility ||
    claims.visibility !== authoritativeVisibility ||
    claims.bucket !== expectedBucket
  ) {
    await discardObject(clients, claims.bucket, claims.key);
    throw new AppError(
      'VALIDATION_FAILED',
      'upload storage placement contradicts authoritative content visibility',
      { reason: 'VISIBILITY_STORAGE_MISMATCH' },
      409,
    );
  }
  return expectedBucket;
}

type ContentDb = PrismaClient | Prisma.TransactionClient;

interface WritableContent {
  id: string;
  branchId: string | null;
  visibility: string;
  consentForcedPrivate: boolean;
  origin: 'uploaded' | 'session_recording';
  storageBucket: string;
  storageKey: string;
  version: number;
}

/** A stable identity for pre-B-03 tickets which did not carry one. */
function finalizationIdOf(claims: UploadTicketClaims): string {
  return (
    claims.finalization_id ??
    createHash('sha256')
      .update(`legacy-upload\0${claims.sub}\0${claims.cid}\0${claims.bucket}\0${claims.key}`)
      .digest('hex')
  );
}

/**
 * The final key binds both the signed finalization grant and the SHA-256 of the
 * complete accepted stream. The domain-separated SHA-256 is truncated to 128
 * bits for the path segment: negligible collision probability at this scale,
 * while the full content digest remains in mandatory audit and object metadata.
 */
function canonicalKeyFor(
  claims: UploadTicketClaims,
  finalizationId: string,
  contentSha256: string,
): string {
  const versionHash = createHash('sha256')
    .update(`upload-finalization-sha256-v1\0${finalizationId}\0${contentSha256}`)
    .digest('hex')
    .slice(0, 32);
  return buildStorageKey(claims.cid, claims.filename, versionHash);
}

interface PublishedFinalization {
  canonicalKey: string;
  contentSha256: string | null;
}

async function publishedFinalization(
  db: ContentDb,
  claims: UploadTicketClaims,
  finalizationId: string,
): Promise<PublishedFinalization | null> {
  // Compatibility for a ticket completed by the direct-to-canonical flow
  // before deployment. Its row points at the ticket's own key and its older
  // audit does not contain a finalization identity.
  if (claims.finalization_id === undefined) {
    const legacy = await db.educationalContent.findUnique({
      where: { id: claims.cid },
      select: { storageKey: true },
    });
    if (legacy?.storageKey === claims.key) {
      return { canonicalKey: claims.key, contentSha256: null };
    }
  }

  const auditRow = await db.auditLog.findFirst({
    where: {
      actionType: claims.replaces ? 'content.replace' : 'content.upload',
      targetEntity: 'EducationalContent',
      targetId: claims.cid,
      detail: { path: ['upload_finalization_id'], equals: finalizationId },
    },
    select: { detail: true },
  });
  if (auditRow === null) return null;
  const detail = auditRow.detail;
  if (typeof detail !== 'object' || detail === null || Array.isArray(detail)) {
    throw new Error(`content finalization audit ${finalizationId} has no detail object`);
  }
  const contentSha256 =
    typeof detail['content_sha256'] === 'string' &&
    /^[0-9a-f]{64}$/i.test(detail['content_sha256'])
      ? detail['content_sha256']
      : null;
  // Current finalizations retain the accepted digest and signed grant id, so
  // their immutable canonical coordinate is reproducible without copying a
  // filename-derived storage key into the indefinitely retained AuditLog.
  // The exact-key fallback reads rows written by releases before this change.
  const canonicalKey =
    contentSha256 === null
      ? detail['canonical_key'] ?? detail['new_key']
      : canonicalKeyFor(claims, finalizationId, contentSha256);
  if (typeof canonicalKey !== 'string') {
    throw new Error(`content finalization audit ${finalizationId} has no key evidence`);
  }
  return {
    canonicalKey,
    contentSha256,
  };
}

/** Delete only a disposable upload object, never a key an authoritative row
 * still names. The database check is required for pre-B-03 tickets, whose PUT
 * target and canonical key were the same. */
async function discardStagingObject(
  prisma: PrismaClient,
  clients: StorageClients,
  claims: UploadTicketClaims,
): Promise<void> {
  if (claims.key.startsWith('staging/content/')) {
    await discardObject(clients, claims.bucket, claims.key);
    return;
  }

  let referenced: number;
  try {
    referenced = await prisma.educationalContent.count({
      where: {
        storageBucket: claims.bucket,
        storageKey: claims.key,
        // Both states are intentional: a soft-deleted row may still depend on
        // its recoverable object after quarantine copy/delete failed.
        OR: [{ deletedAt: null }, { deletedAt: { not: null } }],
      },
    });
  } catch {
    // Legacy keys need the database to distinguish disposable from canonical.
    // An unavailable database means "leave it for upload.gc", never guess and
    // risk deleting accepted content.
    return;
  }
  if (referenced === 0) {
    await discardObject(clients, claims.bucket, claims.key);
  }
}

/** Streaming, bounded-memory promotion of a server-owned accepted byte stream. */
async function promoteVerifiedObject(
  clients: StorageClients,
  claims: UploadTicketClaims,
  serverStaging: { bucket: string; key: string; etag: string | null },
  canonicalKey: string,
  size: number,
  contentSha256: string,
): Promise<void> {
  let existing;
  try {
    existing = await hashStoredObject(clients, claims.bucket, canonicalKey);
  } catch {
    throw new AppError('SERVICE_UNAVAILABLE', 'canonical object safety check failed', {
      reason: 'STORAGE_UNAVAILABLE',
    });
  }

  if (existing !== null) {
    if (existing.sizeBytes === size && existing.sha256 === contentSha256) return;
    throw new AppError('STATE_CONFLICT', 'canonical finalization key is already occupied', {
      reason: 'CANONICAL_KEY_OCCUPIED',
    });
  }

  try {
    await streamObjectToStorageWithSha256(
      clients,
      serverStaging,
      { bucket: claims.bucket, key: canonicalKey },
      {
        sizeBytes: size,
        sha256: contentSha256,
        contentType: mimeEssence(claims.mime),
      },
    );
  } catch {
    throw new AppError('SERVICE_UNAVAILABLE', 'storage promotion failed', {
      reason: 'STORAGE_PROMOTION_FAILED',
    });
  }
}

async function createContentFromFinalization(
  prisma: PrismaClient,
  actor: Actor,
  claims: UploadTicketClaims,
  input: CompleteInput,
  size: number,
  canonicalKey: string,
  finalizationId: string,
  contentSha256: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertUploadAccountAvailable(tx, actor.userId);
    await tx.educationalContent.create({
      data: {
        id: claims.cid,
        title: input.title,
        description: input.description,
        visibility: claims.visibility as 'public' | 'private' | 'hidden',
        levelId: claims.level_id,
        subjectId: claims.subject_id,
        academicYearId: claims.academic_year_id,
        branchId: claims.branch_id,
        storageBucket: claims.bucket,
        storageKey: canonicalKey,
        originalFilename: claims.filename,
        mimeType: claims.mime,
        sizeBytes: BigInt(size),
        origin: claims.origin ?? 'uploaded',
      },
    });
    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'content.upload',
      targetEntity: 'EducationalContent',
      targetId: claims.cid,
      detail: {
        mime: claims.mime,
        size_bytes: size,
        visibility: claims.visibility,
        branch_id: claims.branch_id,
        staging_coordinate_id: storageCoordinateId(claims.bucket, claims.key),
        canonical_coordinate_id: storageCoordinateId(claims.bucket, canonicalKey),
        content_sha256: contentSha256,
        upload_finalization_id: finalizationId,
      },
    });
  });
}

export async function completeUpload(
  prisma: PrismaClient,
  clients: StorageClients,
  signingKey: string,
  actor: Actor,
  uploadId: string,
  input: CompleteInput,
  hooks: UploadCompletionHooks = {},
): Promise<{ id: string }> {
  const claims = claimsOf(uploadId, signingKey, actor);
  const finalizationId = finalizationIdOf(claims);

  // A successful completion is durable in the mandatory audit transaction.
  // Check it before touching staging: retries still succeed after cleanup.
  if (await publishedFinalization(prisma, claims, finalizationId)) {
    await discardStagingObject(prisma, clients, claims);
    return { id: claims.cid };
  }

  // R103 rollout is deliberately fail-closed for an outstanding replacement
  // grant minted before B-03. Re-reading today's version would turn a stale
  // ticket into authority it never carried.
  if (claims.replaces && claims.replaces_version === undefined) {
    await discardStagingObject(prisma, clients, claims);
    throw new AppError(
      'VERSION_CONFLICT',
      'legacy replacement must be initiated again',
      { reason: 'REPLACEMENT_REINITIATION_REQUIRED' },
    );
  }

  let replacement: WritableContent | null = null;
  if (claims.replaces) {
    replacement = await loadWritableContent(prisma, actor, claims.cid);
    if (
      claims.replaces_version !== undefined &&
      claims.replaces_version !== replacement.version
    ) {
      throw new AppError('VERSION_CONFLICT', 'content changed after replacement initiation', {
        expected_version: claims.replaces_version,
      });
    }
    await assertStoragePlacement(clients, claims, replacement.visibility);
  } else {
    await assertStoragePlacement(clients, claims, claims.visibility);
  }

  const serverStagingKey = buildServerFinalizationKey(claims.cid);
  const {
    size,
    sourceEtag,
    serverStagingEtag,
    contentSha256,
  } = await streamAndVerifyObject(clients, claims, serverStagingKey, hooks);
  const canonicalKey = canonicalKeyFor(claims, finalizationId, contentSha256);
  try {
    await hooks.afterVerification?.({
      bucket: claims.bucket,
      stagingKey: claims.key,
      serverStagingKey,
      sourceEtag,
      sha256: contentSha256,
    });

    await promoteVerifiedObject(
      clients,
      claims,
      {
        bucket: BUCKETS.private,
        key: serverStagingKey,
        etag: serverStagingEtag,
      },
      canonicalKey,
      size,
      contentSha256,
    );
    await hooks.afterPromotion?.({
      bucket: claims.bucket,
      stagingKey: claims.key,
      canonicalKey,
    });
  } finally {
    // This object is server-owned and disposable as soon as canonical PUT has
    // either completed or failed. A cleanup miss is a harmless upload.gc orphan.
    await discardObject(clients, BUCKETS.private, serverStagingKey);
  }

  try {
    if (replacement) {
      const publication = await replaceContentFile(
        prisma,
        actor,
        claims,
        input,
        size,
        canonicalKey,
        finalizationId,
        contentSha256,
        replacement,
      );
      // A same-ticket loser may have accepted a different immutable staging
      // snapshot and therefore promoted a different candidate. The winner's
      // audit is authoritative; remove only this call's unpublished object.
      if (publication.acceptedCanonicalKey !== canonicalKey) {
        await discardObject(clients, claims.bucket, canonicalKey);
      }
      await discardStagingObject(prisma, clients, claims);
      if (publication.published) {
        if (publication.retireOldPublic) {
          try {
            await retireConsentPublicObject(
              clients,
              claims.cid,
              replacement.storageKey,
            );
          } catch {
            // The exact-key TD-7 obligation committed with the replacement.
            // Publication succeeded; a transient cleanup error must not lie to
            // the caller or lose the durable safeguarding retry.
          }
        } else {
          await quarantineObject(
            clients,
            replacement.storageBucket,
            replacement.storageKey,
            claims.cid,
          );
        }
      }
      return { id: claims.cid };
    }

    await createContentFromFinalization(
      prisma,
      actor,
      claims,
      input,
      size,
      canonicalKey,
      finalizationId,
      contentSha256,
    );
    await discardStagingObject(prisma, clients, claims);
    return { id: claims.cid };
  } catch (error) {
    // A concurrent same-ticket winner owns the same canonical key. Its audit is
    // committed with its row, so the loser converges to success and must not
    // delete the winner's object. Every other failure gets compensating cleanup.
    let published = false;
    let publicationKnown = false;
    try {
      const accepted = await publishedFinalization(prisma, claims, finalizationId);
      published = accepted !== null;
      publicationKnown = true;
      // Under the SHA flow two concurrent readers may have accepted different
      // stable staging snapshots and therefore produced different candidates.
      // Only the audit's candidate is authoritative; the loser removes its own.
      if (accepted !== null && accepted.canonicalKey !== canonicalKey) {
        await discardObject(clients, claims.bucket, canonicalKey);
      }
    } catch {
      // A failed COMMIT can be outcome-ambiguous. Never delete a canonical
      // object while the database is unavailable to prove it unreferenced;
      // upload.gc is the safe recovery boundary for a possible orphan.
    }
    if (published) {
      await discardStagingObject(prisma, clients, claims);
      return { id: claims.cid };
    }
    if (publicationKnown) {
      await discardObject(clients, claims.bucket, canonicalKey);
    }
    throw error;
  }
}

/* ── POST /uploads/{upload_id}/abort ─────────────────────────────────────── */

export async function abortUpload(
  prisma: PrismaClient,
  clients: StorageClients,
  signingKey: string,
  actor: Actor,
  uploadId: string,
): Promise<void> {
  const claims = claimsOf(uploadId, signingKey, actor);
  // Best-effort by design: aborting an upload that never started is a success
  // from the caller's point of view, and `upload.gc` (TD-7) sweeps anything a
  // client abandons without telling us.
  await discardStagingObject(prisma, clients, claims);
}

/* ── Replace and delete (Revision 53) ────────────────────────────────────── */

/**
 * Loads a content record the caller is allowed to *modify*.
 *
 * Distinct from the library's read rule on purpose: reading is governed by the
 * §4.9 tiers, writing by TD-2 plus the same branch scope an upload takes. A
 * Teacher may read Global content and may not edit it.
 */
async function loadWritableContent(
  prisma: PrismaClient,
  actor: Actor,
  contentId: string,
): Promise<WritableContent> {
  const row = await prisma.educationalContent.findFirst({
    where: { id: contentId, deletedAt: null },
    select: {
      id: true,
      branchId: true,
      visibility: true,
      consentForcedPrivate: true,
      origin: true,
      storageBucket: true,
      storageKey: true,
      version: true,
    },
  });
  // §20 rule 17: out of scope answers 404, never 403 — a 403 would confirm the
  // record exists to someone with no business knowing it does.
  if (!row) throw new AppError('NOT_FOUND', 'no such content');
  if (!isStaff(actor)) throw new AppError('NOT_FOUND', 'no such content');

  await assertUploadScope(prisma, actor, row.branchId);
  return row;
}

/**
 * TD-9's replacement rule, executed: **a new key, the old object quarantined,
 * never an overwrite.**
 *
 * > Keys are immutable once written. Replacing a file on an existing content
 * > record generates a *new* key (new hash segment) and updates the DB
 * > reference; the old object is quarantined. Cached URLs of the old object can
 * > therefore never mask a newer upload.
 *
 * The old object is **copied to `quarantine/…` before the original is removed**,
 * so a failure between the two leaves a duplicate rather than nothing — BR-15's
 * recovery window is a safeguarding guarantee, and losing a recording to a network
 * blip is the one outcome it cannot tolerate.
 */
async function replaceContentFile(
  prisma: PrismaClient,
  actor: Actor,
  claims: UploadTicketClaims,
  input: CompleteInput,
  size: number,
  canonicalKey: string,
  finalizationId: string,
  contentSha256: string,
  existing: WritableContent,
): Promise<{
  published: boolean;
  acceptedCanonicalKey: string;
  retireOldPublic: boolean;
}> {
  return prisma.$transaction(async (tx) => {
    await assertUploadAccountAvailable(tx, actor.userId);
    // Replacement is an upload trigger for every occurrence already referencing
    // this recording. Session locks precede the content CAS, matching the
    // re-evaluation lock hierarchy and avoiding a Session↔Content deadlock.
    const linkedSessions = await tx.sessionContent.findMany({
      where: { contentId: claims.cid, deletedAt: null, session: { deletedAt: null } },
      select: { sessionId: true },
    });
    const lockedSessionIds = await enqueueConsentReevaluationForSessions(
      tx,
      linkedSessions.map((link) => link.sessionId),
    );
    const retireOldPublic =
      existing.storageBucket === BUCKETS.public &&
      existing.origin === 'session_recording' &&
      (existing.consentForcedPrivate ||
        (await recordingContentRequiresSafeguardUnderLocks(
          tx,
          claims.cid,
          lockedSessionIds,
        )));

    const written = await tx.educationalContent.updateMany({
      where: {
        id: claims.cid,
        deletedAt: null,
        version: existing.version,
        storageBucket: existing.storageBucket,
        storageKey: existing.storageKey,
      },
      data: {
        title: input.title,
        description: input.description,
        ...(retireOldPublic ? { consentForcedPrivate: true } : {}),
        storageBucket: claims.bucket,
        storageKey: canonicalKey,
        originalFilename: claims.filename,
        mimeType: claims.mime,
        sizeBytes: BigInt(size),
        version: { increment: 1 },
      },
    });

    if (written.count === 0) {
      const accepted = await publishedFinalization(tx, claims, finalizationId);
      if (accepted !== null) {
        return {
          published: false,
          acceptedCanonicalKey: accepted.canonicalKey,
          retireOldPublic: false,
        };
      }
      const current = await tx.educationalContent.findUnique({
        where: { id: claims.cid },
        select: { id: true },
      });
      if (!current) throw new AppError('NOT_FOUND', 'no such content');
      throw new AppError('VERSION_CONFLICT', 'content changed during replacement', {
        expected_version: existing.version,
      });
    }

    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'content.replace',
      targetEntity: 'EducationalContent',
      targetId: claims.cid,
      detail: {
        previous_storage_coordinate_id: storageCoordinateId(
          existing.storageBucket,
          existing.storageKey,
        ),
        new_storage_coordinate_id: storageCoordinateId(claims.bucket, canonicalKey),
        staging_coordinate_id: storageCoordinateId(claims.bucket, claims.key),
        size_bytes: size,
        content_sha256: contentSha256,
        upload_finalization_id: finalizationId,
      },
    });
    if (retireOldPublic) {
      if (!existing.consentForcedPrivate) {
        await audit.write(tx, {
          actorUserId: null,
          actionType: 'content.visibility_change',
          targetEntity: 'EducationalContent',
          targetId: claims.cid,
          detail: {
            reason: 'consent_gate',
            old_visibility: existing.visibility,
            new_visibility: existing.visibility,
            old_consent_forced_private: false,
            new_consent_forced_private: true,
            bucket_migration_pending: true,
            source: 'content.replace',
          },
        });
      }
      await enqueueConsentPublicRetirement(tx, claims.cid, existing.storageKey);
      await enqueueConsentContentMigration(tx, claims.cid, canonicalKey);
    } else {
      await enqueueQuarantineTransition(
        tx,
        claims.cid,
        existing.storageBucket,
        existing.storageKey,
      );
    }
    return {
      published: true,
      acceptedCanonicalKey: canonicalKey,
      retireOldPublic,
    };
  });
}

async function enqueueQuarantineTransition(
  tx: Prisma.TransactionClient,
  contentId: string,
  bucket: string,
  storageKey: string,
): Promise<boolean> {
  const coordinateHash = storageCoordinateId(bucket, storageKey);
  return enqueue(
    tx,
    JOB_QUEUES.contentQuarantinePurge,
    {
      operation: 'quarantine_retired_object',
      content_id: contentId,
      bucket,
      storage_key: storageKey,
    },
    `quarantine:${contentId}:${coordinateHash}`,
  );
}

async function quarantineObject(
  clients: StorageClients,
  bucket: string,
  key: string,
  contentId: string,
): Promise<void> {
  const target = quarantineKeyFor(contentId, key);
  try {
    // The shared primitive, which URI-encodes the source — this call used to
    // build `CopySource` by interpolation, and a TD-9 key carries a slug of a
    // filename a person chose.
    await copyObject(clients, { bucket, key }, { bucket, key: target });
    await deleteObject(clients, bucket, key);
  } catch {
    // The row, audit and exact-key TD-7 obligation are already committed.
    // Failing the request here would lie about publication; the worker retries
    // the same copy-before-delete transition and never derives a current key.
  }
}

/**
 * `DELETE /content/{id}` — soft delete, snapshot, quarantine (TD-5, BR-15).
 *
 * The object moves to `quarantine/…` and waits out BR-15's seven-day window, which
 * `content.quarantine-purge` (TD-7) closes. **The file is not removed here**:
 * a deletion that destroyed the object immediately would make the Trash's
 * restore promise a lie for exactly the entity where the data is largest.
 */
export interface ContentMetadataPatch {
  title?: string;
  levelId?: string;
  subjectId?: string;
  visibility?: 'public' | 'private' | 'hidden';
  /**
   * R99.12's `origin` marker — *«هذا تسجيل حصة»*. The authoritative field
   * already on the row; no second boolean is introduced for the same concept.
   *
   * A plain column with **no storage meaning**: correcting it moves no object
   * and re-uploads nothing, exactly like `title`. Consent evaluation is
   * unchanged and is not re-run from here.
   */
  origin?: 'uploaded' | 'session_recording';
}

/**
 * **Editing what a content item IS, without touching the file** (UAT, 2026-09-02).
 *
 * مكتبة المحتوى could upload and delete and nothing between: correcting a typed
 * title, a Level chosen from the wrong filter, or a visibility set too widely
 * meant re-uploading the same bytes under a new row. TD-9's replacement path
 * exists for a **new file**; it is the wrong instrument for a wrong word.
 *
 * ## The file is not re-uploaded, and usually not touched at all
 *
 * `title`, `levelId` and `subjectId` are database columns with no storage
 * meaning. `visibility` is different, and this is the invariant that shapes the
 * whole function.
 *
 * ## B-02: the bucket follows the database, so some visibility changes MOVE the object
 *
 * `bucketFor` puts `public` in the public bucket and both `private` and
 * `hidden` in the private one. So:
 *
 * * **private ↔ hidden** changes a column and nothing else;
 * * **public → private/hidden** must move the object, or the row would claim to
 *   be private while the bytes stayed anonymously reachable — a privacy hole,
 *   not an inconsistency;
 * * **private/hidden → public** must move it too, or the presigned read would
 *   point into a bucket the public tier cannot serve.
 *
 * The move is copy → verify → commit → delete source, the same order
 * `quarantineContentObject` already uses: the destination is proved byte-identical
 * before anything is committed, and the source is removed only afterwards, so a
 * failure at any point leaves a readable object rather than none.
 *
 * ## Consent still wins
 *
 * A recording forced private by consent (B-01) cannot be published by editing a
 * dropdown. The refusal is coded so the screen can say why rather than showing
 * a control that silently fails.
 *
 * ## No notification
 *
 * R116(9) decided that content completion emits none, because upload is storage
 * finalization rather than a deliberate publication transition. A metadata
 * correction is *less* of a publication event than that, so it inherits the
 * decision rather than reopening it.
 */
export async function updateContentMetadata(
  prisma: PrismaClient,
  clients: StorageClients,
  actor: Actor,
  contentId: string,
  patch: ContentMetadataPatch,
): Promise<void> {
  const existing = await loadWritableContent(prisma, actor, contentId);

  if (
    patch.visibility === 'public' &&
    existing.consentForcedPrivate &&
    existing.visibility !== 'public'
  ) {
    throw new AppError('STATE_CONFLICT', 'consent keeps this recording private', {
      reason: 'CONSENT_FORCED_PRIVATE',
    });
  }

  // §4.9's Global-scope and branch rules are the same ones initiation applies;
  // a Level change must not become a way to move content into a scope the
  // caller could not have uploaded to.
  if (patch.levelId !== undefined) {
    const level = await prisma.level.findFirst({
      where: { id: patch.levelId, deletedAt: null },
      select: { id: true },
    });
    if (!level) throw new AppError('VALIDATION_FAILED', 'no such level', { reason: 'UNKNOWN_LEVEL' });
  }
  if (patch.subjectId !== undefined) {
    const subject = await prisma.subject.findFirst({
      where: { id: patch.subjectId, deletedAt: null },
      select: { id: true },
    });
    if (!subject) {
      throw new AppError('VALIDATION_FAILED', 'no such subject', { reason: 'UNKNOWN_SUBJECT' });
    }
  }

  const nextVisibility = patch.visibility ?? existing.visibility;
  const targetBucket = bucketFor(nextVisibility);
  const mustMove = targetBucket !== existing.storageBucket;

  if (!mustMove) {
    const written = await prisma.educationalContent.updateMany({
      where: { id: contentId, deletedAt: null, version: existing.version },
      data: {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.levelId !== undefined ? { levelId: patch.levelId } : {}),
        ...(patch.subjectId !== undefined ? { subjectId: patch.subjectId } : {}),
        ...(patch.visibility !== undefined ? { visibility: nextVisibility as never } : {}),
        ...(patch.origin !== undefined ? { origin: patch.origin as never } : {}),
        version: { increment: 1 },
      },
    });
    if (written.count === 0) {
      throw new AppError('VERSION_CONFLICT', 'content changed during edit', {
        reason: 'CONCURRENT_MODIFICATION',
      });
    }
    return;
  }

  // **Copy first, and prove it.** Nothing is committed and nothing is removed
  // until the destination is confirmed byte-identical to the source.
  const source = await statObjectStrict(clients, existing.storageBucket, existing.storageKey);
  if (source === null) {
    throw new AppError('STATE_CONFLICT', 'the stored object is missing', {
      reason: 'OBJECT_MISSING',
    });
  }
  await copyObject(
    clients,
    { bucket: existing.storageBucket, key: existing.storageKey },
    { bucket: targetBucket, key: existing.storageKey },
    undefined,
    source.etag === null ? {} : { sourceIfMatch: source.etag },
  );
  const destination = await statObjectStrict(clients, targetBucket, existing.storageKey);
  if (
    destination === null ||
    destination.sizeBytes !== source.sizeBytes ||
    (source.sha256 !== null && destination.sha256 !== source.sha256)
  ) {
    // The copy is the disposable half: remove it and leave the original alone.
    await discardObject(clients, targetBucket, existing.storageKey);
    throw new AppError('STATE_CONFLICT', 'the object could not be moved', {
      reason: 'STORAGE_MOVE_FAILED',
    });
  }

  const written = await prisma.educationalContent.updateMany({
    where: {
      id: contentId,
      deletedAt: null,
      version: existing.version,
      storageBucket: existing.storageBucket,
      storageKey: existing.storageKey,
    },
    data: {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.levelId !== undefined ? { levelId: patch.levelId } : {}),
      ...(patch.subjectId !== undefined ? { subjectId: patch.subjectId } : {}),
      visibility: nextVisibility as never,
      ...(patch.origin !== undefined ? { origin: patch.origin as never } : {}),
      storageBucket: targetBucket,
      version: { increment: 1 },
    },
  });
  if (written.count === 0) {
    // Somebody else changed the row while the bytes were being copied. The
    // database is the authority (B-02), so the COPY is what gets discarded.
    await discardObject(clients, targetBucket, existing.storageKey);
    throw new AppError('VERSION_CONFLICT', 'content changed during edit', {
      reason: 'CONCURRENT_MODIFICATION',
    });
  }

  // Committed. The old placement now contradicts the authority, so it goes —
  // last, deliberately: a failure here leaves a duplicate object rather than an
  // unreadable row, and the duplicate is visible to the storage lifecycle.
  await discardObject(clients, existing.storageBucket, existing.storageKey);
}

export async function deleteContent(
  prisma: PrismaClient,
  clients: StorageClients,
  actor: Actor,
  contentId: string,
): Promise<void> {
  const existing = await loadWritableContent(prisma, actor, contentId);

  const retireOldPublic = await prisma.$transaction(async (tx) => {
    const linkedSessions = await tx.sessionContent.findMany({
      where: { contentId, deletedAt: null, session: { deletedAt: null } },
      select: { sessionId: true },
    });
    const lockedSessionIds = await lockLiveSessions(
      tx,
      linkedSessions.map((link) => link.sessionId),
    );
    const retireForConsent =
      existing.storageBucket === BUCKETS.public &&
      existing.origin === 'session_recording' &&
      (existing.consentForcedPrivate ||
        (await recordingContentRequiresSafeguardUnderLocks(
          tx,
          contentId,
          lockedSessionIds,
        )));
    const row = await tx.educationalContent.findUnique({ where: { id: contentId } });
    const written = await tx.educationalContent.updateMany({
      where: {
        id: contentId,
        deletedAt: null,
        version: existing.version,
        storageBucket: existing.storageBucket,
        storageKey: existing.storageKey,
      },
      data: { deletedAt: new Date(), deletedById: actor.userId },
    });
    if (written.count === 0 || row === null) {
      throw new AppError('VERSION_CONFLICT', 'content changed during deletion', {
        expected_version: existing.version,
      });
    }
    await snapshot(tx, {
      targetEntity: 'EducationalContent',
      targetId: contentId,
      // `size_bytes` is a `BigInt`, which has no JSON representation and would
      // throw on serialisation — the snapshot has to survive the round-trip, so
      // it is stringified here rather than lost with the row it describes.
      snapshot: { ...row, sizeBytes: row.sizeBytes.toString() },
      deletedById: actor.userId,
    });
    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'content.delete',
      targetEntity: 'EducationalContent',
      targetId: contentId,
      detail: {
        storage_coordinate_id: storageCoordinateId(
          existing.storageBucket,
          existing.storageKey,
        ),
      },
    });
    if (retireForConsent) {
      await enqueueConsentPublicRetirement(tx, contentId, existing.storageKey);
    } else {
      await enqueueQuarantineTransition(
        tx,
        contentId,
        existing.storageBucket,
        existing.storageKey,
      );
    }
    return retireForConsent;
  });

  if (retireOldPublic) {
    try {
      await retireConsentPublicObject(clients, contentId, existing.storageKey);
    } catch {
      // The delete and its exact-key job are already committed. A transient
      // storage failure is retried by the existing TD-7 placement worker.
    }
  } else {
    await quarantineObject(clients, existing.storageBucket, existing.storageKey, contentId);
  }
}

/* ── GET /content/{id}/download-url ──────────────────────────────────────── */

export interface MintResult {
  url: string;
  expiresIn: number;
}

/**
 * Mints a short-lived presigned GET after a **server-side** permission check
 * (§3.1, §4.9, TD-12, §20 rule 4).
 *
 * Three rules meet on this one endpoint:
 *
 * 1. **TD-12 freshness.** *"Statelessness ends where safeguarding begins"* — an
 *    unexpired access token is not sufficient here. The caller's `account_status`
 *    and role assignment are re-read from the database on every request, so a
 *    Teacher suspended mid-session loses access to a private recording at once
 *    rather than at token expiry.
 * 2. **The §4.9 tiers**, applied through `visibleContentIds` — the *same*
 *    predicate the library list uses, deliberately not a second expression of
 *    it. The rule that decides what a person may see in a list is the rule that
 *    decides what they may open.
 * 3. **Child context** (§4.3), for a Parent acting on a minor's behalf. The
 *    middleware is not mounted on this route because staff reach content through
 *    a different path and would be asked for a header they have no reason to
 *    send; the resolver is called directly instead, for exactly the callers the
 *    rule is about.
 */
export async function mintDownloadUrl(
  prisma: PrismaClient,
  clients: StorageClients,
  actor: Actor,
  contentId: string,
  activeChildHeader: string | undefined,
): Promise<MintResult> {
  const fresh = await assertFreshActive(
    prisma,
    actor.userId,
    ['super_admin', 'admin', 'teacher', 'student', 'parent'],
    // R60 — the narrowed roles come back, so §4.9's tier is evaluated for the
    // role being exercised rather than for every role the account holds.
    actor.activeRole,
  );

  // A Parent who is not also a Student is acting for a child, and §4.3 requires
  // the link to be verified on this very request. `via: 'family_link'` narrows
  // the tier check below to that one child rather than every child they are
  // linked to.
  let actingStudentId: string | undefined;
  const parentOnly =
    fresh.roles.includes('parent') &&
    !fresh.roles.includes('student') &&
    !fresh.roles.some((r) => (STAFF_ROLES as readonly string[]).includes(r));
  if (parentOnly) {
    const acting = await resolveActingStudent(
      prisma,
      { userId: fresh.userId, roles: fresh.roles },
      activeChildHeader,
    );
    actingStudentId = acting.studentId;
  }

  const visible = await visibleContentIds(
    prisma,
    {
      userId: fresh.userId,
      roles: fresh.roles,
      roleScopes: fresh.roleScopes,
      accountStatus: 'active',
      ...(actingStudentId ? { actingStudentId } : {}),
    },
    [contentId],
  );
  if (!visible.has(contentId)) {
    // §20 rule 17 again: no distinction between "does not exist" and "not yours".
    throw new AppError('NOT_FOUND', 'no such content');
  }

  const row = await prisma.educationalContent.findFirst({
    where: { id: contentId, deletedAt: null },
    select: { storageBucket: true, storageKey: true },
  });
  if (!row) throw new AppError('NOT_FOUND', 'no such content');

  const url = await presignGetUrl(clients, row.storageBucket as BucketName, row.storageKey);
  return { url, expiresIn: PRESIGN_TTL_SECONDS.get };
}
