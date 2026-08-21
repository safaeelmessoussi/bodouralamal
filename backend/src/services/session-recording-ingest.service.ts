import { createHash } from "node:crypto";

import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import {
  buildStorageKey,
  extensionOf,
  isIngestibleMime,
  mimeEssence,
  recordingFamilyMatches,
  sizeCapFor,
  type AcceptedMime,
} from "../lib/file-types.js";
import { verifyStoredObject } from "../lib/object-verification.js";
import {
  nextRecordingName,
  recordingBaseName,
} from "../lib/recording-name.js";
import {
  copyObject,
  deleteObject,
  statObject,
  type StorageClients,
} from "../lib/storage.js";
import * as audit from "../repositories/audit.repository.js";
import { bucketFor, categoryDefaultVisibility } from "./content.service.js";

/**
 * **Turning a provider's staging object into a بذور الأمل library item**
 * (SRS Revision 99, clauses 13 and 14).
 *
 * ## The sentence this file exists to make true
 *
 * > **A recording is finished when the object exists in the platform's own
 * > storage and an `EducationalContent` row references it — not when the
 * > provider says it has one.**
 *
 * C1 ends at *the provider produced an object*. Everything between that and a
 * beneficiary pressing play is here, and every step of it can fail
 * independently, so the ordering below is not incidental — it is the design.
 *
 * ## Provider `completed` ≠ Bodour `available`
 *
 * They are different facts about different stores, and R99.14 forbids claiming
 * the second on the strength of the first. **Availability is DERIVED from
 * `SessionRecording.educationalContentId` being set**, never stored as a status
 * value that could disagree with it: an `EducationalContent` row whose object is
 * absent is worse than an honest failure, because it is discoverable,
 * downloadable and empty.
 *
 * ## Why a job and not the webhook
 *
 * The callback must persist the provider's report and return. Copying a 500 MB
 * MP4 inside an HTTP handler would hold the request open for as long as the copy
 * takes, and a provider that times out **retries**, so a slow ingestion would
 * turn into several concurrent ones. The webhook writes the fact and enqueues;
 * this runs on pg-boss with TD-7's retry policy, which is also what makes a
 * transient MinIO failure a *retry* instead of a lost recording (§20 rule 1).
 *
 * ## The order, and what each step protects
 *
 * 1. **Already ingested?** → return what is there. The durable idempotency
 *    anchor, and the first thing checked on every attempt.
 * 2. **Verify the ACTUAL bytes** — never the provider's metadata. Exists,
 *    non-empty, within TD-9's cap, magic bytes matching, and the **media family
 *    the class asked for** (R99.7).
 * 3. **Copy server-side into the content bucket.** The staging object is
 *    integration state with a lifetime the association does not control; a
 *    library item pointing at it would rot silently (R99.13).
 * 4. **One transaction**: name, `EducationalContent`, `SessionContent`, the
 *    link back, and the audit row. Either the recording became a library item
 *    or it did not.
 * 5. **Then, and only then, clean up staging.** A cleanup failure must never
 *    undo valid content.
 */

/** What one attempt did, for the job log and for the tests. */
export interface IngestOutcome {
  recordingId: string;
  contentId: string | null;
  /** `true` when this attempt found the work already done — a duplicate
   *  callback, a retried job, or a worker that died after committing. */
  alreadyIngested: boolean;
  /** Present when the attempt refused the object. The job still **fails**, so
   *  TD-7's backoff applies and a corrected staging object is picked up on the
   *  next attempt (R99.14 — a failure somebody can act on). */
  failure?: string;
  /** A returned attempt has removed staging (or found it already absent).
   *  Cleanup failure is thrown so this same durable job remains retryable. */
  stagingCleaned?: boolean;
}

/**
 * Raised when the attempt should be retried by pg-boss. Carries the reason that
 * was persisted, so the job log and the row agree.
 */
export class IngestionFailure extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "IngestionFailure";
  }
}

/**
 * The canonical ingest has committed, but its exact staging object could not
 * yet be removed. This is deliberately distinct from `IngestionFailure`: the
 * recording is already valid and available, so the failure belongs to the
 * durable job obligation, not to `ingestionFailureReason` or the UI state.
 */
export class RecordingStagingCleanupFailure extends Error {
  constructor(
    readonly bucket: string,
    readonly key: string,
    cause: unknown,
  ) {
    super(`staging cleanup failed for ${bucket}/${key}`, { cause });
    this.name = "RecordingStagingCleanupFailure";
  }
}

const RECORDING_INCLUDE = {
  session: {
    include: {
      schedule: {
        include: {
          subject: { select: { id: true, name: true } },
          level: { select: { id: true } },
          administrativeGroup: { select: { levelId: true } },
          teachingGroup: { select: { levelId: true } },
        },
      },
    },
  },
} as const;

/**
 * **The one entry point.** Idempotent by construction and safe to call again
 * after any failure.
 */
export async function ingestRecording(
  prisma: PrismaClient,
  clients: StorageClients,
  recordingId: string,
): Promise<IngestOutcome> {
  const recording = await prisma.sessionRecording.findFirst({
    where: { id: recordingId, deletedAt: null },
    include: RECORDING_INCLUDE,
  });
  // A recording that no longer exists is not a failure to retry — there is
  // nothing to ingest and never will be.
  if (!recording) {
    return { recordingId, contentId: null, alreadyIngested: false };
  }

  /**
   * **Step 1 — the durable idempotency anchor** (R99.15).
   *
   * A duplicate webhook delivery, a pg-boss retry and a worker killed between
   * the commit and the staging sweep all land here, and all three must produce
   * **one** content row. The column is `UNIQUE`, so this is a genuine guarantee
   * rather than a check that usually wins the race.
   */
  if (recording.educationalContentId !== null) {
    await sweepStaging(clients, recording.outputBucket, recording.outputKey);
    return {
      recordingId,
      contentId: recording.educationalContentId,
      alreadyIngested: true,
      stagingCleaned: true,
    };
  }

  // Only a provider-completed recording has an object to ingest. Anything else
  // — still running, failed, aborted — has nothing, and enqueuing was either a
  // race with a later report or a stale job.
  if (recording.status !== "completed") {
    return { recordingId, contentId: null, alreadyIngested: false };
  }

  const stagingBucket = recording.outputBucket;
  const stagingKey = recording.outputKey;
  const stagingMime = recording.mimeType;
  if (!stagingBucket || !stagingKey || !stagingMime) {
    return fail(prisma, recordingId, "the provider reported no output object");
  }

  const media = recording.session.onlineMediaMode;
  if (media === null) {
    // R97's CHECK makes this unreachable for an online occurrence; reaching it
    // means the occurrence stopped being online, and guessing a family would be
    // inventing the one fact the verification turns on.
    return fail(prisma, recordingId, "the occurrence is no longer an online class");
  }

  /**
   * **Step 2 — the object itself, never the metadata around it** (R99.8).
   *
   * The row says what the provider was *asked* to produce and the webhook says
   * what it *claims* to have produced. Neither is evidence. Four things are
   * checked against the bytes actually in the bucket, and the family check is
   * the one that is specific to recording: an OGG delivered for a صوت وصورة
   * class is a downgrade of the lesson (R99.7), not a corrupt file, and it must
   * be refused with the same firmness as a renamed ZIP.
   */
  if (!recordingFamilyMatches(media, stagingMime)) {
    return fail(
      prisma,
      recordingId,
      `the provider produced ${mimeEssence(stagingMime)} for a ${media} class`,
    );
  }
  if (!isIngestibleMime(stagingMime)) {
    return fail(prisma, recordingId, `${mimeEssence(stagingMime)} is not a TD-9 type`);
  }

  const verified = await verifyStoredObject(clients, {
    bucket: stagingBucket,
    key: stagingKey,
    mime: stagingMime,
    // **Deliberately not the provider's byte count.** The platform declared no
    // size, and failing a perfect recording over a provider's rounding would be
    // a strictness that protects nothing. The cap and the emptiness check are
    // what actually matter here.
    declaredSize: null,
    cap: sizeCapFor(stagingMime as AcceptedMime),
  });
  if (!verified.ok) {
    return fail(
      prisma,
      recordingId,
      `the staging object failed verification: ${verified.reason} ${JSON.stringify(verified.detail)}`,
    );
  }

  const levelId =
    recording.session.schedule.level?.id ??
    recording.session.schedule.administrativeGroup?.levelId ??
    recording.session.schedule.teachingGroup?.levelId ??
    null;
  if (levelId === null) {
    // `EducationalContent.level_id` is NOT NULL, and §4.9 groups the library by
    // Level. Inventing one would file the class's recording under a curriculum
    // it does not belong to.
    return fail(prisma, recordingId, "the occurrence resolves to no Level");
  }

  /**
   * **Step 3 — the durable object, copied INSIDE the storage service.**
   *
   * The key is TD-9's ordinary content key, so an ingested recording is
   * indistinguishable from any other library object to every reader, every
   * presigned mint and every quarantine path. Its hash segment is **derived
   * from the recording id** rather than random, which is what makes a retry
   * after a partial failure find its own object instead of minting a second key
   * and orphaning the first — and the object is copied only if it is **not
   * already there**, so the key is still written exactly once (§20 rule 15).
   */
  const contentId = recording.id;
  const extension = extensionOf(`x.${mimeEssence(stagingMime).split("/")[1] ?? "bin"}`);
  const baseName = recordingBaseName({
    title: recording.session.schedule.subject.name,
    description: null,
    date: isoDate(recording.session.date),
  });
  const filename = `${baseName}.${extension}`;
  const visibility = await categoryDefaultVisibility(prisma, levelId);
  const bucket = bucketFor(visibility);
  const key = buildStorageKey(
    contentId,
    filename,
    createHash("sha256").update(recording.id).digest("hex").slice(0, 8),
  );

  const already = await statObject(clients, bucket, key);
  if (already === null) {
    try {
      await copyObject(
        clients,
        { bucket: stagingBucket, key: stagingKey },
        { bucket, key },
        // The VERIFIED type becomes the object's own. A provider's guess must
        // not survive into the content bucket.
        mimeEssence(stagingMime),
      );
    } catch (error) {
      return fail(prisma, recordingId, `the durable copy failed: ${String(error).slice(0, 200)}`);
    }
  }

  /**
   * **Step 4 — one transaction, and the name is allocated inside it.**
   *
   * `SELECT … FOR UPDATE` on the occurrence is what makes R75.6's numbering
   * collision-free without a unique constraint on a human-editable title: two
   * ingestions of the same class — or an ingestion racing a browser recording's
   * link — serialise on the session row, so the second one sees the first one's
   * title in the namespace it numbers against (§20 rule 12).
   */
  const created = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT "id" FROM "session" WHERE "id" = ${recording.sessionId}::uuid FOR UPDATE`;

    // Re-read under the lock: a concurrent attempt may have finished between
    // the check at the top and here.
    const fresh = await tx.sessionRecording.findUniqueOrThrow({
      where: { id: recording.id },
      select: { educationalContentId: true },
    });
    if (fresh.educationalContentId !== null) return fresh.educationalContentId;

    const title = nextRecordingName(baseName, await linkedTitles(tx, recording.sessionId));

    await tx.educationalContent.create({
      data: {
        id: contentId,
        title,
        description: null,
        visibility: visibility as "public" | "private" | "hidden",
        levelId,
        subjectId: recording.session.schedule.subjectId,
        academicYearId: recording.session.schedule.academicYearId,
        // §4.9's Global scope is a deliberate act; a recording belongs to the
        // branch whose class produced it.
        branchId: recording.session.schedule.branchId,
        storageBucket: bucket,
        storageKey: key,
        originalFilename: filename,
        mimeType: mimeEssence(stagingMime),
        sizeBytes: BigInt(verified.sizeBytes),
        // R99.9/R99.10 — «التسجيلات» is decided here.
        origin: "session_recording",
      },
    });

    // §4.9: a Session REFERENCES content. `upsert` on the composite key because
    // an earlier attempt may have created the link and failed afterwards.
    await tx.sessionContent.upsert({
      where: {
        sessionId_contentId: { sessionId: recording.sessionId, contentId },
      },
      create: { sessionId: recording.sessionId, contentId },
      update: { deletedAt: null, deletedById: null },
    });

    await tx.sessionRecording.update({
      where: { id: recording.id },
      data: { educationalContentId: contentId, ingestionFailureReason: null },
    });

    await audit.write(tx, {
      // **No actor.** §7's attribution invariant (Revision 17) makes a null
      // actor mean *system-initiated*, which is exactly what this is: the
      // person who pressed «بدء التسجيل» is recorded by `session.recording_start`
      // and did not perform this.
      actorUserId: null,
      actionType: "session.recording_ingested",
      targetEntity: "SessionRecording",
      targetId: recording.id,
      detail: {
        session_id: recording.sessionId,
        educational_content_id: contentId,
        mime: mimeEssence(stagingMime),
        size_bytes: verified.sizeBytes,
        media_mode: media,
      },
    });

    return contentId;
  });

  /**
   * **Step 5 — staging is swept last, and its failure is not the recording's.**
   *
   * R99.13 is explicit that the provider's object is temporary; it is equally
   * explicit that the durable asset is the truth. If the sweep fails the content
   * is valid and reachable, and what is left behind is one object in a bucket
   * the platform owns and does not serve. Undoing a good ingestion to tidy it up
   * would be the wrong trade in every direction.
   */
  await sweepStaging(clients, stagingBucket, stagingKey);

  return {
    recordingId,
    contentId: created,
    alreadyIngested: false,
    stagingCleaned: true,
  };
}

/* ───────────────────────────────── internals ───────────────────────────── */

/**
 * Records why the attempt was refused and **throws**, so pg-boss retries under
 * TD-7's backoff.
 *
 * The reason lands in `ingestionFailureReason` — a column of its own, separate
 * from the provider's `failureReason`, because *the provider could not record*
 * and *the platform could not accept what it recorded* have different remedies
 * and only one of them is fixed by trying again.
 *
 * **Nothing is deleted and no content row exists.** R99.14: a failed ingestion
 * leaves a state somebody can act on and never a broken content item.
 */
async function fail(
  prisma: PrismaClient,
  recordingId: string,
  reason: string,
): Promise<never> {
  await prisma.sessionRecording.updateMany({
    where: { id: recordingId },
    data: { ingestionFailureReason: reason.slice(0, 500) },
  });
  throw new IngestionFailure(reason);
}

/**
 * Immediate cleanup, backed by the current job's durable TD-7 retry.
 *
 * S3 `DeleteObject` is idempotent: an already-missing key is success. A real
 * storage failure is allowed to escape only after the canonical object and
 * relation committed. pg-boss therefore retries this same recording; the
 * first-read idempotency anchor above skips every ingest step and addresses
 * only the bucket/key recorded on this `SessionRecording`.
 */
async function sweepStaging(
  clients: StorageClients,
  bucket: string | null,
  key: string | null,
): Promise<void> {
  if (!bucket || !key) return;
  try {
    await deleteObject(clients, bucket, key);
  } catch (error) {
    throw new RecordingStagingCleanupFailure(bucket, key, error);
  }
}

/**
 * **The whole namespace, not the caller-visible slice.**
 *
 * The Session page numbers against what its reader can see, because a suffix
 * derived from a hidden item would report that the item exists (§20 rule 17).
 * There is no reader here — this runs unattended under a row lock — so it uses
 * every live link, which is what makes the unattended path genuinely
 * collision-free.
 */
async function linkedTitles(
  tx: Prisma.TransactionClient,
  sessionId: string,
): Promise<string[]> {
  const links = await tx.sessionContent.findMany({
    where: { sessionId, deletedAt: null, content: { deletedAt: null } },
    select: { content: { select: { title: true } } },
  });
  return links.map((l) => l.content.title);
}

/** TD-11: a Session carries a calendar date, never an instant. */
const isoDate = (d: Date): string => d.toISOString().slice(0, 10);
