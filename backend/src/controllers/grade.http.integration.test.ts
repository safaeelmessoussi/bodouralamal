import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { issueAccessToken } from "../lib/access-token.js";
import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import { httpCall } from "../test-support/http-client.js";

/**
 * **Grade entry and Teacher scope over real HTTP (§4.6, BR-7, BR-8, BR-12,
 * TD-15; M5a, SRS Revision 70).**
 *
 * Two things are asserted here that no unit test can see:
 *
 * * **a score crosses the wire unchanged** (R81): 15 goes in and 15 comes back,
 *   because there is no conversion left to get wrong — and the bound it is
 *   checked against is the exam's own maximum, applied by the server;
 * * **§4.4c scope is enforced by the server**, not by a hidden button. Every
 *   capability is asserted from both sides: a Teacher inside their scope, and
 *   the same Teacher one branch, one level or one group outside it.
 *
 * **A Teacher's scope is not configuration — it is the schedules they staff.**
 * The fixtures therefore build a real `RecurringCourseSchedule` with a real
 * `CourseScheduleStaff` row, because anything less would be testing a mock of
 * the rule rather than the rule.
 *
 * Requires the compose stack with the api image built from current source:
 *   docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build api
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = "[http-grade-test]";
const YEAR_LABEL = "2097-2098";

interface Res {
  status: number;
  body: Record<string, unknown> & {
    error?: { code?: string; details?: Record<string, unknown> };
    data?: Record<string, unknown>;
  };
}

async function call(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<Res> {
  return httpCall<Res["body"]>(BASE, method, path, {
    token,
    ...(body !== undefined ? { body } : {}),
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

async function makeUser(label: string, role?: string): Promise<string> {
  const u = await prisma.user.create({
    data: {
      // R80 — every person carries a recorded sex; the column is NOT NULL.
      sex: "female",
      nameArabic: `${TAG} ${label}`,
      accountStatus: "active",
    },
  });
  if (role !== undefined) {
    const roleRow = await prisma.role.findUnique({ where: { name: role } });
    await prisma.userBranchRole.create({
      data: { userId: u.id, roleId: roleRow!.id, branchId: null },
    });
  }
  return u.id;
}

let superToken: string;
let teacherToken: string;
let outsiderToken: string;
let branchA: string;
let branchB: string;
let roomA: string;
let levelId: string;
let otherLevelId: string;
let subjectId: string;
let groupA: string;
let academicYearId: string;
let studentOne: string;
let studentTwo: string;
let examId: string;

async function clear(): Promise<void> {
  const exams = await prisma.exam.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true },
  });
  const examIds = exams.map((e) => e.id);
  if (examIds.length > 0) {
    await prisma.grade.deleteMany({ where: { examId: { in: examIds } } });
    await prisma.examStaff.deleteMany({ where: { examId: { in: examIds } } });
    await prisma.trash.deleteMany({ where: { targetId: { in: examIds } } });
    await prisma.auditLog.deleteMany({ where: { targetId: { in: examIds } } });
    // R82 — a notification RESTRICTs the exam or event it is about, deliberately:
    // a notice whose subject vanished would be unreadable. Test teardown is the
    // only place anything here is HARD-deleted (production soft-deletes), so the
    // notices go first.
    await prisma.notification.deleteMany({ where: { exam: { id: { in: examIds } } } });
    await prisma.exam.deleteMany({ where: { id: { in: examIds } } });
  }

  const schedules = await prisma.recurringCourseSchedule.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true },
  });
  const scheduleIds = schedules.map((s) => s.id);
  if (scheduleIds.length > 0) {
    await prisma.courseScheduleStaff.deleteMany({
      where: { scheduleId: { in: scheduleIds } },
    });
    await prisma.recurringCourseSchedule.deleteMany({
      where: { id: { in: scheduleIds } },
    });
  }

  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  if (userIds.length > 0) {
    await prisma.grade.deleteMany({ where: { studentId: { in: userIds } } });
    await prisma.enrollment.deleteMany({
      where: { studentId: { in: userIds } },
    });
    await prisma.auditLog.deleteMany({
      where: { actorUserId: { in: userIds } },
    });
    await prisma.auditLog.deleteMany({ where: { targetId: { in: userIds } } });
    await prisma.trash.deleteMany({ where: { deletedById: { in: userIds } } });
    await prisma.userBranchRole.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }

  const levels = await prisma.level.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  const levelIds = levels.map((l) => l.id);
  await prisma.administrativeGroup.deleteMany({
    where: { levelId: { in: levelIds } },
  });
  await prisma.levelSubject.deleteMany({
    where: { levelId: { in: levelIds } },
  });
  await prisma.level.deleteMany({ where: { id: { in: levelIds } } });
  await prisma.subject.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.room.deleteMany({
    where: { branch: { name: { startsWith: TAG } } },
  });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.academicYear.deleteMany({ where: { label: YEAR_LABEL } });
}

beforeAll(async () => {
  const health = await fetch(`${config.PUBLIC_BASE_URL}/healthz`).catch(
    () => null,
  );
  if (!health || health.status !== 200) {
    throw new Error(`API not reachable at ${config.PUBLIC_BASE_URL}/healthz`);
  }
  await clear();

  branchA = (await prisma.branch.create({ data: { name: `${TAG} فرع أ` } })).id;
  branchB = (await prisma.branch.create({ data: { name: `${TAG} فرع ب` } })).id;
  roomA = (
    await prisma.room.create({
      data: { name: `${TAG} قاعة أ`, branchId: branchA },
    })
  ).id;

  const category = await prisma.category.create({
    data: { name: `${TAG} فئة` },
  });
  levelId = (
    await prisma.level.create({
      data: {
        name: `${TAG} مستوى`,
        categoryId: category.id,
        genderRestriction: "any",
      },
    })
  ).id;
  otherLevelId = (
    await prisma.level.create({
      data: {
        name: `${TAG} مستوى آخر`,
        categoryId: category.id,
        genderRestriction: "any",
      },
    })
  ).id;
  subjectId = (await prisma.subject.create({ data: { name: `${TAG} مادة` } }))
    .id;
  await prisma.levelSubject.create({ data: { levelId, subjectId } });
  await prisma.levelSubject.create({
    data: { levelId: otherLevelId, subjectId },
  });

  groupA = (
    await prisma.administrativeGroup.create({
      data: { name: `${TAG} مجموعة أ`, levelId, branchId: branchA },
    })
  ).id;

  academicYearId = (
    await prisma.academicYear.create({ data: { label: YEAR_LABEL } })
  ).id;

  superToken = bearer(await makeUser("مدير عام", "super_admin"), [
    { role: "super_admin", branches: null },
  ]);

  // **A real staffing row — this IS the teacher's scope (§4.4c).**
  const teacherId = await makeUser("مؤطرة", "teacher");
  teacherToken = bearer(teacherId, [{ role: "teacher", branches: null }]);
  const schedule = await prisma.recurringCourseSchedule.create({
    data: {
      title: `${TAG} حصة`,
      subjectId,
      teachingMode: "administrative_group",
      administrativeGroupId: groupA,
      branchId: branchA,
      startTime: new Date("1970-01-01T09:00:00Z"),
      endTime: new Date("1970-01-01T10:00:00Z"),
      recurrence: "weekly",
      weekdays: ["monday"],
      academicYearId,
    },
  });
  await prisma.courseScheduleStaff.create({
    data: { scheduleId: schedule.id, userId: teacherId, position: "teacher" },
  });

  // Staffs nothing at all: every scope test needs the negative side.
  outsiderToken = bearer(await makeUser("مؤطرة أخرى", "teacher"), [
    { role: "teacher", branches: null },
  ]);

  studentOne = await makeUser("مستفيدة أولى");
  studentTwo = await makeUser("مستفيدة ثانية");
  for (const studentId of [studentOne, studentTwo]) {
    await prisma.enrollment.create({
      data: {
        studentId,
        levelId,
        administrativeGroupId: groupA,
        branchId: branchA,
      },
    });
  }

  const created = await call("POST", "/exams", superToken, {
      max_grade: 20,
    title: `${TAG} امتحان`,
    date: "2098-03-01",
    start_time: "09:00",
    end_time: "10:30",
    level_id: levelId,
    subject_id: subjectId,
    academic_year_id: academicYearId,
    branch_id: branchA,
    room_id: roomA,
    administrative_group_id: groupA,
  });
  expect(created.status).toBe(201);
  examId = (created.body as { id: string }).id;
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe("Teacher exam scope (§4.4c, TD-2 as split by R70.4)", () => {
  it("a Teacher may create a sitting inside the scope they staff", async () => {
    // §4.5: "teachers create exams manually". The service refused this outright
    // until R70.4 — three normative statements against one implementation.
    const res = await call("POST", "/exams", teacherToken, {
      max_grade: 20,
      title: `${TAG} امتحان المؤطرة`,
      date: "2098-04-01",
      start_time: "09:00",
      end_time: "10:00",
      level_id: levelId,
      subject_id: subjectId,
      academic_year_id: academicYearId,
      branch_id: branchA,
      room_id: roomA,
      administrative_group_id: groupA,
    });
    expect(res.status).toBe(201);
  });

  it("refuses a level the Teacher does not teach", async () => {
    const res = await call("POST", "/exams", teacherToken, {
      max_grade: 20,
      title: `${TAG} امتحان خارج النطاق`,
      date: "2098-04-02",
      start_time: "09:00",
      end_time: "10:00",
      level_id: otherLevelId,
      subject_id: subjectId,
      academic_year_id: academicYearId,
      branch_id: branchA,
      room_id: roomA,
    });
    expect(res.status).toBe(403);
    expect(res.body.error?.details?.["reason"]).toBe("EXAM_OUT_OF_SCOPE");
  });

  it("refuses a branch the Teacher does not staff", async () => {
    const res = await call("POST", "/exams", teacherToken, {
      max_grade: 20,
      title: `${TAG} امتحان فرع آخر`,
      date: "2098-04-03",
      start_time: "09:00",
      end_time: "10:00",
      level_id: levelId,
      subject_id: subjectId,
      academic_year_id: academicYearId,
      branch_id: branchB,
      room_id: roomA,
    });
    expect(res.status).toBe(403);
    expect(res.body.error?.details?.["reason"]).toBe("EXAM_OUT_OF_SCOPE");
  });

  it("refuses a WHOLE-LEVEL sitting to a Teacher who staffs only one group", async () => {
    // R70.4's stated rule: `administrative_group_id = NULL` means *everyone*,
    // and authority over everyone is held rather than inferred from authority
    // over some. A teacher of one group must not set the whole Level's paper.
    const res = await call("POST", "/exams", teacherToken, {
      max_grade: 20,
      title: `${TAG} امتحان المستوى كامل`,
      date: "2098-04-04",
      start_time: "09:00",
      end_time: "10:00",
      level_id: levelId,
      subject_id: subjectId,
      academic_year_id: academicYearId,
      branch_id: branchA,
      room_id: roomA,
    });
    expect(res.status).toBe(403);
    expect(res.body.error?.details?.["reason"]).toBe(
      "WHOLE_LEVEL_OUT_OF_SCOPE",
    );
  });

  it("a Teacher may NOT delete a sitting — deletion stays Admin (R70.4)", async () => {
    const res = await call("DELETE", `/exams/${examId}`, teacherToken);
    expect(res.status).toBe(403);
  });
});

describe("the grade sheet (§4.6, R70.1)", () => {
  it("lists the exam’s audience with NO marks — empty is not zero", async () => {
    const res = await call("GET", `/exams/${examId}/grades`, superToken);
    expect(res.status).toBe(200);
    const sheet = res.body.data as {
      rows: {
        student_id: string;
        score: number | null;
        version: number | null;
      }[];
      max_grade: number;
      has_published: boolean;
    };
    expect(sheet.rows).toHaveLength(2);
    // The distinction the whole model rests on: **no row yet**, not a zero.
    expect(sheet.rows.every((r) => r.score === null)).toBe(true);
    expect(sheet.rows.every((r) => r.version === null)).toBe(true);
    // R81 — the exam's own maximum, and nothing that could stand in for a
    // platform scale or a passing threshold.
    expect(sheet.max_grade).toBe(20);
    expect(sheet).not.toHaveProperty("display_scale");
    expect(sheet).not.toHaveProperty("passing_grade_bp");
    expect(sheet.has_published).toBe(false);
  });

  it("a Teacher outside their scope cannot read the sheet", async () => {
    const res = await call("GET", `/exams/${examId}/grades`, outsiderToken);
    expect(res.status).toBe(403);
  });

  it("a Teacher inside their scope can read it", async () => {
    const res = await call("GET", `/exams/${examId}/grades`, teacherToken);
    expect(res.status).toBe(200);
  });
});

describe("entry, BR-7 and the exam’s own maximum", () => {
  it("stores the score as given, and initialises absentees at the first draft save", async () => {
    const save = await call("PUT", `/exams/${examId}/grades`, teacherToken, {
      entries: [{ student_id: studentOne, score: 15, absent: false }],
    });
    expect(save.status).toBe(200);
    // BR-7 (R10 timing): the student nobody marked gets a draft 0/absent row at
    // this exact moment, so nothing computed from the sheet is inflated by an
    // omission.
    expect(save.body.data).toMatchObject({ saved: 1, initialised: 1 });

    const sheet = await call("GET", `/exams/${examId}/grades`, teacherToken);
    const rows = (sheet.body.data as { rows: Record<string, unknown>[] }).rows;
    const one = rows.find((r) => r["student_id"] === studentOne)!;
    const two = rows.find((r) => r["student_id"] === studentTwo)!;

    // 15/20 → 7500 bp. Round-half-up applied exactly once, on the server (R8).
    expect(one["score"]).toBe(15);
    expect(one["absent"]).toBe(false);
    
    expect(two["score"]).toBe(0);
    expect(two["absent"]).toBe(true);
      });

  it("an actual zero stays distinguishable from an absence", async () => {
    const sheet = await call("GET", `/exams/${examId}/grades`, teacherToken);
    const two = (
      sheet.body.data as { rows: Record<string, unknown>[] }
    ).rows.find((r) => r["student_id"] === studentTwo)!;

    const save = await call("PUT", `/exams/${examId}/grades`, teacherToken, {
      entries: [
        {
          student_id: studentTwo,
          score: 0,
          absent: false,
          version: two["version"] as number,
        },
      ],
    });
    expect(save.status).toBe(200);

    const after = await call("GET", `/exams/${examId}/grades`, teacherToken);
    const row = (
      after.body.data as { rows: Record<string, unknown>[] }
    ).rows.find((r) => r["student_id"] === studentTwo)!;
    // Same number, different fact: marked and scored nothing, vs sat nothing.
    expect(row["score"]).toBe(0);
    expect(row["absent"]).toBe(false);
  });

  it("refuses a student who is not sitting this exam", async () => {
    const stranger = await makeUser("غريبة");
    const res = await call("PUT", `/exams/${examId}/grades`, superToken, {
      entries: [{ student_id: stranger, score: 10, absent: false }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error?.details?.["reason"]).toBe("NOT_IN_AUDIENCE");
  });

  it("refuses a stale version — two people editing one sheet (TD-15)", async () => {
    // The real scenario, not a made-up number: both editors load the sheet, the
    // first saves, and the second submits the version they loaded. A fresh row
    // is version **0**, so asserting `version: 0` conflicts would have tested
    // nothing — it is the value a first save legitimately carries.
    const loaded = await call("GET", `/exams/${examId}/grades`, teacherToken);
    const before = (
      loaded.body.data as { rows: Record<string, unknown>[] }
    ).rows.find((r) => r["student_id"] === studentOne)!;
    const stale = before["version"] as number;

    const first = await call("PUT", `/exams/${examId}/grades`, teacherToken, {
      entries: [
        { student_id: studentOne, score: 12, absent: false, version: stale },
      ],
    });
    expect(first.status).toBe(200);

    const second = await call("PUT", `/exams/${examId}/grades`, teacherToken, {
      entries: [
        { student_id: studentOne, score: 19, absent: false, version: stale },
      ],
    });
    expect(second.status).toBe(409);
    expect(second.body.error?.code).toBe("VERSION_CONFLICT");
  });

  it("a Teacher outside their scope cannot enter grades", async () => {
    const res = await call("PUT", `/exams/${examId}/grades`, outsiderToken, {
      entries: [{ student_id: studentOne, score: 20, absent: false }],
    });
    expect(res.status).toBe(403);
  });
});

describe("publish, amend, re-publish (BR-8)", () => {
  it("publishes, then makes an amendment invisible until re-published", async () => {
    const published = await call(
      "POST",
      `/exams/${examId}/grades/publish`,
      teacherToken,
    );
    expect(published.status).toBe(200);
    expect(published.body.data).toMatchObject({ republished: false });

    let sheet = await call("GET", `/exams/${examId}/grades`, teacherToken);
    let body = sheet.body.data as {
      rows: Record<string, unknown>[];
      has_published: boolean;
    };
    expect(body.has_published).toBe(true);
    expect(body.rows.every((r) => r["status"] === "published")).toBe(true);

    // BR-8: "recalculated grades require explicit re-publish before the new
    // values are visible". Amending must therefore return the row to draft.
    const one = body.rows.find((r) => r["student_id"] === studentOne)!;
    const amended = await call("PUT", `/exams/${examId}/grades`, teacherToken, {
      entries: [
        {
          student_id: studentOne,
          score: 18,
          absent: false,
          version: one["version"] as number,
        },
      ],
    });
    expect(amended.status).toBe(200);

    sheet = await call("GET", `/exams/${examId}/grades`, teacherToken);
    body = sheet.body.data as {
      rows: Record<string, unknown>[];
      has_published: boolean;
    };
    const after = body.rows.find((r) => r["student_id"] === studentOne)!;
    expect(after["status"]).toBe("draft");
    expect(after["score"]).toBe(18);

    const again = await call(
      "POST",
      `/exams/${examId}/grades/publish`,
      teacherToken,
    );
    expect(again.status).toBe(200);
    // Anything previously published makes this a RE-publish, which TD-8 records
    // as its own action rather than leaving the trail to infer it.
    expect(again.body.data).toMatchObject({ republished: true });
  });

  it("a Teacher outside their scope cannot publish", async () => {
    const res = await call(
      "POST",
      `/exams/${examId}/grades/publish`,
      outsiderToken,
    );
    expect(res.status).toBe(403);
  });
});

describe("an exam that predates Revision 58", () => {
  it("is refused with a coded reason rather than a 500", async () => {
    // **Found against the live database, not by a fixture.** Every fixture here
    // builds a post-R58 sitting; the real database still holds rows created
    // when an exam carried no branch and no subject, and the sheet answered
    // `500 INTERNAL` for them because an empty string reached a uuid column.
    const legacy = await prisma.exam.create({
      data: {
        title: `${TAG} امتحان قديم`,
        mode: "physical",
        maxGrade: 20,
        levelId,
        date: new Date("2024-05-05T00:00:00Z"),
        questions: [],
      },
    });

    const res = await call("GET", `/exams/${legacy.id}/grades`, superToken);
    expect(res.status).toBe(409);
    expect(res.body.error?.details?.["reason"]).toBe("EXAM_INCOMPLETE");
  });
});

describe("retroactively recorded exams (R70.5)", () => {
  it("accepts a past date and derives «سُجّل لاحقًا» without storing it", async () => {
    const created = await call("POST", "/exams", superToken, {
      max_grade: 20,
      title: `${TAG} امتحان سابق`,
      date: "2020-01-15",
      start_time: "09:00",
      end_time: "10:00",
      level_id: levelId,
      subject_id: subjectId,
      academic_year_id: academicYearId,
      branch_id: branchA,
      room_id: roomA,
      administrative_group_id: groupA,
    });
    // No past-date restriction exists at any layer, and none is added: R58 says
    // an exam needs no term boundary to exist.
    expect(created.status).toBe(201);

    const sheet = await call(
      "GET",
      `/exams/${(created.body as { id: string }).id}/grades`,
      superToken,
    );
    const exam = (sheet.body.data as { exam: Record<string, unknown> }).exam;
    // Derived from `created_at > date` at read time — there is no column.
    expect(exam["recorded_late"]).toBe(true);

    const columns = Object.keys(
      (await prisma.exam.findFirst({
        where: { id: (created.body as { id: string }).id },
      }))!,
    );
    expect(columns).not.toContain("recordedLate");
    expect(columns).not.toContain("isRetroactive");
  });

  it("an exam recorded on its own date is not flagged", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const created = await call("POST", "/exams", superToken, {
      max_grade: 20,
      title: `${TAG} امتحان اليوم`,
      date: today,
      start_time: "09:00",
      end_time: "10:00",
      level_id: levelId,
      subject_id: subjectId,
      academic_year_id: academicYearId,
      branch_id: branchA,
      room_id: roomA,
      administrative_group_id: groupA,
    });
    expect(created.status).toBe(201);
    const sheet = await call(
      "GET",
      `/exams/${(created.body as { id: string }).id}/grades`,
      superToken,
    );
    expect(
      (sheet.body.data as { exam: Record<string, unknown> }).exam[
        "recorded_late"
      ],
    ).toBe(false);
  });
});

/**
 * **§5.3 — a مستفيدة sees her own published grades** (`GET /students/me/grades`).
 *
 * §5.3 and §14.1 have listed `/dashboard/student/grades` since R62 and **nothing
 * rendered it**: a مؤطرة could publish a grade and the student it was about had
 * no way to see it. TD-3.3 already names *grades* among the student-context reads
 * resolved per §4.3, which is the clause `GET /students/me/quran` also ships
 * under, so this closes a surface rather than opening a contract.
 *
 * The four properties below are the whole of it, and each is asserted from **both
 * sides** — the draft is invisible *and* the published one is visible; the child's
 * parent can read it *and* a stranger's parent cannot.
 */
describe("the student’s own published grades (§5.3)", () => {
  /** A fresh sitting, so publishing here cannot disturb the suite's other tests. */
  let ownExam: string;

  beforeAll(async () => {
    const created = await call("POST", "/exams", superToken, {
      max_grade: 20,
      title: `${TAG} امتحان المستفيدة`,
      date: "2098-04-01",
      start_time: "09:00",
      end_time: "10:00",
      level_id: levelId,
      subject_id: subjectId,
      academic_year_id: academicYearId,
      branch_id: branchA,
      room_id: roomA,
      administrative_group_id: groupA,
    });
    expect(created.status).toBe(201);
    ownExam = (created.body as { id: string }).id;

    // 15/20 for the first student, absent for the second — the two shapes the
    // row can take (BR-7).
    const saved = await call("PUT", `/exams/${ownExam}/grades`, superToken, {
      entries: [
        { student_id: studentOne, score: 15, absent: false },
        { student_id: studentTwo, score: null, absent: true },
      ],
    });
    expect(saved.status).toBe(200);
  });

  it("a DRAFT grade is invisible to the student it is about (BR-8)", async () => {
    // Not merely hidden by the client: the server's query selects
    // `status: 'published'`, so there is nothing to hide.
    //
    // **Scoped to THIS exam rather than asserting an empty list.** The suite's
    // publish/amend tests above legitimately leave `studentOne` holding a
    // published grade for the main sitting, so an empty-list assertion was
    // asserting the fixtures rather than the rule — and it would have passed only
    // as long as no earlier test published anything.
    const res = await call(
      "GET",
      "/students/me/grades",
      bearer(studentOne, [{ role: "student", branches: null }]),
    );
    expect(res.status).toBe(200);
    const rows = res.body.data as unknown as Record<string, unknown>[];
    expect(rows.some((r) => r["exam_id"] === ownExam)).toBe(false);
  });

  it("the same grade becomes visible once published, on the association’s scale", async () => {
    const published = await call(
      "POST",
      `/exams/${ownExam}/grades/publish`,
      superToken,
    );
    expect(published.status).toBe(200);

    const res = await call(
      "GET",
      "/students/me/grades",
      bearer(studentOne, [{ role: "student", branches: null }]),
    );
    expect(res.status).toBe(200);
    const rows = res.body.data as unknown as Record<string, unknown>[];
    const row = rows.find((r) => r["exam_id"] === ownExam);
    expect(row).toBeDefined();
    // R81 — the score as given, beside the maximum it is out of. No conversion
    // happened in either direction, and no `meta` scale accompanies it.
    expect(row!["score"]).toBe(15);
    expect(row!["max_grade"]).toBe(20);
    expect(row!["absent"]).toBe(false);
    expect(res.body.meta).toBeUndefined();
  });

  it("carries no pass/fail verdict — a mark is a fact, «راسبة» is a verdict", async () => {
    // The Owner's decision of 2026-08-17, completed by R81: the verdict is gone
    // from the model too, so there is nothing left anywhere to leak here. The
    // key set is asserted exactly, so a field added by reflex to a screen a
    // child looks at is caught.
    const res = await call(
      "GET",
      "/students/me/grades",
      bearer(studentOne, [{ role: "student", branches: null }]),
    );
    const rows = res.body.data as unknown as Record<string, unknown>[];
    const row = rows.find((r) => r["exam_id"] === ownExam)!;
    expect(Object.keys(row).sort()).toEqual(
      [
        "absent",
        "date",
        "exam_id",
        "exam_title",
        "level_name",
        "subject_name",
        "score",
        "max_grade",
      ].sort(),
    );
    expect(row).not.toHaveProperty("passed");
    expect(row).not.toHaveProperty("manual_pass_fail_override");
    expect(row).not.toHaveProperty("value_bp");
    expect(row).not.toHaveProperty("status");
  });

  it("an absent student reads her absence, not a zero", async () => {
    // BR-7 stores the absentee as a real `0` so draft averages are not inflated
    // by omission — and reporting that 0 as a mark would tell her she scored
    // nothing on a sitting she did not attend.
    const res = await call(
      "GET",
      "/students/me/grades",
      bearer(studentTwo, [{ role: "student", branches: null }]),
    );
    const rows = res.body.data as unknown as Record<string, unknown>[];
    const row = rows.find((r) => r["exam_id"] === ownExam)!;
    expect(row["absent"]).toBe(true);
  });

  it("one student never sees another’s grade", async () => {
    // There is no id in the path, so this is not a check that could be bypassed —
    // it is the absence of anywhere to name someone else (TD-12, R63.3).
    //
    // Asserted as a DIFFERENCE between the two callers on the same exam, not as
    // the absence of a particular number: two students may legitimately score the
    // same mark, so `mark !== 15` would be a coincidence test.
    const one = await call(
      "GET",
      "/students/me/grades",
      bearer(studentOne, [{ role: "student", branches: null }]),
    );
    const two = await call(
      "GET",
      "/students/me/grades",
      bearer(studentTwo, [{ role: "student", branches: null }]),
    );
    const rowFor = (res: Res): Record<string, unknown> =>
      (res.body.data as unknown as Record<string, unknown>[]).find(
        (r) => r["exam_id"] === ownExam,
      )!;

    // One row each for this sitting — never both students' rows on one list.
    expect(
      (one.body.data as unknown as Record<string, unknown>[]).filter(
        (r) => r["exam_id"] === ownExam,
      ),
    ).toHaveLength(1);
    expect(
      (two.body.data as unknown as Record<string, unknown>[]).filter(
        (r) => r["exam_id"] === ownExam,
      ),
    ).toHaveLength(1);

    // And each reads her OWN outcome: a mark for the one who sat it, an absence
    // for the one who did not.
    expect(rowFor(one)["absent"]).toBe(false);
    expect(rowFor(one)["score"]).toBe(15);
    expect(rowFor(two)["absent"]).toBe(true);
  });

  it("a parent-only caller with no child header is refused (§4.3)", async () => {
    const res = await call(
      "GET",
      "/students/me/grades",
      bearer(await makeUser("والدة بلا طفل"), [
        { role: "parent", branches: null },
      ]),
    );
    // `400 VALIDATION_FAILED` — the same answer `GET /students/me` gives, because
    // it is the same middleware resolving the same question (R63.6).
    expect(res.status).toBe(400);
  });
});
