import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { issueAccessToken } from "../lib/access-token.js";
import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import { httpCall } from "../test-support/http-client.js";
import { roomNameForSession } from "../policies/online-class.js";

/**
 * `POST /sessions/{id}/online-join` over real HTTP (TD-3.12, R98).
 *
 * **What only this layer can prove**, and each of these has been a real defect
 * class on this project:
 *
 * 1. **The wire shape.** A service test cannot see what the DTO omits, and this
 *    project has already shipped a calendar DTO that silently dropped fields
 *    both typecheckers were blind to (R97). The key set is pinned exactly.
 * 2. **No secret crosses the wire.** The API key and secret are configuration;
 *    a response that carried either would be a service test's blind spot and a
 *    catastrophic one.
 * 3. **`X-Active-Child-ID` is honoured on THIS route.** The middleware is
 *    deliberately not mounted here, so *"the header is read"* is a property of
 *    the controller rather than of the router — the kind of thing that is true
 *    until somebody removes one line.
 * 4. **A forged body is refused by the boundary**, not ignored by a service.
 *
 * Requires the compose stack, with the api image built from current source:
 *   docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build api
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = "[http-join-test]";

/**
 * **The whole response, pinned.**
 *
 * Growing this list is a deliberate act. Shrinking it silently is the defect —
 * and *adding* to it silently is how a room name, a provider identifier or a
 * key would reach a browser without anybody deciding it should.
 */
const JOIN_KEYS = [
  "closes_at",
  "display_name",
  "expires_at",
  "media_mode",
  "role",
  "session_id",
  "token",
  "url",
];

interface Res {
  status: number;
  body: Record<string, unknown> & {
    data?: Record<string, unknown>;
    error?: { code?: string; details?: Record<string, unknown> };
  };
}

async function call(
  path: string,
  token?: string,
  body?: unknown,
  activeChildId?: string,
): Promise<Res> {
  return httpCall<Res["body"]>(BASE, "POST", path, {
    token,
    ...(body !== undefined ? { body } : {}),
    ...(activeChildId ? { headers: { "X-Active-Child-ID": activeChildId } } : {}),
  });
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

let branchId: string;
let levelId: string;
let subjectId: string;
let academicYearId: string;
let onlineSessionId: string;
let inPersonSessionId: string;
let studentId: string;
let studentToken: string;
let parentId: string;
let parentToken: string;
let strangerId: string;
let strangerToken: string;

/** The class runs today, so the live server's own clock is inside the window —
 *  this endpoint is deliberately not time-injectable over HTTP. */
const today = new Date();
const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

async function makeUser(label: string, role?: string): Promise<string> {
  const user = await prisma.user.create({
    data: { sex: "female", nameArabic: `${TAG} ${label}`, accountStatus: "active" },
  });
  if (role) {
    const row = await prisma.role.findFirstOrThrow({
      where: { name: role },
      select: { id: true },
    });
    await prisma.userBranchRole.create({
      data: { userId: user.id, roleId: row.id, branchId },
    });
  }
  return user.id;
}

async function clear(): Promise<void> {
  const schedules = await prisma.recurringCourseSchedule.findMany({
    where: { branch: { name: { startsWith: TAG } } },
    select: { id: true },
  });
  const ids = schedules.map((s) => s.id);
  await prisma.sessionAudienceBranch.deleteMany({
    where: { session: { scheduleId: { in: ids } } },
  });
  await prisma.sessionStaff.deleteMany({ where: { session: { scheduleId: { in: ids } } } });
  await prisma.notification.deleteMany({ where: { session: { scheduleId: { in: ids } } } });
  await prisma.session.deleteMany({ where: { scheduleId: { in: ids } } });
  await prisma.courseScheduleStaff.deleteMany({ where: { scheduleId: { in: ids } } });
  await prisma.recurringCourseSchedule.deleteMany({ where: { id: { in: ids } } });

  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  await prisma.familyLink.deleteMany({ where: { parentId: { in: userIds } } });
  await prisma.enrollment.deleteMany({ where: { studentId: { in: userIds } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: userIds } } });
  if (userIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  }
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });

  await prisma.levelSubject.deleteMany({ where: { level: { name: { startsWith: TAG } } } });
  await prisma.level.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.subject.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.room.deleteMany({ where: { branch: { name: { startsWith: TAG } } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  const health = await fetch(`${config.PUBLIC_BASE_URL}/healthz`).catch(() => null);
  if (!health || health.status !== 200) {
    throw new Error(
      `API not reachable at ${config.PUBLIC_BASE_URL}/healthz — run: ` +
        "docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build api",
    );
  }
  await clear();

  branchId = (await prisma.branch.create({ data: { name: `${TAG} فرع` } })).id;
  const category = await prisma.category.create({ data: { name: `${TAG} فئة` } });
  levelId = (
    await prisma.level.create({
      data: { name: `${TAG} مستوى`, categoryId: category.id, genderRestriction: "any" },
    })
  ).id;
  subjectId = (await prisma.subject.create({ data: { name: `${TAG} مادة` } })).id;
  await prisma.levelSubject.create({ data: { levelId, subjectId } });
  // The seeded academic year, not a fabricated one: this suite is about the
  // wire, and a fixture that invents reference data is a fixture that breaks
  // when the reference data changes shape.
  academicYearId = (
    await prisma.academicYear.findFirstOrThrow({ select: { id: true } })
  ).id;

  /**
   * Sessions are written directly rather than through `createCourseSchedule`,
   * deliberately: this suite is about the **wire**, and materializing a
   * recurrence to land on today would make the fixture the interesting part.
   * The occurrence runs from an hour ago to an hour ahead, so the server's own
   * clock is inside the window whenever the suite runs.
   */
  const schedule = await prisma.recurringCourseSchedule.create({
    data: {
      title: `${TAG} حلقة`,
      subjectId,
      teachingMode: "entire_level",
      levelId,
      branchId,
      startTime: new Date(Date.UTC(1970, 0, 1, 0, 0, 0)),
      endTime: new Date(Date.UTC(1970, 0, 1, 23, 59, 0)),
      recurrence: "weekly",
      weekdays: ["monday"],
      anchorDate: new Date(isoDay(today)),
      academicYearId,
      deliveryMode: "online",
      onlineMediaMode: "audio_only",
    },
  });
  onlineSessionId = (
    await prisma.session.create({
      data: {
        scheduleId: schedule.id,
        date: new Date(isoDay(today)),
        startTime: new Date(Date.UTC(1970, 0, 1, 0, 0, 0)),
        endTime: new Date(Date.UTC(1970, 0, 1, 23, 59, 0)),
        deliveryMode: "online",
        onlineMediaMode: "audio_only",
      },
    })
  ).id;

  const physical = await prisma.recurringCourseSchedule.create({
    data: {
      title: `${TAG} حلقة حضورية`,
      subjectId,
      teachingMode: "entire_level",
      levelId,
      branchId,
      startTime: new Date(Date.UTC(1970, 0, 1, 0, 0, 0)),
      endTime: new Date(Date.UTC(1970, 0, 1, 23, 59, 0)),
      recurrence: "weekly",
      weekdays: ["monday"],
      anchorDate: new Date(isoDay(today)),
      academicYearId,
    },
  });
  inPersonSessionId = (
    await prisma.session.create({
      data: {
        scheduleId: physical.id,
        date: new Date(isoDay(today)),
        startTime: new Date(Date.UTC(1970, 0, 1, 0, 0, 0)),
        endTime: new Date(Date.UTC(1970, 0, 1, 23, 59, 0)),
      },
    })
  ).id;

  studentId = await makeUser("مستفيدة", "student");
  await prisma.enrollment.create({ data: { studentId, levelId, branchId } });
  studentToken = bearer(studentId, [{ role: "student", branches: [branchId] }]);

  strangerId = await makeUser("غريبة", "student");
  strangerToken = bearer(strangerId, [{ role: "student", branches: [branchId] }]);

  parentId = await makeUser("الوالدة", "parent");
  parentToken = bearer(parentId, [{ role: "parent", branches: [branchId] }]);
  await prisma.familyLink.create({
    data: { parentId, studentId, status: "approved" },
  });
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe("POST /sessions/{id}/online-join", () => {
  it("answers exactly the pinned key set, and no secret", async () => {
    const res = await call(`/sessions/${onlineSessionId}/online-join`, studentToken, {});
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data ?? {}).sort()).toEqual(JOIN_KEYS);

    // The configuration secrets never cross the wire — asserted against the
    // WHOLE serialized body, not field by field, so a future field cannot
    // smuggle one in.
    const wire = JSON.stringify(res.body);
    expect(wire).not.toContain(config.LIVEKIT_API_SECRET ?? "@@unset@@");
    expect(wire).not.toContain(config.LIVEKIT_API_KEY ?? "@@unset@@");
    // And no room identifier is published, even though one exists (R98.2).
    expect(wire).not.toContain(roomNameForSession(onlineSessionId));
  });

  it("names the caller and the class's media mode", async () => {
    const res = await call(`/sessions/${onlineSessionId}/online-join`, studentToken, {});
    expect(res.body.data?.["media_mode"]).toBe("audio_only");
    expect(res.body.data?.["role"]).toBe("student");
    expect(res.body.data?.["session_id"]).toBe(onlineSessionId);
    expect(typeof res.body.data?.["token"]).toBe("string");
  });

  it("mints for the CHILD when a guardian names one (R98.6)", async () => {
    const res = await call(
      `/sessions/${onlineSessionId}/online-join`,
      parentToken,
      {},
      studentId,
    );
    expect(res.status).toBe(200);
    // The credential's subject is the child. Decoded, never printed.
    const token = res.body.data?.["token"] as string;
    const claims = JSON.parse(
      Buffer.from(token.split(".")[1]!, "base64url").toString("utf8"),
    ) as { sub?: string };
    expect(claims.sub).toBe(studentId);
    expect(claims.sub).not.toBe(parentId);
  });

  it("refuses a guardian naming an unrelated child — 404 (§4.3)", async () => {
    const res = await call(
      `/sessions/${onlineSessionId}/online-join`,
      parentToken,
      {},
      strangerId,
    );
    expect(res.status).toBe(404);
  });

  it("refuses an unrelated beneficiary — 404, never 403", async () => {
    const res = await call(`/sessions/${onlineSessionId}/online-join`, strangerToken, {});
    expect(res.status).toBe(404);
  });

  it("refuses an in-person occurrence with a domain reason", async () => {
    const res = await call(`/sessions/${inPersonSessionId}/online-join`, studentToken, {});
    expect(res.status).toBe(409);
    expect(res.body.error?.details?.["reason"]).toBe("NOT_ONLINE");
  });

  it("refuses a body that names an identity, a role or a room", async () => {
    for (const forged of [
      { identity: strangerId },
      { role: "teacher" },
      { room: "bodour-anything" },
      { student_id: strangerId },
      { can_publish: true },
    ]) {
      const res = await call(
        `/sessions/${onlineSessionId}/online-join`,
        studentToken,
        forged,
      );
      expect({ forged, status: res.status, code: res.body.error?.code }).toEqual({
        forged,
        status: 400,
        code: "VALIDATION_FAILED",
      });
    }
  });

  it("requires authentication — an anonymous caller gets no credential", async () => {
    const res = await call(`/sessions/${onlineSessionId}/online-join`, undefined, {});
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toContain("token");
  });

  it("is idempotent — repeating it changes nothing about the occurrence", async () => {
    const before = await prisma.session.findUniqueOrThrow({
      where: { id: onlineSessionId },
      select: { version: true, overridden: true, updatedAt: true },
    });
    await call(`/sessions/${onlineSessionId}/online-join`, studentToken, {});
    await call(`/sessions/${onlineSessionId}/online-join`, studentToken, {});
    const after = await prisma.session.findUniqueOrThrow({
      where: { id: onlineSessionId },
      select: { version: true, overridden: true, updatedAt: true },
    });
    expect(after).toEqual(before);
  });
});

/**
 * **R99 — the provider callback, over real HTTP** (R99.15).
 *
 * This is the platform's only unauthenticated-by-session route, so what it
 * *refuses* is the whole of its specification. Every case below is an attempt
 * to make it do something, and the assertion is that nothing happened.
 *
 * It runs against the live container, which is the only place the raw-body
 * mounting is real: `express.json` would have consumed the stream long before a
 * service test could notice, and every genuine callback would fail
 * verification while this suite passed.
 */
describe("POST /integrations/online-class/callback", () => {
  const CALLBACK = "/integrations/online-class/callback";

  async function post(body: string, authHeader?: string): Promise<number> {
    const res = await fetch(`${BASE}${CALLBACK}`, {
      method: "POST",
      headers: {
        "content-type": "application/webhook+json",
        ...(authHeader ? { authorization: authHeader } : {}),
      },
      body,
    });
    return res.status;
  }

  it("accepts the request and creates NOTHING when unsigned", async () => {
    const before = await prisma.sessionRecording.count();
    const status = await post(
      JSON.stringify({
        event: "egress_ended",
        egressInfo: { egressId: "EG_unsigned", status: 3 },
      }),
    );
    // 204 rather than 401: a distinguishable refusal tells a prober its guess
    // was wrong, and a provider retrying forever against a 4xx it cannot fix is
    // worse than a silent discard.
    expect(status).toBe(204);
    expect(await prisma.sessionRecording.count()).toBe(before);
  });

  it("refuses a forged signature", async () => {
    const before = await prisma.sessionRecording.count();
    const status = await post(
      JSON.stringify({
        event: "egress_ended",
        egressInfo: { egressId: "EG_forged", status: 3 },
      }),
      "Bearer not.a.real.signature",
    );
    expect(status).toBe(204);
    expect(await prisma.sessionRecording.count()).toBe(before);
  });

  it("cannot manufacture a recording out of nothing", async () => {
    // Even a perfectly-shaped payload names an egress id this platform never
    // started, so there is nothing to update and nothing to create. An
    // arbitrary external request must not become educational content — and in
    // C1 it cannot even become a recording row.
    const before = await prisma.sessionRecording.count();
    await post(
      JSON.stringify({
        event: "egress_ended",
        egressInfo: {
          egressId: "EG_nobody_started_this",
          status: 3,
          fileResults: [{ filename: "anything.mp4", size: "999" }],
        },
      }),
      "Bearer forged",
    );
    expect(await prisma.sessionRecording.count()).toBe(before);
  });

  it("never creates educational content, whatever it is sent", async () => {
    const before = await prisma.educationalContent.count();
    await post(
      JSON.stringify({
        event: "egress_ended",
        egressInfo: { egressId: "EG_x", status: 3, fileResults: [{ filename: "x.mp4" }] },
      }),
      "Bearer forged",
    );
    expect(await prisma.educationalContent.count()).toBe(before);
  });
});

/**
 * **R99 — recording authority over real HTTP.**
 *
 * The service suite proves the rules; this proves the ROUTES enforce them, and
 * that the read is deliberately wider than the write.
 */
describe("the recording routes", () => {
  it("refuses a beneficiary's start with 403 and a reason she can be told", async () => {
    const res = await call(`/sessions/${onlineSessionId}/recording`, studentToken, {});
    expect(res.status).toBe(403);
    expect(res.body.error?.details?.["reason"]).toBe("RECORDING_NOT_PERMITTED");
  });

  it("but LETS her read the state — transparency is not authority (R99.5)", async () => {
    const res = await httpCall<Res["body"]>(
      BASE,
      "GET",
      `/sessions/${onlineSessionId}/recording`,
      { token: studentToken },
    );
    expect(res.status).toBe(200);
    // Nothing was ever recorded for this fixture, and `null` is a real answer.
    expect(res.body.data ?? null).toBeNull();
  });

  it("refuses an unrelated beneficiary entirely — 404", async () => {
    const res = await httpCall<Res["body"]>(
      BASE,
      "GET",
      `/sessions/${onlineSessionId}/recording`,
      { token: strangerToken },
    );
    expect(res.status).toBe(404);
  });

  it("refuses a body that names a format — the class decides (R99.7)", async () => {
    const res = await call(`/sessions/${onlineSessionId}/recording`, studentToken, {
      media_mode: "audio_video",
    });
    expect({ status: res.status, code: res.body.error?.code }).toEqual({
      status: 400,
      code: "VALIDATION_FAILED",
    });
  });
});
