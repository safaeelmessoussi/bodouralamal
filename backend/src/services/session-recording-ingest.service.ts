import { createHash } from "node:crypto";

import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import {
  buildStorageKey,
  extensionOf,
  isIngestibleMime,
  mimeEssence,
  platformRecordingCap,
  recordingFamilyMatches,
} from "../lib/file-types.js";
import { verifyStoredObject } from "../lib/object-verification.js";
import { segmentsPrefixFor } from "../policies/online-class.js";
import { scheduleLevelIds } from "../policies/roster-resolution.js";
import { enqueue, JOB_QUEUES } from "../repositories/jobs.repository.js";
import { publicDisplayName } from "../lib/display-name.js";
import {
  nextRecordingName,
  recordingBaseName,
  sessionRecordingBaseName,
} from "../lib/recording-name.js";
import {
  copyObject,
  deleteObject,
  listObjectsPage,
  statObject,
  type StorageClients,
} from "../lib/storage.js";
import * as audit from "../repositories/audit.repository.js";
import { bucketFor, categoryDefaultVisibility } from "./content.service.js";
import { enqueueConsentReevaluationForSessions } from "./consent-reevaluation.service.js";

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
/** What a recovered recording says about itself in the library (R168 §2). */
export const RECOVERED_NOTE =
  "استُعيد هذا التسجيل من أجزائه المحفوظة بعد توقّف المسجِّل قبل نهاية الحصة؛ قد تنقصه الثواني الأخيرة.";

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
      // R165 §1 — what the recording is CALLED: this occurrence's own Subject
      // and Surahs where it has them (else the class's), and who led it.
      subject: { select: { name: true } },
      surahs: {
        select: { surah: { select: { nameArabic: true } } },
        orderBy: { surahId: "asc" },
      },
      staff: {
        where: { deletedAt: null, position: "teacher" },
        select: { user: { select: { nameArabic: true, publicDisplayName: true } } },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
      schedule: {
        include: {
          schedulingType: { select: { name: true } },
          surahs: {
            select: { surah: { select: { nameArabic: true } } },
            orderBy: { surahId: "asc" },
          },
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
    // **Not the upload caps** (SRS Revision 168 §2): a recording is as long as
    // the class was, and TD-9's 100 MB / 500 MB refused every class over about
    // 1 h 40 of audio or 47 minutes of video — after it had been given.
    cap: platformRecordingCap(),
  });
  if (!verified.ok) {
    return fail(
      prisma,
      recordingId,
      `the staging object failed verification: ${verified.reason} ${JSON.stringify(verified.detail)}`,
    );
  }

  /**
   * **The Level the recording is filed under — for EVERY kind of class**
   * (Owner-reported, 2026-09-21; SRS Revision 166 §4). This read the three
   * single-target columns only. A class built through the five filters
   * (`multi_dimension` — every class created since Revision 163 §5) has none
   * of them, so each of its recordings stopped here with *«the occurrence
   * resolves to no Level»*, was retried into the same refusal, and reached
   * nobody: «انتهى التسجيل لكن تعذّرت تهيئته للنشر». `scheduleLevelIds` is the
   * one resolution every other surface already uses (the Subject and Surah
   * rules), so a filter-built class answers here exactly as it does there.
   *
   * `EducationalContent.level_id` is single, so a class addressing SEVERAL
   * Levels files its recording under the first in the Levels' own order —
   * deterministic, so a retry after a partial failure writes the same row.
   */
  const { levelId, wholeCategory } = await recordingScope(prisma, recording.session);
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

    /**
     * **The TITLE is richer than the file's name, on purpose** (R165 §1): type,
     * Subject, Surah, main teacher, and when she pressed «إيقاف التسجيل». The
     * object key above keeps the person-free `baseName` — a key carries a slug
     * of its filename (TD-9) and must never carry somebody's name, and it has
     * to resolve identically on a retry.
     */
    const session = recording.session;
    const lead = session.staff[0]?.user ?? null;
    const title = nextRecordingName(
      sessionRecordingBaseName({
        typeName: session.schedule.schedulingType?.name ?? null,
        subjectName: (session.subject ?? session.schedule.subject).name,
        surahNames: (session.surahs.length > 0 ? session.surahs : session.schedule.surahs).map(
          (row) => row.surah.nameArabic,
        ),
        teacherName: lead === null ? null : publicDisplayName(lead),
        at: recording.stoppedAt ?? recording.startedAt,
      }),
      await linkedTitles(tx, recording.sessionId),
    );

    await tx.educationalContent.create({
      data: {
        id: contentId,
        title,
        // R168 §2 — said where she will read it: a recording assembled from the
        // recorder's safety segments may be missing its last few seconds.
        description: recording.recoveredFromSegments ? RECOVERED_NOTE : null,
        visibility: visibility as "public" | "private" | "hidden",
        levelId,
        wholeCategory,
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

    // §4.1a treats creation/import of a linked recording as a consent-gate
    // trigger. This shares the Session lock already held above and commits the
    // obligation with the content/link/relation transaction.
    await enqueueConsentReevaluationForSessions(tx, [recording.sessionId]);

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
 * **Where a recording is filed, and whom it is addressed to** (SRS Revision
 * 166 §4, Revision 167 §5).
 *
 * It is filed under ONE Level — the first, in the Levels' own order, of those
 * the class addresses (the Owner keeps that rule). Where the class addresses
 * **every live Level of exactly one Category**, the recording is addressed to
 * the whole Category as well: `whole_category`, which every Level of it —
 * including one added later — reads it through. A class over some Levels of a
 * Category, or over Levels of two, stays with its first Level: «كل مستويات
 * الفئة» is a statement about a Category, and neither of those is one.
 */
async function recordingScope(
  prisma: PrismaClient,
  session: {
    scheduleId: string;
    schedule: {
      teachingMode: string;
      levelId: string | null;
      administrativeGroupId: string | null;
      teachingGroupId: string | null;
    };
  },
): Promise<{ levelId: string | null; wholeCategory: boolean }> {
  const ids = await scheduleLevelIds(prisma, session.scheduleId, session.schedule);
  if (ids.length <= 1) return { levelId: ids[0] ?? null, wholeCategory: false };
  const addressed = await prisma.level.findMany({
    where: { id: { in: ids }, deletedAt: null },
    orderBy: [{ displayOrder: { sort: "asc", nulls: "last" } }, { name: "asc" }, { id: "asc" }],
    select: { id: true, categoryId: true },
  });
  const first = addressed[0];
  if (!first) return { levelId: null, wholeCategory: false };

  const oneCategory = addressed.every((level) => level.categoryId === first.categoryId);
  const wholeCategory =
    oneCategory &&
    addressed.length ===
      (await prisma.level.count({ where: { categoryId: first.categoryId, deletedAt: null } }));
  return { levelId: first.id, wholeCategory };
}

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
    // R168 §2 — and the safety segments the recorder uploaded while the class
    // ran. They exist so that a recording can be rebuilt; once the library
    // holds it they are residue, and a five-hour class leaves 1,800 of them.
    // Exactly this recording's prefix, a page at a time; the playlist too.
    const prefix = segmentsPrefixFor(key);
    for (;;) {
      const page = await listObjectsPage(clients, bucket, prefix, { maxKeys: 1_000 });
      if (page.objects.length === 0) break;
      for (const object of page.objects) await deleteObject(clients, bucket, object.key);
      if (page.nextContinuationToken === null) break;
    }
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

/**
 * **Re-queues the import of recordings that were made but never reached the
 * library** (SRS Revision 166 §4) — the operator tool behind
 * `npm run ops:requeue-recordings`.
 *
 * `session-recording-ingest` retries under TD-7's backoff and then stops. That
 * is right for a transient failure and useless once a DEFECT is fixed: the
 * staging object is still there and nothing is left to try it. For every
 * recording that is `completed`, not deleted, has an output object and has NO
 * content, this enqueues the ordinary import job — the same queue, payload and
 * singleton key the provider callback uses. It clears nothing: the job's own
 * first step is its idempotency anchor, so running this twice, or beside a job
 * already pending, is harmless. Returns counts, the platform's own refusal text
 * and recording ids — never a title, a name or a key.
 */
export async function requeueStrandedRecordings(
  prisma: PrismaClient,
  options: { dryRun: boolean },
): Promise<{
  stranded: number;
  queued: number;
  already_pending: number;
  dry_run: boolean;
  reasons: string[];
  recording_ids: string[];
}> {
  const stranded = await prisma.sessionRecording.findMany({
    where: {
      status: "completed",
      deletedAt: null,
      educationalContentId: null,
      outputKey: { not: null },
    },
    select: { id: true, ingestionFailureReason: true },
    orderBy: { startedAt: "asc" },
  });

  let queued = 0;
  if (!options.dryRun) {
    for (const recording of stranded) {
      const inserted = await prisma.$transaction((tx) =>
        enqueue(tx, JOB_QUEUES.sessionRecordingIngest, { recording_id: recording.id }, recording.id),
      );
      if (inserted) queued += 1;
    }
  }
  return {
    stranded: stranded.length,
    queued,
    already_pending: options.dryRun ? 0 : stranded.length - queued,
    dry_run: options.dryRun,
    reasons: [...new Set(stranded.map((r) => r.ingestionFailureReason ?? "(none recorded)"))],
    recording_ids: stranded.map((r) => r.id),
  };
}
