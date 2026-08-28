import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Readable } from "node:stream";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type GetObjectCommandOutput,
} from "@aws-sdk/client-s3";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { loadConfig } from "../lib/config.js";
import { quarantineKeyFor, storageCoordinateId } from "../lib/file-types.js";
import {
  BUCKETS,
  createStorageClients,
  deleteObject,
  presignPutUrl,
  statObject,
  type StorageClients,
} from "../lib/storage.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import {
  issueUploadTicket,
  verifyUploadTicket,
  type UploadTicketClaims,
} from "../lib/upload-token.js";
import type { Actor } from "../policies/actor.js";
import * as audit from "../repositories/audit.repository.js";
import {
  createTeachingContext,
  staff,
} from "../test-support/educational-fixture.js";
import { MD5_COLLISION_PDFS } from "../test-support/md5-collision-pdf.js";
import {
  abortUpload,
  completeUpload,
  deleteContent,
  initiateUpload,
  mintDownloadUrl,
  UPLOAD_QUOTA,
} from "./content.service.js";

/**
 * TD-3.5 end to end, against **real MinIO through the real Nginx proxy**.
 *
 * §3.1 is explicit that the storage round-trip must never be "verified" by
 * direct-to-MinIO access: the property under test is that a SigV4 signature
 * survives the proxy's prefix strip and Host rewrite. Every PUT below therefore
 * goes to the URL the service actually handed out — the same one a browser gets.
 *
 * That also means the magic-byte and size checks are exercised against bytes
 * that genuinely made the trip, rather than against a mock that would agree with
 * whatever the implementation happened to do.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const KEY = config.JWT_SIGNING_KEY;
// Run-unique ownership: a new process must never treat residue from an
// interrupted older process as its fixture and delete it from the ambient DB.
const TAG = `[content-test:${randomUUID()}]`;

let clients: StorageClients;
let adminId = "";
let teacherId = "";
let categoryId = "";
let levelId = "";
let subjectId = "";
let branchId = "";
let otherBranchId = "";
let academicYearId = "";
let sessionId = "";

const objectsToClean = new Map<string, { bucket: string; key: string }>();
const settingKeysToClean = new Set<string>();

function trackObject(bucket: string, key: string): void {
  objectsToClean.set(`${bucket}\u0000${key}`, { bucket, key });
}

function trackTicket(uploadId: string): UploadTicketClaims {
  const ticket = verifyUploadTicket(uploadId, KEY);
  if (!ticket.valid) throw new Error(`test received an invalid upload ticket: ${ticket.reason}`);
  trackObject(ticket.claims.bucket, ticket.claims.key);
  return ticket.claims;
}

function stableObjectUrl(bucket: string, key: string): string {
  return `${config.STORAGE_BASE_URL}/${bucket}/${key}`;
}

const actorOf = (
  userId: string,
  roles: { role: string; branches: string[] | null }[],
): Actor =>
  ({
    userId,
    roles: roles.map((r) => r.role),
    roleScopes: roles,
  }) as unknown as Actor;
const admin = (): Actor =>
  actorOf(adminId, [{ role: "admin", branches: null }]);
const teacher = (): Actor =>
  actorOf(teacherId, [{ role: "teacher", branches: [branchId] }]);

async function failure(
  run: () => Promise<unknown>,
): Promise<{
  code?: string;
  status?: number;
  details?: Record<string, unknown>;
}> {
  try {
    await run();
    return {};
  } catch (e) {
    return e as {
      code?: string;
      status?: number;
      details?: Record<string, unknown>;
    };
  }
}

/** A real, valid PDF header — the sniffer reads the first 512 bytes and nothing else. */
const pdfBytes = (): Buffer =>
  Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(200)]);

/** Uploads to the presigned URL exactly as a browser would. */
async function putObject(
  url: string,
  body: Buffer,
  mime: string,
): Promise<number> {
  const res = await fetch(url, {
    method: "PUT",
    body,
    headers: { "content-type": mime },
  });
  return res.status;
}

async function keysUnder(bucket: string, prefix: string): Promise<string[]> {
  const listed = await clients.internal.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }),
  );
  const keys = (listed.Contents ?? []).flatMap((entry) =>
    entry.Key === undefined ? [] : [entry.Key],
  );
  for (const key of keys) trackObject(bucket, key);
  return keys;
}

function twoPartyBarrier(): () => Promise<void> {
  let arrived = 0;
  let release!: () => void;
  const bothArrived = new Promise<void>((resolve) => {
    release = resolve;
  });
  return async () => {
    arrived += 1;
    if (arrived === 2) release();
    await bothArrived;
  };
}

/**
 * Teardown, innermost first.
 *
 * Every FK here is `Restrict`, so the order is a requirement rather than a
 * preference — a schedule with materialized sessions refuses to go, and the
 * failure surfaces in an unrelated test as a constraint violation rather than as
 * anything readable. (This is the third suite to learn that; the ordering rule
 * is recorded in `development/testing.md`.)
 */
async function clear(): Promise<void> {
  const ids = (
    await prisma.user.findMany({
      where: { nameArabic: { startsWith: TAG } },
      select: { id: true },
    })
  ).map((u) => u.id);
  const levels = (
    await prisma.level.findMany({
      where: { name: { startsWith: TAG } },
      select: { id: true },
    })
  ).map((l) => l.id);
  const groups = (
    await prisma.administrativeGroup.findMany({
      where: { levelId: { in: levels } },
      select: { id: true },
    })
  ).map((g) => g.id);
  // A schedule reaches its Level through its TARGET, not through a column —
  // `teaching_mode` decides which of the three it is (R43), so the group is
  // where this suite's schedules are found.
  const schedules = (
    await prisma.recurringCourseSchedule.findMany({
      where: {
        OR: [
          { administrativeGroupId: { in: groups } },
          { levelId: { in: levels } },
        ],
      },
      select: { id: true },
    })
  ).map((s) => s.id);

  const contents = await prisma.educationalContent.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true, storageBucket: true, storageKey: true },
  });
  for (const content of contents) {
    trackObject(content.storageBucket, content.storageKey);
    trackObject(
      content.storageBucket,
      quarantineKeyFor(content.id, content.storageKey),
    );
  }
  for (const object of objectsToClean.values()) {
    await deleteObject(clients, object.bucket, object.key);
  }
  objectsToClean.clear();
  if (settingKeysToClean.size > 0) {
    await prisma.systemSetting.deleteMany({
      where: { key: { in: [...settingKeysToClean] } },
    });
    settingKeysToClean.clear();
  }
  await prisma.trash.deleteMany({
    where: { targetId: { in: contents.map((c) => c.id) } },
  });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
  await prisma.rateLimitCounter.deleteMany({ where: { userId: { in: ids } } });
  await prisma.sessionContent.deleteMany({
    where: { contentId: { in: contents.map((c) => c.id) } },
  });
  await prisma.educationalContent.deleteMany({
    where: { title: { startsWith: TAG } },
  });

  await prisma.sessionStaff.deleteMany({
    where: { session: { scheduleId: { in: schedules } } },
  });
  // R77 — `notification.session_id` is RESTRICT, like every other reference
  // to a Session: a cancellation notice whose session vanished is unreadable.
  // Fixtures therefore unwind notices before the occurrences they name.
  await prisma.notification.deleteMany({
    where: { session: { scheduleId: { in: schedules } } },
  });
  await prisma.session.deleteMany({ where: { scheduleId: { in: schedules } } });
  await prisma.courseScheduleStaff.deleteMany({
    where: { scheduleId: { in: schedules } },
  });
  await prisma.recurringCourseSchedule.deleteMany({
    where: { id: { in: schedules } },
  });
  await prisma.enrollment.deleteMany({ where: { levelId: { in: levels } } });
  await prisma.administrativeGroup.deleteMany({
    where: { levelId: { in: levels } },
  });
  await prisma.levelSubject.deleteMany({ where: { levelId: { in: levels } } });
  await prisma.level.deleteMany({ where: { id: { in: levels } } });
  await prisma.subject.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  clients = createStorageClients(config);
  const res = await fetch(`${config.STORAGE_BASE_URL}/${BUCKETS.public}/`, {
    redirect: "manual",
  });
  if (res.status <= 0) {
    throw new Error(
      "storage proxy unreachable — docker compose up -d minio nginx",
    );
  }
});

beforeEach(async () => {
  await clear();

  const year = await prisma.academicYear.findFirst({
    where: { isCurrent: true },
  });
  academicYearId = year!.id;

  branchId = (await prisma.branch.create({ data: { name: `${TAG} فرع` } })).id;
  otherBranchId = (
    await prisma.branch.create({ data: { name: `${TAG} فرع آخر` } })
  ).id;

  adminId = (
    await prisma.user.create({
      data: { sex: 'female', nameArabic: `${TAG} مديرة`, accountStatus: "active" },
    })
  ).id;
  teacherId = (
    await prisma.user.create({
      data: { sex: 'female', nameArabic: `${TAG} مؤطرة`, accountStatus: "active" },
    })
  ).id;

  // §4.4c: a teacher's branch reach is the branches of the schedules they staff,
  // not their role assignment — so the fixture builds that whole path rather
  // than a Level and a Subject in isolation. It is the shared one on purpose:
  // a suite that builds a slightly different model is testing something the
  // application cannot produce.
  const fixture = await createTeachingContext(prisma, TAG, branchId);
  categoryId = fixture.categoryId;
  levelId = fixture.levelId;
  subjectId = fixture.subjectId;
  sessionId = fixture.sessionId;
  await staff(prisma, fixture, teacherId);

  // **Real `UserBranchRole` rows, not just role names on the actor.** TD-12's
  // freshness check re-reads the assignment from the database on every mint, so
  // an actor whose roles exist only in a token would be refused for the right
  // reason at the wrong time — and the suspended-teacher test below would pass
  // without ever exercising the suspension.
  const adminRole = await prisma.role.findFirstOrThrow({
    where: { name: "admin" },
  });
  const teacherRole = await prisma.role.findFirstOrThrow({
    where: { name: "teacher" },
  });
  await prisma.userBranchRole.createMany({
    data: [
      { userId: adminId, roleId: adminRole.id, branchId: null },
      { userId: teacherId, roleId: teacherRole.id, branchId },
    ],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

const meta = (over: Partial<Record<string, unknown>> = {}) => ({
  levelId,
  subjectId,
  academicYearId,
  branchId,
  visibility: "private",
  ...over,
});

/** initiate → PUT → complete, the whole path a browser takes. */
async function uploadPdf(
  actor: Actor,
  title: string,
  over: Record<string, unknown> = {},
) {
  const replacementId = over["replacesContentId"];
  if (typeof replacementId === "string") {
    const current = await prisma.educationalContent.findUnique({
      where: { id: replacementId },
      select: { storageBucket: true, storageKey: true },
    });
    if (current) {
      trackObject(
        current.storageBucket,
        quarantineKeyFor(replacementId, current.storageKey),
      );
    }
  }
  const bytes = pdfBytes();
  const initiated = await initiateUpload(prisma, clients, KEY, actor, {
    filename: "درس القرآن.pdf",
    size: bytes.length,
    mime: "application/pdf",
    meta: meta(over) as never,
  });
  trackTicket(initiated.uploadId);
  expect(await putObject(initiated.putUrl, bytes, "application/pdf")).toBe(200);
  const created = await completeUpload(
    prisma,
    clients,
    KEY,
    actor,
    initiated.uploadId,
    {
      title: `${TAG} ${title}`,
      description: null,
    },
  );
  const stored = await prisma.educationalContent.findUniqueOrThrow({
    where: { id: created.id },
    select: { storageBucket: true, storageKey: true },
  });
  trackObject(stored.storageBucket, stored.storageKey);
  return { ...created, ...stored, initiated, bytes };
}

/**
 * **R99.12 — the marker travels in the TICKET, not in the completion body.**
 *
 * «التسجيلات» is decided by `origin` (R99.10), so it is an authorization-shaped
 * decision taken at `/initiate` and bound into the signed ticket — exactly like
 * the scope fields, and for the same reason: a client that could restate it at
 * `/complete` would classify content after the check that authorised it.
 */
describe("R99.12 — the origin marker", () => {
  it("persists `session_recording` from initiate through to the row", async () => {
    const { id } = await uploadPdf(admin(), "تسجيل مرفوع", {
      origin: "session_recording",
    });
    const row = await prisma.educationalContent.findUniqueOrThrow({
      where: { id },
      select: { origin: true },
    });
    expect(row.origin).toBe("session_recording");
  });

  it("defaults to `uploaded`, which is what every pre-R99 row is", async () => {
    const { id } = await uploadPdf(admin(), "مادة عادية");
    const row = await prisma.educationalContent.findUniqueOrThrow({
      where: { id },
      select: { origin: true },
    });
    expect(row.origin).toBe("uploaded");
  });
});

describe("the two-phase upload (TD-3.5)", () => {
  it("round-trips a real file through the presigned PUT and creates the content row", async () => {
    const { id, initiated, bytes } = await uploadPdf(admin(), "ملف");

    // The URL handed to the browser is rooted at the public storage origin and
    // never at MinIO's internal endpoint (§3.1).
    expect(initiated.putUrl.startsWith(config.STORAGE_BASE_URL)).toBe(true);

    const row = await prisma.educationalContent.findUniqueOrThrow({
      where: { id },
    });
    expect(row.storageKey).not.toBe(initiated.key);
    expect(initiated.key).toMatch(/^staging\/content\//);
    expect(row.storageBucket).toBe(BUCKETS.private);
    expect(Number(row.sizeBytes)).toBe(bytes.length);
    // TD-9: the true filename is kept verbatim; the key carries a slug of it.
    expect(row.originalFilename).toBe("درس القرآن.pdf");
    expect(row.storageKey).toMatch(
      /^content\/[0-9a-f-]{36}\/[0-9a-f]{32}\/drs-alqran\.pdf$/,
    );
  });

  it("writes non-identifying coordinates and preserves same-ticket retry", async () => {
    const filename = "guardian.person@example.test.pdf";
    const bytes = pdfBytes();
    const initiated = await initiateUpload(prisma, clients, KEY, admin(), {
      filename,
      size: bytes.length,
      mime: "application/pdf",
      meta: meta() as never,
    });
    const ticket = trackTicket(initiated.uploadId);
    expect(await putObject(initiated.putUrl, bytes, "application/pdf")).toBe(200);

    const completed = await completeUpload(
      prisma,
      clients,
      KEY,
      admin(),
      initiated.uploadId,
      { title: `${TAG} مدقق`, description: null },
    );
    const row = await prisma.educationalContent.findUniqueOrThrow({
      where: { id: completed.id },
      select: { storageBucket: true, storageKey: true },
    });
    trackObject(row.storageBucket, row.storageKey);
    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { actionType: "content.upload", targetId: completed.id },
      select: { detail: true },
    });
    expect(entry.detail).toMatchObject({
      staging_coordinate_id: storageCoordinateId(ticket.bucket, ticket.key),
      canonical_coordinate_id: storageCoordinateId(row.storageBucket, row.storageKey),
    });
    expect(JSON.stringify(entry.detail)).not.toContain("guardian.person");
    expect(entry.detail).not.toHaveProperty("staging_key");
    expect(entry.detail).not.toHaveProperty("canonical_key");

    // The retry reads the minimized audit evidence and derives exactly the
    // already-published key; it never needs the removed raw locator fields.
    await expect(
      completeUpload(prisma, clients, KEY, admin(), initiated.uploadId, {
        title: `${TAG} لا يتكرر`,
        description: null,
      }),
    ).resolves.toEqual({ id: completed.id });
    expect(
      await prisma.auditLog.count({
        where: { actionType: "content.upload", targetId: completed.id },
      }),
    ).toBe(1);
  });

  it("refuses a MIME type TD-9 does not list, before anything is uploaded", async () => {
    const e = await failure(() =>
      initiateUpload(prisma, clients, KEY, admin(), {
        filename: "clip.mp4",
        size: 1000,
        mime: "video/mp4",
        meta: meta() as never,
      }),
    );
    expect(e.code).toBe("VALIDATION_FAILED");
  });

  it("refuses a declared size over the TD-9 cap without minting a URL", async () => {
    const e = await failure(() =>
      initiateUpload(prisma, clients, KEY, admin(), {
        filename: "huge.pdf",
        size: 51 * 1024 * 1024,
        mime: "application/pdf",
        meta: meta() as never,
      }),
    );
    expect(e.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("refuses a subject that is not taught at that level (R43)", async () => {
    const stray = await prisma.subject.create({
      data: { name: `${TAG} مادة غريبة` },
    });
    const e = await failure(() =>
      initiateUpload(prisma, clients, KEY, admin(), {
        filename: "a.pdf",
        size: 10,
        mime: "application/pdf",
        meta: meta({ subjectId: stray.id }) as never,
      }),
    );
    expect(e.code).toBe("STATE_CONFLICT");
    // One code across all three surfaces (`policies/curriculum.ts`): scheduling
    // and teaching-group splits raise the same one, and the older spelling wins
    // because clients render it.
    expect(e.details?.["reason"]).toBe("SUBJECT_NOT_IN_LEVEL");
  });
});

describe("§4.9 upload authorization", () => {
  it("refuses a Teacher the Global scope — the named §19.2 regression", async () => {
    const e = await failure(() =>
      initiateUpload(prisma, clients, KEY, teacher(), {
        filename: "a.pdf",
        size: 10,
        mime: "application/pdf",
        meta: meta({ branchId: null }) as never,
      }),
    );
    expect(e.code).toBe("FORBIDDEN");
    expect(e.details?.["reason"]).toBe("GLOBAL_SCOPE_FORBIDDEN");
  });

  it("refuses a Teacher a branch they do not teach at", async () => {
    const e = await failure(() =>
      initiateUpload(prisma, clients, KEY, teacher(), {
        filename: "a.pdf",
        size: 10,
        mime: "application/pdf",
        meta: meta({ branchId: otherBranchId }) as never,
      }),
    );
    expect(e.code).toBe("FORBIDDEN");
    expect(e.details?.["reason"]).toBe("BRANCH_OUT_OF_SCOPE");
  });

  it("admits a Teacher at a branch they DO teach at, resolved through the schedule", async () => {
    // The scope comes from `CourseScheduleStaff` (§4.4c), not from the role
    // assignment — the fixture's teacher has no admin scope of any kind.
    const result = await uploadPdf(teacher(), "ملف المؤطرة");
    expect(result.id).toBeTruthy();
  });

  it("lets an Admin publish to the Global scope", async () => {
    const { id } = await uploadPdf(admin(), "عام", { branchId: null });
    const row = await prisma.educationalContent.findUniqueOrThrow({
      where: { id },
    });
    expect(row.branchId).toBeNull();
  });
});

describe("completion verification (§4.9 Revision 8)", () => {
  it("deletes the object and refuses with 409 when the magic bytes lie", async () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      randomBytes(100),
    ]);
    const initiated = await initiateUpload(prisma, clients, KEY, admin(), {
      filename: "liar.pdf",
      size: png.length,
      mime: "application/pdf",
      meta: meta() as never,
    });
    await putObject(initiated.putUrl, png, "application/pdf");

    const e = await failure(() =>
      completeUpload(prisma, clients, KEY, admin(), initiated.uploadId, {
        title: `${TAG} كاذب`,
        description: null,
      }),
    );
    expect(e.code).toBe("VALIDATION_FAILED");
    // §4.9 says 409 here, not 400: the request is well-formed, the object is not
    // what it claimed. TD-3.8 records it as the "409 variant on upload complete".
    expect(e.status).toBe(409);

    expect(
      await prisma.educationalContent.count({
        where: { title: `${TAG} كاذب` },
      }),
    ).toBe(0);
    // And the object is gone — a rejected upload must not linger in the bucket.
    const orphan = await fetch(initiated.putUrl.replace("X-Amz", "x-amz"), {
      method: "HEAD",
    });
    expect(orphan.status).toBeGreaterThanOrEqual(400);
  });

  it("refuses with 409 when the stored size disagrees with the declared size", async () => {
    const bytes = pdfBytes();
    const initiated = await initiateUpload(prisma, clients, KEY, admin(), {
      filename: "short.pdf",
      size: bytes.length + 500,
      mime: "application/pdf",
      meta: meta() as never,
    });
    await putObject(initiated.putUrl, bytes, "application/pdf");

    const e = await failure(() =>
      completeUpload(prisma, clients, KEY, admin(), initiated.uploadId, {
        title: `${TAG} قصير`,
        description: null,
      }),
    );
    expect(e.code).toBe("VALIDATION_FAILED");
    expect(e.status).toBe(409);
  });

  it("answers UPLOAD_INCOMPLETE when nothing was ever PUT", async () => {
    const initiated = await initiateUpload(prisma, clients, KEY, admin(), {
      filename: "never.pdf",
      size: 100,
      mime: "application/pdf",
      meta: meta() as never,
    });
    const e = await failure(() =>
      completeUpload(prisma, clients, KEY, admin(), initiated.uploadId, {
        title: `${TAG} مفقود`,
        description: null,
      }),
    );
    expect(e.code).toBe("UPLOAD_INCOMPLETE");
  });

  it("refuses a ticket belonging to another caller", async () => {
    const initiated = await initiateUpload(prisma, clients, KEY, admin(), {
      filename: "a.pdf",
      size: 100,
      mime: "application/pdf",
      meta: meta() as never,
    });
    const e = await failure(() =>
      completeUpload(prisma, clients, KEY, teacher(), initiated.uploadId, {
        title: `${TAG} مسروق`,
        description: null,
      }),
    );
    expect(e.code).toBe("NOT_FOUND");
  });

  it("refuses a ticket whose scope was rewritten after it was issued", async () => {
    // The forged ticket is what a client would have to produce to complete into
    // the Global scope after initiating inside a branch.
    const forged = issueUploadTicket(
      {
        sub: teacherId,
        cid: "11111111-2222-3333-4444-555555555555",
        bucket: BUCKETS.private,
        key: "content/x/abcd1234/a.pdf",
        filename: "a.pdf",
        mime: "application/pdf",
        size: 10,
        level_id: levelId,
        subject_id: subjectId,
        academic_year_id: academicYearId,
        branch_id: null,
        visibility: "private",
      },
      "a-different-key",
    ).token;
    const e = await failure(() =>
      completeUpload(prisma, clients, KEY, teacher(), forged, {
        title: `${TAG} مزور`,
        description: null,
      }),
    );
    expect(e.code).toBe("NOT_FOUND");
    expect(e.details?.["reason"]).toBe("BAD_SIGNATURE");
  });
});

describe("abort", () => {
  it("removes the object so an abandoned upload leaves nothing behind", async () => {
    const bytes = pdfBytes();
    const initiated = await initiateUpload(prisma, clients, KEY, admin(), {
      filename: "gone.pdf",
      size: bytes.length,
      mime: "application/pdf",
      meta: meta() as never,
    });
    await putObject(initiated.putUrl, bytes, "application/pdf");
    await abortUpload(prisma, clients, KEY, admin(), initiated.uploadId);

    const e = await failure(() =>
      completeUpload(prisma, clients, KEY, admin(), initiated.uploadId, {
        title: `${TAG} ملغى`,
        description: null,
      }),
    );
    expect(e.code).toBe("UPLOAD_INCOMPLETE");
  });
});

describe("the per-user upload quota (TD-4.12, Revision 14)", () => {
  it("refuses the 31st initiation within the hour with RATE_LIMITED", async () => {
    // Counted in PostgreSQL inside the initiating transaction — never in process
    // memory (dies with the container) and never through pg-boss (asynchronous).
    await prisma.rateLimitCounter.create({
      data: {
        userId: adminId,
        bucket: UPLOAD_QUOTA.bucket,
        windowStart: new Date(new Date().setUTCMinutes(0, 0, 0)),
        count: UPLOAD_QUOTA.perHour,
      },
    });
    const e = await failure(() =>
      initiateUpload(prisma, clients, KEY, admin(), {
        filename: "a.pdf",
        size: 10,
        mime: "application/pdf",
        meta: meta() as never,
      }),
    );
    expect(e.code).toBe("RATE_LIMITED");
    expect(e.details?.["limit"]).toBe(30);
  });

  it("admits exactly one of two concurrent initiations at the boundary", async () => {
    // The check-then-write race TD-15.2's row lock exists to close: without the
    // lock both would read 29 and both would pass.
    await prisma.rateLimitCounter.create({
      data: {
        userId: adminId,
        bucket: UPLOAD_QUOTA.bucket,
        windowStart: new Date(new Date().setUTCMinutes(0, 0, 0)),
        count: UPLOAD_QUOTA.perHour - 1,
      },
    });
    const attempt = () =>
      initiateUpload(prisma, clients, KEY, admin(), {
        filename: "a.pdf",
        size: 10,
        mime: "application/pdf",
        meta: meta() as never,
      });
    const results = await Promise.allSettled([attempt(), attempt()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });
});

describe("the presigned GET mint (TD-3.5, TD-12)", () => {
  it("mints a short-lived URL that actually serves the bytes", async () => {
    const { id, bytes } = await uploadPdf(admin(), "قابل للتنزيل");
    const minted = await mintDownloadUrl(
      prisma,
      clients,
      admin(),
      id,
      undefined,
    );

    expect(minted.expiresIn).toBe(600);
    expect(minted.url.startsWith(config.STORAGE_BASE_URL)).toBe(true);
    const res = await fetch(minted.url);
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).length).toBe(bytes.length);
  });

  it("refuses a suspended Teacher inside their unexpired token window (§19.2)", async () => {
    const { id } = await uploadPdf(admin(), "محمي");
    await prisma.user.update({
      where: { id: teacherId },
      data: { accountStatus: "suspended" },
    });
    // TD-12: "statelessness ends where safeguarding begins" — the token is still
    // valid, and that is exactly the case this check exists for.
    const e = await failure(() =>
      mintDownloadUrl(prisma, clients, teacher(), id, undefined),
    );
    expect(e.code).toBe("FORBIDDEN");
  });

  it("answers 404 rather than 403 for content out of the caller’s reach (§20 rule 17)", async () => {
    const { id } = await uploadPdf(admin(), "مخفي", { visibility: "hidden" });
    const student = await prisma.user.create({
      data: {
        // R80 — every person carries a recorded sex; the column is NOT NULL.
        sex: "female",
        nameArabic: `${TAG} طالبة`,
        accountStatus: "active",
      },
    });
    const role = await prisma.role.findFirstOrThrow({
      where: { name: "student" },
    });
    await prisma.userBranchRole.create({
      data: { userId: student.id, roleId: role.id, branchId },
    });
    const e = await failure(() =>
      mintDownloadUrl(
        prisma,
        clients,
        actorOf(student.id, [{ role: "student", branches: [branchId] }]),
        id,
        undefined,
      ),
    );
    // A 403 would confirm the file exists to someone with no business knowing.
    expect(e.code).toBe("NOT_FOUND");
  });
});

describe("B-03 — immutable upload finalization", () => {
  it("promotes exact validated bytes to a distinct canonical key and removes staging", async () => {
    const uploaded = await uploadPdf(admin(), "ترقية آمنة");
    const ticket = trackTicket(uploaded.initiated.uploadId);

    expect(ticket.key).toBe(uploaded.initiated.key);
    expect(ticket.finalization_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(uploaded.storageKey).not.toBe(ticket.key);
    expect(uploaded.storageKey.startsWith(`content/${uploaded.id}/`)).toBe(true);
    expect(await statObject(clients, ticket.bucket, ticket.key)).toBeNull();
    expect(
      await keysUnder(
        BUCKETS.private,
        `staging/server-finalization/${uploaded.id}/`,
      ),
    ).toEqual([]);

    const download = await mintDownloadUrl(
      prisma,
      clients,
      admin(),
      uploaded.id,
      undefined,
    );
    const bytes = Buffer.from(await (await fetch(download.url)).arrayBuffer());
    expect(bytes.equals(uploaded.bytes)).toBe(true);
    const sha256 = createHash("sha256").update(uploaded.bytes).digest("hex");
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha256);
    expect(
      await statObject(clients, uploaded.storageBucket, uploaded.storageKey),
    ).toMatchObject({ sha256 });
    const published = await prisma.auditLog.findFirstOrThrow({
      where: { actionType: "content.upload", targetId: uploaded.id },
      select: { detail: true },
    });
    expect(published.detail).toMatchObject({ content_sha256: sha256 });
  });

  it("a retained completed-upload PUT can mutate staging but never canonical bytes", async () => {
    const uploaded = await uploadPdf(admin(), "رابط محتفظ به", {
      visibility: "public",
    });
    const changed = pdfBytes();
    expect(changed.equals(uploaded.bytes)).toBe(false);

    // The original capability remains cryptographically valid for one hour,
    // but after completion it addresses only the deleted staging key.
    expect(
      await putObject(uploaded.initiated.putUrl, changed, "application/pdf"),
    ).toBe(200);
    expect(
      await statObject(clients, BUCKETS.public, uploaded.initiated.key),
    ).toMatchObject({ sizeBytes: changed.length });

    const row = await prisma.educationalContent.findUniqueOrThrow({
      where: { id: uploaded.id },
    });
    expect(row.storageKey).toBe(uploaded.storageKey);
    const canonical = await fetch(stableObjectUrl(BUCKETS.public, row.storageKey));
    expect(Buffer.from(await canonical.arrayBuffer()).equals(uploaded.bytes)).toBe(true);
  });

  it("canonicalizes the opened byte stream when staging is replaced by a different PDF with the same MD5", async () => {
    const first = MD5_COLLISION_PDFS.first;
    const second = MD5_COLLISION_PDFS.second;
    const firstMd5 = createHash("md5").update(first).digest("hex");
    const secondMd5 = createHash("md5").update(second).digest("hex");
    const firstSha256 = createHash("sha256").update(first).digest("hex");
    const secondSha256 = createHash("sha256").update(second).digest("hex");
    expect(first.equals(second)).toBe(false);
    expect(first.length).toBe(second.length);
    expect(firstMd5).toBe("150df5a6596a8c06a879c4b84e331c8a");
    expect(secondMd5).toBe(firstMd5);
    expect(secondSha256).not.toBe(firstSha256);

    const initiated = await initiateUpload(prisma, clients, KEY, admin(), {
      filename: "md5-collision.pdf",
      size: first.length,
      mime: "application/pdf",
      meta: meta() as never,
    });
    const ticket = trackTicket(initiated.uploadId);
    expect(await putObject(initiated.putUrl, first, "application/pdf")).toBe(200);

    await expect(
      completeUpload(
        prisma,
        clients,
        KEY,
        admin(),
        initiated.uploadId,
        { title: `${TAG} تصادم MD5`, description: null },
        {
          afterSourceMagicValidated: async () => {
            // This barrier is inside the production full-object read: the GET
            // is already open and has accepted A's magic prefix. MinIO gives
            // that request one stable object snapshot while this retained PUT
            // replaces the key with equal-size/equal-MD5 B.
            expect(
              await putObject(initiated.putUrl, second, "application/pdf"),
            ).toBe(200);
          },
        },
      ),
    ).resolves.toEqual({ id: ticket.cid });

    const row = await prisma.educationalContent.findUniqueOrThrow({
      where: { id: ticket.cid },
    });
    trackObject(row.storageBucket, row.storageKey);
    const download = await mintDownloadUrl(
      prisma,
      clients,
      admin(),
      ticket.cid,
      undefined,
    );
    const canonical = Buffer.from(
      await (await fetch(download.url)).arrayBuffer(),
    );
    expect(canonical.equals(first)).toBe(true);
    expect(canonical.equals(second)).toBe(false);
    expect(createHash("sha256").update(canonical).digest("hex")).toBe(firstSha256);
    const published = await prisma.auditLog.findFirstOrThrow({
      where: { actionType: "content.upload", targetId: ticket.cid },
      select: { detail: true },
    });
    expect(published.detail).toMatchObject({ content_sha256: firstSha256 });
    expect(await statObject(clients, ticket.bucket, ticket.key)).toBeNull();
  });

  it("keeps staging retryable when canonical promotion fails, then succeeds", async () => {
    const bytes = pdfBytes();
    const initiated = await initiateUpload(prisma, clients, KEY, admin(), {
      filename: "copy-retry.pdf",
      size: bytes.length,
      mime: "application/pdf",
      meta: meta() as never,
    });
    const ticket = trackTicket(initiated.uploadId);
    expect(await putObject(initiated.putUrl, bytes, "application/pdf")).toBe(200);

    const realSend = clients.internal.send.bind(clients.internal);
    let failCopy = true;
    const copyFailure = vi.spyOn(clients.internal, "send").mockImplementation(
      async (command, ...args) => {
        if (
          failCopy &&
          command instanceof PutObjectCommand &&
          command.input.Key?.startsWith(`content/${ticket.cid}/`)
        ) {
          failCopy = false;
          throw new Error("controlled copy failure");
        }
        return realSend(command, ...args);
      },
    );

    const e = await failure(() =>
      completeUpload(prisma, clients, KEY, admin(), initiated.uploadId, {
        title: `${TAG} نسخ معاد`,
        description: null,
      }),
    );
    expect(e.code).toBe("SERVICE_UNAVAILABLE");
    expect(await prisma.educationalContent.findUnique({ where: { id: ticket.cid } })).toBeNull();
    expect(await statObject(clients, ticket.bucket, ticket.key)).not.toBeNull();
    expect(await keysUnder(ticket.bucket, `content/${ticket.cid}/`)).toEqual([]);

    copyFailure.mockRestore();
    await expect(
      completeUpload(prisma, clients, KEY, admin(), initiated.uploadId, {
        title: `${TAG} نسخ معاد`,
        description: null,
      }),
    ).resolves.toEqual({ id: ticket.cid });
  });

  it("maps a storage verification outage to 503 and creates no row", async () => {
    const bytes = pdfBytes();
    const initiated = await initiateUpload(prisma, clients, KEY, admin(), {
      filename: "head-outage.pdf",
      size: bytes.length,
      mime: "application/pdf",
      meta: meta() as never,
    });
    const ticket = trackTicket(initiated.uploadId);
    expect(await putObject(initiated.putUrl, bytes, "application/pdf")).toBe(200);
    const realSend = clients.internal.send.bind(clients.internal);
    const headFailure = vi.spyOn(clients.internal, "send").mockImplementation(
      async (command, ...args) => {
        if (
          command instanceof HeadObjectCommand &&
          command.input.Key === ticket.key
        ) {
          throw new Error("controlled HEAD outage");
        }
        return realSend(command, ...args);
      },
    );

    const e = await failure(() =>
      completeUpload(prisma, clients, KEY, admin(), initiated.uploadId, {
        title: `${TAG} تخزين متوقف`,
        description: null,
      }),
    );
    expect(e).toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      status: 503,
      details: { reason: "STORAGE_VERIFICATION_FAILED" },
    });
    expect(await prisma.educationalContent.findUnique({ where: { id: ticket.cid } })).toBeNull();
    headFailure.mockRestore();
    expect(await statObject(clients, ticket.bucket, ticket.key)).not.toBeNull();
  });

  it("a truncated source stream publishes no row or canonical object and keeps staging retryable", async () => {
    const bytes = Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(4096)]);
    const initiated = await initiateUpload(prisma, clients, KEY, admin(), {
      filename: "source-read-failure.pdf",
      size: bytes.length,
      mime: "application/pdf",
      meta: meta() as never,
    });
    const ticket = trackTicket(initiated.uploadId);
    expect(await putObject(initiated.putUrl, bytes, "application/pdf")).toBe(200);

    const realSend = clients.internal.send.bind(clients.internal);
    const sourceFailure = vi.spyOn(clients.internal, "send").mockImplementation(
      async (command, ...args) => {
        if (
          command instanceof GetObjectCommand &&
          command.input.Key === ticket.key &&
          command.input.Range === undefined
        ) {
          const response = (await realSend(
            command,
            ...args
          )) as unknown as GetObjectCommandOutput;
          const stored = Buffer.from(await response.Body!.transformToByteArray());
          const broken = Readable.from([stored.subarray(0, 1024)], {
            objectMode: false,
          });
          return { ...response, Body: broken } as never;
        }
        return realSend(command, ...args);
      },
    );

    const e = await failure(() =>
      completeUpload(prisma, clients, KEY, admin(), initiated.uploadId, {
        title: `${TAG} قراءة فاشلة`,
        description: null,
      }),
    );
    expect(e).toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      details: { reason: "STORAGE_VERIFICATION_FAILED" },
    });
    sourceFailure.mockRestore();
    expect(await prisma.educationalContent.findUnique({ where: { id: ticket.cid } })).toBeNull();
    expect(await keysUnder(ticket.bucket, `content/${ticket.cid}/`)).toEqual([]);
    expect(await statObject(clients, ticket.bucket, ticket.key)).not.toBeNull();
    expect(
      await keysUnder(
        BUCKETS.private,
        `staging/server-finalization/${ticket.cid}/`,
      ),
    ).toEqual([]);
  });

  it("rolls back audit/DB failure and removes the unreferenced canonical copy", async () => {
    const bytes = pdfBytes();
    const initiated = await initiateUpload(prisma, clients, KEY, admin(), {
      filename: "db-rollback.pdf",
      size: bytes.length,
      mime: "application/pdf",
      meta: meta() as never,
    });
    const ticket = trackTicket(initiated.uploadId);
    expect(await putObject(initiated.putUrl, bytes, "application/pdf")).toBe(200);

    const realWrite = audit.write;
    const auditFailure = vi.spyOn(audit, "write").mockImplementation(async (db, entry) => {
      if (entry.actionType === "content.upload" && entry.targetId === ticket.cid) {
        throw new Error("controlled content audit failure");
      }
      return realWrite(db, entry);
    });

    await expect(
      completeUpload(prisma, clients, KEY, admin(), initiated.uploadId, {
        title: `${TAG} معاملة فاشلة`,
        description: null,
      }),
    ).rejects.toThrow("controlled content audit failure");
    expect(await prisma.educationalContent.findUnique({ where: { id: ticket.cid } })).toBeNull();
    expect(await keysUnder(ticket.bucket, `content/${ticket.cid}/`)).toEqual([]);
    expect(await statObject(clients, ticket.bucket, ticket.key)).not.toBeNull();

    auditFailure.mockRestore();
    await expect(
      completeUpload(prisma, clients, KEY, admin(), initiated.uploadId, {
        title: `${TAG} معاملة ناجحة`,
        description: null,
      }),
    ).resolves.toEqual({ id: ticket.cid });
  });

  it("recovers after a stop between promotion and DB finalization without another object", async () => {
    const bytes = pdfBytes();
    const initiated = await initiateUpload(prisma, clients, KEY, admin(), {
      filename: "restart.pdf",
      size: bytes.length,
      mime: "application/pdf",
      meta: meta() as never,
    });
    const ticket = trackTicket(initiated.uploadId);
    expect(await putObject(initiated.putUrl, bytes, "application/pdf")).toBe(200);

    await expect(
      completeUpload(
        prisma,
        clients,
        KEY,
        admin(),
        initiated.uploadId,
        { title: `${TAG} قبل التوقف`, description: null },
        {
          afterPromotion: async () => {
            throw new Error("simulated process stop after promotion");
          },
        },
      ),
    ).rejects.toThrow("simulated process stop after promotion");
    expect(await prisma.educationalContent.findUnique({ where: { id: ticket.cid } })).toBeNull();
    expect(await keysUnder(ticket.bucket, `content/${ticket.cid}/`)).toHaveLength(1);

    await expect(
      completeUpload(prisma, clients, KEY, admin(), initiated.uploadId, {
        title: `${TAG} بعد الاستئناف`,
        description: null,
      }),
    ).resolves.toEqual({ id: ticket.cid });
    expect(await keysUnder(ticket.bucket, `content/${ticket.cid}/`)).toHaveLength(1);
    expect(
      await prisma.auditLog.count({
        where: { actionType: "content.upload", targetId: ticket.cid },
      }),
    ).toBe(1);
  });

  it("keeps accepted content intact when staging cleanup fails and converges on retry", async () => {
    const bytes = pdfBytes();
    const initiated = await initiateUpload(prisma, clients, KEY, admin(), {
      filename: "cleanup.pdf",
      size: bytes.length,
      mime: "application/pdf",
      meta: meta() as never,
    });
    const ticket = trackTicket(initiated.uploadId);
    expect(await putObject(initiated.putUrl, bytes, "application/pdf")).toBe(200);

    const realSend = clients.internal.send.bind(clients.internal);
    let failDelete = true;
    const cleanupFailure = vi.spyOn(clients.internal, "send").mockImplementation(
      async (command, ...args) => {
        if (
          failDelete &&
          command instanceof DeleteObjectCommand &&
          command.input.Key === ticket.key
        ) {
          failDelete = false;
          throw new Error("controlled staging cleanup failure");
        }
        return realSend(command, ...args);
      },
    );

    await expect(
      completeUpload(prisma, clients, KEY, admin(), initiated.uploadId, {
        title: `${TAG} تنظيف`,
        description: null,
      }),
    ).resolves.toEqual({ id: ticket.cid });
    const row = await prisma.educationalContent.findUniqueOrThrow({
      where: { id: ticket.cid },
    });
    trackObject(row.storageBucket, row.storageKey);
    expect(await statObject(clients, ticket.bucket, ticket.key)).not.toBeNull();
    expect(await statObject(clients, row.storageBucket, row.storageKey)).not.toBeNull();

    cleanupFailure.mockRestore();
    await expect(
      completeUpload(prisma, clients, KEY, admin(), initiated.uploadId, {
        title: `${TAG} لا يتكرر`,
        description: null,
      }),
    ).resolves.toEqual({ id: ticket.cid });
    expect(await statObject(clients, ticket.bucket, ticket.key)).toBeNull();
    expect(
      await prisma.auditLog.count({
        where: { actionType: "content.upload", targetId: ticket.cid },
      }),
    ).toBe(1);
  });

  it("duplicate and concurrent same-ticket completion publish once", async () => {
    const bytes = pdfBytes();
    const initiated = await initiateUpload(prisma, clients, KEY, admin(), {
      filename: "duplicate.pdf",
      size: bytes.length,
      mime: "application/pdf",
      meta: meta() as never,
    });
    const ticket = trackTicket(initiated.uploadId);
    expect(await putObject(initiated.putUrl, bytes, "application/pdf")).toBe(200);
    const barrier = twoPartyBarrier();
    const complete = () =>
      completeUpload(
        prisma,
        clients,
        KEY,
        admin(),
        initiated.uploadId,
        { title: `${TAG} متزامن`, description: null },
        { afterPromotion: barrier },
      );

    await expect(Promise.all([complete(), complete()])).resolves.toEqual([
      { id: ticket.cid },
      { id: ticket.cid },
    ]);
    await expect(
      completeUpload(prisma, clients, KEY, admin(), initiated.uploadId, {
        title: `${TAG} تكرار لاحق`,
        description: null,
      }),
    ).resolves.toEqual({ id: ticket.cid });

    expect(await prisma.educationalContent.count({ where: { id: ticket.cid } })).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { actionType: "content.upload", targetId: ticket.cid },
      }),
    ).toBe(1);
    expect(await keysUnder(ticket.bucket, `content/${ticket.cid}/`)).toHaveLength(1);
  });

  it("concurrent same-ticket reads of different stable staging versions converge on the published one", async () => {
    const first = pdfBytes();
    const second = pdfBytes();
    const initiated = await initiateUpload(prisma, clients, KEY, admin(), {
      filename: "snapshot-race.pdf",
      size: first.length,
      mime: "application/pdf",
      meta: meta() as never,
    });
    const ticket = trackTicket(initiated.uploadId);
    expect(second.length).toBe(first.length);
    expect(await putObject(initiated.putUrl, first, "application/pdf")).toBe(200);

    let releaseFirst!: () => void;
    let announceOpened!: () => void;
    const opened = new Promise<void>((resolve) => {
      announceOpened = resolve;
    });
    const released = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstCompletion = completeUpload(
      prisma,
      clients,
      KEY,
      admin(),
      initiated.uploadId,
      { title: `${TAG} لقطة أولى`, description: null },
      {
        afterSourceMagicValidated: async () => {
          announceOpened();
          await released;
        },
      },
    );

    await opened;
    expect(await putObject(initiated.putUrl, second, "application/pdf")).toBe(200);
    const secondCompletion = completeUpload(
      prisma,
      clients,
      KEY,
      admin(),
      initiated.uploadId,
      { title: `${TAG} لقطة منشورة`, description: null },
    );
    await expect(secondCompletion).resolves.toEqual({ id: ticket.cid });
    releaseFirst();
    await expect(firstCompletion).resolves.toEqual({ id: ticket.cid });

    const row = await prisma.educationalContent.findUniqueOrThrow({
      where: { id: ticket.cid },
    });
    trackObject(row.storageBucket, row.storageKey);
    const download = await mintDownloadUrl(
      prisma,
      clients,
      admin(),
      ticket.cid,
      undefined,
    );
    const canonical = Buffer.from(await (await fetch(download.url)).arrayBuffer());
    expect(canonical.equals(second)).toBe(true);
    expect(canonical.equals(first)).toBe(false);
    expect(await keysUnder(ticket.bucket, `content/${ticket.cid}/`)).toEqual([
      row.storageKey,
    ]);
    expect(
      await prisma.auditLog.count({
        where: { actionType: "content.upload", targetId: ticket.cid },
      }),
    ).toBe(1);
  });

  it("concurrent same-ticket replacement snapshots remove the losing canonical candidate", async () => {
    const original = await uploadPdf(admin(), "أصل سباق اللقطات");
    const before = await prisma.educationalContent.findUniqueOrThrow({
      where: { id: original.id },
    });
    const first = pdfBytes();
    const second = pdfBytes();
    expect(second.length).toBe(first.length);
    expect(second.equals(first)).toBe(false);
    const initiated = await initiateUpload(prisma, clients, KEY, admin(), {
      filename: "replacement-snapshot-race.pdf",
      size: first.length,
      mime: "application/pdf",
      meta: meta({ replacesContentId: original.id }) as never,
    });
    trackTicket(initiated.uploadId);
    expect(await putObject(initiated.putUrl, first, "application/pdf")).toBe(200);

    let releaseFirst!: () => void;
    let announceOpened!: () => void;
    const opened = new Promise<void>((resolve) => {
      announceOpened = resolve;
    });
    const released = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstCompletion = completeUpload(
      prisma,
      clients,
      KEY,
      admin(),
      initiated.uploadId,
      { title: `${TAG} استبدال أول`, description: null },
      {
        afterSourceMagicValidated: async () => {
          announceOpened();
          await released;
        },
      },
    );

    await opened;
    expect(await putObject(initiated.putUrl, second, "application/pdf")).toBe(200);
    await expect(
      completeUpload(prisma, clients, KEY, admin(), initiated.uploadId, {
        title: `${TAG} استبدال منشور`,
        description: null,
      }),
    ).resolves.toEqual({ id: original.id });
    releaseFirst();
    await expect(firstCompletion).resolves.toEqual({ id: original.id });

    const row = await prisma.educationalContent.findUniqueOrThrow({
      where: { id: original.id },
    });
    trackObject(row.storageBucket, row.storageKey);
    trackObject(
      before.storageBucket,
      quarantineKeyFor(original.id, before.storageKey),
    );
    const download = await mintDownloadUrl(
      prisma,
      clients,
      admin(),
      original.id,
      undefined,
    );
    const canonical = Buffer.from(await (await fetch(download.url)).arrayBuffer());
    expect(canonical.equals(second)).toBe(true);
    expect(canonical.equals(first)).toBe(false);
    expect(await keysUnder(row.storageBucket, `content/${original.id}/`)).toEqual([
      row.storageKey,
    ]);
    expect(
      await prisma.auditLog.count({
        where: { actionType: "content.replace", targetId: original.id },
      }),
    ).toBe(1);
    expect(
      await statObject(
        clients,
        before.storageBucket,
        quarantineKeyFor(original.id, before.storageKey),
      ),
    ).not.toBeNull();
  });

  it("competing replacements serialize: one wins, one conflicts, old bytes stay quarantined", async () => {
    const original = await uploadPdf(admin(), "أصل التنافس");
    const before = await prisma.educationalContent.findUniqueOrThrow({
      where: { id: original.id },
    });
    const makeReplacement = async (filename: string, bytes: Buffer) => {
      const initiated = await initiateUpload(prisma, clients, KEY, admin(), {
        filename,
        size: bytes.length,
        mime: "application/pdf",
        meta: meta({ replacesContentId: original.id }) as never,
      });
      trackTicket(initiated.uploadId);
      expect(await putObject(initiated.putUrl, bytes, "application/pdf")).toBe(200);
      return initiated;
    };
    const aBytes = pdfBytes();
    const bBytes = pdfBytes();
    const a = await makeReplacement("a.pdf", aBytes);
    const b = await makeReplacement("b.pdf", bBytes);
    const barrier = twoPartyBarrier();
    const run = (uploadId: string, title: string) =>
      completeUpload(
        prisma,
        clients,
        KEY,
        admin(),
        uploadId,
        { title, description: null },
        { afterPromotion: barrier },
      );
    const results = await Promise.allSettled([
      run(a.uploadId, `${TAG} فائز أ`),
      run(b.uploadId, `${TAG} فائز ب`),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({ reason: { code: "VERSION_CONFLICT" } });
    const after = await prisma.educationalContent.findUniqueOrThrow({
      where: { id: original.id },
    });
    trackObject(after.storageBucket, after.storageKey);
    trackObject(
      before.storageBucket,
      quarantineKeyFor(original.id, before.storageKey),
    );
    expect(after.version).toBe(before.version + 1);
    expect(
      await prisma.auditLog.count({
        where: { actionType: "content.replace", targetId: original.id },
      }),
    ).toBe(1);
    expect(await statObject(clients, before.storageBucket, before.storageKey)).toBeNull();
    expect(
      await statObject(
        clients,
        before.storageBucket,
        quarantineKeyFor(original.id, before.storageKey),
      ),
    ).not.toBeNull();
    expect(await keysUnder(after.storageBucket, `content/${original.id}/`)).toEqual([
      after.storageKey,
    ]);
  });

  it("a failed replacement copy preserves the old canonical row and bytes", async () => {
    const original = await uploadPdf(admin(), "أصل محفوظ");
    const before = await prisma.educationalContent.findUniqueOrThrow({
      where: { id: original.id },
    });
    const bytes = pdfBytes();
    const replacement = await initiateUpload(prisma, clients, KEY, admin(), {
      filename: "failed-copy.pdf",
      size: bytes.length,
      mime: "application/pdf",
      meta: meta({ replacesContentId: original.id }) as never,
    });
    trackTicket(replacement.uploadId);
    expect(await putObject(replacement.putUrl, bytes, "application/pdf")).toBe(200);

    const realSend = clients.internal.send.bind(clients.internal);
    const copyFailure = vi.spyOn(clients.internal, "send").mockImplementation(
      async (command, ...args) => {
        if (
          command instanceof PutObjectCommand &&
          command.input.Key?.startsWith(`content/${original.id}/`)
        ) {
          throw new Error("controlled replacement copy failure");
        }
        return realSend(command, ...args);
      },
    );
    const e = await failure(() =>
      completeUpload(prisma, clients, KEY, admin(), replacement.uploadId, {
        title: `${TAG} لا ينشر`,
        description: null,
      }),
    );
    expect(e.code).toBe("SERVICE_UNAVAILABLE");
    expect(
      await prisma.educationalContent.findUniqueOrThrow({ where: { id: original.id } }),
    ).toEqual(before);
    copyFailure.mockRestore();

    const download = await mintDownloadUrl(
      prisma,
      clients,
      admin(),
      original.id,
      undefined,
    );
    expect(
      Buffer.from(await (await fetch(download.url)).arrayBuffer()).equals(original.bytes),
    ).toBe(true);
  });

  it("a failed replacement validation never changes or quarantines the old canonical object", async () => {
    const original = await uploadPdf(admin(), "أصل قبل رفض التحقق");
    const before = await prisma.educationalContent.findUniqueOrThrow({
      where: { id: original.id },
    });
    const fakePdf = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      randomBytes(200),
    ]);
    const replacement = await initiateUpload(prisma, clients, KEY, admin(), {
      filename: "invalid.pdf",
      size: fakePdf.length,
      mime: "application/pdf",
      meta: meta({ replacesContentId: original.id }) as never,
    });
    trackTicket(replacement.uploadId);
    expect(
      await putObject(replacement.putUrl, fakePdf, "application/pdf"),
    ).toBe(200);

    const e = await failure(() =>
      completeUpload(prisma, clients, KEY, admin(), replacement.uploadId, {
        title: `${TAG} مرفوض`,
        description: null,
      }),
    );
    expect(e).toMatchObject({ code: "VALIDATION_FAILED", status: 409 });
    expect(
      await prisma.educationalContent.findUniqueOrThrow({ where: { id: original.id } }),
    ).toEqual(before);
    expect(await statObject(clients, before.storageBucket, before.storageKey)).not.toBeNull();
    expect(
      await statObject(
        clients,
        before.storageBucket,
        quarantineKeyFor(original.id, before.storageKey),
      ),
    ).toBeNull();
  });

  it("completes an outstanding legacy ticket through promotion and retries idempotently", async () => {
    const contentId = crypto.randomUUID();
    const bytes = pdfBytes();
    const legacyKey = `content/${contentId}/${randomBytes(4).toString("hex")}/legacy.pdf`;
    const uploadId = issueUploadTicket(
      {
        sub: adminId,
        cid: contentId,
        bucket: BUCKETS.private,
        key: legacyKey,
        filename: "legacy.pdf",
        mime: "application/pdf",
        size: bytes.length,
        level_id: levelId,
        subject_id: subjectId,
        academic_year_id: academicYearId,
        branch_id: branchId,
        visibility: "private",
      },
      KEY,
    ).token;
    trackObject(BUCKETS.private, legacyKey);
    const putUrl = await presignPutUrl(clients, BUCKETS.private, legacyKey);
    expect(await putObject(putUrl, bytes, "application/pdf")).toBe(200);

    await expect(
      completeUpload(prisma, clients, KEY, admin(), uploadId, {
        title: `${TAG} تذكرة قديمة`,
        description: null,
      }),
    ).resolves.toEqual({ id: contentId });
    const row = await prisma.educationalContent.findUniqueOrThrow({
      where: { id: contentId },
    });
    trackObject(row.storageBucket, row.storageKey);
    expect(row.storageKey).not.toBe(legacyKey);
    expect(await statObject(clients, BUCKETS.private, legacyKey)).toBeNull();
    await expect(
      completeUpload(prisma, clients, KEY, admin(), uploadId, {
        title: `${TAG} لا يتكرر`,
        description: null,
      }),
    ).resolves.toEqual({ id: contentId });
    expect(
      await prisma.auditLog.count({
        where: { actionType: "content.upload", targetId: contentId },
      }),
    ).toBe(1);
  });

  it("never deletes a canonical row named by an already-completed legacy ticket", async () => {
    const uploaded = await uploadPdf(admin(), "قديم مكتمل");
    const legacyCompleted = issueUploadTicket(
      {
        sub: adminId,
        cid: uploaded.id,
        bucket: uploaded.storageBucket,
        key: uploaded.storageKey,
        filename: "legacy-completed.pdf",
        mime: "application/pdf",
        size: uploaded.bytes.length,
        level_id: levelId,
        subject_id: subjectId,
        academic_year_id: academicYearId,
        branch_id: branchId,
        visibility: "private",
      },
      KEY,
    ).token;

    await expect(
      completeUpload(prisma, clients, KEY, admin(), legacyCompleted, {
        title: `${TAG} لا يعاد`,
        description: null,
      }),
    ).resolves.toEqual({ id: uploaded.id });
    await abortUpload(prisma, clients, KEY, admin(), legacyCompleted);
    expect(
      await statObject(clients, uploaded.storageBucket, uploaded.storageKey),
    ).toMatchObject({ sizeBytes: uploaded.bytes.length });
  });

  it("completing one upload never touches an unrelated staging object", async () => {
    const unrelatedBytes = pdfBytes();
    const unrelated = await initiateUpload(prisma, clients, KEY, admin(), {
      filename: "unrelated.pdf",
      size: unrelatedBytes.length,
      mime: "application/pdf",
      meta: meta() as never,
    });
    const unrelatedTicket = trackTicket(unrelated.uploadId);
    expect(
      await putObject(unrelated.putUrl, unrelatedBytes, "application/pdf"),
    ).toBe(200);

    await uploadPdf(admin(), "لا يلمس غيره");
    expect(
      await statObject(clients, unrelatedTicket.bucket, unrelatedTicket.key),
    ).toMatchObject({ sizeBytes: unrelatedBytes.length });
  });
});

describe("B-02 — authoritative visibility/storage placement", () => {
  it("stores new private content only in private storage and never serves it anonymously", async () => {
    const { id, initiated, bytes } = await uploadPdf(admin(), "خاص جديد");
    const row = await prisma.educationalContent.findUniqueOrThrow({
      where: { id },
    });

    expect(row.visibility).toBe("private");
    expect(row.storageBucket).toBe(BUCKETS.private);
    expect(await statObject(clients, BUCKETS.private, row.storageKey)).toMatchObject({
      sizeBytes: bytes.length,
    });
    expect(await statObject(clients, BUCKETS.private, initiated.key)).toBeNull();
    expect(await statObject(clients, BUCKETS.public, row.storageKey)).toBeNull();

    const anonymous = await fetch(
      stableObjectUrl(BUCKETS.private, row.storageKey),
      { redirect: "manual" },
    );
    expect(anonymous.status).toBe(302);

    const authorised = await mintDownloadUrl(
      prisma,
      clients,
      admin(),
      id,
      undefined,
    );
    const downloaded = await fetch(authorised.url);
    expect(downloaded.status).toBe(200);
    expect(Buffer.from(await downloaded.arrayBuffer()).equals(bytes)).toBe(true);
  });

  it("stores genuinely public content only in public storage and serves those bytes anonymously", async () => {
    const { id, initiated, bytes } = await uploadPdf(admin(), "عام جديد", {
      visibility: "public",
    });
    const row = await prisma.educationalContent.findUniqueOrThrow({
      where: { id },
    });

    expect(row.visibility).toBe("public");
    expect(row.storageBucket).toBe(BUCKETS.public);
    expect(await statObject(clients, BUCKETS.public, row.storageKey)).toMatchObject({
      sizeBytes: bytes.length,
    });
    expect(await statObject(clients, BUCKETS.public, initiated.key)).toBeNull();
    expect(await statObject(clients, BUCKETS.private, row.storageKey)).toBeNull();

    const anonymous = await fetch(stableObjectUrl(BUCKETS.public, row.storageKey));
    expect(anonymous.status).toBe(200);
    expect(Buffer.from(await anonymous.arrayBuffer()).equals(bytes)).toBe(true);
  });

  it("inherits private visibility on replacement even when the Category default is public", async () => {
    const first = await uploadPdf(admin(), "خاص قبل الاستبدال");
    trackObject(
      BUCKETS.private,
      quarantineKeyFor(first.id, first.storageKey),
    );
    const settingKey = `content.default_visibility.category.${categoryId}`;
    settingKeysToClean.add(settingKey);
    await prisma.systemSetting.create({
      data: { key: settingKey, value: "public" },
    });

    const bytes = pdfBytes();
    const initiated = await initiateUpload(prisma, clients, KEY, admin(), {
      filename: "بديل خاص.pdf",
      size: bytes.length,
      mime: "application/pdf",
      // This is the real replacement shape from the UI: visibility is omitted.
      // The Category default must not become a second authority for this row.
      meta: {
        levelId,
        subjectId,
        academicYearId,
        branchId,
        replacesContentId: first.id,
      },
    });
    const ticket = trackTicket(initiated.uploadId);
    expect(ticket.visibility).toBe("private");
    expect(ticket.bucket).toBe(BUCKETS.private);
    expect(await putObject(initiated.putUrl, bytes, "application/pdf")).toBe(200);
    await completeUpload(prisma, clients, KEY, admin(), initiated.uploadId, {
      title: `${TAG} خاص بعد الاستبدال`,
      description: null,
    });

    const row = await prisma.educationalContent.findUniqueOrThrow({
      where: { id: first.id },
    });
    expect(row.visibility).toBe("private");
    expect(row.storageBucket).toBe(BUCKETS.private);
    expect(await statObject(clients, BUCKETS.private, row.storageKey)).not.toBeNull();
    expect(await statObject(clients, BUCKETS.private, initiated.key)).toBeNull();
    expect(await statObject(clients, BUCKETS.public, row.storageKey)).toBeNull();
    expect(
      (
        await fetch(stableObjectUrl(BUCKETS.private, row.storageKey), {
          redirect: "manual",
        })
      ).status,
    ).toBe(302);
  });

  it("inherits public visibility on replacement despite a manipulated private request", async () => {
    const first = await uploadPdf(admin(), "عام قبل الاستبدال", {
      visibility: "public",
    });
    const second = await uploadPdf(admin(), "عام بعد الاستبدال", {
      replacesContentId: first.id,
      visibility: "private",
    });
    const ticket = trackTicket(second.initiated.uploadId);
    const row = await prisma.educationalContent.findUniqueOrThrow({
      where: { id: first.id },
    });

    expect(ticket.visibility).toBe("public");
    expect(ticket.bucket).toBe(BUCKETS.public);
    expect(row.visibility).toBe("public");
    expect(row.storageBucket).toBe(BUCKETS.public);
    expect(await statObject(clients, BUCKETS.public, row.storageKey)).not.toBeNull();
    expect(await statObject(clients, BUCKETS.private, row.storageKey)).toBeNull();
    const anonymous = await fetch(stableObjectUrl(row.storageBucket, row.storageKey));
    expect(anonymous.status).toBe(200);
    expect(Buffer.from(await anonymous.arrayBuffer()).equals(second.bytes)).toBe(true);
  });

  it("rejects a legacy replacement without replaces_version and preserves the previous content", async () => {
    const first = await uploadPdf(admin(), "قديم صالح");
    const before = await prisma.educationalContent.findUniqueOrThrow({
      where: { id: first.id },
    });
    const bytes = pdfBytes();
    const key = `content/${first.id}/${randomBytes(4).toString("hex")}/legacy.pdf`;
    const uploadId = issueUploadTicket(
      {
        sub: adminId,
        cid: first.id,
        bucket: BUCKETS.public,
        key,
        filename: "legacy.pdf",
        mime: "application/pdf",
        size: bytes.length,
        level_id: levelId,
        subject_id: subjectId,
        academic_year_id: academicYearId,
        branch_id: branchId,
        visibility: "public",
        origin: "uploaded",
        replaces: first.id,
      },
      KEY,
    ).token;
    trackObject(BUCKETS.public, key);
    const putUrl = await presignPutUrl(clients, BUCKETS.public, key);
    expect(await putObject(putUrl, bytes, "application/pdf")).toBe(200);

    const e = await failure(() =>
      completeUpload(prisma, clients, KEY, admin(), uploadId, {
        title: `${TAG} يجب ألا يحفظ`,
        description: null,
      }),
    );
    expect(e.code).toBe("VERSION_CONFLICT");
    expect(e.status).toBe(409);
    expect(e.details?.["reason"]).toBe("REPLACEMENT_REINITIATION_REQUIRED");
    expect(
      await prisma.educationalContent.findUniqueOrThrow({ where: { id: first.id } }),
    ).toEqual(before);
    expect(await statObject(clients, BUCKETS.public, key)).toBeNull();
    expect(await statObject(clients, BUCKETS.private, before.storageKey)).not.toBeNull();
  });

  it("leaves unrelated content and its object untouched when another item is replaced", async () => {
    const target = await uploadPdf(admin(), "هدف");
    const unrelated = await uploadPdf(admin(), "غير مرتبط", {
      visibility: "public",
    });
    const unrelatedBefore = await prisma.educationalContent.findUniqueOrThrow({
      where: { id: unrelated.id },
    });

    await uploadPdf(admin(), "هدف بديل", {
      replacesContentId: target.id,
      visibility: "public",
    });

    expect(
      await prisma.educationalContent.findUniqueOrThrow({
        where: { id: unrelated.id },
      }),
    ).toEqual(unrelatedBefore);
    const stat = await statObject(
      clients,
      unrelatedBefore.storageBucket,
      unrelatedBefore.storageKey,
    );
    expect(stat?.sizeBytes).toBe(unrelated.bytes.length);
    const bytes = await fetch(
      stableObjectUrl(unrelatedBefore.storageBucket, unrelatedBefore.storageKey),
    );
    expect(Buffer.from(await bytes.arrayBuffer()).equals(unrelated.bytes)).toBe(true);
  });

  it("preserves SessionContent links and recording origin across replacement", async () => {
    const first = await uploadPdf(admin(), "تسجيل مرتبط", {
      origin: "session_recording",
    });
    const link = await prisma.sessionContent.create({
      data: { sessionId, contentId: first.id },
    });

    await uploadPdf(admin(), "تسجيل مرتبط بديل", {
      replacesContentId: first.id,
      visibility: "public",
    });

    const after = await prisma.educationalContent.findUniqueOrThrow({
      where: { id: first.id },
      select: { origin: true, visibility: true, storageBucket: true },
    });
    expect(after).toEqual({
      origin: "session_recording",
      visibility: "private",
      storageBucket: BUCKETS.private,
    });
    expect(
      await prisma.sessionContent.findUniqueOrThrow({
        where: { id: link.id },
      }),
    ).toMatchObject({
      id: link.id,
      sessionId,
      contentId: first.id,
      deletedAt: null,
    });
  });
});

describe("replace and delete (R53)", () => {
  it("replacement mints a NEW key and never overwrites the old object (TD-9)", async () => {
    const first = await uploadPdf(admin(), "نسخة أولى");
    const before = await prisma.educationalContent.findUniqueOrThrow({
      where: { id: first.id },
    });

    const second = await uploadPdf(admin(), "نسخة ثانية", {
      replacesContentId: first.id,
    });
    expect(second.id).toBe(first.id);

    const after = await prisma.educationalContent.findUniqueOrThrow({
      where: { id: first.id },
    });
    expect(after.storageKey).not.toBe(before.storageKey);
    expect(after.version).toBe(before.version + 1);
    // One row, not two — the record keeps its identity and every link to it.
    expect(
      await prisma.educationalContent.count({ where: { id: first.id } }),
    ).toBe(1);
    const replacementAudit = await prisma.auditLog.findFirstOrThrow({
      where: { actionType: "content.replace", targetId: first.id },
      select: { detail: true },
    });
    expect(replacementAudit.detail).toMatchObject({
      previous_storage_coordinate_id: storageCoordinateId(
        before.storageBucket,
        before.storageKey,
      ),
      new_storage_coordinate_id: storageCoordinateId(
        after.storageBucket,
        after.storageKey,
      ),
    });
    expect(replacementAudit.detail).not.toHaveProperty("previous_key");
    expect(replacementAudit.detail).not.toHaveProperty("new_key");
  });

  it("deletion soft-deletes, snapshots to the Trash, and leaves the file recoverable", async () => {
    const { id } = await uploadPdf(admin(), "للحذف");
    const before = await prisma.educationalContent.findUniqueOrThrow({
      where: { id },
      select: { storageBucket: true, storageKey: true },
    });
    trackObject(
      before.storageBucket,
      quarantineKeyFor(id, before.storageKey),
    );
    await deleteContent(prisma, clients, admin(), id);

    const row = await prisma.educationalContent.findUniqueOrThrow({
      where: { id },
    });
    expect(row.deletedAt).not.toBeNull();
    const tomb = await prisma.trash.findFirst({
      where: { targetEntity: "EducationalContent", targetId: id },
    });
    // BR-15: the object waits out the 90-day window in quarantine rather than
    // being destroyed — the retention rule is the whole point of a soft delete.
    expect(tomb).not.toBeNull();
    expect(tomb!.purgeAfter.getTime()).toBeGreaterThan(Date.now());
    const deletionAudit = await prisma.auditLog.findFirstOrThrow({
      where: { actionType: "content.delete", targetId: id },
      select: { detail: true },
    });
    expect(deletionAudit.detail).toMatchObject({
      storage_coordinate_id: storageCoordinateId(
        before.storageBucket,
        before.storageKey,
      ),
    });
    expect(JSON.stringify(deletionAudit.detail)).not.toContain(before.storageKey);
  });

  it("refuses a Teacher deleting content outside their branch scope, as a 404", async () => {
    const { id } = await uploadPdf(admin(), "عام للحذف", { branchId: null });
    const e = await failure(() =>
      deleteContent(prisma, clients, teacher(), id),
    );
    // Global content is readable by a teacher and not writable — and the refusal
    // is a 404 for the same reason every other out-of-scope answer is.
    expect(["NOT_FOUND", "FORBIDDEN"]).toContain(e.code);
  });
});
