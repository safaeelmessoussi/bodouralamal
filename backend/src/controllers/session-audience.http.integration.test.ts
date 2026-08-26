import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { issueAccessToken } from "../lib/access-token.js";
import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import { httpCall } from "../test-support/http-client.js";
import { requireMemorisationSubject } from "../test-support/quran-subject.js";

/**
 * **Cross-branch occurrence audiences (SRS Revision 92).**
 *
 * The association occasionally delivers a lesson once instead of twice: the
 * Targa class and the second branch's class meet together, physically at Targa,
 * for that occurrence only.
 *
 * Two dimensions that must stay independent, and the last block proves it:
 *
 * | | Decided by |
 * |---|---|
 * | **who teaches** | R91's effective assignment, and the occurrence's `SessionStaff` |
 * | **who attends** | R92's occurrence audience override |
 *
 * Every assertion below also pins what the revision must NOT do: no Enrollment
 * is mutated, no Session is duplicated, no per-student row is created, and the
 * physical venue never moves.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = "[r92-audience-test]";

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

const bearer = (
  userId: string,
  roles: { role: string; branches: string[] | null }[],
) =>
  issueAccessToken(
    { userId, roleScopes: roles as never, accountStatus: "active" as never },
    config.JWT_SIGNING_KEY,
  ).token;

const day = (offset: number): Date => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
};
const iso = (d: Date): string => d.toISOString().slice(0, 10);

let adminToken: string;
let adminId: string;
let targa: string;
let branch2: string;
let elsewhere: string;
let levelId: string;
let subjectId: string;
let yearId: string;
let targaSchedule: string;
let branch2Schedule: string;
/** The occurrence the two branches will attend together. */
let combined: string;
/** The following week's occurrence — proves the override does not propagate. */
let nextWeek: string;

let studentA: string;
let studentB: string;
let studentC: string;
let safa: string;
let amina: string;
let helper: string;

async function clear(): Promise<void> {
  const schedules = await prisma.recurringCourseSchedule.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = schedules.map((s) => s.id);
  const sessions = await prisma.session.findMany({
    where: { scheduleId: { in: ids } },
    select: { id: true },
  });
  const sessionIds = sessions.map((s) => s.id);
  await prisma.sessionAudienceBranch.deleteMany({
    where: { sessionId: { in: sessionIds } },
  });
  await prisma.notification.deleteMany({
    where: { sessionId: { in: sessionIds } },
  });
  await prisma.sessionStaff.deleteMany({
    where: { sessionId: { in: sessionIds } },
  });
  await prisma.session.deleteMany({ where: { id: { in: sessionIds } } });
  await prisma.courseScheduleStaff.deleteMany({
    where: { scheduleId: { in: ids } },
  });
  await prisma.recurringCourseSchedule.deleteMany({
    where: { id: { in: ids } },
  });

  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const uids = users.map((u) => u.id);
  await prisma.notification.deleteMany({ where: { userId: { in: uids } } });
  await prisma.enrollment.deleteMany({ where: { studentId: { in: uids } } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: uids } } });
  await prisma.auditLog.deleteMany({ where: { targetId: { in: uids } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: uids } } });
  await prisma.user.deleteMany({ where: { id: { in: uids } } });

  await prisma.levelSubject.deleteMany({
    where: {
      OR: [
        { subject: { name: { startsWith: TAG } } },
        { level: { name: { startsWith: TAG } } },
      ],
    },
  });
  await prisma.subject.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.level.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
}

async function person(
  label: string,
  role: string,
  beneficiary = false,
): Promise<string> {
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

async function schedule(title: string, branchId: string): Promise<string> {
  const row = await prisma.recurringCourseSchedule.create({
    data: {
      title: `${TAG} ${title}`,
      subjectId,
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
  return row.id;
}

async function session(
  scheduleId: string,
  date: Date,
  staff: string[],
): Promise<string> {
  const row = await prisma.session.create({
    data: {
      scheduleId,
      date,
      startTime: new Date("1970-01-01T15:00:00Z"),
      endTime: new Date("1970-01-01T18:00:00Z"),
      status: "scheduled",
    },
    select: { id: true },
  });
  for (const userId of staff) {
    await prisma.sessionStaff.create({
      data: { sessionId: row.id, userId, position: "teacher" },
    });
  }
  return row.id;
}

const rosterOf = async (
  sessionId: string,
): Promise<Record<string, unknown>> => {
  const res = await call("GET", `/sessions/${sessionId}/roster`, adminToken);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data as Record<string, unknown>;
};

const studentIds = (roster: Record<string, unknown>): string[] =>
  (roster["students"] as { id: string }[]).map((s) => s.id);

const calendarOf = async (userId: string): Promise<string[]> => {
  const token = bearer(userId, [{ role: "student", branches: null }]);
  const res = await call(
    "GET",
    `/me/calendar?from=${iso(day(-40))}&to=${iso(day(40))}`,
    token,
  );
  expect(res.status).toBe(200);
  return (res.body.data as { id: string }[]).map((o) => o.id);
};

const setAudience = async (
  sessionId: string,
  branchIds: string[],
): Promise<Res> => {
  const row = await prisma.session.findUniqueOrThrow({
    where: { id: sessionId },
    select: { version: true },
  });
  return call("PUT", `/sessions/${sessionId}/audience-branches`, adminToken, {
    version: row.version,
    branch_ids: branchIds,
  });
};

beforeAll(async () => {
  const health = await fetch(`${config.PUBLIC_BASE_URL}/healthz`).catch(
    () => null,
  );
  if (!health || health.status !== 200) throw new Error("API not reachable");
  await clear();

  adminId = await person("مديرة", "super_admin");
  adminToken = bearer(adminId, [{ role: "super_admin", branches: null }]);

  targa = (await prisma.branch.create({ data: { name: `${TAG} تاركة` } })).id;
  branch2 = (
    await prisma.branch.create({ data: { name: `${TAG} الفرع الثاني` } })
  ).id;
  elsewhere = (
    await prisma.branch.create({ data: { name: `${TAG} فرع بعيد` } })
  ).id;

  const category = await prisma.category.create({
    data: { name: `${TAG} المرأة`, displayOrder: 99 },
  });
  levelId = (
    await prisma.level.create({
      data: {
        name: `${TAG} المستوى 1`,
        categoryId: category.id,
        genderRestriction: "any",
      },
    })
  ).id;
  subjectId = (await requireMemorisationSubject(prisma)).id;
  await prisma.levelSubject.create({ data: { levelId, subjectId } });
  yearId = (await prisma.academicYear.findFirstOrThrow()).id;

  safa = await person("صفاء", "teacher");
  amina = await person("أمينة", "teacher");
  helper = await person("مساعدة", "teacher");

  studentA = await person("أ تاركة", "student", true);
  studentB = await person("ب الفرع الثاني", "student", true);
  studentC = await person("ج فرع بعيد", "student", true);
  await prisma.enrollment.create({
    data: { studentId: studentA, levelId, branchId: targa },
  });
  await prisma.enrollment.create({
    data: { studentId: studentB, levelId, branchId: branch2 },
  });
  await prisma.enrollment.create({
    data: { studentId: studentC, levelId, branchId: elsewhere },
  });

  targaSchedule = await schedule("تفسير تاركة", targa);
  branch2Schedule = await schedule("تفسير الفرع الثاني", branch2);

  combined = await session(targaSchedule, day(7), [safa]);
  nextWeek = await session(targaSchedule, day(14), [safa]);
  await session(branch2Schedule, day(7), [helper]);
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.sessionAudienceBranch.deleteMany({
    where: { session: { schedule: { title: { startsWith: TAG } } } },
  });
});

/* ── the inherited audience, which is every occurrence but one ───────────── */

describe("without an override, nothing whatever changes", () => {
  it("the Targa occurrence gathers Targa only", async () => {
    const roster = await rosterOf(combined);
    expect(studentIds(roster)).toEqual([studentA]);
    expect(roster["overridden"]).toBe(false);
  });

  it("and its audience branch is the schedule's own", async () => {
    const roster = await rosterOf(combined);
    expect(
      (roster["audience_branches"] as { id: string }[]).map((b) => b.id),
    ).toEqual([targa]);
  });

  it("the second branch's beneficiary sees her OWN branch's occurrence, not Targa's", async () => {
    const hers = await calendarOf(studentB);
    expect(hers).not.toContain(combined);
  });
});

/* ── the override ────────────────────────────────────────────────────────── */

describe("one occurrence, two branches", () => {
  beforeEach(async () => {
    const res = await setAudience(combined, [targa, branch2]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it("gathers both branches' beneficiaries", async () => {
    const roster = await rosterOf(combined);
    expect(studentIds(roster).sort()).toEqual([studentA, studentB].sort());
  });

  it("and excludes an unrelated branch's, who was never part of either class", async () => {
    expect(studentIds(await rosterOf(combined))).not.toContain(studentC);
  });

  it("reports each student's own branch, so a combined roster is readable", async () => {
    const roster = await rosterOf(combined);
    const rows = roster["students"] as { id: string; branch_id: string }[];
    expect(rows.find((r) => r.id === studentA)?.branch_id).toBe(targa);
    expect(rows.find((r) => r.id === studentB)?.branch_id).toBe(branch2);
  });

  it("**the physical venue does not move** — it is a different fact", async () => {
    const roster = await rosterOf(combined);
    const venue = roster["venue"] as { branch_id: string };
    expect(venue.branch_id).toBe(targa);
    // And the Session row itself still belongs to the Targa schedule.
    const row = await prisma.session.findUniqueOrThrow({
      where: { id: combined },
      select: { schedule: { select: { branchId: true } } },
    });
    expect(row.schedule.branchId).toBe(targa);
  });

  it("both beneficiaries see the SAME occurrence on their calendars", async () => {
    expect(await calendarOf(studentA)).toContain(combined);
    expect(await calendarOf(studentB)).toContain(combined);
  });

  it("and the unrelated beneficiary sees neither", async () => {
    expect(await calendarOf(studentC)).not.toContain(combined);
  });

  it("**the NEXT occurrence is untouched** — an override never propagates", async () => {
    const roster = await rosterOf(nextWeek);
    expect(roster["overridden"]).toBe(false);
    expect(studentIds(roster)).toEqual([studentA]);
    expect(await calendarOf(studentB)).not.toContain(nextWeek);
  });

  it("mutates no Enrollment and creates no per-student row", async () => {
    // The three prohibitions R92 states, asserted rather than trusted.
    const enrolments = await prisma.enrollment.findMany({
      where: {
        studentId: { in: [studentA, studentB, studentC] },
        deletedAt: null,
      },
      select: { studentId: true, branchId: true },
    });
    expect(enrolments.find((e) => e.studentId === studentB)?.branchId).toBe(
      branch2,
    );
    const rows = await prisma.sessionAudienceBranch.count({
      where: { sessionId: combined },
    });
    // Two rows for two BRANCHES — never one per student.
    expect(rows).toBe(2);
  });

  it("duplicates no Session", async () => {
    const onThatDay = await prisma.session.count({
      where: { scheduleId: targaSchedule, date: day(7), deletedAt: null },
    });
    expect(onThatDay).toBe(1);
  });

  it("clearing it returns the audience to the schedule's", async () => {
    const res = await setAudience(combined, []);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const roster = await rosterOf(combined);
    expect(roster["overridden"]).toBe(false);
    expect(studentIds(roster)).toEqual([studentA]);
  });
});

/* ── notifications follow the ACTUAL audience ────────────────────────────── */

describe("a cancellation reaches the people who were expected", () => {
  it("notifies both branches, the effective staff, and not the actor", async () => {
    expect((await setAudience(combined, [targa, branch2])).status).toBe(200);

    const version = (
      await prisma.session.findUniqueOrThrow({
        where: { id: combined },
        select: { version: true },
      })
    ).version;
    const cancelled = await call(
      "POST",
      `/sessions/${combined}/cancel`,
      adminToken,
      {
        version,
        reason: "درس واحد للفرعين",
      },
    );
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);

    const sent = await call(
      "POST",
      `/sessions/${combined}/notify`,
      adminToken,
      {
        change: "cancelled",
      },
    );
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);

    const rows = await prisma.notification.findMany({
      where: { sessionId: combined, deletedAt: null },
      select: { userId: true },
    });
    const told = rows.map((r) => r.userId);

    expect(told).toContain(studentA);
    // **The whole point.** Falling back to the schedule's single branch would
    // leave her seeing a class on her calendar and hearing nothing about it.
    expect(told).toContain(studentB);
    expect(told).not.toContain(studentC);
    // The occurrence's own staffing snapshot (R43.4/R91), not the schedule's.
    expect(told).toContain(safa);
    expect(told).not.toContain(helper);
    // R78.3 — never notified of your own act.
    expect(told).not.toContain(adminId);
  });
});

/* ── staffing and audience are independent dimensions ────────────────────── */

describe("R91 staffing × R92 audience — two dimensions, one occurrence", () => {
  it("a replacement teaches the combined class, and the audience is unaffected by who teaches", async () => {
    // Amina covers THIS occurrence only (R91 §11 / R43.4).
    await prisma.sessionStaff.deleteMany({ where: { sessionId: combined } });
    await prisma.sessionStaff.create({
      data: { sessionId: combined, userId: amina, position: "teacher" },
    });
    expect((await setAudience(combined, [targa, branch2])).status).toBe(200);

    const roster = await rosterOf(combined);
    // Changing who teaches changed nobody's expectation of attending.
    expect(studentIds(roster).sort()).toEqual([studentA, studentB].sort());

    const staff = await prisma.sessionStaff.findMany({
      where: { sessionId: combined, deletedAt: null },
      select: { userId: true },
    });
    // And the audience override touched no staffing row.
    expect(staff.map((s) => s.userId)).toEqual([amina]);
  });

  it("the next occurrence returns to normal on BOTH dimensions independently", async () => {
    const roster = await rosterOf(nextWeek);
    expect(roster["overridden"]).toBe(false);
    const staff = await prisma.sessionStaff.findMany({
      where: { sessionId: nextWeek, deletedAt: null },
      select: { userId: true },
    });
    expect(staff.map((s) => s.userId)).toEqual([safa]);
  });
});

/* ── refusals and concurrency ────────────────────────────────────────────── */

describe("what the write refuses", () => {
  it("an unknown branch, rather than silently dropping it", async () => {
    const res = await setAudience(combined, [
      targa,
      "00000000-0000-4000-8000-00000000dead",
    ]);
    expect(res.status).toBe(400);
    expect(res.body.error?.details?.["reason"]).toBe("UNKNOWN_BRANCH");
  });

  it("a schedule that is not whole-Level — semantics nobody asked for", async () => {
    const group = await prisma.administrativeGroup.create({
      data: { name: `${TAG} مجموعة`, levelId, branchId: targa },
      select: { id: true },
    });
    const grouped = await prisma.recurringCourseSchedule.create({
      data: {
        title: `${TAG} حصة المجموعة`,
        subjectId,
        teachingMode: "administrative_group",
        administrativeGroupId: group.id,
        branchId: targa,
        academicYearId: yearId,
        startTime: new Date("1970-01-01T09:00:00Z"),
        endTime: new Date("1970-01-01T10:00:00Z"),
        recurrence: "weekly",
        weekdays: ["monday"],
        anchorDate: day(-30),
      },
      select: { id: true },
    });
    const occ = await session(grouped.id, day(8), []);
    const res = await setAudience(occ, [targa, branch2]);
    expect(res.status).toBe(400);
    expect(res.body.error?.details?.["reason"]).toBe(
      "AUDIENCE_OVERRIDE_MODE_UNSUPPORTED",
    );

    await prisma.sessionAudienceBranch.deleteMany({
      where: { sessionId: occ },
    });
    await prisma.session.deleteMany({ where: { id: occ } });
    await prisma.recurringCourseSchedule.deleteMany({
      where: { id: grouped.id },
    });
    await prisma.administrativeGroup.deleteMany({ where: { id: group.id } });
  });

  it("a stale version — the Session's own, never a second mechanism", async () => {
    const row = await prisma.session.findUniqueOrThrow({
      where: { id: combined },
      select: { version: true },
    });
    const first = await call(
      "PUT",
      `/sessions/${combined}/audience-branches`,
      adminToken,
      {
        version: row.version,
        branch_ids: [targa, branch2],
      },
    );
    expect(first.status).toBe(200);
    const second = await call(
      "PUT",
      `/sessions/${combined}/audience-branches`,
      adminToken,
      {
        version: row.version,
        branch_ids: [targa],
      },
    );
    // Two administrators must not silently lose one another's change.
    expect(second.status).toBe(409);
  });

  it("an unknown key", async () => {
    const row = await prisma.session.findUniqueOrThrow({
      where: { id: combined },
      select: { version: true },
    });
    const res = await call(
      "PUT",
      `/sessions/${combined}/audience-branches`,
      adminToken,
      {
        version: row.version,
        branch_ids: [targa],
        student_ids: [studentB],
      },
    );
    expect(res.status).toBe(400);
  });
});

/**
 * **The notification pipeline's server half** (2026-08-20).
 *
 * The user-visible proof is `verify-notify-ui`, which clicks the real button and
 * reads the notice out of the recipient's own bell. These pin the properties
 * underneath it that a browser run would be a clumsy way to assert — and one the
 * old harness never asserted at all, because it POSTed to `/notify` directly and
 * so could not tell a wired dialog from an unwired one.
 */
describe("notification recipients, resolved for the occurrence", () => {
  // **Its own occurrence.** `combined` is cancelled by an earlier block, and a
  // second cancellation answers 409 — a test that borrows another's row fails
  // for reasons that have nothing to do with what it asserts.
  it("a repeated send is idempotent and reports that nothing new was written", async () => {
    expect((await setAudience(nextWeek, [targa, branch2])).status).toBe(200);
    const version = (
      await prisma.session.findUniqueOrThrow({
        where: { id: nextWeek },
        select: { version: true },
      })
    ).version;
    // **The key is OMITTED, which is how the form expresses *no reason*.**
    // `null` is refused by the schema; R83.2 made the reason optional, and
    // optional here means absent rather than explicitly null.
    const cancelled = await call("POST", `/sessions/${nextWeek}/cancel`, adminToken, {
      version,
    });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);

    const first = await call("POST", `/sessions/${nextWeek}/notify`, adminToken, {
      change: "cancelled",
    });
    expect(first.status).toBe(200);
    const firstCount = (first.body.data as { notified: number }).notified;
    expect(firstCount).toBeGreaterThan(0);

    const again = await call("POST", `/sessions/${nextWeek}/notify`, adminToken, {
      change: "cancelled",
    });
    expect(again.status).toBe(200);
    // **The second send creates nothing**, through the `(user, session, type)`
    // unique index — and says so, rather than reporting the same number twice
    // and implying people were newly told.
    expect((again.body.data as { notified: number }).notified).toBe(0);

    const rows = await prisma.notification.count({
      where: { sessionId: nextWeek, type: "session_cancelled", deletedAt: null },
    });
    expect(rows).toBe(firstCount);
  });

  it("cancelling with NO reason still notifies, and stores no reason", async () => {
    const stored = await prisma.session.findUniqueOrThrow({
      where: { id: nextWeek },
      select: { cancellationReason: true },
    });
    // R83.2 — a class is sometimes simply not held, and demanding a sentence
    // before the platform will record that is a gate with no purpose.
    expect(stored.cancellationReason).toBeNull();
    const told = await prisma.notification.count({
      where: { sessionId: nextWeek, deletedAt: null },
    });
    expect(told).toBeGreaterThan(0);
  });

  it("the actor is never among the recipients", async () => {
    const told = await prisma.notification.findMany({
      where: { sessionId: nextWeek, deletedAt: null },
      select: { userId: true },
    });
    expect(told.map((t) => t.userId)).not.toContain(adminId);
  });
});
