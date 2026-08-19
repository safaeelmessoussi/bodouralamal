import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { issueAccessToken } from "../lib/access-token.js";
import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import { httpCall } from "../test-support/http-client.js";

/**
 * **The teaching profile (§E, SRS Revision 88).**
 *
 * The property this file exists for is the one the Owner named first and twice:
 *
 *     CAPABILITY / AVAILABILITY  ≠  AUTHORIZATION
 *
 * A مؤطِّرة may declare every Subject in the curriculum and be free all week; it
 * reaches no beneficiary, no memorisation, no grade and no content. Only an
 * assignment does that, and it does so **whether or not she declared the
 * Subject**. Both halves are asserted below, because a separation only stated
 * in prose is one a later refactor will quietly close.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = "[r88-profile-test]";

interface Res {
  status: number;
  body: Record<string, unknown> & {
    error?: { code?: string; details?: Record<string, unknown> };
    data?: Record<string, unknown>;
  };
}

const call = (method: string, path: string, token?: string, body?: unknown) =>
  httpCall<Res["body"]>(BASE, method, path, {
    token,
    ...(body !== undefined ? { body } : {}),
  }) as Promise<Res>;

const bearer = (userId: string, roles: { role: string; branches: string[] | null }[]) =>
  issueAccessToken(
    { userId, roleScopes: roles as never, accountStatus: "active" as never },
    config.JWT_SIGNING_KEY,
  ).token;

let adminToken: string;
let teacherId: string;
let teacherToken: string;
let quranSubject: string;
let tafseerSubject: string;
let womenCategory: string;

async function clear(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await prisma.teacherSubjectCapability.deleteMany({ where: { userId: { in: ids } } });
  await prisma.teacherCategoryCapability.deleteMany({ where: { userId: { in: ids } } });
  await prisma.teacherAvailability.deleteMany({ where: { userId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { targetId: { in: ids } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.teacherSubjectCapability.deleteMany({
    where: { subject: { name: { startsWith: TAG } } },
  });
  // The Subject is linked to a real Level by the last test; the join is
  // RESTRICT, so it goes first.
  await prisma.levelSubject.deleteMany({ where: { subject: { name: { startsWith: TAG } } } });
  const schedules = await prisma.recurringCourseSchedule.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true },
  });
  await prisma.courseScheduleStaff.deleteMany({
    where: { scheduleId: { in: schedules.map((x) => x.id) } },
  });
  await prisma.recurringCourseSchedule.deleteMany({
    where: { id: { in: schedules.map((x) => x.id) } },
  });
  await prisma.subject.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.teacherCategoryCapability.deleteMany({
    where: { category: { name: { startsWith: TAG } } },
  });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  const health = await fetch(`${config.PUBLIC_BASE_URL}/healthz`).catch(() => null);
  if (!health || health.status !== 200) throw new Error("API not reachable");
  await clear();

  // Its own reference data: the marker and the names are what the assertions
  // turn on, and a fixture that hunts finds a different answer per machine.
  quranSubject = (
    await prisma.subject.create({
      data: { name: `${TAG} حفظ القران`, displayOrder: 80, tracksQuranProgress: true },
    })
  ).id;
  tafseerSubject = (
    await prisma.subject.create({ data: { name: `${TAG} تفسير`, displayOrder: 81 } })
  ).id;
  womenCategory = (
    await prisma.category.create({ data: { name: `${TAG} المرأة`, displayOrder: 80 } })
  ).id;

  const admin = await prisma.user.create({
    data: { nameArabic: `${TAG} مديرة`, sex: "female", accountStatus: "active" },
  });
  const role = await prisma.role.findFirstOrThrow({ where: { name: "super_admin" } });
  await prisma.userBranchRole.create({
    data: { userId: admin.id, roleId: role.id, branchId: null },
  });
  adminToken = bearer(admin.id, [{ role: "super_admin", branches: null }]);

  const teacher = await prisma.user.create({
    data: { nameArabic: `${TAG} صفاء`, sex: "female", accountStatus: "active" },
  });
  teacherId = teacher.id;
  teacherToken = bearer(teacher.id, [{ role: "teacher", branches: null }]);
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.teacherSubjectCapability.deleteMany({ where: { userId: teacherId } });
  await prisma.teacherCategoryCapability.deleteMany({ where: { userId: teacherId } });
  await prisma.teacherAvailability.deleteMany({ where: { userId: teacherId } });
});

const profile = (over: Record<string, unknown> = {}) => ({
  subject_ids: [tafseerSubject, quranSubject],
  category_ids: [womenCategory],
  availability: [
    { weekday: "monday", start_time: "10:00", end_time: "12:00" },
    { weekday: "thursday", start_time: "15:00", end_time: "18:00" },
  ],
  ...over,
});

/* ── the contract ───────────────────────────────────────────────────────── */

describe("an administrator records what a مؤطِّرة can teach, and when", () => {
  it("starts empty — nothing is inferred from her history (R88.16)", async () => {
    const res = await call("GET", `/admin/users/${teacherId}/teaching-profile`, adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ subjects: [], categories: [], availability: [] });
  });

  it("records several Subjects, several Categories and several ranges", async () => {
    const saved = await call(
      "PUT",
      `/admin/users/${teacherId}/teaching-profile`,
      adminToken,
      profile(),
    );
    expect(saved.status).toBe(200);

    const read = await call("GET", `/admin/users/${teacherId}/teaching-profile`, adminToken);
    const data = read.body.data as unknown as {
      subjects: { id: string }[];
      categories: { id: string }[];
      availability: { weekday: string; start_time: string; end_time: string }[];
    };
    expect(data.subjects.map((s) => s.id).sort()).toEqual([tafseerSubject, quranSubject].sort());
    expect(data.categories).toHaveLength(1);
    expect(data.availability).toHaveLength(2);
    // Wall-clock, round-tripped exactly — `TIME(0)` would truncate seconds, so
    // the boundary refuses them rather than storing something else.
    expect(data.availability.map((a) => a.start_time).sort()).toEqual(["10:00", "15:00"]);
  });

  it("REPLACES rather than merges — the profile means «this is it now»", async () => {
    await call("PUT", `/admin/users/${teacherId}/teaching-profile`, adminToken, profile());
    await call(
      "PUT",
      `/admin/users/${teacherId}/teaching-profile`,
      adminToken,
      profile({ subject_ids: [tafseerSubject], availability: [] }),
    );
    const read = await call("GET", `/admin/users/${teacherId}/teaching-profile`, adminToken);
    const data = read.body.data as unknown as { subjects: unknown[]; availability: unknown[] };
    expect(data.subjects).toHaveLength(1);
    expect(data.availability).toHaveLength(0);
  });

  it("collapses a Subject named twice — repetition is not a second declaration", async () => {
    const res = await call(
      "PUT",
      `/admin/users/${teacherId}/teaching-profile`,
      adminToken,
      profile({ subject_ids: [tafseerSubject, tafseerSubject] }),
    );
    expect(res.status).toBe(200);
    expect((res.body.data as unknown as { subjects: unknown[] }).subjects).toHaveLength(1);
  });
});

/* ── validation ─────────────────────────────────────────────────────────── */

describe("the planning data is validated where it is written", () => {
  it("refuses a range that ends before it starts", async () => {
    const res = await call("PUT", `/admin/users/${teacherId}/teaching-profile`, adminToken, {
      ...profile(),
      availability: [{ weekday: "monday", start_time: "12:00", end_time: "10:00" }],
    });
    expect(res.status).toBe(400);
  });

  it("refuses OVERLAPPING ranges on one day, naming the clash", async () => {
    // Two readings exist for what an overlap means and neither is canonical, so
    // the platform asks rather than guessing.
    const res = await call("PUT", `/admin/users/${teacherId}/teaching-profile`, adminToken, {
      ...profile(),
      availability: [
        { weekday: "monday", start_time: "09:00", end_time: "12:00" },
        { weekday: "monday", start_time: "11:00", end_time: "13:00" },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.error?.details?.["reason"]).toBe("OVERLAPPING_AVAILABILITY");
  });

  it("ACCEPTS exactly touching ranges — that is how she says «all morning»", async () => {
    const res = await call("PUT", `/admin/users/${teacherId}/teaching-profile`, adminToken, {
      ...profile(),
      availability: [
        { weekday: "monday", start_time: "09:00", end_time: "12:00" },
        { weekday: "monday", start_time: "12:00", end_time: "15:00" },
      ],
    });
    expect(res.status).toBe(200);
  });

  it("refuses a Subject that does not exist rather than dropping it silently", async () => {
    const res = await call("PUT", `/admin/users/${teacherId}/teaching-profile`, adminToken, {
      ...profile(),
      subject_ids: ["00000000-0000-4000-8000-000000000000"],
    });
    expect(res.status).toBe(400);
    expect(res.body.error?.details?.["reason"]).toBe("UNKNOWN_SUBJECT");
  });

  it("refuses an unknown key rather than ignoring it", async () => {
    const res = await call("PUT", `/admin/users/${teacherId}/teaching-profile`, adminToken, {
      ...profile(),
      grants_quran_access: true,
    });
    expect(res.status).toBe(400);
  });
});

/* ── who owns it ────────────────────────────────────────────────────────── */

describe("the administration owns planning data (R88.2)", () => {
  it("refuses the مؤطِّرة editing her own profile — not supported in this slice", async () => {
    const res = await call(
      "PUT",
      `/admin/users/${teacherId}/teaching-profile`,
      teacherToken,
      profile(),
    );
    expect(res.status).toBe(403);
  });

  it("refuses her reading it too, and refuses an anonymous caller", async () => {
    expect((await call("GET", `/admin/users/${teacherId}/teaching-profile`, teacherToken)).status).toBe(
      403,
    );
    expect((await call("GET", `/admin/users/${teacherId}/teaching-profile`)).status).toBe(401);
  });
});

/* ── THE property: capability is not authorization ──────────────────────── */

describe("capability grants NOTHING operationally (R88.3)", () => {
  beforeEach(async () => {
    // Everything declared: every Subject including Quran, the women's Category,
    // free all week. If declaring were enough, this is where it would show.
    await call("PUT", `/admin/users/${teacherId}/teaching-profile`, adminToken, profile());
  });

  it("does not put a single beneficiary in her Quran roster", async () => {
    const res = await call("GET", "/quran-students", teacherToken);
    expect(res.status).toBe(200);
    expect(res.body.data as unknown as unknown[]).toHaveLength(0);
  });

  it("does not make her a Quran teacher in the platform's own answer", async () => {
    // R87 §M's structural marker: it reads ASSIGNMENTS, and she has none.
    const me = await call("GET", "/me", teacherToken);
    expect((me.body as unknown as { teaches_quran: boolean }).teaches_quran).toBe(false);
  });

  it("puts no CLASS in her personal calendar", async () => {
    /**
     * **Sessions, not every occurrence** — and the distinction is R82.7's, not
     * a weakening.
     *
     * A **global** Event (one with no scope rows) is on everybody's calendar by
     * design: visible to all, notified to none. Asserting an empty array made
     * this test fail on a database that happens to hold one, and would have
     * been asserting something the platform deliberately does not promise.
     * What capability must not produce is a **teaching** occurrence, which is
     * exactly a session.
     */
    const res = await call("GET", "/me/calendar?from=2026-08-01&to=2026-08-31", teacherToken);
    expect(res.status).toBe(200);
    const rows = res.body.data as unknown as { kind: string }[];
    expect(rows.filter((o) => o.kind === "session")).toHaveLength(0);
  });

  it("and declaring nothing does not remove authority either — assignment decides", async () => {
    // The converse, which matters just as much: the administration may assign a
    // Subject she never declared — a warning at planning time, not a refusal —
    // and the assignment then carries full authority.
    await call("PUT", `/admin/users/${teacherId}/teaching-profile`, adminToken, {
      subject_ids: [],
      category_ids: [],
      availability: [],
    });

    const level = await prisma.level.findFirstOrThrow({ where: { deletedAt: null } });
    const branch = await prisma.branch.findFirstOrThrow({
      where: { deletedAt: null, rooms: { some: { deletedAt: null } } },
    });
    const room = await prisma.room.findFirstOrThrow({ where: { branchId: branch.id } });
    const year = await prisma.academicYear.findFirstOrThrow();
    await prisma.levelSubject.upsert({
      where: { levelId_subjectId: { levelId: level.id, subjectId: quranSubject } },
      create: { levelId: level.id, subjectId: quranSubject },
      update: {},
    });

    const schedule = await prisma.recurringCourseSchedule.create({
      data: {
        title: `${TAG} حلقة`,
        subjectId: quranSubject,
        teachingMode: "entire_level",
        levelId: level.id,
        branchId: branch.id,
        roomId: room.id,
        academicYearId: year.id,
        startTime: new Date("1970-01-01T09:00:00Z"),
        endTime: new Date("1970-01-01T10:00:00Z"),
        recurrence: "weekly",
        weekdays: ["monday"],
        anchorDate: new Date("2099-01-05T00:00:00Z"),
      },
      select: { id: true },
    });
    await prisma.courseScheduleStaff.create({
      data: { scheduleId: schedule.id, userId: teacherId, position: "teacher" },
    });

    const me = await call("GET", "/me", teacherToken);
    expect((me.body as unknown as { teaches_quran: boolean }).teaches_quran).toBe(true);

    await prisma.courseScheduleStaff.deleteMany({ where: { scheduleId: schedule.id } });
    await prisma.recurringCourseSchedule.delete({ where: { id: schedule.id } });
  });
});
