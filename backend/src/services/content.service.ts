import { randomUUID } from 'node:crypto';

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';

import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import {
  buildStorageKey,
  isAcceptedMime,
  magicBytesMatch,
  quarantineKeyFor,
  sizeCapFor,
  type AcceptedMime,
} from '../lib/file-types.js';
import {
  BUCKETS,
  presignGetUrl,
  presignPutUrl,
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
import { snapshot } from '../repositories/trash.repository.js';
import { visibleContentIds } from './library.service.js';

/**
 * Educational content storage — the TD-3.5 upload flow and the presigned-GET
 * mint (§4.9, TD-9, TD-12).
 *
 * ## The two phases, and why the split is not an implementation detail
 *
 * A browser uploads **straight to MinIO** through a presigned PUT; the file
 * never passes through this process (§2.3 — the VPS is small and the
 * connections are mobile). That means the server sees the object only *after*
 * it exists, so validation splits in two:
 *
 * * **`/initiate`** decides everything that can be decided before a byte moves —
 *   the §4.9 branch scope, the declared type against TD-9's whitelist, the
 *   declared size against TD-9's cap, and the per-user quota (TD-4.12). A
 *   Teacher on a phone connection must learn they cannot publish Globally
 *   *before* uploading 80 MB, not after.
 * * **`/complete`** decides what only the object itself can answer: are these
 *   really the bytes that were declared? §4.9 (Revision 8) fixes the mechanism —
 *   a **ranged GET of `bytes=0-511`** for the magic bytes and a **HEAD** for the
 *   true size. The server never streams or buffers the file to validate it.
 *
 * ## What holds the two phases together
 *
 * A signed ticket, not a table — see `lib/upload-token.ts` for why. It binds
 * every authorization decision taken at phase one, so `/complete` cannot restate
 * them.
 *
 * ## What is deliberately NOT here
 *
 * The **consent gate** (BR-2/BR-3) attaches to a *Session's resolved audience*,
 * and content is not owned by a session — it is *referenced* by one (§4.9,
 * Revision 43). So an upload has no audience to gate at the moment it happens;
 * the gate engages when content is linked to a session, and its engine
 * (`consent.reevaluate`, §4.1a) is a separate M6 deliverable. `visibility` here
 * is the caller's choice, defaulted from the Category setting, and
 * `consent_forced_private` is left to the engine that owns it.
 */

/* ── Shared helpers ──────────────────────────────────────────────────────── */

const STAFF_ROLES = ['super_admin', 'admin', 'teacher'] as const;

function isStaff(actor: Actor): boolean {
  return actor.roles.some((r) => (STAFF_ROLES as readonly string[]).includes(r));
}

/** §7: the bucket carries visibility, the key never does (TD-9). */
function bucketFor(visibility: string): BucketName {
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
async function categoryDefaultVisibility(prisma: PrismaClient, levelId: string): Promise<string> {
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
  if (!isAcceptedMime(input.mime)) {
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

  const visibility =
    input.meta.visibility ?? (await categoryDefaultVisibility(prisma, input.meta.levelId));

  // Replacement keeps the record and its identity; only the object changes
  // (TD-9). Resolving it here means an unauthorized replacement is refused
  // before a presigned PUT is ever minted.
  let contentId: string = randomUUID();
  if (input.meta.replacesContentId) {
    const existing = await loadWritableContent(prisma, actor, input.meta.replacesContentId);
    contentId = existing.id;
  }

  const key = buildStorageKey(contentId, input.filename);
  const bucket = bucketFor(visibility);

  const putUrl = await prisma.$transaction(async (tx) => {
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
      filename: input.filename,
      mime,
      size: input.size,
      level_id: input.meta.levelId,
      subject_id: input.meta.subjectId,
      academic_year_id: input.meta.academicYearId,
      branch_id: input.meta.branchId,
      visibility,
      ...(input.meta.replacesContentId ? { replaces: input.meta.replacesContentId } : {}),
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

async function deleteObject(clients: StorageClients, bucket: string, key: string): Promise<void> {
  await clients.internal.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

/**
 * §4.9 (Revision 8) verification: **ranged GET for the magic bytes, HEAD for the
 * size.** Never a full read.
 */
async function verifyObject(
  clients: StorageClients,
  claims: UploadTicketClaims,
): Promise<{ size: number }> {
  let head;
  try {
    head = await clients.internal.send(
      new HeadObjectCommand({ Bucket: claims.bucket, Key: claims.key }),
    );
  } catch {
    // Nothing was ever PUT, or the PUT failed. This is the state
    // `UPLOAD_INCOMPLETE` exists for (TD-3.8) — not a validation failure.
    throw new AppError('UPLOAD_INCOMPLETE', 'no object at the initiated key');
  }

  const size = Number(head.ContentLength ?? 0);
  const cap = sizeCapFor(claims.mime as AcceptedMime);
  if (size !== claims.size || size > cap) {
    await deleteObject(clients, claims.bucket, claims.key);
    throw new AppError(
      'VALIDATION_FAILED',
      'stored size does not match the declared size',
      { declared: claims.size, actual: size, cap },
      // §4.9: a mismatch at completion is a 409, not a 400 — TD-3.8 records this
      // as the "409 variant on upload complete". The request was well-formed;
      // the object it refers to is not what it claimed.
      409,
    );
  }

  const ranged = await clients.internal.send(
    new GetObjectCommand({ Bucket: claims.bucket, Key: claims.key, Range: 'bytes=0-511' }),
  );
  const head512 = Buffer.from(await ranged.Body!.transformToByteArray());
  if (!magicBytesMatch(claims.mime as AcceptedMime, head512)) {
    await deleteObject(clients, claims.bucket, claims.key);
    throw new AppError(
      'VALIDATION_FAILED',
      'magic bytes do not match the declared MIME type',
      { declared: claims.mime },
      409,
    );
  }

  return { size };
}

export interface CompleteInput {
  title: string;
  description: string | null;
}

export async function completeUpload(
  prisma: PrismaClient,
  clients: StorageClients,
  signingKey: string,
  actor: Actor,
  uploadId: string,
  input: CompleteInput,
): Promise<{ id: string }> {
  const claims = claimsOf(uploadId, signingKey, actor);
  const { size } = await verifyObject(clients, claims);

  if (claims.replaces) {
    return replaceContentFile(prisma, clients, actor, claims, input, size);
  }

  await prisma.$transaction(async (tx) => {
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
        storageKey: claims.key,
        originalFilename: claims.filename,
        mimeType: claims.mime,
        sizeBytes: BigInt(size),
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
      },
    });
  });

  return { id: claims.cid };
}

/* ── POST /uploads/{upload_id}/abort ─────────────────────────────────────── */

export async function abortUpload(
  clients: StorageClients,
  signingKey: string,
  actor: Actor,
  uploadId: string,
): Promise<void> {
  const claims = claimsOf(uploadId, signingKey, actor);
  // Best-effort by design: aborting an upload that never started is a success
  // from the caller's point of view, and `upload.gc` (TD-7) sweeps anything a
  // client abandons without telling us.
  try {
    await deleteObject(clients, claims.bucket, claims.key);
  } catch {
    /* already gone */
  }
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
): Promise<{ id: string; branchId: string | null; storageBucket: string; storageKey: string }> {
  const row = await prisma.educationalContent.findFirst({
    where: { id: contentId, deletedAt: null },
    select: { id: true, branchId: true, storageBucket: true, storageKey: true },
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
 * 90-day window is a safeguarding guarantee, and losing a recording to a network
 * blip is the one outcome it cannot tolerate.
 */
async function replaceContentFile(
  prisma: PrismaClient,
  clients: StorageClients,
  actor: Actor,
  claims: UploadTicketClaims,
  input: CompleteInput,
  size: number,
): Promise<{ id: string }> {
  const existing = await loadWritableContent(prisma, actor, claims.cid);

  await prisma.$transaction(async (tx) => {
    await tx.educationalContent.update({
      where: { id: claims.cid },
      data: {
        title: input.title,
        description: input.description,
        storageBucket: claims.bucket,
        storageKey: claims.key,
        originalFilename: claims.filename,
        mimeType: claims.mime,
        sizeBytes: BigInt(size),
        version: { increment: 1 },
      },
    });
    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'content.replace',
      targetEntity: 'EducationalContent',
      targetId: claims.cid,
      detail: { previous_key: existing.storageKey, new_key: claims.key, size_bytes: size },
    });
  });

  await quarantineObject(clients, existing.storageBucket, existing.storageKey, claims.cid);
  return { id: claims.cid };
}

async function quarantineObject(
  clients: StorageClients,
  bucket: string,
  key: string,
  contentId: string,
): Promise<void> {
  const target = quarantineKeyFor(contentId, key);
  try {
    await clients.internal.send(
      new CopyObjectCommand({
        Bucket: bucket,
        Key: target,
        CopySource: `${bucket}/${key}`,
      }),
    );
    await deleteObject(clients, bucket, key);
  } catch {
    // The row is already updated and the audit written; an object left in place
    // is reaped by `content.quarantine-purge` (TD-7) rather than lost. Failing
    // the request here would tell the caller their replacement did not happen
    // when it did.
  }
}

/**
 * `DELETE /content/{id}` — soft delete, snapshot, quarantine (TD-5, BR-15).
 *
 * The object moves to `quarantine/…` and waits out BR-15's 90-day window, which
 * `content.quarantine-purge` (TD-7) closes. **The file is not removed here**:
 * a deletion that destroyed the object immediately would make the Trash's
 * restore promise a lie for exactly the entity where the data is largest.
 */
export async function deleteContent(
  prisma: PrismaClient,
  clients: StorageClients,
  actor: Actor,
  contentId: string,
): Promise<void> {
  const existing = await loadWritableContent(prisma, actor, contentId);

  await prisma.$transaction(async (tx) => {
    const row = await tx.educationalContent.findUnique({ where: { id: contentId } });
    await tx.educationalContent.update({
      where: { id: contentId },
      data: { deletedAt: new Date(), deletedById: actor.userId },
    });
    await snapshot(tx, {
      targetEntity: 'EducationalContent',
      targetId: contentId,
      // `size_bytes` is a `BigInt`, which has no JSON representation and would
      // throw on serialisation — the snapshot has to survive the round-trip, so
      // it is stringified here rather than lost with the row it describes.
      snapshot: { ...row, sizeBytes: row?.sizeBytes.toString() ?? null },
      deletedById: actor.userId,
    });
    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'content.delete',
      targetEntity: 'EducationalContent',
      targetId: contentId,
      detail: { storage_key: existing.storageKey },
    });
  });

  await quarantineObject(clients, existing.storageBucket, existing.storageKey, contentId);
}

/**
 * **Reaps the quarantined object of a permanently deleted content row** (R59.1).
 *
 * A purge that destroyed the database row and left the bytes would not be a
 * deletion — it would be an orphan nobody can find, reach or account for, in the
 * one entity where the data is largest.
 *
 * Called **after** the purge transaction commits, never inside it: an S3 call
 * cannot participate in a database transaction, and holding one open across a
 * network round trip is how a lock outlives its usefulness. The ordering is the
 * safe one — if this fails, the row is gone and the object remains, which is a
 * reapable leftover rather than a record pointing at nothing.
 */
export async function purgeQuarantinedObject(
  clients: StorageClients,
  contentId: string,
  bucket: string,
  storageKey: string,
): Promise<void> {
  // Both keys, because `deleteContent` quarantines and a failure there leaves
  // the original in place — the delete is idempotent, so asking twice is free.
  for (const key of [quarantineKeyFor(contentId, storageKey), storageKey]) {
    try {
      await deleteObject(clients, bucket, key);
    } catch {
      // Already gone, or the bucket refused. The row is destroyed either way and
      // failing the request would report a purge that did happen as one that did
      // not.
    }
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
