import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { issueAccessToken } from "../lib/access-token.js";
import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import { httpCall } from "../test-support/http-client.js";

/**
 * **Effective-dated teaching staffing (SRS Revision 91).**
 *
 * The Owner's brief states the requirement as a question the platform must
 * answer: *who teaches this class today, who taught it in October, who will
 * teach it next month, and which beneficiaries may this مؤطِّرة act on at a given
 * date.* Before R91 there was one answer to all four, because an assignment had
 * no period.
 *
 * The fixture is the association's own case, with **dates relative to today** so
 * the file does not rot into past-date conflicts:
 *
 * | | Safa | Amina |
 * |---|---|---|
 * | before the replacement | main teacher | — |
 * | during it | — | main teacher |
 * | after it | main teacher again | — |
 *
 * Safa therefore holds **two rows**, which is precisely what the withdrawn
 * `(schedule, user)` unique index made impossible.
 *
 * **The non-negotiable rule is asserted first and last**: a staffing change must
 * never make a historical Session look as though the new مؤطِّرة taught it.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = "[r91-effective-test]";

interface Res {
  status: number;
  body: {
    error?: { code?: string; details?: Record<string, unknown> };
    data?: unknown;
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

/** Relative dates, so the suite never rots. Day 0 is today, UTC-midnight. */
const day = (offset: number): Date => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
};
const iso = (d: Date): string => d.toISOString().slice(0, 10);

/** The replacement window: a bounded month, entirely in the future. */
const REPLACE_FROM = day(30);
const REPLACE_UNTIL = day(60);

let adminToken: string;
let branchId: string;
let levelId: string;
let categoryId: string;
let quranSubject: string;
let yearId: string;
let scheduleId: string;

let safa: string;
let amina: string;
let helper1: string;
let helper2: string;
let coverOnly: string;
let studentId: string;
let outsiderStudent: string;

async function clear(): Promise<void> {
  const schedules = await prisma.recurringCourseSchedule.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true },
  });
  const scheduleIds = schedules.map((s) => s.id);
  await prisma.sessionStaff.deleteMany({
    where: { session: { scheduleId: { in: scheduleIds } } },
  });
  await prisma.notification.deleteMany({
    where: { session: { scheduleId: { in: scheduleIds } } },
  });
  await prisma.session.deleteMany({ where: { scheduleId: { in: scheduleIds } } });
  await prisma.courseScheduleStaff.deleteMany({ where: { scheduleId: { in: scheduleIds } } });
  await prisma.recurringCourseSchedule.deleteMany({ where: { id: { in: scheduleIds } } });

  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
  await prisma.enrollment.deleteMany({ where: { studentId: { in: ids } } });
  await prisma.teacherSubjectCapability.deleteMany({ where: { userId: { in: ids } } });
  await prisma.teacherCategoryCapability.deleteMany({ where: { userId: { in: ids } } });
  await prisma.teacherAvailability.deleteMany({ where: { userId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { targetId: { in: ids } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });

  await prisma.levelSubject.deleteMany({ where: { subject: { name: { startsWith: TAG } } } });
  await prisma.teacherSubjectCapability.deleteMany({
    where: { subject: { name: { startsWith: TAG } } },
  });
  await prisma.subject.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.room.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.level.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
}

async function person(label: string, role: string, beneficiary = false): Promise<string> {
  const user = await prisma.user.create({
    data: {
      nameArabic: `${TAG} ${label}`,
      sex: "female",
      accountStatus: "active",
      isBeneficiary: beneficiary,
    },
  });
  const row = await prisma.role.findFirstOrThrow({ where: { name: role } });
  await prisma.userBranchRole.create({
    data: { userId: user.id, roleId: row.id, branchId: null },
  });
  return user.id;
}

/** The staffing set, submitted the way the real form does. */
const putStaff = async (
  staff: { user_id: string; position: string; effective_from?: string; effective_until?: string }[],
): Promise<Res> => {
  const current = await prisma.recurringCourseSchedule.findUniqueOrThrow({
    where: { id: scheduleId },
    select: { version: true },
  });
  return call("PATCH", `/admin/course-schedules/${scheduleId}`, adminToken, {
    staff,
    version: current.version,
  });
};

const teacherToken = (id: string): string => bearer(id, [{ role: "teacher", branches: null }]);

beforeAll(async () => {
  const health = await fetch(`${config.PUBLIC_BASE_URL}/healthz`).catch(() => null);
  if (!health || health.status !== 200) throw new Error("API not reachable");
  await clear();

  const admin = await person("مديرة", "super_admin");
  adminToken = bearer(admin, [{ role: "super_admin", branches: null }]);

  branchId = (await prisma.branch.create({ data: { name: `${TAG} تاركة` } })).id;
  categoryId = (await prisma.category.create({ data: { name: `${TAG} المرأة`, displayOrder: 97 } }))
    .id;
  levelId = (
    await prisma.level.create({
      data: { name: `${TAG} المستوى 1`, categoryId, genderRestriction: "any" },
    })
  ).id;
  // The Subject tracks Quran, so §15's boundary is provable on the same fixture.
  quranSubject = (
    await prisma.subject.create({
      data: { name: `${TAG} تفسير`, displayOrder: 97, tracksQuranProgress: true },
    })
  ).id;
  await prisma.levelSubject.create({ data: { levelId, subjectId: quranSubject } });
  yearId = (await prisma.academicYear.findFirstOrThrow()).id;

  safa = await person("صفاء", "teacher");
  amina = await person("أمينة", "teacher");
  helper1 = await person("مساعدة أولى", "teacher");
  helper2 = await person("مساعدة ثانية", "teacher");
  coverOnly = await person("مؤطرة الحصة الواحدة", "teacher");

  studentId = await person("مستفيدة", "student", true);
  outsiderStudent = await person("مستفيدة أخرى", "student", true);
  await prisma.enrollment.create({ data: { studentId, levelId, branchId } });

  const otherBranch = await prisma.branch.create({ data: { name: `${TAG} فرع آخر` } });
  await prisma.enrollment.create({
    data: { studentId: outsiderStudent, levelId, branchId: otherBranch.id },
  });

  // Thursday 15:00–18:00, weekly, open-ended — the Owner's stated fixture.
  const schedule = await prisma.recurringCourseSchedule.create({
    data: {
      title: `${TAG} تفسير المستوى 1`,
      subjectId: quranSubject,
      teachingMode: "entire_level",
      levelId,
      branchId,
      academicYearId: yearId,
      startTime: new Date("1970-01-01T15:00:00Z"),
      endTime: new Date("1970-01-01T18:00:00Z"),
      recurrence: "weekly",
      weekdays: ["thursday"],
      anchorDate: day(-30),
    },
    select: { id: true },
  });
  scheduleId = schedule.id;
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

/* ── §4 · migration compatibility ────────────────────────────────────────── */

/**
 * **`/quran-students` answers `{ students, levels }` since Section C.**
 *
 * The endpoint used to answer a bare array. It now carries the Levels the
 * roster reaches and each Level's `LevelSurah` syllabus too, because the entry
 * form's three selectors — whom, which Level, which Surah — are one question,
 * and a مؤطِّرة is refused by the admin reference endpoints that would otherwise
 * answer the last two (rule O).
 *
 * **The property these cases pin is unchanged**, so they are restated rather
 * than deleted: which beneficiaries the caller reaches, on which date.
 */
const rosterOf = (res: { body: { data?: unknown } }): string[] =>
  ((res.body.data as { students?: { id: string }[] } | undefined)?.students ?? []).map(
    (s) => s.id,
  );

describe("§4 — an assignment with no dates behaves exactly as it did", () => {
  it("is accepted, stored with two NULLs, and is effective on every date", async () => {
    const res = await putStaff([{ user_id: safa, position: "teacher" }]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const row = await prisma.courseScheduleStaff.findFirstOrThrow({
      where: { scheduleId, userId: safa, deletedAt: null },
    });
    // **Nothing fabricated.** Deriving an `effective_from` from `anchor_date`
    // would assert an assignment date nobody recorded.
    expect(row.effectiveFrom).toBeNull();
    expect(row.effectiveUntil).toBeNull();
  });

  it("and reaches her students, exactly as before the revision", async () => {
    const list = await call("GET", "/quran-students", teacherToken(safa));
    expect(list.status).toBe(200);
    expect(rosterOf(list)).toContain(studentId);
  });
});

/* ── §5, §6, §7 · the interval invariants ────────────────────────────────── */

describe("§5–§7 — the periods a schedule will and will not accept", () => {
  it("§6 refuses two main teachers whose periods overlap", async () => {
    const res = await putStaff([
      { user_id: safa, position: "teacher", effective_from: iso(day(0)), effective_until: iso(day(45)) },
      { user_id: amina, position: "teacher", effective_from: iso(day(30)), effective_until: iso(day(90)) },
    ]);
    expect(res.status).toBe(400);
    expect(res.body.error?.details?.["reason"]).toBe("OVERLAPPING_MAIN_TEACHER");
  });

  it("§6 accepts two main teachers whose periods do NOT overlap", async () => {
    const res = await putStaff([
      { user_id: safa, position: "teacher", effective_until: iso(day(29)) },
      { user_id: amina, position: "teacher", effective_from: iso(day(30)) },
    ]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it("§6 does NOT apply the one-main rule to assistants", async () => {
    const res = await putStaff([
      { user_id: safa, position: "teacher" },
      { user_id: helper1, position: "assistant" },
      { user_id: helper2, position: "assistant" },
    ]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = await prisma.courseScheduleStaff.findMany({
      where: { scheduleId, deletedAt: null, position: "assistant" },
    });
    expect(rows).toHaveLength(2);
  });

  it("§7 refuses one person holding two overlapping periods", async () => {
    const res = await putStaff([
      { user_id: safa, position: "teacher", effective_from: iso(day(0)), effective_until: iso(day(60)) },
      { user_id: safa, position: "assistant", effective_from: iso(day(30)) },
    ]);
    expect(res.status).toBe(400);
    expect(res.body.error?.details?.["reason"]).toBe("OVERLAPPING_ASSIGNMENT");
  });

  it("§7 ACCEPTS one person holding two periods that do not overlap — the resume case", async () => {
    // The withdrawn `(schedule, user)` unique index made this impossible, and it
    // is the whole shape of a temporary replacement.
    const res = await putStaff([
      { user_id: safa, position: "teacher", effective_until: iso(day(29)) },
      { user_id: amina, position: "teacher", effective_from: iso(day(30)), effective_until: iso(day(60)) },
      { user_id: safa, position: "teacher", effective_from: iso(day(61)) },
    ]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const safaRows = await prisma.courseScheduleStaff.findMany({
      where: { scheduleId, userId: safa, deletedAt: null },
    });
    expect(safaRows).toHaveLength(2);
  });

  it("§5 refuses a period entirely outside the schedule's life", async () => {
    await prisma.recurringCourseSchedule.update({
      where: { id: scheduleId },
      data: { effectiveUntil: day(120) },
    });
    const res = await putStaff([
      { user_id: safa, position: "teacher", effective_from: iso(day(200)) },
    ]);
    expect(res.status).toBe(400);
    expect(res.body.error?.details?.["reason"]).toBe("STAFF_PERIOD_OUTSIDE_SCHEDULE");
    await prisma.recurringCourseSchedule.update({
      where: { id: scheduleId },
      data: { effectiveUntil: null },
    });
  });

  it("§5 refuses an inverted period at the contract boundary", async () => {
    const res = await putStaff([
      {
        user_id: safa,
        position: "teacher",
        effective_from: iso(day(60)),
        effective_until: iso(day(30)),
      },
    ]);
    expect(res.status).toBe(400);
  });
});

/* ── §24 · the temporary replacement, end to end ─────────────────────────── */

describe("§24 — the temporary replacement", () => {
  beforeAll(async () => {
    const res = await putStaff([
      { user_id: safa, position: "teacher", effective_until: iso(day(29)) },
      {
        user_id: amina,
        position: "teacher",
        effective_from: iso(REPLACE_FROM),
        effective_until: iso(REPLACE_UNTIL),
      },
      { user_id: safa, position: "teacher", effective_from: iso(day(61)) },
    ]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it("§9 materializes each occurrence with the staff effective on ITS date", async () => {
    const sessions = await prisma.session.findMany({
      where: { scheduleId, deletedAt: null },
      select: { date: true, staff: { where: { deletedAt: null }, select: { userId: true } } },
      orderBy: { date: "asc" },
    });
    expect(sessions.length).toBeGreaterThan(0);

    const who = (d: Date): string[] =>
      sessions.find((s) => iso(s.date) === iso(d))?.staff.map((x) => x.userId) ?? [];

    const inWindow = sessions.filter(
      (s) => s.date >= REPLACE_FROM && s.date <= REPLACE_UNTIL,
    );
    const afterWindow = sessions.filter((s) => s.date > REPLACE_UNTIL);
    expect(inWindow.length).toBeGreaterThan(0);
    expect(afterWindow.length).toBeGreaterThan(0);

    // **One edit, three answers.** No occurrence was touched by hand.
    for (const s of inWindow) expect(who(s.date)).toEqual([amina]);
    for (const s of afterWindow) expect(who(s.date)).toEqual([safa]);
  });

  it("§14 — studentsTaughtBy answers about the DATE it is asked about", async () => {
    // Today Safa is effective and Amina is not.
    const safaNow = await call("GET", "/quran-students", teacherToken(safa));
    expect(rosterOf(safaNow)).toContain(studentId);

    const aminaNow = await call("GET", "/quran-students", teacherToken(amina));
    // Her period has not begun. A time-blind resolver handed her the roster the
    // moment the row existed, which is the defect R91 exists to close.
    expect(rosterOf(aminaNow)).not.toContain(studentId);
  });

  it("§15 — teaches_quran follows the effective assignment, not its existence", async () => {
    const safaMe = await call("GET", "/me", teacherToken(safa));
    expect((safaMe.body as unknown as { teaches_quran: boolean }).teaches_quran).toBe(true);

    const aminaMe = await call("GET", "/me", teacherToken(amina));
    // She has a real, live assignment row — it simply is not in force today, and
    // «إدخال الحفظ» is a screen for classes she is taking now.
    expect((aminaMe.body as unknown as { teaches_quran: boolean }).teaches_quran).toBe(false);
  });

  it("§16 — each personal calendar shows only her own effective occurrences", async () => {
    const range = `from=${iso(day(0))}&to=${iso(day(120))}`;
    const safaCal = await call("GET", `/me/calendar?${range}`, teacherToken(safa));
    const aminaCal = await call("GET", `/me/calendar?${range}`, teacherToken(amina));
    expect(safaCal.status).toBe(200);

    const dates = (r: Res): string[] =>
      (r.body.data as { date: string; schedule_id?: string }[])
        .filter((o) => o.date !== undefined)
        .map((o) => o.date);

    const aminaDates = dates(aminaCal);
    const safaDates = dates(safaCal);

    // Amina's occurrences are inside her window and Safa's are outside it. The
    // calendar reads `SessionStaff`, which materialization wrote per date — so
    // this is the same fact as the first assertion, seen from the other end.
    for (const d of aminaDates.filter((x) => x >= iso(REPLACE_FROM) && x <= iso(REPLACE_UNTIL))) {
      expect(safaDates).not.toContain(d);
    }
    expect(aminaDates.some((d) => d >= iso(REPLACE_FROM) && d <= iso(REPLACE_UNTIL))).toBe(true);
  });

  it("§19 — exam authority follows the effective assignment", async () => {
    // Amina's period has not started; Safa's has.
    const forSafa = await call("GET", "/quran-students", teacherToken(safa));
    expect(forSafa.status).toBe(200);
    const forAmina = await call("GET", "/quran-students", teacherToken(amina));
    expect(rosterOf(forAmina)).toHaveLength(0);
  });
});

/* ── §2 · history is never rewritten ─────────────────────────────────────── */

describe("§2 — a staffing change never rewrites a past occurrence", () => {
  let pastSessionId: string;

  beforeAll(async () => {
    // An occurrence that already happened, staffed by whoever delivered it.
    const past = await prisma.session.create({
      data: {
        scheduleId,
        date: day(-14),
        startTime: new Date("1970-01-01T15:00:00Z"),
        endTime: new Date("1970-01-01T18:00:00Z"),
        status: "held",
      },
      select: { id: true },
    });
    pastSessionId = past.id;
    await prisma.sessionStaff.create({
      data: { sessionId: past.id, userId: safa, position: "teacher" },
    });
  });

  it("hands the whole class to somebody else, from today onward", async () => {
    const res = await putStaff([{ user_id: amina, position: "teacher" }]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it("and the past occurrence still names the مؤطِّرة who actually took it", async () => {
    const staff = await prisma.sessionStaff.findMany({
      where: { sessionId: pastSessionId, deletedAt: null },
      select: { userId: true },
    });
    // **The non-negotiable rule.** Amina now teaches the class; she did not
    // teach it a fortnight ago, and no read may say she did.
    expect(staff.map((s) => s.userId)).toEqual([safa]);
  });

  it("§11 — a one-off cover is that occurrence's truth and nothing more", async () => {
    const future = await prisma.session.findFirstOrThrow({
      where: { scheduleId, deletedAt: null, date: { gt: day(0) } },
      orderBy: { date: "asc" },
      select: { id: true, date: true, version: true },
    });
    const res = await call("PATCH", `/sessions/${future.id}`, adminToken, {
      version: future.version,
      staff: [{ user_id: coverOnly, position: "teacher" }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const covered = await prisma.sessionStaff.findMany({
      where: { sessionId: future.id, deletedAt: null },
      select: { userId: true },
    });
    expect(covered.map((s) => s.userId)).toEqual([coverOnly]);

    // The schedule is untouched: she covered one lesson, she did not take the
    // class.
    const scheduleStaff = await prisma.courseScheduleStaff.findMany({
      where: { scheduleId, deletedAt: null },
      select: { userId: true },
    });
    expect(scheduleStaff.map((s) => s.userId)).not.toContain(coverOnly);

    // And a LATER occurrence still carries the schedule's own staffing.
    const later = await prisma.session.findFirst({
      where: { scheduleId, deletedAt: null, date: { gt: future.date } },
      orderBy: { date: "asc" },
      select: { staff: { where: { deletedAt: null }, select: { userId: true } } },
    });
    expect(later?.staff.map((s) => s.userId)).not.toContain(coverOnly);
  });
});

/* ── §21 · the R90 appraisal stops seeing expired assignments ────────────── */

describe("§21 — an assignment that ended is no longer a conflict", () => {
  it("does not warn about a class whose staffing period is over", async () => {
    // Safa staffs this schedule only up to a date already past.
    await putStaff([{ user_id: safa, position: "teacher", effective_until: iso(day(-1)) }]);

    const res = await call(
      "GET",
      `/admin/teaching-candidates?recurrence=weekly&weekdays=thursday&start_time=15:00&end_time=18:00&subject_id=${quranSubject}&level_id=${levelId}`,
      adminToken,
    );
    expect(res.status).toBe(200);
    const her = (res.body.data as { id: string; warnings: string[] }[]).find((c) => c.id === safa);
    // Time-blind, this reported a clash with a class nobody is teaching.
    expect(her?.warnings ?? []).not.toContain("conflict");
  });
});

/* ── §22 · the R88 separation is untouched ───────────────────────────────── */

describe("§22 — planning data still grants nothing", () => {
  it("a declared capability reaches no student without an effective assignment", async () => {
    await prisma.teacherSubjectCapability.create({
      data: { userId: helper1, subjectId: quranSubject },
    });
    const list = await call("GET", "/quran-students", teacherToken(helper1));
    expect(list.status).toBe(200);
    expect(rosterOf(list)).toHaveLength(0);

    const me = await call("GET", "/me", teacherToken(helper1));
    expect((me.body as unknown as { teaches_quran: boolean }).teaches_quran).toBe(false);
  });
});

/* ── §23 · assistant parity, on every changed resolver ───────────────────── */

describe("§23 — an assistant is the main teacher for operational authority", () => {
  beforeAll(async () => {
    const res = await putStaff([
      { user_id: amina, position: "teacher" },
      { user_id: helper1, position: "assistant" },
      { user_id: helper2, position: "assistant", effective_from: iso(day(30)) },
    ]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it("§26 — an effective assistant reaches the same students as the lead", async () => {
    const lead = await call("GET", "/quran-students", teacherToken(amina));
    const assistant = await call("GET", "/quran-students", teacherToken(helper1));
    expect(rosterOf(assistant)).toEqual(rosterOf(lead));
    expect(rosterOf(assistant)).toContain(studentId);
  });

  it("and answers teaches_quran identically", async () => {
    const me = await call("GET", "/me", teacherToken(helper1));
    expect((me.body as unknown as { teaches_quran: boolean }).teaches_quran).toBe(true);
  });

  it("but an assistant whose period has not begun reaches nobody", async () => {
    const notYet = await call("GET", "/quran-students", teacherToken(helper2));
    expect(rosterOf(notYet)).toHaveLength(0);
    const me = await call("GET", "/me", teacherToken(helper2));
    expect((me.body as unknown as { teaches_quran: boolean }).teaches_quran).toBe(false);
  });

  it("and a student outside the schedule's branch is reached by nobody", async () => {
    // The audience rule is unchanged by R91 — this pins that it did not drift
    // while every date predicate around it moved.
    const lead = await call("GET", "/quran-students", teacherToken(amina));
    expect(rosterOf(lead)).not.toContain(outsiderStudent);
  });
});

/* ── §28 · concurrency ───────────────────────────────────────────────────── */

describe("§28 — two administrators cannot race past the invariant", () => {
  it("one of two simultaneous overlapping main-teacher writes is refused", async () => {
    await putStaff([{ user_id: safa, position: "teacher", effective_until: iso(day(29)) }]);
    const current = await prisma.recurringCourseSchedule.findUniqueOrThrow({
      where: { id: scheduleId },
      select: { version: true },
    });

    const write = (userId: string) =>
      call("PATCH", `/admin/course-schedules/${scheduleId}`, adminToken, {
        version: current.version,
        staff: [
          { user_id: safa, position: "teacher", effective_until: iso(day(29)) },
          { user_id: userId, position: "teacher", effective_from: iso(day(10)) },
        ],
      });

    const [a, b] = await Promise.all([write(amina), write(helper1)]);
    // Both proposals overlap Safa's own period, so both are refused on the
    // invariant — and the optimistic version would refuse the second regardless.
    // What must never happen is BOTH succeeding.
    expect([a.status, b.status].filter((s) => s === 200).length).toBeLessThanOrEqual(1);
  });
});
