import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { issueAccessToken } from "../lib/access-token.js";
import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import { httpCall } from "../test-support/http-client.js";

/**
 * **The staff picker's planning appraisal (R90).**
 *
 * Five مؤطِّرات, each shaped to isolate one appraisal, and the assertions come in
 * two halves that must both hold:
 *
 * 1. **The appraisal is accurate** — the right warning on the right person, and
 *    *not declared* distinguished from *declared and does not fit*.
 * 2. **The appraisal decides nothing.** Every one of them is returned, every one
 *    of them can be assigned, and the moment she is assigned she holds full
 *    authority — warnings or none. A مؤطِّرة with a flawless profile and no
 *    assignment holds none. That pair is the whole reason R88 and R90 exist and
 *    it is asserted at the end, against the real authorization resolver rather
 *    than against this file's own idea of it.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = "[r90-candidates-test]";

interface Res {
  status: number;
  body: {
    error?: { code?: string };
    data?: unknown;
  };
}

const call = (method: string, path: string, token?: string, body?: unknown) =>
  httpCall<Res["body"]>(BASE, method, path, {
    token,
    ...(body !== undefined ? { body } : {}),
  }) as Promise<Res>;

const bearer = (
  userId: string,
  roles: { role: string; branches: string[] | null }[],
) =>
  issueAccessToken(
    { userId, roleScopes: roles as never, accountStatus: "active" as never },
    config.JWT_SIGNING_KEY,
  ).token;

interface Candidate {
  id: string;
  name_arabic: string;
  no_profile: boolean;
  warnings: string[];
  conflicts: { schedule_id: string; title: string }[];
}

let adminToken: string;
let branchId: string;
let levelId: string;
let otherLevelId: string;
let categoryId: string;
let otherCategoryId: string;
let subjectId: string;
let otherSubjectId: string;
let yearId: string;

/** A · declares the Subject and the Category, free 14:00–18:00, nothing else on. */
let teacherA: string;
/** B · declares both, but is free only in the morning. */
let teacherB: string;
/** C · free at the time, has NOT declared the Subject. */
let teacherC: string;
/** D · declares everything and is free — and already staffs a clashing class. */
let teacherD: string;
/** E · no teaching profile at all. */
let teacherE: string;
/** The class D already staffs, which is what E is later assigned to. */
let clashingSchedule: string;
/** The class under discussion in the assignment half. */
let plannedSchedule: string;

/** The class being planned: Wednesday 15:30–17:00, weekly. */
const PROPOSED =
  "recurrence=weekly&weekdays=wednesday&start_time=15:30&end_time=17:00";

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
  const scheduleIds = schedules.map((s) => s.id);
  await prisma.sessionStaff.deleteMany({
    where: { session: { scheduleId: { in: scheduleIds } } },
  });
  await prisma.session.deleteMany({
    where: { scheduleId: { in: scheduleIds } },
  });
  await prisma.courseScheduleStaff.deleteMany({
    where: { scheduleId: { in: scheduleIds } },
  });
  await prisma.recurringCourseSchedule.deleteMany({
    where: { id: { in: scheduleIds } },
  });

  await prisma.teacherSubjectCapability.deleteMany({
    where: { userId: { in: ids } },
  });
  await prisma.teacherCategoryCapability.deleteMany({
    where: { userId: { in: ids } },
  });
  await prisma.teacherAvailability.deleteMany({
    where: { userId: { in: ids } },
  });
  await prisma.enrollment.deleteMany({ where: { studentId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { targetId: { in: ids } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });

  await prisma.teacherSubjectCapability.deleteMany({
    where: { subject: { name: { startsWith: TAG } } },
  });
  await prisma.levelSubject.deleteMany({
    where: { subject: { name: { startsWith: TAG } } },
  });
  await prisma.subject.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.room.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.level.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.teacherCategoryCapability.deleteMany({
    where: { category: { name: { startsWith: TAG } } },
  });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
}

/** A مؤطِّرة with the profile she is defined by. Its own rows, always. */
async function teacher(
  label: string,
  profile: {
    subjects?: string[];
    categories?: string[];
    availability?: { weekday: string; start: string; end: string }[];
  },
): Promise<string> {
  const user = await prisma.user.create({
    data: {
      nameArabic: `${TAG} ${label}`,
      sex: "female",
      accountStatus: "active",
    },
  });
  const role = await prisma.role.findFirstOrThrow({
    where: { name: "teacher" },
  });
  await prisma.userBranchRole.create({
    data: { userId: user.id, roleId: role.id, branchId: null },
  });
  for (const id of profile.subjects ?? []) {
    await prisma.teacherSubjectCapability.create({
      data: { userId: user.id, subjectId: id },
    });
  }
  for (const id of profile.categories ?? []) {
    await prisma.teacherCategoryCapability.create({
      data: { userId: user.id, categoryId: id },
    });
  }
  for (const r of profile.availability ?? []) {
    await prisma.teacherAvailability.create({
      data: {
        userId: user.id,
        weekday: r.weekday as never,
        startTime: new Date(`1970-01-01T${r.start}:00.000Z`),
        endTime: new Date(`1970-01-01T${r.end}:00.000Z`),
      },
    });
  }
  return user.id;
}

async function schedule(
  title: string,
  opts: {
    weekday: string;
    start: string;
    end: string;
    recurrence?: string;
    anchor?: string;
  },
): Promise<string> {
  const row = await prisma.recurringCourseSchedule.create({
    data: {
      title: `${TAG} ${title}`,
      subjectId,
      teachingMode: "entire_level",
      levelId,
      branchId,
      academicYearId: yearId,
      startTime: new Date(`1970-01-01T${opts.start}:00.000Z`),
      endTime: new Date(`1970-01-01T${opts.end}:00.000Z`),
      recurrence: (opts.recurrence ?? "weekly") as never,
      weekdays: [opts.weekday as never],
      ...(opts.anchor
        ? { anchorDate: new Date(`${opts.anchor}T00:00:00.000Z`) }
        : {}),
    },
    select: { id: true },
  });
  return row.id;
}

const appraise = async (query: string): Promise<Candidate[]> => {
  const res = await call(
    "GET",
    `/admin/teaching-candidates?${query}`,
    adminToken,
  );
  expect(res.status).toBe(200);
  return (res.body.data as Candidate[]).filter((c) =>
    c.name_arabic.startsWith(TAG),
  );
};

const named = (list: Candidate[], id: string): Candidate =>
  list.find((c) => c.id === id) ??
  ({ warnings: ["NOT RETURNED"] } as unknown as Candidate);

beforeAll(async () => {
  const health = await fetch(`${config.PUBLIC_BASE_URL}/healthz`).catch(
    () => null,
  );
  if (!health || health.status !== 200) throw new Error("API not reachable");
  await clear();

  const admin = await prisma.user.create({
    data: {
      nameArabic: `${TAG} مديرة`,
      sex: "female",
      accountStatus: "active",
    },
  });
  const superRole = await prisma.role.findFirstOrThrow({
    where: { name: "super_admin" },
  });
  await prisma.userBranchRole.create({
    data: { userId: admin.id, roleId: superRole.id, branchId: null },
  });
  adminToken = bearer(admin.id, [{ role: "super_admin", branches: null }]);

  branchId = (await prisma.branch.create({ data: { name: `${TAG} فرع` } })).id;
  categoryId = (
    await prisma.category.create({
      data: { name: `${TAG} الطفل`, displayOrder: 90 },
    })
  ).id;
  otherCategoryId = (
    await prisma.category.create({
      data: { name: `${TAG} المرأة`, displayOrder: 91 },
    })
  ).id;
  levelId = (
    await prisma.level.create({
      data: { name: `${TAG} مستوى`, categoryId, genderRestriction: "any" },
    })
  ).id;
  otherLevelId = (
    await prisma.level.create({
      data: {
        name: `${TAG} مستوى آخر`,
        categoryId: otherCategoryId,
        genderRestriction: "any",
      },
    })
  ).id;
  subjectId = (
    await prisma.subject.create({
      data: { name: `${TAG} حفظ`, displayOrder: 90 },
    })
  ).id;
  otherSubjectId = (
    await prisma.subject.create({
      data: { name: `${TAG} تفسير`, displayOrder: 91 },
    })
  ).id;
  yearId = (await prisma.academicYear.findFirstOrThrow()).id;

  const wed = { weekday: "wednesday", start: "14:00", end: "18:00" };
  teacherA = await teacher("أ الموافقة", {
    subjects: [subjectId],
    categories: [categoryId],
    availability: [wed],
  });
  teacherB = await teacher("ب غير المتاحة", {
    subjects: [subjectId],
    categories: [categoryId],
    availability: [{ weekday: "wednesday", start: "08:00", end: "12:00" }],
  });
  teacherC = await teacher("ج بلا مادة", {
    subjects: [otherSubjectId],
    categories: [categoryId],
    availability: [wed],
  });
  teacherD = await teacher("د المتعارضة", {
    subjects: [subjectId],
    categories: [categoryId],
    availability: [wed],
  });
  teacherE = await teacher("هـ بلا ملف", {});

  // D already teaches at that hour. The clash is a TIME overlap, not the mere
  // fact of other work (R88.7).
  clashingSchedule = await schedule("حصة متعارضة", {
    weekday: "wednesday",
    start: "16:00",
    end: "17:30",
  });
  await prisma.courseScheduleStaff.create({
    data: {
      scheduleId: clashingSchedule,
      userId: teacherD,
      position: "teacher",
    },
  });

  plannedSchedule = await schedule("الحصة المخطط لها", {
    weekday: "wednesday",
    start: "15:30",
    end: "17:00",
  });
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe("the appraisal is accurate", () => {
  it("returns EVERY candidate — the list is never shortened", async () => {
    const list = await appraise(
      `${PROPOSED}&subject_id=${subjectId}&level_id=${levelId}`,
    );
    expect(list.map((c) => c.id).sort()).toEqual(
      [teacherA, teacherB, teacherC, teacherD, teacherE].sort(),
    );
  });

  it("A · a مؤطِّرة who declares the Subject, the Category and the hour is QUIET", async () => {
    const list = await appraise(
      `${PROPOSED}&subject_id=${subjectId}&level_id=${levelId}&exclude_schedule_id=${plannedSchedule}`,
    );
    expect(named(list, teacherA).warnings).toEqual([]);
    expect(named(list, teacherA).no_profile).toBe(false);
  });

  it("B · availability that does not contain the class warns, and nothing else does", async () => {
    const list = await appraise(
      `${PROPOSED}&subject_id=${subjectId}&level_id=${levelId}`,
    );
    expect(named(list, teacherB).warnings).toEqual(["unavailable"]);
  });

  it("B · the containment rule is the Owner's — 15:30–17:00 fits 15:00–18:00", async () => {
    // The same person, appraised against a class her morning range DOES contain.
    const list = await appraise(
      `recurrence=weekly&weekdays=wednesday&start_time=09:00&end_time=11:00&subject_id=${subjectId}&level_id=${levelId}`,
    );
    expect(named(list, teacherB).warnings).toEqual([]);
    // …and against one that overlaps her range without being inside it.
    const straddling = await appraise(
      `recurrence=weekly&weekdays=wednesday&start_time=11:00&end_time=13:00&subject_id=${subjectId}&level_id=${levelId}`,
    );
    expect(named(straddling, teacherB).warnings).toEqual(["unavailable"]);
  });

  it("B · two adjacent ranges are NEVER merged to manufacture availability", async () => {
    await prisma.teacherAvailability.create({
      data: {
        userId: teacherB,
        weekday: "wednesday" as never,
        startTime: new Date("1970-01-01T12:00:00.000Z"),
        endTime: new Date("1970-01-01T15:00:00.000Z"),
      },
    });
    // 08:00–12:00 and 12:00–15:00 do not together cover 11:00–13:00: she wrote
    // two ranges, and reading them as one would invent an availability nobody
    // declared.
    const list = await appraise(
      `recurrence=weekly&weekdays=wednesday&start_time=11:00&end_time=13:00&subject_id=${subjectId}&level_id=${levelId}`,
    );
    expect(named(list, teacherB).warnings).toEqual(["unavailable"]);
    await prisma.teacherAvailability.deleteMany({
      where: {
        userId: teacherB,
        startTime: new Date("1970-01-01T12:00:00.000Z"),
      },
    });
  });

  it("C · a Subject she has not declared warns, and her availability does not", async () => {
    const list = await appraise(
      `${PROPOSED}&subject_id=${subjectId}&level_id=${levelId}`,
    );
    expect(named(list, teacherC).warnings).toEqual(["subject_not_declared"]);
  });

  it("C · appraised for the Subject she DID declare, she is quiet", async () => {
    const list = await appraise(
      `${PROPOSED}&subject_id=${otherSubjectId}&level_id=${levelId}`,
    );
    expect(named(list, teacherC).warnings).toEqual([]);
  });

  it("the Category comes from the class's LEVEL, not from the caller", async () => {
    const list = await appraise(
      `${PROPOSED}&subject_id=${subjectId}&level_id=${otherLevelId}`,
    );
    // Everybody declared the child Category; this class belongs to the other one.
    expect(named(list, teacherA).warnings).toEqual(["category_not_declared"]);
  });

  it("a question that was not asked is not answered — no Subject, no Subject warning", async () => {
    const list = await appraise(`${PROPOSED}&level_id=${levelId}`);
    expect(named(list, teacherC).warnings).toEqual([]);
  });

  it("D · another schedule at the same hour is a conflict, and it is NAMED", async () => {
    const list = await appraise(
      `${PROPOSED}&subject_id=${subjectId}&level_id=${levelId}`,
    );
    expect(named(list, teacherD).warnings).toEqual(["conflict"]);
    expect(named(list, teacherD).conflicts).toHaveLength(1);
    expect(named(list, teacherD).conflicts[0]?.schedule_id).toBe(
      clashingSchedule,
    );
  });

  it("D · a class at a DIFFERENT hour is not a conflict — other work is not a clash", async () => {
    const list = await appraise(
      `recurrence=weekly&weekdays=wednesday&start_time=09:00&end_time=10:00&subject_id=${subjectId}&level_id=${levelId}`,
    );
    // Her 14:00–18:00 range does not cover the morning, so she is *unavailable*
    // — but she is not in conflict, which is the distinction R88.7 draws.
    expect(named(list, teacherD).warnings).toEqual(["unavailable"]);
    expect(named(list, teacherD).conflicts).toEqual([]);
  });

  it("D · the schedule being EDITED never conflicts with itself", async () => {
    await prisma.courseScheduleStaff.create({
      data: {
        scheduleId: plannedSchedule,
        userId: teacherA,
        position: "teacher",
      },
    });
    const naive = await appraise(
      `${PROPOSED}&subject_id=${subjectId}&level_id=${levelId}`,
    );
    expect(named(naive, teacherA).warnings).toEqual(["conflict"]);

    const editing = await appraise(
      `${PROPOSED}&subject_id=${subjectId}&level_id=${levelId}&exclude_schedule_id=${plannedSchedule}`,
    );
    expect(named(editing, teacherA).warnings).toEqual([]);
    await prisma.courseScheduleStaff.deleteMany({
      where: { scheduleId: plannedSchedule, userId: teacherA },
    });
  });

  it("E · an empty profile is reported ONCE, and never as unavailability", async () => {
    const list = await appraise(
      `${PROPOSED}&subject_id=${subjectId}&level_id=${levelId}`,
    );
    const e = named(list, teacherE);
    expect(e.no_profile).toBe(true);
    // *Not declared* is not *busy*. Saying «غير متاحة» about somebody who has
    // declared nothing would put words in her mouth.
    expect(e.warnings).toContain("availability_not_declared");
    expect(e.warnings).not.toContain("unavailable");
    expect(e.warnings.sort()).toEqual(
      [
        "availability_not_declared",
        "category_not_declared",
        "subject_not_declared",
      ].sort(),
    );
  });
});

describe("the appraisal is about the CLASS, not one occurrence", () => {
  it("every weekday the recurrence occupies must be covered", async () => {
    // A is free on Wednesday afternoons and has declared nothing for Monday.
    const list = await appraise(
      `recurrence=multiple_weekdays&weekdays=wednesday,monday&start_time=15:30&end_time=17:00&subject_id=${subjectId}&level_id=${levelId}`,
    );
    expect(named(list, teacherA).warnings).toEqual(["unavailable"]);
  });

  it("`daily` occupies all seven days", async () => {
    const list = await appraise(
      `recurrence=daily&start_time=15:30&end_time=17:00&subject_id=${subjectId}&level_id=${levelId}`,
    );
    expect(named(list, teacherA).warnings).toEqual(["unavailable"]);
  });

  it("`monthly` is INDETERMINATE — a day of the month is not a weekday", async () => {
    const list = await appraise(
      `recurrence=monthly&start_time=15:30&end_time=17:00&subject_id=${subjectId}&level_id=${levelId}`,
    );
    // Neither available nor unavailable: the appraisal says it cannot tell
    // rather than guessing in a direction it has no basis for.
    expect(named(list, teacherA).warnings).toEqual([
      "availability_indeterminate",
    ]);
    expect(named(list, teacherD).conflicts).toEqual([]);
  });

  it("two alternating series on the same weekday interleave when their anchors differ in parity", async () => {
    const alternating = await schedule("حصة كل أسبوعين", {
      weekday: "wednesday",
      start: "16:00",
      end: "17:30",
      recurrence: "biweekly_alternating",
      anchor: "2026-09-02",
    });
    await prisma.courseScheduleStaff.create({
      data: { scheduleId: alternating, userId: teacherA, position: "teacher" },
    });

    // Same parity → they meet.
    const same = await appraise(
      `recurrence=biweekly_alternating&weekdays=wednesday&start_time=15:30&end_time=17:00&anchor=2026-09-02&subject_id=${subjectId}&level_id=${levelId}`.replace(
        "&anchor=2026-09-02",
        "",
      ),
    );
    expect(named(same, teacherA).warnings).toEqual(["conflict"]);

    await prisma.courseScheduleStaff.deleteMany({
      where: { scheduleId: alternating },
    });
    await prisma.recurringCourseSchedule.deleteMany({
      where: { id: alternating },
    });
  });
});

describe("who may ask", () => {
  it("a مؤطِّرة may not appraise candidates — planning is the administration's", async () => {
    const her = bearer(teacherA, [{ role: "teacher", branches: null }]);
    const res = await call(
      "GET",
      `/admin/teaching-candidates?${PROPOSED}&subject_id=${subjectId}`,
      her,
    );
    expect(res.status).toBe(403);
  });

  it("an unknown query key is refused rather than ignored", async () => {
    const res = await call(
      "GET",
      `/admin/teaching-candidates?${PROPOSED}&subject=${subjectId}`,
      adminToken,
    );
    expect(res.status).toBe(400);
  });
});

/**
 * **The half that matters most.**
 *
 * A warning is not a refusal and the absence of one is not a permission. These
 * assert it against the real staffing table and the real resolver, in both
 * directions, because a separation only stated in prose is one a later refactor
 * quietly closes.
 */
describe("warnings neither grant nor deny authority (R88.3)", () => {
  it("A · a flawless profile and NO assignment reaches nothing", async () => {
    const list = await appraise(
      `${PROPOSED}&subject_id=${subjectId}&level_id=${levelId}&exclude_schedule_id=${plannedSchedule}`,
    );
    expect(named(list, teacherA).warnings).toEqual([]);

    const staffing = await prisma.courseScheduleStaff.count({
      where: { userId: teacherA, deletedAt: null },
    });
    expect(staffing).toBe(0);
    // R87 §M's structural marker reads ASSIGNMENTS, and she has none.
    // `/me` answers at the top level, not inside `data`.
    const res = await call(
      "GET",
      "/me",
      bearer(teacherA, [{ role: "teacher", branches: null }]),
    );
    expect(
      (res.body as unknown as { teaches_quran: boolean }).teaches_quran,
    ).toBe(false);
  });

  it("E · four warnings do NOT block the assignment", async () => {
    const before = await appraise(
      `${PROPOSED}&subject_id=${subjectId}&level_id=${levelId}`,
    );
    expect(named(before, teacherE).warnings.length).toBeGreaterThan(0);

    const res = await call(
      "PATCH",
      `/admin/course-schedules/${plannedSchedule}`,
      adminToken,
      {
        staff: [{ user_id: teacherE, position: "teacher" }],
        version: 0,
      },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const stored = await prisma.courseScheduleStaff.findFirst({
      where: { scheduleId: plannedSchedule, userId: teacherE, deletedAt: null },
    });
    expect(stored?.position).toBe("teacher");
  });

  it("E · and the assignment grants full authority, profile or none", async () => {
    // She declared nothing at all. The assignment is what carries the authority,
    // and it carries all of it (§4.4c) — the converse of the first assertion.
    const students = await prisma.recurringCourseSchedule.findFirst({
      where: { id: plannedSchedule },
      select: { levelId: true, branchId: true },
    });
    expect(students?.levelId).toBe(levelId);

    const still = await appraise(
      `${PROPOSED}&subject_id=${subjectId}&level_id=${levelId}`,
    );
    // The warnings do not disappear because she was assigned: they describe her
    // PROFILE, which nobody updated. Planning data and authority are two facts.
    expect(named(still, teacherE).no_profile).toBe(true);
  });

  it("multiple assistants are supported, and they warn exactly as the lead does", async () => {
    const current = await prisma.recurringCourseSchedule.findUniqueOrThrow({
      where: { id: plannedSchedule },
      select: { version: true },
    });
    const res = await call(
      "PATCH",
      `/admin/course-schedules/${plannedSchedule}`,
      adminToken,
      {
        staff: [
          { user_id: teacherA, position: "teacher" },
          { user_id: teacherB, position: "assistant" },
          { user_id: teacherC, position: "assistant" },
          { user_id: teacherE, position: "assistant" },
        ],
        version: current.version,
      },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = await prisma.courseScheduleStaff.findMany({
      where: { scheduleId: plannedSchedule, deletedAt: null },
      select: { userId: true, position: true },
    });
    expect(rows.filter((r) => r.position === "teacher")).toHaveLength(1);
    expect(rows.filter((r) => r.position === "assistant")).toHaveLength(3);

    // **One profile per person, and no assistant variant** (R88.8). The
    // appraisal does not know or care what position anybody is being considered
    // for — the same warnings are returned for all four.
    const list = await appraise(
      `${PROPOSED}&subject_id=${subjectId}&level_id=${levelId}&exclude_schedule_id=${plannedSchedule}`,
    );
    expect(named(list, teacherA).warnings).toEqual([]);
    expect(named(list, teacherB).warnings).toEqual(["unavailable"]);
    expect(named(list, teacherC).warnings).toEqual(["subject_not_declared"]);
    expect(named(list, teacherE).no_profile).toBe(true);
  });
});
