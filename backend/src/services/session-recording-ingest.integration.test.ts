import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { PgBoss } from "pg-boss";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { TD7_RETRY_POLICY } from "../jobs/runner.js";
import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import {
  createStorageClients,
  deleteObject,
  statObject,
  type StorageClients,
} from "../lib/storage.js";
import type { Actor } from "../policies/actor.js";
import type { RoleScope } from "../policies/branch-scope.js";
import { createCourseSchedule } from "./course-schedule.service.js";
import { createLevel } from "./level.service.js";
import {
  ingestRecording,
  RecordingStagingCleanupFailure,
} from "./session-recording-ingest.service.js";
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
): Promise<string> {
  const { id } = await createCourseSchedule(
    prisma,
    superAdmin(),
    {
      title: `${TAG} ${media}`,
      subjectId,
      teachingMode: "entire_level",
      targetId: levelId,
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
  subjectVideo = (await prisma.subject.create({ data: { name: `${TAG} تفسير` } })).id;
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

/* ── Mixed-origin naming ─────────────────────────────────────────────────── */

describe("one Session, one naming namespace (R75.6)", () => {
  it("browser + provider recordings number base / « 2» / « 3» without duplicates", async () => {
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

    const one = await completedRecording(sessionId, "audio/ogg", oggBytes());
    await ingestRecording(prisma, clients, one.id);
    // The first live recording per occurrence is unique only among LIVE states,
    // so a second completed one is an ordinary second attempt.
    const two = await completedRecording(sessionId, "audio/ogg", oggBytes());
    await ingestRecording(prisma, clients, two.id);

    const titles = (
      await prisma.educationalContent.findMany({
        where: { subjectId: subjectAudio },
        select: { title: true },
        orderBy: { title: "asc" },
      })
    ).map((c) => c.title);

    expect(new Set(titles).size).toBe(3);
    expect(titles).toContain(browser.title);
    expect(titles).toContain(`${browser.title} 2`);
    expect(titles).toContain(`${browser.title} 3`);
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
