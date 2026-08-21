import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { issueAccessToken } from "../lib/access-token.js";
import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import { httpCall } from "../test-support/http-client.js";

/**
 * `POST /uploads/initiate` **over real HTTP, through the real router** (TD-3.5).
 *
 * ## Why this file exists, in the words of the failure it reproduces
 *
 * The upload screen returned `404 NOT_FOUND` with an **empty `details`** object
 * for every attempt. Nothing in the service could produce that: every refusal it
 * raises carries a `reason`. The answer was that the route was **not mounted in
 * the running process at all** — a container image built before the routes
 * existed — so the request fell through to the `notFound` middleware, which
 * produces exactly that envelope.
 *
 * **The service tests could not have caught it, and no amount of them would
 * have.** They call `initiateUpload` directly; whether `app.ts` mounts it is a
 * different question, and the only thing that can answer it is a real request to
 * a real router. That is what this file is: the endpoint's *existence* asserted
 * as a property, so a route that is specified, implemented and never wired can
 * never again look identical to one that is wired and refusing.
 *
 * The second assertion below is the other half of the same story. Once the route
 * was reachable, every upload still failed — because the screen offered every
 * Subject in the platform while the server accepts only Subjects the Level
 * actually teaches (R43), and this database had **no `LevelSubject` rows at
 * all**. So the pairing is pinned here too, in both directions.
 *
 * Requires the compose stack, with the api image built from current source:
 *   docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build api
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = "[upload-http-test]";

interface Res {
  status: number;
  body: {
    error?: { code?: string; details?: Record<string, unknown> };
    upload_id?: string;
    key?: string;
    put_url?: string;
  };
}

function bearer(
  userId: string,
  scopes: { role: string; branches: string[] | null }[],
): string {
  return issueAccessToken(
    { userId, roleScopes: scopes as never, accountStatus: "active" as never },
    config.JWT_SIGNING_KEY,
  ).token;
}

let adminId = "";
let token = "";
let branchId = "";
let levelId = "";
let taughtSubjectId = "";
let untaughtSubjectId = "";
let academicYearId = "";

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

  await prisma.educationalContent.deleteMany({
    where: { title: { startsWith: TAG } },
  });
  await prisma.rateLimitCounter.deleteMany({ where: { userId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
  await prisma.levelSubject.deleteMany({ where: { levelId: { in: levels } } });
  await prisma.level.deleteMany({ where: { id: { in: levels } } });
  await prisma.subject.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
}

/** `as: null` is *anonymous*. It cannot be `undefined`: a default parameter is
 *  applied for an explicit `undefined` too, so "no token" would silently become
 *  "the admin token" — which is how a 401 test passes by getting a 201. */
async function initiate(
  body: unknown,
  as: string | null = token,
): Promise<Res> {
  return httpCall<Res["body"]>(BASE, "POST", "/uploads/initiate", {
    ...(as === null ? {} : { token: as }),
    body,
  });
}

/** The payload the upload screen actually sends. */
function payload(over: Record<string, unknown> = {}): unknown {
  return {
    filename: "درس.pdf",
    size: 2048,
    mime: "application/pdf",
    content_meta: {
      level_id: levelId,
      subject_id: taughtSubjectId,
      academic_year_id: academicYearId,
      branch_id: branchId,
      ...over,
    },
  };
}

beforeAll(async () => {
  academicYearId = (
    await prisma.academicYear.findFirstOrThrow({ where: { isCurrent: true } })
  ).id;
});

beforeEach(async () => {
  await clear();

  branchId = (await prisma.branch.create({ data: { name: `${TAG} فرع` } })).id;
  const categoryId = (
    await prisma.category.create({ data: { name: `${TAG} فئة` } })
  ).id;
  levelId = (
    await prisma.level.create({
      data: { name: `${TAG} مستوى`, categoryId, genderRestriction: "any" },
    })
  ).id;
  taughtSubjectId = (
    await prisma.subject.create({ data: { name: `${TAG} مادة مسندة` } })
  ).id;
  untaughtSubjectId = (
    await prisma.subject.create({ data: { name: `${TAG} مادة غريبة` } })
  ).id;
  await prisma.levelSubject.create({
    data: { levelId, subjectId: taughtSubjectId },
  });

  adminId = (
    await prisma.user.create({
      data: { sex: 'female', nameArabic: `${TAG} مديرة`, accountStatus: "active" },
    })
  ).id;
  const role = await prisma.role.findFirstOrThrow({ where: { name: "admin" } });
  await prisma.userBranchRole.create({
    data: { userId: adminId, roleId: role.id, branchId: null },
  });
  token = bearer(adminId, [{ role: "admin", branches: null }]);
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe("the route is mounted (the defect this file was written for)", () => {
  it("answers a valid upload with a ticket, not the unmounted-route 404", async () => {
    const res = await initiate(payload());

    expect(res.status).toBe(201);
    expect(res.body.upload_id).toBeTruthy();
    expect(res.body.put_url).toContain(config.STORAGE_BASE_URL);
    // TD-9's key shape, asserted here because the key is what the browser then
    // PUTs to — a malformed one fails much later and much less clearly.
    expect(res.body.key).toMatch(/^content\/[0-9a-f-]{36}\/[0-9a-f]{8}\//);
  });

  it("never answers NOT_FOUND with empty details — that shape means UNMOUNTED", async () => {
    // The exact signature of the reported bug. Every refusal this endpoint
    // raises names a reason; a bare NOT_FOUND can only have come from the
    // `notFound` middleware, which means the route is not on the router.
    for (const body of [
      payload(),
      payload({ subject_id: untaughtSubjectId }),
      payload({ level_id: "11111111-2222-3333-4444-555555555555" }),
    ]) {
      const res = await initiate(body);
      const isBareNotFound =
        res.body.error?.code === "NOT_FOUND" &&
        Object.keys(res.body.error.details ?? {}).length === 0;
      expect(isBareNotFound, JSON.stringify(res.body)).toBe(false);
    }
  });

  it("still mounts /complete and /abort, which share the failure mode", async () => {
    // A ticket the server refuses, but refuses with a REASON — proving the
    // handler ran rather than the router giving up.
    const complete = await httpCall<Res["body"]>(
      BASE,
      "POST",
      "/uploads/not-a-ticket/complete",
      {
        token,
        body: { title: "x" },
      },
    );
    expect(complete.body.error?.details?.["reason"]).toBe("MALFORMED");

    const abort = await httpCall<Res["body"]>(
      BASE,
      "POST",
      "/uploads/not-a-ticket/abort",
      {
        token,
      },
    );
    expect(abort.body.error?.details?.["reason"]).toBe("MALFORMED");
  });
});

describe("the Level/Subject pairing the screen must respect (R43)", () => {
  it("accepts a Subject the Level teaches", async () => {
    expect((await initiate(payload())).status).toBe(201);
  });

  it("refuses a Subject the Level does not teach, and says which rule", async () => {
    // The second half of the reported failure: with no `LevelSubject` rows, a
    // picker offering every Subject in the platform can only ever produce this.
    const res = await initiate(payload({ subject_id: untaughtSubjectId }));
    expect(res.status).toBe(409);
    expect(res.body.error?.details?.["reason"]).toBe("SUBJECT_NOT_IN_LEVEL");
  });

  it("refuses every Subject once the Level teaches none — the observed database state", async () => {
    await prisma.levelSubject.deleteMany({ where: { levelId } });
    for (const subject of [taughtSubjectId, untaughtSubjectId]) {
      const res = await initiate(payload({ subject_id: subject }));
      expect(res.body.error?.details?.["reason"]).toBe("SUBJECT_NOT_IN_LEVEL");
    }
  });
});

describe("the payload contract (TD-3.5)", () => {
  it("rejects an unknown key rather than ignoring it", async () => {
    // `.strict()` at the boundary: a client sending `content_id` instead of the
    // documented key must be told, not silently given a different upload.
    const res = await initiate({ ...(payload() as object), session_id: "x" });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("VALIDATION_FAILED");
  });

  it("requires branch_id to be PRESENT, so Global is never a silent default", async () => {
    const body = payload() as { content_meta: Record<string, unknown> };
    delete body.content_meta["branch_id"];
    const res = await initiate(body);
    expect(res.status).toBe(400);
  });

  it("refuses a MIME type absent from the TD-9 whitelist, including video", async () => {
    const res = await initiate({
      filename: "clip.mp4",
      size: 2048,
      mime: "video/mp4",
      content_meta: {
        level_id: levelId,
        subject_id: taughtSubjectId,
        academic_year_id: academicYearId,
        branch_id: branchId,
      },
    });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("VALIDATION_FAILED");
  });

  it("answers 401 without a token — the guarded router, not the service", async () => {
    const res = await initiate(payload(), null);
    expect(res.status).toBe(401);
  });
});

/**
 * **R99.12 — the boundary can say *this is a class recording*, and that is all
 * it can say.**
 *
 * R99.10 made «التسجيلات» a function of `origin`, so §4.9's phone-record-and-
 * upload flow needed a way to state what it is or every مؤطِّرة's recording
 * would have become a *material* the day origin-based classification shipped.
 *
 * The field states a fact and **grants nothing**: R99.8 keeps `video/*` refused
 * at `/uploads/*` whatever it says, because TD-9's video row is reachable only
 * by the platform's own ingestion pipeline.
 */
describe("R99.12 — the origin marker at the upload boundary", () => {
  it("accepts `session_recording` on an audio upload", async () => {
    const res = await initiate({
      filename: "الحصة.mp3",
      size: 2048,
      mime: "audio/mpeg",
      content_meta: {
        level_id: levelId,
        subject_id: taughtSubjectId,
        academic_year_id: academicYearId,
        branch_id: branchId,
        origin: "session_recording",
      },
    });
    expect(res.status).toBe(201);
  });

  it("STILL refuses video, marker or no marker — R99.8", async () => {
    // The trap this test exists for: reading `origin` as permission rather than
    // as a description. The whitelist check does not consult it.
    for (const origin of ["uploaded", "session_recording"]) {
      const res = await initiate({
        filename: "الحصة.mp4",
        size: 2048,
        mime: "video/mp4",
        content_meta: {
          level_id: levelId,
          subject_id: taughtSubjectId,
          academic_year_id: academicYearId,
          branch_id: branchId,
          origin,
        },
      });
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe("VALIDATION_FAILED");
    }
  });

  it("refuses an origin that is not one of the two", async () => {
    const res = await initiate(payload({ origin: "livekit" }));
    expect(res.status).toBe(400);
  });

  it("defaults to `uploaded` when the field is absent", async () => {
    const res = await initiate(payload());
    expect(res.status).toBe(201);
    // Proven at `/complete`, which is where the row is written; here the
    // contract is only that omitting the field is legal.
    expect(res.body).toHaveProperty("upload_id");
  });
});
