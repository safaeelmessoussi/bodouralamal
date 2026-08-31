import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { issueAccessToken } from "../lib/access-token.js";
import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import { httpCall } from "../test-support/http-client.js";
import { requireMemorisationSubject } from "../test-support/quran-subject.js";

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
const TAG = `[r88-profile-test:${randomUUID()}]`;

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
let levelId: string;
let branchId: string;
let roomId: string;

async function clear(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
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
  await prisma.teacherSubjectCapability.deleteMany({ where: { userId: { in: ids } } });
  await prisma.teacherCategoryCapability.deleteMany({ where: { userId: { in: ids } } });
  await prisma.teacherAvailability.deleteMany({ where: { userId: { in: ids } } });
  // The physical-preference completeness trigger is deferred specifically so
  // the branch rows and their parent can be retired as one meaning. Separate
  // auto-committed deletes would expose an invalid half-state at the first
  // commit and are therefore correctly refused.
  await prisma.$transaction(async (tx) => {
    await tx.framingPreferenceBranch.deleteMany({ where: { userId: { in: ids } } });
    await tx.framingPreference.deleteMany({ where: { userId: { in: ids } } });
  });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { targetId: { in: ids } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.teacherSubjectCapability.deleteMany({
    where: { subject: { name: { startsWith: TAG } } },
  });
  await prisma.levelSubject.deleteMany({
    where: {
      OR: [
        { subject: { name: { startsWith: TAG } } },
        { level: { name: { startsWith: TAG } } },
      ],
    },
  });
  await prisma.subject.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.teacherCategoryCapability.deleteMany({
    where: { category: { name: { startsWith: TAG } } },
  });
  await prisma.room.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.level.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  const health = await fetch(`${config.PUBLIC_BASE_URL}/healthz`).catch(() => null);
  if (!health || health.status !== 200) throw new Error("API not reachable");
  await clear();

  // R107 — the Production seed owns the one marker. This fixture owns the
  // unmarked comparison Subject and its assignments, never the حفظ row.
  quranSubject = (await requireMemorisationSubject(prisma)).id;
  tafseerSubject = (
    await prisma.subject.create({ data: { name: `${TAG} تفسير القرآن`, displayOrder: 81 } })
  ).id;
  womenCategory = (
    await prisma.category.create({ data: { name: `${TAG} المرأة`, displayOrder: 80 } })
  ).id;
  levelId = (
    await prisma.level.create({
      data: {
        name: `${TAG} المستوى`,
        categoryId: womenCategory,
        genderRestriction: "any",
      },
    })
  ).id;
  branchId = (
    await prisma.branch.create({
      data: { name: `${TAG} الفرع`, operationalStartDate: new Date("2020-01-01") },
    })
  ).id;
  roomId = (
    await prisma.room.create({ data: { name: `${TAG} القاعة`, branchId } })
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
  await prisma.framingPreference.create({
    data: {
      userId: teacherId,
      mode: "both",
      allBranches: false,
      branches: { create: [{ branchId }] },
    },
  });
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
  it("shows the approved general framing preference without inferring a weekly range", async () => {
    const res = await call("GET", `/admin/users/${teacherId}/teaching-profile`, adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      framing: {
        mode: "both",
        all_branches: false,
        branches: [{ id: branchId, name: `${TAG} الفرع` }],
      },
      subjects: [],
      categories: [],
      availability: [],
    });
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

describe("the administration owns the ADMIN route, still (R88.2, R106)", () => {
  it("refuses the مؤطِّرة the administrative endpoint even now she has her own", async () => {
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
    // `/quran-students` answers `{ students, levels }` since Section C — the
    // property is unchanged: a DECLARED capability reaches nobody.
    expect(
      (res.body.data as unknown as { students: unknown[] }).students,
    ).toHaveLength(0);
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

    const year = await prisma.academicYear.findFirstOrThrow();
    const schedule = await prisma.recurringCourseSchedule.create({
      data: {
        title: `${TAG} حلقة`,
        subjectId: quranSubject,
        teachingMode: "entire_level",
        levelId,
        branchId,
        roomId,
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

/* ── R106: she states her OWN availability, and only that ────────────────── */

/**
 * **The question R88.2 reserved in terms**, and the shape of the answer.
 *
 * R88.2: *"a مؤطِّرة may not edit her own, because who may assert their own
 * availability, and whether the administration may then rely on it, is a
 * separate decision the Owner has not taken."* R106 takes it — **availability
 * only** — and the tests that matter most here are the ones proving the
 * narrowness, because a grant this small is exactly the kind that widens by
 * accident: it would be one line to accept `subject_ids` and nobody would see
 * it until a مؤطِّرة had rewritten what she is authorised to teach.
 */
describe("R106 — a مؤطِّرة states her own availability", () => {
  it("reads her own WHOLE profile, capabilities included, so the ranges have context", async () => {
    const res = await call("GET", "/me/teaching-profile", teacherToken);
    expect(res.status).toBe(200);
    const data = res.body.data as Record<string, unknown>;
    expect(data["subjects"]).toBeDefined();
    expect(data["categories"]).toBeDefined();
    expect(data["availability"]).toBeDefined();
    expect(data["framing"]).toEqual({
      mode: "both",
      all_branches: false,
      branches: [{ id: branchId, name: `${TAG} الفرع` }],
    });
  });

  it("replaces her ranges, and the administration sees exactly what she wrote", async () => {
    const written = await call("PUT", "/me/teaching-profile/availability", teacherToken, {
      availability: [
        {
          weekday: "tuesday",
          start_time: "14:00",
          end_time: "17:00",
          mode: "online",
        },
        {
          weekday: "wednesday",
          start_time: "09:00",
          end_time: "11:00",
          mode: "both",
        },
      ],
    });
    expect(written.status).toBe(200);

    // **One model, not a parallel one** (R106.5): the administrative read is
    // the same table, so what she asserted is what the administration plans
    // against. A second store would make this assertion impossible.
    const asAdmin = await call(
      "GET",
      `/admin/users/${teacherId}/teaching-profile`,
      adminToken,
    );
    const ranges = (
      asAdmin.body.data as {
        availability: { weekday: string; mode: string | null }[];
      }
    ).availability;
    expect(ranges.map((r) => r.weekday).sort()).toEqual(["tuesday", "wednesday"]);
    expect(ranges.map((r) => r.mode).sort()).toEqual(["both", "online"]);
  });

  it("preserves a legacy/not-stated window as null and refuses an invalid modality", async () => {
    const legacy = await call("PUT", "/me/teaching-profile/availability", teacherToken, {
      availability: [{ weekday: "friday", start_time: "10:00", end_time: "12:00" }],
    });
    expect(legacy.status).toBe(200);
    expect(
      (
        legacy.body.data as {
          availability: { mode: string | null }[];
        }
      ).availability[0]?.mode,
    ).toBeNull();

    const invalid = await call("PUT", "/me/teaching-profile/availability", teacherToken, {
      availability: [
        { weekday: "friday", start_time: "10:00", end_time: "12:00", mode: "hybrid" },
      ],
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error?.code).toBe("VALIDATION_FAILED");
  });

  it("REFUSES a body naming subject_ids rather than ignoring it (R106.5)", async () => {
    // The assertion that keeps the grant narrow. Were the field merely dropped,
    // the response — which echoes the profile — would look exactly like a
    // successful rewrite of what she is authorised to teach.
    const before = await call("GET", "/me/teaching-profile", teacherToken);
    const subjectsBefore = (before.body.data as { subjects: unknown[] }).subjects;

    const res = await call("PUT", "/me/teaching-profile/availability", teacherToken, {
      availability: [{ weekday: "monday", start_time: "09:00", end_time: "10:00" }],
      subject_ids: [],
      category_ids: [],
    });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("VALIDATION_FAILED");

    const after = await call("GET", "/me/teaching-profile", teacherToken);
    expect((after.body.data as { subjects: unknown[] }).subjects).toEqual(subjectsBefore);
  });

  it("leaves her declared Subjects untouched when she saves availability", async () => {
    // The whole-object-PUT failure mode, asserted directly: a shared writer
    // taking a partial profile would clear the half nobody sent.
    //
    // The capabilities are (re)written here rather than assumed from an earlier
    // test — a test that depends on its neighbours' order is a test that will
    // fail for a reason unrelated to its own property.
    await call("PUT", `/admin/users/${teacherId}/teaching-profile`, adminToken, profile());

    const before = await call("GET", "/me/teaching-profile", teacherToken);
    const subjects = (before.body.data as { subjects: { id: string }[] }).subjects;
    expect(subjects.length).toBeGreaterThan(0);

    await call("PUT", "/me/teaching-profile/availability", teacherToken, {
      availability: [{ weekday: "sunday", start_time: "08:00", end_time: "09:00" }],
    });

    const after = await call("GET", "/me/teaching-profile", teacherToken);
    expect((after.body.data as { subjects: { id: string }[] }).subjects).toEqual(subjects);
  });

  it("applies R88.6 unchanged — overlapping refused, touching accepted", async () => {
    // The SAME rule as the administrative writer, because it is the same code.
    // Two statements of it would be two rules that agree until one is edited.
    const overlap = await call("PUT", "/me/teaching-profile/availability", teacherToken, {
      availability: [
        { weekday: "monday", start_time: "09:00", end_time: "12:00" },
        { weekday: "monday", start_time: "11:00", end_time: "13:00" },
      ],
    });
    expect(overlap.status).toBe(400);
    expect(overlap.body.error?.code).toBe("VALIDATION_FAILED");

    const touching = await call("PUT", "/me/teaching-profile/availability", teacherToken, {
      availability: [
        { weekday: "monday", start_time: "09:00", end_time: "12:00" },
        { weekday: "monday", start_time: "12:00", end_time: "15:00" },
      ],
    });
    expect(touching.status).toBe(200);
  });

  it("refuses an account without the teaching role, and an anonymous caller", async () => {
    // An Admin is not a مؤطِّرة: this route is about the caller's OWN ranges,
    // and an administrator's availability is not a thing the platform records.
    expect((await call("GET", "/me/teaching-profile", adminToken)).status).toBe(403);
    expect(
      (
        await call("PUT", "/me/teaching-profile/availability", adminToken, {
          availability: [],
        })
      ).status,
    ).toBe(403);
    expect((await call("GET", "/me/teaching-profile")).status).toBe(401);
  });

  it("she replaces her OWN declared Subjects and Categories (Owner 2026-08-30)", async () => {
    // R88.2 refused this and R106 took only the availability half; the Owner
    // has now taken this one. Same two tables, same editor, same rules.
    const res = await call("PUT", "/me/teaching-profile/capabilities", teacherToken, {
      subject_ids: [quranSubject],
      category_ids: [womenCategory],
    });
    expect(res.status).toBe(200);

    const after = await call("GET", "/me/teaching-profile", teacherToken);
    const body = after.body.data as { subjects: { id: string }[]; categories: { id: string }[] };
    expect(body.subjects.map((x) => x.id)).toEqual([quranSubject]);
    expect(body.categories.map((x) => x.id)).toEqual([womenCategory]);
  });

  it("REFUSES a body naming availability rather than ignoring it", async () => {
    // The mirror of the assertion above it: each self-service route replaces
    // exactly the half it names, so a stale tab cannot erase the other one and
    // a forged body cannot make one endpoint do the other's job.
    await call("PUT", "/me/teaching-profile/availability", teacherToken, {
      availability: [{ weekday: "monday", start_time: "09:00", end_time: "10:00" }],
    });
    const before = await call("GET", "/me/teaching-profile", teacherToken);
    const ranges = (before.body.data as { availability: unknown[] }).availability;

    const res = await call("PUT", "/me/teaching-profile/capabilities", teacherToken, {
      subject_ids: [quranSubject],
      category_ids: [],
      availability: [],
    });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("VALIDATION_FAILED");

    const after = await call("GET", "/me/teaching-profile", teacherToken);
    expect((after.body.data as { availability: unknown[] }).availability).toEqual(ranges);
  });

  it("leaves her availability untouched when she saves her capabilities", async () => {
    // The whole-object-PUT failure mode from the other direction.
    await call("PUT", "/me/teaching-profile/availability", teacherToken, {
      availability: [{ weekday: "wednesday", start_time: "08:00", end_time: "09:30" }],
    });
    const before = await call("GET", "/me/teaching-profile", teacherToken);
    const ranges = (before.body.data as { availability: unknown[] }).availability;
    expect(ranges).toHaveLength(1);

    await call("PUT", "/me/teaching-profile/capabilities", teacherToken, {
      subject_ids: [tafseerSubject],
      category_ids: [],
    });

    const after = await call("GET", "/me/teaching-profile", teacherToken);
    expect((after.body.data as { availability: unknown[] }).availability).toEqual(ranges);
  });

  it("refuses a retired Subject, from the same code the administrator's route uses", async () => {
    const res = await call("PUT", "/me/teaching-profile/capabilities", teacherToken, {
      subject_ids: ["00000000-0000-4000-8000-000000000000"],
      category_ids: [],
    });
    expect(res.status).toBe(400);
    expect(res.body.error?.details?.["reason"]).toBe("UNKNOWN_SUBJECT");
  });

  it("carries the catalogue she chooses from, so no admin read is needed", async () => {
    // She cannot call `/admin/subjects`, and widening that to make the screen
    // work would be the one fix that is never right. The options ride on the
    // read she already makes.
    const res = await call("GET", "/me/teaching-profile", teacherToken);
    const body = res.body.data as {
      selectable_subjects: { id: string }[];
      selectable_categories: { id: string }[];
    };
    expect(body.selectable_subjects.map((x) => x.id)).toContain(quranSubject);
    expect(body.selectable_categories.map((x) => x.id)).toContain(womenCategory);
    // And the admin route she must NOT have stays refused.
    expect((await call("GET", "/admin/subjects", teacherToken)).status).toBe(403);
  });

  it("CAPABILITIES grant nothing either — declaring every Subject reaches no one", async () => {
    /**
     * The property that makes this grant safe (R88.3, §4.4c, R73, R87).
     * Teaching authority is an ASSIGNMENT — `CourseScheduleStaff`/`SessionStaff`
     * resolved through `studentsTaughtBy` — and nothing she can write here
     * touches either.
     */
    await call("PUT", "/me/teaching-profile/capabilities", teacherToken, {
      subject_ids: [quranSubject, tafseerSubject],
      category_ids: [womenCategory],
    });

    const students = await call("GET", "/quran-students", teacherToken);
    expect(students.status).toBe(200);
    expect((students.body.data as unknown as { students: unknown[] }).students).toHaveLength(0);
    // Nor does it let her near the administration's own surfaces.
    expect((await call("GET", "/admin/users", teacherToken)).status).toBe(403);
  });

  it("is HERS only — an Admin and an anonymous caller are both refused", async () => {
    // There is no `{id}` in the route, so there is nowhere to name another
    // person; the remaining question is who may call it at all.
    expect(
      (
        await call("PUT", "/me/teaching-profile/capabilities", adminToken, {
          subject_ids: [],
          category_ids: [],
        })
      ).status,
    ).toBe(403);
    expect(
      (await call("PUT", "/me/teaching-profile/capabilities", undefined, {
        subject_ids: [],
        category_ids: [],
      })).status,
    ).toBe(401);
  });

  it("grants NOTHING — R88.3 still holds after she asserts it herself", async () => {
    // The reason R106 is a small decision. She has just declared availability
    // covering every hour of Tuesday; she reaches no beneficiary by it.
    await call("PUT", "/me/teaching-profile/availability", teacherToken, {
      availability: [{ weekday: "tuesday", start_time: "00:00", end_time: "23:59" }],
    });
    const students = await call("GET", "/quran-students", teacherToken);
    expect(students.status).toBe(200);
    // `/quran-students` answers `{ students, levels }` since Section C.
    expect(
      (students.body.data as unknown as { students: unknown[] }).students,
    ).toHaveLength(0);
  });
});
