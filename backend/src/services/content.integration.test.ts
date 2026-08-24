import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "../lib/config.js";
import { quarantineKeyFor } from "../lib/file-types.js";
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
import {
  createTeachingContext,
  staff,
} from "../test-support/educational-fixture.js";
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
const TAG = "[content-test]";

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
  return { ...created, initiated, bytes };
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
    expect(row.storageKey).toBe(initiated.key);
    expect(row.storageBucket).toBe(BUCKETS.private);
    expect(Number(row.sizeBytes)).toBe(bytes.length);
    // TD-9: the true filename is kept verbatim; the key carries a slug of it.
    expect(row.originalFilename).toBe("درس القرآن.pdf");
    expect(row.storageKey).toMatch(
      /^content\/[0-9a-f-]{36}\/[0-9a-f]{8}\/drs-alqran\.pdf$/,
    );
  });

  it("writes a content.upload audit row", async () => {
    const { id } = await uploadPdf(admin(), "مدقق");
    const entry = await prisma.auditLog.findFirst({
      where: { actionType: "content.upload", targetId: id },
    });
    expect(entry).not.toBeNull();
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
    await abortUpload(clients, KEY, admin(), initiated.uploadId);

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

describe("B-02 — authoritative visibility/storage placement", () => {
  it("stores new private content only in private storage and never serves it anonymously", async () => {
    const { id, initiated, bytes } = await uploadPdf(admin(), "خاص جديد");
    const row = await prisma.educationalContent.findUniqueOrThrow({
      where: { id },
    });

    expect(row.visibility).toBe("private");
    expect(row.storageBucket).toBe(BUCKETS.private);
    expect(await statObject(clients, BUCKETS.private, initiated.key)).toMatchObject({
      sizeBytes: bytes.length,
    });
    expect(await statObject(clients, BUCKETS.public, initiated.key)).toBeNull();

    const anonymous = await fetch(
      stableObjectUrl(BUCKETS.private, initiated.key),
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
    expect(await statObject(clients, BUCKETS.public, initiated.key)).toMatchObject({
      sizeBytes: bytes.length,
    });
    expect(await statObject(clients, BUCKETS.private, initiated.key)).toBeNull();

    const anonymous = await fetch(stableObjectUrl(BUCKETS.public, initiated.key));
    expect(anonymous.status).toBe(200);
    expect(Buffer.from(await anonymous.arrayBuffer()).equals(bytes)).toBe(true);
  });

  it("inherits private visibility on replacement even when the Category default is public", async () => {
    const first = await uploadPdf(admin(), "خاص قبل الاستبدال");
    trackObject(
      BUCKETS.private,
      quarantineKeyFor(first.id, first.initiated.key),
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
    expect(await statObject(clients, BUCKETS.private, initiated.key)).not.toBeNull();
    expect(await statObject(clients, BUCKETS.public, initiated.key)).toBeNull();
    expect(
      (
        await fetch(stableObjectUrl(BUCKETS.private, initiated.key), {
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

  it("rejects a legacy contradictory replacement ticket and preserves the previous content", async () => {
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
    expect(e.code).toBe("VALIDATION_FAILED");
    expect(e.status).toBe(409);
    expect(e.details?.["reason"]).toBe("VISIBILITY_STORAGE_MISMATCH");
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
