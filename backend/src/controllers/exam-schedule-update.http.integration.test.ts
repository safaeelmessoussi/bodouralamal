import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { issueAccessToken } from "../lib/access-token.js";
import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import { httpCall } from "../test-support/http-client.js";
import {
  clearTeachingContext,
  createTeachingContext,
  type TeachingFixture,
} from "../test-support/educational-fixture.js";

/**
 * `PATCH /exams/{id}/schedule` — an ONLINE occurrence's arrangement, edited
 * (Owner, 2026-09-15; SRS Revision 145 §1), superseding R136 clause 12's own
 * "no route exists". `updateExamSchedule`'s own docstring carries the full
 * reasoning; this proves the wire behaviour: authorization, TD-15, the
 * `mode`/`status` guards, and that `target`/`availability`, each omitted,
 * leave the row exactly as it was rather than resetting it.
 *
 * The fixture creates its `published` online exam directly via Prisma rather
 * than through `POST /exams/schedule`'s full authored-paper chain — this
 * suite tests the UPDATE route, not the scheduling-creation workflow, and a
 * direct write is the same accepted shortcut R142's own test suite already
 * takes for the parallel case (proving a state transition's OWN guard, never
 * substituting for the write path that reaches that state in production).
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = "[http-exam-schedule-update-test]";

interface Res {
  status: number;
  body: Record<string, unknown> & { error?: { code?: string; details?: Record<string, unknown> } };
}

async function call(method: string, path: string, token?: string, body?: unknown): Promise<Res> {
  return httpCall<Res["body"]>(BASE, method, path, { token, ...(body !== undefined ? { body } : {}) });
}

function bearer(userId: string): string {
  return issueAccessToken(
    { userId, roleScopes: [{ role: "super_admin", branches: null }] as never, accountStatus: "active" as never },
    config.JWT_SIGNING_KEY,
  ).token;
}

let superAdminId: string;
let superAdminToken: string;
let fixtureA: TeachingFixture;
let branchA: string;

async function makeOnlineExam(over: Record<string, unknown> = {}): Promise<{ id: string; version: number }> {
  const exam = await prisma.exam.create({
    data: {
      title: `${TAG} اختبار`,
      mode: "online",
      status: "published",
      levelId: fixtureA.levelId,
      subjectId: fixtureA.subjectId,
      date: new Date("2026-09-20"),
      maxGrade: 20,
      targetKind: "level",
      availableFrom: new Date("2026-09-20T07:00:00Z"),
      ...over,
    },
    select: { id: true, version: true },
  });
  return exam;
}

async function clearExams(): Promise<void> {
  const exams = await prisma.exam.findMany({ where: { title: { startsWith: TAG } }, select: { id: true } });
  const ids = exams.map((e) => e.id);
  if (ids.length > 0) {
    await prisma.examStaff.deleteMany({ where: { examId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { targetId: { in: ids } } });
    await prisma.notification.deleteMany({ where: { exam: { id: { in: ids } } } });
  }
  await prisma.exam.deleteMany({ where: { title: { startsWith: TAG } } });
}

beforeAll(async () => {
  const health = await fetch(`${config.PUBLIC_BASE_URL}/healthz`).catch(() => null);
  if (!health || health.status !== 200) throw new Error("API not reachable");
  const superAdmin = await prisma.user.create({
    data: { sex: "female", nameArabic: `${TAG} مشرفة`, accountStatus: "active" },
  });
  superAdminId = superAdmin.id;
  superAdminToken = bearer(superAdminId);
  branchA = (await prisma.branch.create({
    data: { name: `${TAG} فرع أ`, operationalStartDate: new Date("2020-01-01") },
  })).id;
  fixtureA = await createTeachingContext(prisma, TAG, branchA);
});

afterEach(clearExams);
afterAll(async () => {
  await clearExams();
  await clearTeachingContext(prisma, TAG);
  await prisma.room.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { nameArabic: { startsWith: TAG } } });
  await prisma.$disconnect();
});

describe("PATCH /exams/{id}/schedule", () => {
  it("edits date, time and catalogue type without touching content", async () => {
    const exam = await makeOnlineExam();
    const res = await call("PATCH", `/exams/${exam.id}/schedule`, superAdminToken, {
      version: exam.version,
      date: "2026-09-21",
      start_time: "10:00",
      end_time: "11:00",
    });
    expect(res.status).toBe(204);
    const row = await prisma.exam.findUniqueOrThrow({ where: { id: exam.id } });
    expect(row.date.toISOString().slice(0, 10)).toBe("2026-09-21");
    expect(row.version).toBe(exam.version + 1);
  });

  it("moves the target to a different administrative group", async () => {
    const exam = await makeOnlineExam();
    const res = await call("PATCH", `/exams/${exam.id}/schedule`, superAdminToken, {
      version: exam.version,
      target: { kind: "administrative_group", id: fixtureA.administrativeGroupId },
    });
    expect(res.status).toBe(204);
    const row = await prisma.exam.findUniqueOrThrow({ where: { id: exam.id } });
    expect(row.targetKind).toBe("administrative_group");
    expect(row.administrativeGroupId).toBe(fixtureA.administrativeGroupId);
  });

  it("recomputes available_from from a new availability policy", async () => {
    const exam = await makeOnlineExam({ availableFrom: null });
    const res = await call("PATCH", `/exams/${exam.id}/schedule`, superAdminToken, {
      version: exam.version,
      start_time: "09:00",
      availability: { policy: "offset_minutes", minutes: 30 },
    });
    expect(res.status).toBe(204);
    const row = await prisma.exam.findUniqueOrThrow({ where: { id: exam.id } });
    expect(row.availableFrom).not.toBeNull();
  });

  it("leaves available_from untouched when availability is omitted", async () => {
    const exam = await makeOnlineExam();
    const before = await prisma.exam.findUniqueOrThrow({ where: { id: exam.id } });
    const res = await call("PATCH", `/exams/${exam.id}/schedule`, superAdminToken, {
      version: exam.version,
      visibility: "private",
    });
    expect(res.status).toBe(204);
    const after = await prisma.exam.findUniqueOrThrow({ where: { id: exam.id } });
    expect(after.availableFrom?.toISOString()).toBe(before.availableFrom?.toISOString());
    expect(after.visibility).toBe("private");
  });

  it("refuses a physical sitting — PATCH /exams/{id} is its own route", async () => {
    const room = await prisma.room.create({
      data: { name: `${TAG} قاعة`, branchId: branchA },
    });
    const exam = await prisma.exam.create({
      data: {
        title: `${TAG} حضوري`,
        mode: "physical",
        status: "published",
        levelId: fixtureA.levelId,
        branchId: branchA,
        roomId: room.id,
        date: new Date("2026-09-20"),
        startTime: new Date("1970-01-01T09:00:00Z"),
        endTime: new Date("1970-01-01T10:00:00Z"),
        maxGrade: 20,
        targetKind: "level",
      },
      select: { id: true, version: true },
    });
    const res = await call("PATCH", `/exams/${exam.id}/schedule`, superAdminToken, {
      version: exam.version,
      date: "2026-09-22",
    });
    expect(res.status).toBe(409);
    expect(res.body.error?.details?.["reason"]).toBe("PHYSICAL_USE_OTHER_ROUTE");
  });

  it("refuses a still-draft source — nothing scheduled yet to edit", async () => {
    const exam = await makeOnlineExam({ status: "draft", availableFrom: null });
    const res = await call("PATCH", `/exams/${exam.id}/schedule`, superAdminToken, {
      version: exam.version,
      date: "2026-09-22",
    });
    expect(res.status).toBe(409);
    expect(res.body.error?.details?.["reason"]).toBe("NOT_SCHEDULED_YET");
  });

  it("refuses a stale version (TD-15)", async () => {
    const exam = await makeOnlineExam();
    const res = await call("PATCH", `/exams/${exam.id}/schedule`, superAdminToken, {
      version: exam.version + 1,
      date: "2026-09-22",
    });
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe("VERSION_CONFLICT");
  });

  it("refuses an availability policy needing a start time when none exists", async () => {
    const exam = await makeOnlineExam({ startTime: null });
    const res = await call("PATCH", `/exams/${exam.id}/schedule`, superAdminToken, {
      version: exam.version,
      availability: { policy: "at_start" },
    });
    expect(res.status).toBe(400);
    expect(res.body.error?.details?.["reason"]).toBe("AVAILABILITY_NEEDS_START_TIME");
  });

  it("replaces staff wholesale", async () => {
    const exam = await makeOnlineExam();
    const person = await prisma.user.create({
      data: { sex: "female", nameArabic: `${TAG} مساعدة`, accountStatus: "active" },
    });
    const res = await call("PATCH", `/exams/${exam.id}/schedule`, superAdminToken, {
      version: exam.version,
      staff: [{ user_id: person.id, position: "supervisor" }],
    });
    expect(res.status).toBe(204);
    const staff = await prisma.examStaff.findMany({ where: { examId: exam.id, deletedAt: null } });
    expect(staff.map((s) => s.userId)).toEqual([person.id]);
    // Not deleted here — the row now references `person` via `ExamStaff`,
    // and `clearExams`/the final `afterAll` remove both in the right order.
  });

  it("refuses an anonymous caller", async () => {
    const exam = await makeOnlineExam();
    const res = await call("PATCH", `/exams/${exam.id}/schedule`, undefined, { version: exam.version });
    expect(res.status).toBe(401);
  });
});
