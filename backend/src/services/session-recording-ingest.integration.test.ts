import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { PgBoss } from "pg-boss";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { TD7_RETRY_POLICY } from "../jobs/runner.js";
import { loadConfig } from "../lib/config.js";
import { clearTestContentRetirements } from '../test-support/storage-retirement.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import {
  createStorageClients,
  deleteObject,
  listObjectsPage,
  statObject,
  type StorageClients,
} from "../lib/storage.js";
import type { OnlineClassProvider, RecordingReport } from "../lib/online-class-provider.js";
import { platformRecordingCap, SIZE_CAPS } from "../lib/file-types.js";
import type { Actor } from "../policies/actor.js";
import { segmentsPrefixFor } from "../policies/online-class.js";
import type { RoleScope } from "../policies/branch-scope.js";
import { createCourseSchedule } from "./course-schedule.service.js";
import { createLevel } from "./level.service.js";
import {
  ingestRecording,
  RECOVERED_NOTE,
  RecordingStagingCleanupFailure,
  requeueStrandedRecordings,
} from "./session-recording-ingest.service.js";
import {
  activeRecordings,
  RECONCILE_DEAD_AFTER_MS,
  reconcileRecordings,
} from "./session-recording-reconcile.service.js";
import { FFMPEG_PATH, type Assembler } from "./session-recording-recover.service.js";
import { listSegments } from "./session-recording-segments.js";
import { applyProviderReport } from "./session-recording.service.js";

/**
 * **R99 C2 — a provider's staging object becomes a بذور الأمل library item.**
 *
 * The properties this suite exists for, each written against the reason it
 * matters rather than the code that implements it:
 *
 * 1. **Provider `completed` is not Bodour «متاح»** (R99.13/14). Availability is
 *    derived from the content row existing, and a failed import leaves **no**
 *    content, **no** link and a state somebody can act on.
 * 2. **The bytes are verified, never the metadata.** A renamed ZIP, an empty
 *    file, an over-cap file and an OGG delivered for a صوت وصورة class are all
 *    refused — the last one because R99.7 forbids silently downgrading a lesson.
 * 3. **Exactly once.** A duplicate callback, a retried job and a re-run after a
 *    partial failure converge on one object, one `EducationalContent`, one
 *    `SessionContent` and no false suffix increment.
 * 4. **The durable object is Bodour's.** The library never points at
 *    `recordings-staging`, and staging is swept only after success.
 * 5. **`video/mp4` is ingestible and still unuploadable** — R99.8 admits a
 *    provenance, not a file type.
 *
 * Real MinIO throughout: an ingestion that "works" against a mocked object store
 * proves nothing about `CopyObject`, which is the one step that could quietly
 * move half a gigabyte through this process.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = "[recording-ingest-r99]";
const STAGING = config.RECORDING_STAGING_BUCKET;

const CLASS_DATE = "2026-06-09";
const NOW = new Date("2026-06-01T08:00:00.000Z");

const at = (hh: number, mm = 0): Date => new Date(Date.UTC(1970, 0, 1, hh, mm, 0));
const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

let clients: StorageClients;
let adminId: string;
let branchA: string;
let levelId: string;
let subjectVideo: string;
let subjectAudio: string;
let academicYearId: string;

const actorOf = (userId: string, scopes: RoleScope[]): Actor => ({
  userId,
  roles: scopes.map((s) => s.role),
  roleScopes: scopes,
});
const superAdmin = (): Actor =>
  actorOf(adminId, [{ role: "super_admin", branches: null }]);

/* ── Real bytes, with real signatures ────────────────────────────────────── */

/** `OggS` at offset 0 — what a صوت فقط Egress writes. */
function oggBytes(size = 4096): Buffer {
  const b = Buffer.alloc(size, 0x11);
  b.write("OggS", 0, "latin1");
  return b;
}

/** `ftyp` at offset 4 — the ISO base media box MP4 carries. */
function mp4Bytes(size = 8192): Buffer {
  const b = Buffer.alloc(size, 0x22);
  b.writeUInt32BE(size, 0);
  b.write("ftypisom", 4, "latin1");
  return b;
}

/** A ZIP renamed to look like a recording — the case magic bytes exist for. */
function zipBytes(size = 2048): Buffer {
  const b = Buffer.alloc(size, 0x33);
  b.set([0x50, 0x4b, 0x03, 0x04], 0);
  return b;
}

async function putStaging(key: string, bytes: Buffer): Promise<void> {
  await clients.internal.send(
    new PutObjectCommand({ Bucket: STAGING, Key: key, Body: bytes }),
  );
}

/**
 * A real MinIO client with one controlled fault at the exact delete boundary.
 * HEAD, ranged GET, CopyObject and every non-target delete still go to MinIO;
 * only the selected `DeleteObject` calls fail before leaving this process.
 */
function failTargetDeletes(
  base: StorageClients,
  target: { bucket: string; key: string },
  failures: number,
): { clients: StorageClients; attempts: () => number } {
  let attempts = 0;
  const internal = {
    send: async (command: unknown): Promise<unknown> => {
      if (
        command instanceof DeleteObjectCommand &&
        command.input.Bucket === target.bucket &&
        command.input.Key === target.key
      ) {
        attempts += 1;
        if (attempts <= failures) {
          throw new Error("controlled transient staging-delete failure");
        }
      }
      return base.internal.send(command as never);
    },
  } as unknown as StorageClients["internal"];

  return {
    clients: { ...base, internal },
    attempts: () => attempts,
  };
}

type StoredJob = {
  state: "created" | "retry" | "active" | "completed" | "failed";
  retry_count: number;
  output: unknown;
};

async function storedJob(queue: string, id: string): Promise<StoredJob | null> {
  const rows = await prisma.$queryRaw<StoredJob[]>`
    SELECT state::text, retry_count, output
    FROM pgboss.job
    WHERE name = ${queue} AND id = ${id}::uuid`;
  return rows[0] ?? null;
}

async function waitForJobState(
  queue: string,
  id: string,
  expected: StoredJob["state"],
  timeoutMs = 20_000,
): Promise<StoredJob> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await storedJob(queue, id);
    if (row?.state === expected) return row;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`job ${id} did not reach ${expected}`);
}

function testBoss(): PgBoss {
  const boss = new PgBoss({ connectionString: config.DATABASE_URL, max: 1 });
  // A test assertion observes failures through durable job state. Do not also
  // turn pg-boss's process-level error event into an unhandled exception.
  boss.on("error", () => undefined);
  return boss;
}

async function dropTestQueue(queue: string): Promise<void> {
  const boss = testBoss();
  await boss.start();
  try {
    if (await boss.getQueue(queue)) await boss.deleteQueue(queue);
  } finally {
    await boss.stop({ graceful: true });
  }
}

/* ── Fixture ─────────────────────────────────────────────────────────────── */

async function person(label: string): Promise<string> {
  const user = await prisma.user.create({
    data: { sex: "female", nameArabic: `${TAG} ${label}`, accountStatus: "active" },
  });
  return user.id;
}

async function onlineClass(
  media: "audio_video" | "audio_only",
  subjectId: string,
  weekday: string,
  /** How the class is ADDRESSED. `filters` is what إضافة عنصر has built since
   *  Revision 163 §5: no single-target column at all, only scope rows. */
  addressedBy: "level" | "filters" = "level",
  /** The Levels a filter-built class names; her own Level when not said. */
  filterLevelIds?: string[],
): Promise<string> {
  const { id } = await createCourseSchedule(
    prisma,
    superAdmin(),
    {
      title: `${TAG} ${media}`,
      subjectId,
      ...(addressedBy === "level"
        ? { teachingMode: "entire_level", targetId: levelId }
        : { teachingMode: "multi_dimension", dimensions: { levelIds: filterLevelIds ?? [levelId] } }),
      branchId: branchA,
      roomId: null,
      startTime: at(15),
      endTime: at(17),
      recurrence: "weekly",
      weekdays: [weekday],
      academicYearId,
      staff: [],
      deliveryMode: "online",
      onlineMediaMode: media,
    } as never,
    NOW,
  );
  const session = await prisma.session.findFirstOrThrow({
    where: { scheduleId: id, date: day(CLASS_DATE) },
    select: { id: true },
  });
  return session.id;
}

/**
 * A recording as C1 leaves it: the provider has reported `completed` and there
 * is an object in staging. **Nothing here creates content** — that is exactly
 * what C2 is for.
 */
async function completedRecording(
  sessionId: string,
  mime: string,
  bytes: Buffer,
  keyOverride?: string,
): Promise<{ id: string; key: string }> {
  const created = await prisma.sessionRecording.create({
    data: {
      sessionId,
      startedById: adminId,
      status: "completed",
      providerEgressId: `EG_${Math.random().toString(36).slice(2)}`,
      outputBucket: STAGING,
      outputKey: "placeholder",
      mimeType: mime,
      stoppedAt: new Date(),
    },
    select: { id: true },
  });
  const key = keyOverride ?? `session-recordings/${sessionId}/${created.id}.bin`;
  await prisma.sessionRecording.update({
    where: { id: created.id },
    data: { outputKey: key },
  });
  await putStaging(key, bytes);
  return { id: created.id, key };
}

async function cleanup(): Promise<void> {
  const tagged = { name: { startsWith: TAG } };
  const taggedPerson = { nameArabic: { startsWith: TAG } };
  const scheduleWhere = { schedule: { subject: tagged } };

  /**
   * **The staging objects this suite deliberately leaves behind.**
   *
   * A refused ingestion keeps its staging object on purpose (R99.14 — a
   * corrected one must be retryable), which is right for the platform and wrong
   * for a test bucket: without this the dev store grows by a handful of objects
   * every run, and the ONE measurement that tells a real sweep failure from
   * accumulated fixtures — *is the staging bucket empty after a successful
   * import?* — stops meaning anything.
   */
  const staged = await prisma.sessionRecording.findMany({
    where: { session: scheduleWhere },
    select: { outputBucket: true, outputKey: true },
  });
  if (staged.length > 0) {
    const s3 = createStorageClients(config);
    for (const row of staged) {
      if (!row.outputBucket || !row.outputKey) continue;
      try {
        await deleteObject(s3, row.outputBucket, row.outputKey);
      } catch {
        /* already swept by a successful ingestion */
      }
      // R168 §2 — and the safety segments a recording that was never imported
      // still has, deliberately.
      const left = await listObjectsPage(s3, row.outputBucket, segmentsPrefixFor(row.outputKey), {
        maxKeys: 1_000,
      });
      for (const object of left.objects) await deleteObject(s3, row.outputBucket, object.key);
    }
  }

  // Durable content objects too — an ingested recording left a real file.
  const durable = await prisma.educationalContent.findMany({
    where: { subject: tagged },
    select: { storageBucket: true, storageKey: true },
  });
  if (durable.length > 0) {
    const s3 = createStorageClients(config);
    for (const row of durable) {
      try {
        await deleteObject(s3, row.storageBucket, row.storageKey);
      } catch {
        /* never written, or already gone */
      }
    }
  }

  await prisma.sessionRecording.updateMany({
    where: { session: scheduleWhere },
    data: { educationalContentId: null },
  });
  await prisma.sessionRecording.deleteMany({ where: { session: scheduleWhere } });
  await prisma.sessionContent.deleteMany({ where: { session: scheduleWhere } });
  await prisma.sessionStaff.deleteMany({ where: { session: scheduleWhere } });
  await prisma.notification.deleteMany({ where: { session: scheduleWhere } });
  await prisma.session.deleteMany({ where: scheduleWhere });
  await clearTestContentRetirements(prisma, { subject: tagged });
  await prisma.educationalContent.deleteMany({ where: { subject: tagged } });
  await prisma.courseScheduleStaff.deleteMany({
    where: { schedule: { subject: tagged } },
  });
  await prisma.recurringCourseSchedule.deleteMany({ where: { subject: tagged } });
  await prisma.levelSubject.deleteMany({ where: { subject: tagged } });
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { actionType: "session.recording_ingested" },
        { actor: taggedPerson },
      ],
    },
  });
  await prisma.userBranchRole.deleteMany({ where: { user: taggedPerson } });
  await prisma.user.deleteMany({ where: taggedPerson });
  await prisma.subject.deleteMany({ where: tagged });
  await prisma.level.deleteMany({ where: tagged });
  await prisma.branch.deleteMany({ where: tagged });
  await prisma.category.deleteMany({ where: tagged });
}

beforeEach(async () => {
  clients = createStorageClients(config);
  await cleanup();
  adminId = await person("المسؤولة");
  const role = await prisma.role.findFirstOrThrow({ where: { name: "super_admin" } });
  await prisma.userBranchRole.create({
    data: { userId: adminId, roleId: role.id, branchId: null },
  });
  const categoryId = (
    await prisma.category.create({ data: { name: `${TAG} النساء` } })
  ).id;
  branchA = (await prisma.branch.create({ data: { name: `${TAG} تاركة` } })).id;
  levelId = (
    await createLevel(prisma, superAdmin(), {
      name: `${TAG} المستوى 1`,
      categoryId,
      genderRestriction: "any",
    })
  ).level.id;
  subjectVideo = (await prisma.subject.create({ data: { name: `${TAG} تفسير القرآن` } })).id;
  subjectAudio = (await prisma.subject.create({ data: { name: `${TAG} سيرة` } })).id;
  await prisma.levelSubject.createMany({
    data: [
      { levelId, subjectId: subjectVideo },
      { levelId, subjectId: subjectAudio },
    ],
  });
  academicYearId = (
    await prisma.academicYear.findFirstOrThrow({ select: { id: true } })
  ).id;
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

const failure = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run();
    return "";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};

/* ── The happy path, both media modes ────────────────────────────────────── */

describe("a completed recording becomes a library item (R99.13)", () => {
  it("صوت فقط — an OGG lands in Bodour storage, linked to its class", async () => {
    const sessionId = await onlineClass("audio_only", subjectAudio, "tuesday");
    const rec = await completedRecording(sessionId, "audio/ogg", oggBytes());

    const outcome = await ingestRecording(prisma, clients, rec.id);
    expect(outcome.contentId).not.toBeNull();
    expect(outcome.alreadyIngested).toBe(false);

    const content = await prisma.educationalContent.findUniqueOrThrow({
      where: { id: outcome.contentId! },
    });
    // R99.10 — «التسجيلات» is decided by this and not by the MIME type.
    expect(content.origin).toBe("session_recording");
    expect(content.mimeType).toBe("audio/ogg");
    expect(Number(content.sizeBytes)).toBe(4096);
    // R99.13 — the library must NEVER point at the provider's staging area.
    expect(content.storageBucket).not.toBe(STAGING);
    expect(content.storageKey).not.toContain("session-recordings/");
    expect(content.storageKey.startsWith(`content/${outcome.contentId!}/`)).toBe(true);
    // The class's own scope, not a guess.
    expect(content.levelId).toBe(levelId);
    expect(content.subjectId).toBe(subjectAudio);
    expect(content.branchId).toBe(branchA);

    // §4.9 — a Session REFERENCES content.
    const links = await prisma.sessionContent.findMany({
      where: { sessionId, deletedAt: null },
    });
    expect(links.map((l) => l.contentId)).toEqual([outcome.contentId]);

    // The durable object genuinely exists, with the verified type.
    const stat = await statObject(clients, content.storageBucket, content.storageKey);
    expect(stat?.sizeBytes).toBe(4096);
    expect(stat?.contentType).toBe("audio/ogg");

    // Staging is swept only after all of that.
    expect(outcome.stagingCleaned).toBe(true);
    expect(await statObject(clients, STAGING, rec.key)).toBeNull();
  });

  it("صوت وصورة — an MP4 is ingestible, and video is STILL unuploadable (R99.8)", async () => {
    const sessionId = await onlineClass("audio_video", subjectVideo, "tuesday");
    const rec = await completedRecording(sessionId, "video/mp4", mp4Bytes());

    const outcome = await ingestRecording(prisma, clients, rec.id);
    const content = await prisma.educationalContent.findUniqueOrThrow({
      where: { id: outcome.contentId! },
    });
    expect(content.mimeType).toBe("video/mp4");
    expect(content.origin).toBe("session_recording");

    // The other half of R99.8, asserted here beside the arm that admits it:
    // what R99 opened is a PIPELINE, not a file type.
    const { isUploadableMime, isIngestibleMime } = await import("../lib/file-types.js");
    expect(isUploadableMime("video/mp4")).toBe(false);
    expect(isIngestibleMime("video/mp4")).toBe(true);
  });

  it("availability is DERIVED, so «متاح» cannot disagree with the asset", async () => {
    const sessionId = await onlineClass("audio_only", subjectAudio, "tuesday");
    const rec = await completedRecording(sessionId, "audio/ogg", oggBytes());

    const before = await prisma.sessionRecording.findUniqueOrThrow({
      where: { id: rec.id },
      select: { status: true, educationalContentId: true },
    });
    // The provider is finished and the platform is not. R99.14's whole point.
    expect(before.status).toBe("completed");
    expect(before.educationalContentId).toBeNull();

    await ingestRecording(prisma, clients, rec.id);

    const after = await prisma.sessionRecording.findUniqueOrThrow({
      where: { id: rec.id },
      select: { status: true, educationalContentId: true, ingestionFailureReason: true },
    });
    expect(after.status).toBe("completed");
    expect(after.educationalContentId).not.toBeNull();
    expect(after.ingestionFailureReason).toBeNull();
  });

  it("writes a system-initiated audit row — nobody performed this", async () => {
    const sessionId = await onlineClass("audio_only", subjectAudio, "tuesday");
    const rec = await completedRecording(sessionId, "audio/ogg", oggBytes());
    await ingestRecording(prisma, clients, rec.id);

    const row = await prisma.auditLog.findFirstOrThrow({
      where: { actionType: "session.recording_ingested", targetId: rec.id },
    });
    // §7's attribution invariant (Revision 17): null means system-initiated,
    // not attribution lost. Who chose to record is `session.recording_start`.
    expect(row.actorUserId).toBeNull();
  });
});

/* ── Post-commit staging cleanup ────────────────────────────────────────── */

describe("staging cleanup is an idempotent durable obligation (R99/R100)", () => {
  it("preserves the canonical ingest, then retries only the exact staging key", async () => {
    const sessionId = await onlineClass("audio_only", subjectAudio, "tuesday");
    const rec = await completedRecording(sessionId, "audio/ogg", oggBytes());
    const unrelated = await completedRecording(sessionId, "audio/ogg", oggBytes());
    const flaky = failTargetDeletes(
      clients,
      { bucket: STAGING, key: rec.key },
      1,
    );

    const failedCleanup = ingestRecording(prisma, flaky.clients, rec.id);
    await expect(failedCleanup).rejects.toBeInstanceOf(RecordingStagingCleanupFailure);
    await expect(failedCleanup).rejects.toMatchObject({
      name: "RecordingStagingCleanupFailure",
      bucket: STAGING,
      key: rec.key,
    });
    expect(flaky.attempts()).toBe(1);

    // The failure happened AFTER the durable copy and transaction. It is not
    // an import failure and cannot make valid content disappear or look failed.
    const row = await prisma.sessionRecording.findUniqueOrThrow({
      where: { id: rec.id },
      select: { educationalContentId: true, ingestionFailureReason: true },
    });
    expect(row.educationalContentId).not.toBeNull();
    expect(row.ingestionFailureReason).toBeNull();
    const content = await prisma.educationalContent.findUniqueOrThrow({
      where: { id: row.educationalContentId! },
      select: { storageBucket: true, storageKey: true },
    });
    expect(await statObject(clients, content.storageBucket, content.storageKey)).toMatchObject({
      sizeBytes: 4096,
    });
    expect(await statObject(clients, STAGING, rec.key)).not.toBeNull();
    expect(await statObject(clients, STAGING, unrelated.key)).not.toBeNull();

    // A retry sees the durable relation first, skips verification/copy/rows,
    // and removes only the staging coordinates stored on this recording.
    const retried = await ingestRecording(prisma, clients, rec.id);
    expect(retried).toMatchObject({
      contentId: row.educationalContentId,
      alreadyIngested: true,
      stagingCleaned: true,
    });
    expect(await statObject(clients, STAGING, rec.key)).toBeNull();
    expect(await statObject(clients, STAGING, unrelated.key)).not.toBeNull();
    expect(await statObject(clients, content.storageBucket, content.storageKey)).toMatchObject({
      sizeBytes: 4096,
    });

    // MinIO/S3 DeleteObject treats an absent key as success. Repeating the
    // cleanup therefore converges without touching the canonical object.
    await expect(ingestRecording(prisma, clients, rec.id)).resolves.toMatchObject({
      alreadyIngested: true,
      stagingCleaned: true,
    });
    expect(await statObject(clients, content.storageBucket, content.storageKey)).toMatchObject({
      sizeBytes: 4096,
    });
  });

  it("survives a pg-boss worker restart and eventually removes staging", async () => {
    const sessionId = await onlineClass("audio_only", subjectAudio, "tuesday");
    const rec = await completedRecording(sessionId, "audio/ogg", oggBytes());
    const unrelated = await completedRecording(sessionId, "audio/ogg", oggBytes());
    const flaky = failTargetDeletes(
      clients,
      { bucket: STAGING, key: rec.key },
      1,
    );
    const queue = `test-r99-cleanup-restart-${rec.id}`;
    let firstBoss: PgBoss | null = testBoss();
    let restartedBoss: PgBoss | null = null;

    try {
      await firstBoss.start();
      await firstBoss.createQueue(queue, {
        ...TD7_RETRY_POLICY,
        retryDelay: 2,
        deleteAfterSeconds: 60,
      });
      await firstBoss.work<{ recording_id: string }>(
        queue,
        { pollingIntervalSeconds: 0.5 },
        async ([job]) => {
          await ingestRecording(prisma, flaky.clients, job!.data.recording_id);
        },
      );
      const jobId = await firstBoss.send(queue, { recording_id: rec.id });
      expect(jobId).not.toBeNull();

      const retry = await waitForJobState(queue, jobId!, "retry");
      expect(JSON.stringify(retry.output)).toContain("staging cleanup failed");
      expect(flaky.attempts()).toBe(1);
      const committed = await prisma.sessionRecording.findUniqueOrThrow({
        where: { id: rec.id },
        select: { educationalContentId: true, ingestionFailureReason: true },
      });
      expect(committed.educationalContentId).not.toBeNull();
      expect(committed.ingestionFailureReason).toBeNull();

      // Stop every worker/process-local reference. The retry row is still in
      // Postgres, which is the obligation that the old implementation lost.
      await firstBoss.stop({ graceful: true });
      firstBoss = null;
      expect(await storedJob(queue, jobId!)).toMatchObject({
        state: "retry",
      });

      restartedBoss = testBoss();
      await restartedBoss.start();
      await restartedBoss.work<{ recording_id: string }>(
        queue,
        { pollingIntervalSeconds: 0.5 },
        async ([job]) => {
          await ingestRecording(prisma, clients, job!.data.recording_id);
        },
      );
      await waitForJobState(queue, jobId!, "completed");

      expect(await statObject(clients, STAGING, rec.key)).toBeNull();
      expect(await statObject(clients, STAGING, unrelated.key)).not.toBeNull();
      const content = await prisma.educationalContent.findUniqueOrThrow({
        where: { id: committed.educationalContentId! },
        select: { storageBucket: true, storageKey: true },
      });
      expect(await statObject(clients, content.storageBucket, content.storageKey)).toMatchObject({
        sizeBytes: 4096,
      });
    } finally {
      if (firstBoss) await firstBoss.stop({ graceful: true }).catch(() => undefined);
      if (restartedBoss) {
        await restartedBoss.stop({ graceful: true }).catch(() => undefined);
      }
      await dropTestQueue(queue);
    }
  });

  it("runs exactly five total attempts before a repeated cleanup failure becomes terminal", async () => {
    const sessionId = await onlineClass("audio_only", subjectAudio, "tuesday");
    const rec = await completedRecording(sessionId, "audio/ogg", oggBytes());
    const unrelated = await completedRecording(sessionId, "audio/ogg", oggBytes());
    const unavailable = failTargetDeletes(
      clients,
      { bucket: STAGING, key: rec.key },
      Number.MAX_SAFE_INTEGER,
    );
    const queue = `test-r99-cleanup-failure-${rec.id}`;
    let boss: PgBoss | null = testBoss();

    try {
      await boss.start();
      // Keep the production attempt budget. Only the delay/backoff is disabled
      // so the real pg-boss state machine proves the exact count promptly.
      await boss.createQueue(queue, {
        ...TD7_RETRY_POLICY,
        retryDelay: 0,
        retryBackoff: false,
        deleteAfterSeconds: 60,
      });
      await boss.work<{ recording_id: string }>(
        queue,
        { pollingIntervalSeconds: 0.5 },
        async ([job]) => {
          await ingestRecording(prisma, unavailable.clients, job!.data.recording_id);
        },
      );
      const jobId = await boss.send(queue, { recording_id: rec.id });
      expect(jobId).not.toBeNull();

      const failed = await waitForJobState(queue, jobId!, "failed");
      expect(failed.retry_count).toBe(4);
      expect(unavailable.attempts()).toBe(5);
      expect(JSON.stringify(failed.output)).toContain("staging cleanup failed");

      const row = await prisma.sessionRecording.findUniqueOrThrow({
        where: { id: rec.id },
        select: { educationalContentId: true, ingestionFailureReason: true },
      });
      expect(row.educationalContentId).not.toBeNull();
      expect(row.ingestionFailureReason).toBeNull();
      const content = await prisma.educationalContent.findUniqueOrThrow({
        where: { id: row.educationalContentId! },
        select: { storageBucket: true, storageKey: true },
      });
      expect(await statObject(clients, content.storageBucket, content.storageKey)).not.toBeNull();
      expect(await statObject(clients, STAGING, rec.key)).not.toBeNull();
      expect(await statObject(clients, STAGING, unrelated.key)).not.toBeNull();
    } finally {
      if (boss) await boss.stop({ graceful: true }).catch(() => undefined);
      boss = null;
      await dropTestQueue(queue);
    }
  });
});

/* ── The object is verified, never the metadata ──────────────────────────── */

describe("the ACTUAL staging bytes are verified (R99.8)", () => {
  const refuses = async (
    media: "audio_video" | "audio_only",
    subjectId: string,
    mime: string,
    bytes: Buffer,
  ): Promise<{ reason: string; sessionId: string; recordingId: string }> => {
    const sessionId = await onlineClass(media, subjectId, "tuesday");
    const rec = await completedRecording(sessionId, mime, bytes);
    const reason = await failure(() => ingestRecording(prisma, clients, rec.id));
    return { reason, sessionId, recordingId: rec.id };
  };

  const leavesNothingBehind = async (sessionId: string, recordingId: string) => {
    // R99.14 — never a broken content item, which is worse than an honest
    // failure because it is discoverable, downloadable and empty.
    expect(await prisma.sessionContent.count({ where: { sessionId } })).toBe(0);
    const row = await prisma.sessionRecording.findUniqueOrThrow({
      where: { id: recordingId },
      select: { educationalContentId: true, ingestionFailureReason: true },
    });
    expect(row.educationalContentId).toBeNull();
    expect(row.ingestionFailureReason).not.toBeNull();
  };

  it("refuses a renamed ZIP", async () => {
    const r = await refuses("audio_only", subjectAudio, "audio/ogg", zipBytes());
    expect(r.reason).toContain("MAGIC");
    await leavesNothingBehind(r.sessionId, r.recordingId);
  });

  it("refuses an EMPTY object — a passing lifecycle and a failed recording", async () => {
    const r = await refuses("audio_only", subjectAudio, "audio/ogg", Buffer.alloc(0));
    expect(r.reason).toContain("EMPTY");
    await leavesNothingBehind(r.sessionId, r.recordingId);
  });

  it("refuses an object over TD-9's 500 MB recording cap without reading it", async () => {
    // Asserted through the cap rather than by uploading half a gigabyte: the
    // property is that the size decides before any byte is copied.
    const { sizeCapFor, SIZE_CAPS } = await import("../lib/file-types.js");
    expect(sizeCapFor("video/mp4")).toBe(SIZE_CAPS.recording);
    expect(SIZE_CAPS.recording).toBe(500 * 1024 * 1024);
    expect(SIZE_CAPS.recording).toBeGreaterThan(SIZE_CAPS.audio);
  });

  it("refuses an object that is simply not there", async () => {
    const sessionId = await onlineClass("audio_only", subjectAudio, "tuesday");
    const rec = await completedRecording(sessionId, "audio/ogg", oggBytes());
    await deleteObject(clients, STAGING, rec.key);

    const reason = await failure(() => ingestRecording(prisma, clients, rec.id));
    expect(reason).toContain("MISSING");
    await leavesNothingBehind(sessionId, rec.id);
  });

  it("refuses an OGG delivered for a صوت وصورة class — R99.7 forbids the downgrade", async () => {
    // The family check, and the reason it is not merely a magic-byte check: the
    // bytes are a perfectly valid OGG. What is wrong is that the lesson had a
    // camera and the artefact does not.
    const r = await refuses("audio_video", subjectVideo, "audio/ogg", oggBytes());
    expect(r.reason).toContain("audio_video");
    await leavesNothingBehind(r.sessionId, r.recordingId);
  });

  it("refuses a صوت فقط class delivered as MP4, for the same reason in reverse", async () => {
    const r = await refuses("audio_only", subjectAudio, "video/mp4", mp4Bytes());
    expect(r.reason).toContain("audio_only");
    await leavesNothingBehind(r.sessionId, r.recordingId);
  });

  it("keeps the staging object after a refusal, so a corrected one can be retried", async () => {
    const r = await refuses("audio_only", subjectAudio, "audio/ogg", zipBytes());
    const rec = await prisma.sessionRecording.findUniqueOrThrow({
      where: { id: r.recordingId },
      select: { outputKey: true },
    });
    // Deleting it would make the failure unrecoverable — the opposite of
    // "recoverable failed ingestion".
    expect(await statObject(clients, STAGING, rec.outputKey!)).not.toBeNull();
  });
});

/* ── Failure, then retry ─────────────────────────────────────────────────── */

describe("a failed ingestion is RECOVERABLE (R99.14)", () => {
  it("succeeds on retry once the staging object is corrected, leaving ONE item", async () => {
    const sessionId = await onlineClass("audio_only", subjectAudio, "tuesday");
    const rec = await completedRecording(sessionId, "audio/ogg", zipBytes());

    expect(await failure(() => ingestRecording(prisma, clients, rec.id))).toContain(
      "MAGIC",
    );
    expect(await prisma.educationalContent.count({ where: { subjectId: subjectAudio } })).toBe(0);

    // Whatever went wrong is put right — here, the real file is written where
    // the broken one was.
    await putStaging(rec.key, oggBytes());
    const outcome = await ingestRecording(prisma, clients, rec.id);

    expect(outcome.contentId).not.toBeNull();
    expect(
      await prisma.educationalContent.count({ where: { subjectId: subjectAudio } }),
    ).toBe(1);
    expect(await prisma.sessionContent.count({ where: { sessionId } })).toBe(1);

    const row = await prisma.sessionRecording.findUniqueOrThrow({
      where: { id: rec.id },
      select: { ingestionFailureReason: true },
    });
    // Cleared, so a populated reason always describes the CURRENT state rather
    // than an attempt that later succeeded.
    expect(row.ingestionFailureReason).toBeNull();
  });
});

/* ── Exactly once ────────────────────────────────────────────────────────── */

describe("ingestion happens EXACTLY once (R99.15)", () => {
  it("a second run returns the existing result and creates nothing", async () => {
    const sessionId = await onlineClass("audio_only", subjectAudio, "tuesday");
    const rec = await completedRecording(sessionId, "audio/ogg", oggBytes());

    const first = await ingestRecording(prisma, clients, rec.id);
    const second = await ingestRecording(prisma, clients, rec.id);

    expect(second.contentId).toBe(first.contentId);
    expect(second.alreadyIngested).toBe(true);
    expect(
      await prisma.educationalContent.count({ where: { subjectId: subjectAudio } }),
    ).toBe(1);
    expect(await prisma.sessionContent.count({ where: { sessionId } })).toBe(1);
  });

  it("CONCURRENT runs still produce one content row and one link", async () => {
    const sessionId = await onlineClass("audio_only", subjectAudio, "tuesday");
    const rec = await completedRecording(sessionId, "audio/ogg", oggBytes());

    // The real shape of a duplicate webhook delivery: two workers, same instant.
    const results = await Promise.allSettled([
      ingestRecording(prisma, clients, rec.id),
      ingestRecording(prisma, clients, rec.id),
    ]);
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);

    expect(
      await prisma.educationalContent.count({ where: { subjectId: subjectAudio } }),
    ).toBe(1);
    expect(await prisma.sessionContent.count({ where: { sessionId } })).toBe(1);
  });

  it("no FALSE suffix increment — one recording is named once, without a « 2»", async () => {
    const sessionId = await onlineClass("audio_only", subjectAudio, "tuesday");
    const rec = await completedRecording(sessionId, "audio/ogg", oggBytes());

    await ingestRecording(prisma, clients, rec.id);
    await ingestRecording(prisma, clients, rec.id);
    await ingestRecording(prisma, clients, rec.id);

    const titles = await prisma.educationalContent.findMany({
      where: { subjectId: subjectAudio },
      select: { title: true },
    });
    expect(titles).toHaveLength(1);
    expect(titles[0]!.title).not.toMatch(/\s\d+$/);
  });

  it("a retry after the durable copy but before the row reuses the SAME key", async () => {
    // The partial-failure shape a random key segment would turn into two
    // objects: the copy succeeds, the process dies, the job is retried.
    const sessionId = await onlineClass("audio_only", subjectAudio, "tuesday");
    const rec = await completedRecording(sessionId, "audio/ogg", oggBytes());

    const first = await ingestRecording(prisma, clients, rec.id);
    const content = await prisma.educationalContent.findUniqueOrThrow({
      where: { id: first.contentId! },
      select: { storageKey: true, storageBucket: true },
    });

    // Simulate "the row never landed": drop the link and the content, keep the
    // object, and run again.
    await prisma.sessionRecording.update({
      where: { id: rec.id },
      data: { educationalContentId: null },
    });
    await prisma.sessionContent.deleteMany({ where: { sessionId } });
    await prisma.educationalContent.delete({ where: { id: first.contentId! } });
    await putStaging(rec.key, oggBytes());

    const second = await ingestRecording(prisma, clients, rec.id);
    const again = await prisma.educationalContent.findUniqueOrThrow({
      where: { id: second.contentId! },
      select: { storageKey: true },
    });
    // Same key, so the first attempt's object is the one that is used rather
    // than orphaned — and it was never overwritten (§20 rule 15).
    expect(again.storageKey).toBe(content.storageKey);
  });
});

/* ── A class built through the five filters ──────────────────────────────── */

describe("SRS Revision 166 §4 — a filter-built class's recording is imported like any other", () => {
  it("resolves its Level through the class's scope rows — it used to stop at «the occurrence resolves to no Level»", async () => {
    const sessionId = await onlineClass("audio_only", subjectAudio, "tuesday", "filters");
    const schedule = await prisma.recurringCourseSchedule.findFirstOrThrow({
      where: { sessions: { some: { id: sessionId } } },
      select: { teachingMode: true, levelId: true, administrativeGroupId: true, teachingGroupId: true },
    });
    // The shape that broke it: a real class with NONE of the three target columns.
    expect(schedule).toEqual({
      teachingMode: "multi_dimension",
      levelId: null,
      administrativeGroupId: null,
      teachingGroupId: null,
    });

    const rec = await completedRecording(sessionId, "audio/ogg", oggBytes());
    const done = await ingestRecording(prisma, clients, rec.id);

    expect(done.contentId).not.toBeNull();
    const content = await prisma.educationalContent.findUniqueOrThrow({
      where: { id: done.contentId! },
      select: { levelId: true, origin: true },
    });
    expect(content).toEqual({ levelId, origin: "session_recording" });
    // Linked to the occurrence, which is what lists it under «التسجيلات».
    expect(
      await prisma.sessionContent.count({ where: { sessionId, contentId: done.contentId! } }),
    ).toBe(1);
    const row = await prisma.sessionRecording.findUniqueOrThrow({
      where: { id: rec.id },
      select: { ingestionFailureReason: true },
    });
    expect(row.ingestionFailureReason).toBeNull();
  });
});

/* ── A recorder that dies mid-class ──────────────────────────────────────── */

describe("SRS Revision 168 §2 — a recorder that dies mid-class loses nothing recorded", () => {
  /** A recording that has NO final file — only what the recorder had already
   *  delivered: `n` ten-second safety segments under its own prefix. */
  async function diedMidClass(
    sessionId: string,
    status: "recording" | "failed",
    segments: number,
  ): Promise<{ id: string; egressId: string; key: string }> {
    const egressId = `EG_${Math.random().toString(36).slice(2)}`;
    const created = await prisma.sessionRecording.create({
      data: {
        sessionId,
        startedById: adminId,
        status,
        providerEgressId: egressId,
        outputBucket: STAGING,
        outputKey: "placeholder",
        mimeType: "audio/mp4",
        startedAt: new Date(Date.now() - 2 * 60 * 60_000),
      },
      select: { id: true },
    });
    const key = `session-recordings/${sessionId}/${created.id}.m4a`;
    await prisma.sessionRecording.update({ where: { id: created.id }, data: { outputKey: key } });
    for (let i = 0; i < segments; i += 1) {
      await putStaging(
        `${segmentsPrefixFor(key)}seg_${String(i).padStart(5, "0")}.ts`,
        Buffer.alloc(1024, 0x47 + i),
      );
    }
    await putStaging(`${segmentsPrefixFor(key)}playlist.m3u8`, Buffer.from("#EXTM3U\n"));
    return { id: created.id, egressId, key };
  }

  /**
   * Stands in for `ffmpeg` where there is none (a CI runner): it CONSUMES every
   * segment in the order given — which is what is under test here — and writes
   * a file the importer's own byte check accepts. The real remux is proven by
   * the `ffmpeg` test below and by the recorder-kill drill on a real stack.
   */
  const order: number[] = [];
  const fakeAssemble: Assembler = async (parts, outputPath) => {
    let total = 0;
    for await (const part of parts) {
      for await (const chunk of part) {
        order.push((chunk as Buffer)[0]!);
        total += (chunk as Buffer).length;
      }
    }
    await writeFile(outputPath, mp4Bytes(Math.max(total, 64)));
  };

  const provider = (answers: Record<string, RecordingReport | null>, throws = false): OnlineClassProvider => ({
    issueJoinCredentials: () => Promise.reject(new Error("not used")),
    startRecording: () => Promise.reject(new Error("not used")),
    stopRecording: () => Promise.resolve(),
    verifyCallback: () => Promise.resolve(null),
    reportRecording: (egressId: string) =>
      throws ? Promise.reject(new Error("provider down")) : Promise.resolve(answers[egressId] ?? null),
  });
  const row = (id: string) =>
    prisma.sessionRecording.findUniqueOrThrow({
      where: { id },
      select: { status: true, recoveredFromSegments: true, educationalContentId: true, stoppedAt: true },
    });
  /** Far enough on that freshly written segments count as quiet. */
  const LATER = (): Date => new Date(Date.now() + 40 * 60_000);

  it("the provider says the recorder gave up: what it had delivered is assembled IN ORDER, imported, and says so — and the segments are swept", async () => {
    order.length = 0;
    const sessionId = await onlineClass("audio_only", subjectAudio, "tuesday");
    const dead = await diedMidClass(sessionId, "recording", 3);

    const outcome = await reconcileRecordings(
      prisma,
      clients,
      provider({ [dead.egressId]: { providerEgressId: dead.egressId, state: "failed", failureReason: "egress crashed" } }),
      LATER(),
      fakeAssemble,
    );
    expect(outcome.recovered_from_segments).toBe(1);
    expect(order).toEqual([0x47, 0x48, 0x49]);
    const recovered = await row(dead.id);
    expect(recovered.status).toBe("completed");
    expect(recovered.recoveredFromSegments).toBe(true);
    expect(recovered.stoppedAt).not.toBeNull();
    // The file the recording always named now exists — and nothing else moved it.
    expect(await statObject(clients, STAGING, dead.key)).not.toBeNull();

    const imported = await ingestRecording(prisma, clients, dead.id);
    const content = await prisma.educationalContent.findUniqueOrThrow({
      where: { id: imported.contentId! },
      select: { description: true, origin: true, mimeType: true },
    });
    expect(content).toEqual({ description: RECOVERED_NOTE, origin: "session_recording", mimeType: "audio/mp4" });
    // Swept: the file, every segment and the playlist.
    expect(await statObject(clients, STAGING, dead.key)).toBeNull();
    expect((await listSegments(clients, STAGING, dead.key)).keys).toEqual([]);
    expect(await statObject(clients, STAGING, `${segmentsPrefixFor(dead.key)}playlist.m3u8`)).toBeNull();
  });

  it("a recording a CALLBACK already declared failed is recovered too — the one way out of a terminal failure is that the file now exists", async () => {
    const sessionId = await onlineClass("audio_only", subjectAudio, "tuesday");
    const failed = await diedMidClass(sessionId, "failed", 2);
    const outcome = await reconcileRecordings(prisma, clients, provider({}), LATER(), fakeAssemble);
    expect(outcome.recovered_from_segments).toBeGreaterThanOrEqual(1);
    expect((await row(failed.id)).status).toBe("completed");

    // …and ONLY that way: a failed recording with nothing delivered stays failed.
    const [, next] = await prisma.session.findMany({
      where: { schedule: { sessions: { some: { id: sessionId } } }, date: { gte: day(CLASS_DATE) } },
      orderBy: { date: "asc" },
      take: 2,
      select: { id: true },
    });
    const nothing = await diedMidClass(next!.id, "failed", 0);
    await reconcileRecordings(prisma, clients, provider({}), LATER(), fakeAssemble);
    expect((await row(nothing.id)).status).toBe("failed");
  });

  it("a recorder the provider still calls «active» is judged by its SILENCE: untouched while it may be writing, retired after ten silent minutes, assembled only on a LATER pass", async () => {
    const sessionId = await onlineClass("audio_only", subjectAudio, "tuesday");
    const live = await diedMidClass(sessionId, "recording", 2);
    const stopped: string[] = [];
    const saysRecording: OnlineClassProvider = {
      ...provider({ [live.egressId]: { providerEgressId: live.egressId, state: "recording" } }),
      stopRecording: (egressId: string) => {
        stopped.push(egressId);
        return Promise.resolve();
      },
    };
    const after = (minutes: number): Date => new Date(Date.now() + minutes * 60_000);

    // Five quiet minutes: a class in progress is left alone, whoever is asked.
    await reconcileRecordings(prisma, clients, saysRecording, after(5), fakeAssemble);
    await reconcileRecordings(prisma, clients, provider({}, true), after(5), fakeAssemble);
    expect((await row(live.id)).status).toBe("recording");
    expect(stopped).toEqual([]);

    // Twelve: measured on the real stack, a KILLED recorder is still «active» to
    // the provider. It is retired — asked to stop, so a recorder that was alive
    // after all delivers its own complete file — and NOT assembled yet.
    const retiring = await reconcileRecordings(prisma, clients, saysRecording, after(12), fakeAssemble);
    expect(retiring.retired).toBe(1);
    expect(retiring.recovered_from_segments).toBe(0);
    expect(stopped).toEqual([live.egressId]);
    expect((await row(live.id)).status).toBe("processing");
    expect(await statObject(clients, STAGING, live.key)).toBeNull();

    // The next pass: still no file, still silent — what it delivered is assembled.
    const assembling = await reconcileRecordings(prisma, clients, saysRecording, after(30), fakeAssemble);
    expect(assembling.recovered_from_segments).toBe(1);
    expect((await row(live.id)).status).toBe("completed");
  });

  it("a recording that has delivered NO segment is never judged by silence — it may predate them, and be recording perfectly well", async () => {
    const sessionId = await onlineClass("audio_only", subjectAudio, "tuesday");
    const old = await diedMidClass(sessionId, "recording", 0);
    const outcome = await reconcileRecordings(
      prisma,
      clients,
      provider({ [old.egressId]: { providerEgressId: old.egressId, state: "recording" } }),
      LATER(),
      fakeAssemble,
    );
    expect(outcome.retired).toBe(0);
    expect((await row(old.id)).status).toBe("recording");
  });

  it("an assembly that fails is said, keeps every segment, and is tried again", async () => {
    const sessionId = await onlineClass("audio_only", subjectAudio, "tuesday");
    const dead = await diedMidClass(sessionId, "failed", 2);
    const broken: Assembler = () => Promise.reject(new Error("ffmpeg exited 1"));
    const outcome = await reconcileRecordings(prisma, clients, provider({}), LATER(), broken);
    expect(outcome.recovery_failed).toBeGreaterThanOrEqual(1);
    const after = await prisma.sessionRecording.findUniqueOrThrow({
      where: { id: dead.id },
      select: { status: true, ingestionFailureReason: true },
    });
    expect(after.status).toBe("failed");
    expect(after.ingestionFailureReason).toContain("recovery from segments failed");
    expect((await listSegments(clients, STAGING, dead.key)).keys).toHaveLength(2);

    await reconcileRecordings(prisma, clients, provider({}), LATER(), fakeAssemble);
    expect((await row(dead.id)).status).toBe("completed");
  });

  it.skipIf(!existsSync(FFMPEG_PATH))(
    "the real `ffmpeg` remuxes real MPEG-TS segments into an MP4 the importer accepts",
    async () => {
      // Segments made by ffmpeg itself, exactly as HLS cuts them.
      const dir = await mkdtemp(join(tmpdir(), "bodour-seg-test-"));
      try {
        execFileSync(FFMPEG_PATH, [
          "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=6",
          "-c:a", "aac", "-f", "hls", "-hls_time", "2", "-hls_segment_filename", join(dir, "seg_%05d.ts"),
          join(dir, "playlist.m3u8"),
        ]);
        const sessionId = await onlineClass("audio_only", subjectAudio, "tuesday");
        const dead = await diedMidClass(sessionId, "failed", 0);
        const made = readdirSync(dir).filter((name) => name.endsWith(".ts")).sort();
        expect(made.length).toBeGreaterThanOrEqual(2);
        for (const name of made) {
          await putStaging(`${segmentsPrefixFor(dead.key)}${name}`, readFileSync(join(dir, name)));
        }

        const outcome = await reconcileRecordings(prisma, clients, provider({}), LATER());
        expect(outcome.recovered_from_segments).toBeGreaterThanOrEqual(1);
        const imported = await ingestRecording(prisma, clients, dead.id);
        expect(imported.contentId).not.toBeNull();
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
});

describe("SRS Revision 168 §2 — a recording is as long as the class was", () => {
  it("the UPLOAD caps do not govern the platform's own capture: a two-hour audio class is over TD-9's 100 MB and must import", () => {
    // At the measured ≈59 MB per audio hour and ≈0.63 GB per video hour.
    expect(platformRecordingCap()).toBeGreaterThan(2 * 59 * 1024 * 1024);
    expect(platformRecordingCap()).toBeGreaterThan(5 * 0.63 * 1024 * 1024 * 1024);
    expect(SIZE_CAPS.audio).toBeLessThan(2 * 59 * 1024 * 1024);
  });
});

/* ── A class for every Level of a Category ───────────────────────────────── */

describe("SRS Revision 167 §5 — a class given to EVERY Level of one Category records for all of them", () => {
  it("is filed under the first Level and addressed to the whole Category; some Levels only, and it stays with its first Level", async () => {
    const { categoryId } = await prisma.level.findUniqueOrThrow({
      where: { id: levelId },
      select: { categoryId: true },
    });
    const sibling = async (name: string): Promise<string> => {
      const id = (
        await createLevel(prisma, superAdmin(), { name: `${TAG} ${name}`, categoryId, genderRestriction: "any" })
      ).level.id;
      await prisma.levelSubject.create({ data: { levelId: id, subjectId: subjectAudio } });
      return id;
    };
    const second = await sibling("مستوى ثانٍ");

    const everyLevel = await onlineClass("audio_only", subjectAudio, "tuesday", "filters", [levelId, second]);
    const whole = await completedRecording(everyLevel, "audio/ogg", oggBytes());
    const wholeDone = await ingestRecording(prisma, clients, whole.id);
    const filed = await prisma.educationalContent.findUniqueOrThrow({
      where: { id: wholeDone.contentId! },
      select: { wholeCategory: true, levelId: true, additionalLevels: { select: { levelId: true } } },
    });
    expect(filed.wholeCategory).toBe(true);
    expect([levelId, second]).toContain(filed.levelId);
    // «كل مستويات الفئة» already reaches every Level — naming them again would be
    // a second copy of one fact (R169 §10).
    expect(filed.additionalLevels).toEqual([]);

    // A third Level appears: the SAME two-Level class is no longer «every Level».
    await sibling("مستوى ثالث");
    const [, nextOccurrence] = await prisma.session.findMany({
      where: { schedule: { sessions: { some: { id: everyLevel } } }, date: { gte: day(CLASS_DATE) } },
      orderBy: { date: "asc" },
      take: 2,
      select: { id: true },
    });
    const some = await completedRecording(nextOccurrence!.id, "audio/ogg", oggBytes());
    const someDone = await ingestRecording(prisma, clients, some.id);
    const partial = await prisma.educationalContent.findUniqueOrThrow({
      where: { id: someDone.contentId! },
      select: { wholeCategory: true, levelId: true, additionalLevels: { select: { levelId: true } } },
    });
    expect(partial.wholeCategory).toBe(false);
    // R169 §10 — a class over SOME Levels: filed under one, and the OTHER named
    // as an additional Level, so a private recording reaches both. It used to be
    // listed for the first Level's beneficiaries only.
    expect([levelId, second]).toContain(partial.levelId);
    expect(partial.additionalLevels.map((row) => row.levelId)).toEqual(
      [levelId, second].filter((id) => id !== partial.levelId),
    );
  });
});

/* ── A stranded import is put back ───────────────────────────────────────── */

describe("SRS Revision 166 §4 — `ops:requeue-recordings` puts a stranded import back", () => {
  it("lists without writing on a dry run, queues exactly the stranded ones, and is harmless to run twice", async () => {
    const sessionId = await onlineClass("audio_only", subjectAudio, "tuesday");
    // Stranded: made, never imported, refused for a reason since fixed.
    const stranded = await completedRecording(sessionId, "audio/ogg", oggBytes());
    await prisma.sessionRecording.update({
      where: { id: stranded.id },
      data: { ingestionFailureReason: "the occurrence resolves to no Level" },
    });
    const pending = async (): Promise<number> =>
      Number(
        (
          await prisma.$queryRaw<{ n: bigint }[]>`
            select count(*) as n from pgboss.job
             where name = 'session-recording-ingest'
               and data->>'recording_id' = ${stranded.id}
               and state in ('created', 'retry')`
        )[0]!.n,
      );
    const before = await pending();

    const dry = await requeueStrandedRecordings(prisma, { dryRun: true });
    expect(dry.recording_ids).toContain(stranded.id);
    expect(dry.queued).toBe(0);
    expect(dry.reasons).toContain("the occurrence resolves to no Level");
    expect(await pending()).toBe(before);

    const first = await requeueStrandedRecordings(prisma, { dryRun: false });
    expect(first.recording_ids).toContain(stranded.id);
    expect(await pending()).toBe(before + 1);

    // Twice is once: the singleton key is the recording's own id.
    await requeueStrandedRecordings(prisma, { dryRun: false });
    expect(await pending()).toBe(before + 1);

    // …and once it HAS content it is no longer stranded, so it is left alone.
    await ingestRecording(prisma, clients, stranded.id);
    const after = await requeueStrandedRecordings(prisma, { dryRun: true });
    expect(after.recording_ids).not.toContain(stranded.id);
  });
});

/* ── Nothing is left to a delivery that may not happen ───────────────────── */

describe("SRS Revision 167 §5 — the reconciler: a recording is never left behind", () => {
  /** A recording the platform started and has heard nothing more about. */
  async function openRecording(
    sessionId: string,
    status: "recording" | "stopping" | "processing",
    startedAt: Date,
    staged: Buffer | null,
  ): Promise<{ id: string; egressId: string; key: string }> {
    const egressId = `EG_${Math.random().toString(36).slice(2)}`;
    const created = await prisma.sessionRecording.create({
      data: {
        sessionId,
        startedById: adminId,
        status,
        providerEgressId: egressId,
        outputBucket: STAGING,
        outputKey: "placeholder",
        mimeType: "audio/ogg",
        startedAt,
      },
      select: { id: true },
    });
    const key = `session-recordings/${sessionId}/${created.id}.bin`;
    await prisma.sessionRecording.update({ where: { id: created.id }, data: { outputKey: key } });
    if (staged) await putStaging(key, staged);
    return { id: created.id, egressId, key };
  }

  /** `n` occurrences of ONE class — one live recording is allowed per
   *  occurrence, and two classes at one hour would be a room/teacher conflict. */
  async function occurrences(n: number): Promise<string[]> {
    const first = await onlineClass("audio_only", subjectAudio, "tuesday");
    const { scheduleId } = await prisma.session.findUniqueOrThrow({
      where: { id: first },
      select: { scheduleId: true },
    });
    const rows = await prisma.session.findMany({
      where: { scheduleId, date: { gte: day(CLASS_DATE) } },
      orderBy: { date: "asc" },
      take: n,
      select: { id: true },
    });
    expect(rows).toHaveLength(n);
    return rows.map((row) => row.id);
  }

  /** Answers only what it was told to; `throws` is a provider that is down. */
  function providerSaying(
    answers: Record<string, RecordingReport | null>,
    throws = false,
  ): OnlineClassProvider {
    return {
      issueJoinCredentials: () => Promise.reject(new Error("not used")),
      startRecording: () => Promise.reject(new Error("not used")),
      stopRecording: () => Promise.resolve(),
      verifyCallback: () => Promise.resolve(null),
      reportRecording: (egressId: string) =>
        throws ? Promise.reject(new Error("provider down")) : Promise.resolve(answers[egressId] ?? null),
    };
  }

  const statusOf = async (id: string): Promise<string> =>
    (await prisma.sessionRecording.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;
  const pendingImport = async (id: string): Promise<number> =>
    Number(
      (
        await prisma.$queryRaw<{ n: bigint }[]>`
          select count(*) as n from pgboss.job
           where name = 'session-recording-ingest'
             and data->>'recording_id' = ${id}
             and state in ('created', 'retry')`
      )[0]!.n,
    );

  const LONG_AGO = new Date(Date.now() - 2 * 60 * 60_000);

  it("a completion whose callback never arrived is ASKED for — and its import is queued exactly as a callback would", async () => {
    const sessionId = await onlineClass("audio_only", subjectAudio, "tuesday");
    const missed = await openRecording(sessionId, "processing", LONG_AGO, oggBytes());

    const outcome = await reconcileRecordings(
      prisma,
      clients,
      providerSaying({
        [missed.egressId]: { providerEgressId: missed.egressId, state: "completed", outputKey: missed.key },
      }),
    );
    expect(outcome.advanced).toBeGreaterThanOrEqual(1);
    expect(await statusOf(missed.id)).toBe("completed");
    expect(await pendingImport(missed.id)).toBe(1);

    // …and the import it queued is an ordinary one.
    await ingestRecording(prisma, clients, missed.id);
    const row = await prisma.sessionRecording.findUniqueOrThrow({
      where: { id: missed.id },
      select: { educationalContentId: true },
    });
    expect(row.educationalContentId).not.toBeNull();
  });

  it("where the provider has no answer, the staged FILE is the fact — forgotten by the provider, or the provider down", async () => {
    const [forgottenSession, downSession, noneSession] = (await occurrences(3)) as [string, string, string];
    const forgotten = await openRecording(forgottenSession, "stopping", LONG_AGO, oggBytes());
    const forgottenOutcome = await reconcileRecordings(prisma, clients, providerSaying({}));
    expect(forgottenOutcome.recovered_from_staging).toBeGreaterThanOrEqual(1);
    expect(await statusOf(forgotten.id)).toBe("completed");
    expect(await pendingImport(forgotten.id)).toBe(1);

    const down = await openRecording(downSession, "processing", LONG_AGO, oggBytes());
    const downOutcome = await reconcileRecordings(prisma, clients, providerSaying({}, true));
    expect(downOutcome.provider_unreachable).toBeGreaterThanOrEqual(1);
    expect(await statusOf(down.id)).toBe("completed");

    // No provider configured at all (TD-13) is the same: the file is believed.
    const none = await openRecording(noneSession, "processing", LONG_AGO, oggBytes());
    await reconcileRecordings(prisma, clients, null);
    expect(await statusOf(none.id)).toBe("completed");
  });

  it("concludes NOTHING from silence: young, still running, or unreachable-with-no-file are all left exactly as they are", async () => {
    const [youngSession, runningSession, unreachableSession] = (await occurrences(3)) as [string, string, string];
    const young = await openRecording(youngSession, "processing", new Date(), null);
    const running = await openRecording(runningSession, "recording", LONG_AGO, null);

    await reconcileRecordings(
      prisma,
      clients,
      providerSaying({
        [running.egressId]: { providerEgressId: running.egressId, state: "recording" },
      }),
    );
    expect(await statusOf(young.id)).toBe("processing");
    expect(await statusOf(running.id)).toBe("recording");

    // Three days old, no file — but the provider could not be ASKED, so it is
    // not declared dead.
    const ancient = new Date(Date.now() - 3 * 24 * 60 * 60_000);
    const unreachable = await openRecording(unreachableSession, "recording", ancient, null);
    await reconcileRecordings(prisma, clients, providerSaying({}, true));
    expect(await statusOf(unreachable.id)).toBe("recording");
  });

  it("a recording the provider positively no longer knows, a day on, with nothing staged, is recorded as failed — so the class can be recorded again", async () => {
    const sessionId = await onlineClass("audio_only", subjectAudio, "tuesday");
    const dead = await openRecording(
      sessionId,
      "recording",
      new Date(Date.now() - RECONCILE_DEAD_AFTER_MS - 60_000),
      null,
    );
    const outcome = await reconcileRecordings(prisma, clients, providerSaying({}));
    expect(outcome.marked_failed).toBeGreaterThanOrEqual(1);
    expect(await statusOf(dead.id)).toBe("failed");
    expect(await pendingImport(dead.id)).toBe(0);
  });

  it("re-queues every import that has not succeeded, every time it runs — a deployed fix heals without an operator", async () => {
    const sessionId = await onlineClass("audio_only", subjectAudio, "tuesday");
    const stranded = await completedRecording(sessionId, "audio/ogg", oggBytes());
    await prisma.sessionRecording.update({
      where: { id: stranded.id },
      data: { ingestionFailureReason: "a defect since fixed" },
    });
    const before = await pendingImport(stranded.id);
    const outcome = await reconcileRecordings(prisma, clients, null);
    expect(outcome.stranded).toBeGreaterThanOrEqual(1);
    expect(await pendingImport(stranded.id)).toBe(before + 1);
    // The staged file is still there for it: nothing collects it.
    expect(await statObject(clients, STAGING, stranded.key)).not.toBeNull();
  });

  it("`ops:active-recordings` names what a deployment must wait for", async () => {
    const sessionId = await onlineClass("audio_only", subjectAudio, "tuesday");
    const live = await openRecording(sessionId, "recording", new Date(), null);
    expect((await activeRecordings(prisma)).map((r) => r.id)).toContain(live.id);
    await prisma.sessionRecording.update({ where: { id: live.id }, data: { status: "aborted" } });
    expect((await activeRecordings(prisma)).map((r) => r.id)).not.toContain(live.id);
  });
});

/* ── Mixed-origin naming ─────────────────────────────────────────────────── */

describe("one Session, one naming namespace (R75.6) — and what the platform's own capture is called (R165 §1)", () => {
  it("names its capture for what it is — Subject and the minute it was stopped — and numbers a same-minute second one « 2»", async () => {
    const sessionId = await onlineClass("audio_only", subjectAudio, "tuesday");

    // A مؤطِّرة's browser recording, saved and linked exactly as R75 does it.
    const browser = await prisma.educationalContent.create({
      data: {
        title: `${TAG} سيرة — ${CLASS_DATE}`,
        levelId,
        subjectId: subjectAudio,
        academicYearId,
        branchId: branchA,
        storageBucket: "private",
        storageKey: `content/browser-${Math.random()}/x/a.webm`,
        originalFilename: "a.webm",
        mimeType: "audio/webm",
        sizeBytes: BigInt(10),
        origin: "session_recording",
      },
      select: { id: true, title: true },
    });
    await prisma.sessionContent.create({
      data: { sessionId, contentId: browser.id },
    });

    // Both stopped at ONE stated instant, so the same-minute collision this
    // namespace exists for is what is tested rather than left to the clock.
    const stoppedAt = new Date(2026, 5, 2, 18, 5, 0);
    const one = await completedRecording(sessionId, "audio/ogg", oggBytes());
    await prisma.sessionRecording.update({ where: { id: one.id }, data: { stoppedAt } });
    await ingestRecording(prisma, clients, one.id);
    // The first live recording per occurrence is unique only among LIVE states,
    // so a second completed one is an ordinary second attempt.
    const two = await completedRecording(sessionId, "audio/ogg", oggBytes());
    await prisma.sessionRecording.update({ where: { id: two.id }, data: { stoppedAt } });
    await ingestRecording(prisma, clients, two.id);

    const titles = (
      await prisma.educationalContent.findMany({
        where: { subjectId: subjectAudio },
        select: { title: true },
        orderBy: { title: "asc" },
      })
    ).map((c) => c.title);

    // This class has no catalogue type, no Surah and no staff, so the title is
    // exactly the parts it DOES have: Subject — date and time (R165 §1 omits an
    // absent part rather than leaving an empty separator).
    const subject = await prisma.subject.findUniqueOrThrow({
      where: { id: subjectAudio },
      select: { name: true },
    });
    const captured = `${subject.name} — 2026-06-02 18:05`;
    expect(new Set(titles).size).toBe(3);
    expect(titles).toContain(browser.title);
    expect(titles).toContain(captured);
    expect(titles).toContain(`${captured} 2`);
  });

  it("the storage key stays person-free and identical on a retry, whatever the title says", async () => {
    const sessionId = await onlineClass("audio_only", subjectAudio, "tuesday");
    const rec = await completedRecording(sessionId, "audio/ogg", oggBytes());
    const done = await ingestRecording(prisma, clients, rec.id);
    const content = await prisma.educationalContent.findUniqueOrThrow({
      where: { id: done.contentId! },
      select: { storageKey: true, originalFilename: true, title: true },
    });
    // A key carries a slug of its file name (TD-9): Subject and date only —
    // never the time of day the title carries, and never a person's name.
    expect(content.originalFilename).toMatch(/— \d{4}-\d{2}-\d{2}\.ogg$/);
    expect(content.title).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(content.originalFilename).not.toContain(":");
  });
});

/* ── The webhook handoff ─────────────────────────────────────────────────── */

describe("the callback persists and enqueues, and does not import (R99.13)", () => {
  it("a completion enqueues exactly one job; a duplicate adds none", async () => {
    const sessionId = await onlineClass("audio_only", subjectAudio, "tuesday");
    const rec = await completedRecording(sessionId, "audio/ogg", oggBytes());
    // Put the row back where a live recording actually is when the callback
    // arrives, so the transition is the real one.
    await prisma.sessionRecording.update({
      where: { id: rec.id },
      data: { status: "recording" },
    });
    const egressId = (
      await prisma.sessionRecording.findUniqueOrThrow({
        where: { id: rec.id },
        select: { providerEgressId: true },
      })
    ).providerEgressId!;

    const pending = async (): Promise<number> => {
      const rows = await prisma.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(*)::bigint AS n FROM pgboss.job
        WHERE name = 'session-recording-ingest'
          AND data->>'recording_id' = ${rec.id}`;
      return Number(rows[0]?.n ?? 0);
    };

    const first = await applyProviderReport(prisma, {
      providerEgressId: egressId,
      state: "completed",
      sizeBytes: 4096,
    });
    expect(first).toMatchObject({ applied: true, enqueued: true });
    expect(await pending()).toBe(1);

    // R99.15 — delivered twice. The transition table refuses a move out of a
    // terminal state, so the second delivery enqueues nothing.
    const second = await applyProviderReport(prisma, {
      providerEgressId: egressId,
      state: "completed",
      sizeBytes: 4096,
    });
    expect(second.enqueued).toBe(false);
    expect(await pending()).toBe(1);

    await prisma.$executeRaw`DELETE FROM pgboss.job WHERE data->>'recording_id' = ${rec.id}`;
  });

  it("a FAILED report enqueues nothing — there is no object to import", async () => {
    const sessionId = await onlineClass("audio_only", subjectAudio, "tuesday");
    const rec = await completedRecording(sessionId, "audio/ogg", oggBytes());
    await prisma.sessionRecording.update({
      where: { id: rec.id },
      data: { status: "recording" },
    });
    const egressId = (
      await prisma.sessionRecording.findUniqueOrThrow({
        where: { id: rec.id },
        select: { providerEgressId: true },
      })
    ).providerEgressId!;

    const result = await applyProviderReport(prisma, {
      providerEgressId: egressId,
      state: "failed",
      failureReason: "egress died",
    });
    expect(result).toMatchObject({ applied: true, enqueued: false });
  });
});
