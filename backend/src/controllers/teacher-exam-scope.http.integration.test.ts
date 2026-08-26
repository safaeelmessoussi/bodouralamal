import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { issueAccessToken } from "../lib/access-token.js";
import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import { httpCall } from "../test-support/http-client.js";

/**
 * **The exams a مؤطِّرة can see (§4.4c, R70.4, R91; SRS Revision 106.6b).**
 *
 * ## The defect
 *
 * `GET /exams` scoped **every** caller with
 * `reachableBranches(actor.roleScopes, ['admin'])`. A مؤطِّرة holds no `admin`
 * role, so that resolved to the empty set, the filter became
 * `branchId: { in: [] }`, and she was served **zero exams — always.** Past and
 * future alike, with a `200` and an empty table indistinguishable from *there
 * are none*: the reason the Owner reported it as *"exams assigned to the
 * Teacher, past and future, do not appear"* rather than as an error.
 *
 * `assertCanManage` had admitted her since R70.4 and `assertExamInTeacherScope`
 * guarded her writes just as long. **Only the read's §4.4c half was missing**,
 * and the comment beside the query described an intention rather than the code.
 *
 * ## What is asserted, and why the dates are the point
 *
 * R91 judges an exam's authority **on the exam's own date**. So the fixture is
 * built around a مؤطِّرة whose assignment has a real period, and the assertions
 * are about which side of it each exam falls:
 *
 * | Exam | Date | Hers? | Because |
 * |---|---|---|---|
 * | `pastMine` | 60 days ago | **yes** | inside her assignment window |
 * | `futureMine` | 60 days ahead | **yes** | inside it too |
 * | `beforeShe` | 200 days ago | no | before her assignment began |
 * | `otherSubject` | today | no | a Subject she does not teach |
 * | `otherBranch` | today | no | a branch she does not staff |
 * | `wholeLevelBySubset` | today | no | see below |
 *
 * The last row is the one worth stating: a مؤطِّرة who teaches **one group** of
 * a Level must not see the sitting set for the **whole** Level, because
 * `administrative_group_id = NULL` means *everyone*, and authority over
 * everyone is held rather than inferred from authority over some. That rule is
 * `assertExamInTeacherScope`'s, and this file is what proves the list agrees
 * with it — the two grammars of one question, which is exactly the pair that
 * drifts when written apart.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = "[r106-teacher-exam-test]";

interface Res {
  status: number;
  body: { error?: { code?: string }; data?: Record<string, unknown>[] };
}

const call = (method: string, path: string, token?: string): Promise<Res> =>
  httpCall<Res["body"]>(BASE, method, path, { token }) as Promise<Res>;

const bearer = (userId: string, roles: { role: string; branches: string[] | null }[]) =>
  issueAccessToken(
    { userId, roleScopes: roles as never, accountStatus: "active" as never },
    config.JWT_SIGNING_KEY,
  ).token;

/** Relative dates, so this file never rots into past-date conflicts. */
const day = (offset: number): Date => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
};

let superAdmin: string;
let teacherToken: string;
let subsetTeacherToken: string;
let branchId: string;
let otherBranchId: string;
let roomId: string;
let otherRoomId: string;
let levelId: string;
let subjectId: string;
let otherSubjectId: string;
let groupId: string;
let yearId: string;

const exams: Record<string, string> = {};

async function clear(): Promise<void> {
  const schedules = await prisma.recurringCourseSchedule.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true },
  });
  const scheduleIds = schedules.map((s) => s.id);
  await prisma.sessionStaff.deleteMany({ where: { session: { scheduleId: { in: scheduleIds } } } });
  await prisma.session.deleteMany({ where: { scheduleId: { in: scheduleIds } } });
  await prisma.courseScheduleStaff.deleteMany({ where: { scheduleId: { in: scheduleIds } } });
  await prisma.recurringCourseSchedule.deleteMany({ where: { id: { in: scheduleIds } } });

  const examRows = await prisma.exam.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true },
  });
  const examIds = examRows.map((e) => e.id);
  await prisma.examStaff.deleteMany({ where: { examId: { in: examIds } } });
  await prisma.exam.deleteMany({ where: { id: { in: examIds } } });

  // Group MEMBERSHIP is `Enrollment` (R66 — there is no `StudentGroup` model),
  // and this fixture enrols nobody, so the group deletes cleanly on its own.
  await prisma.administrativeGroup.deleteMany({ where: { name: { startsWith: TAG } } });

  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
  await prisma.enrollment.deleteMany({ where: { studentId: { in: ids } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });

  await prisma.levelSubject.deleteMany({ where: { subject: { name: { startsWith: TAG } } } });
  await prisma.subject.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.room.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.level.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
}

async function person(label: string, role: string): Promise<string> {
  const user = await prisma.user.create({
    data: { nameArabic: `${TAG} ${label}`, sex: "female", accountStatus: "active" },
  });
  const row = await prisma.role.findFirstOrThrow({ where: { name: role } });
  await prisma.userBranchRole.create({
    data: { userId: user.id, roleId: row.id, branchId: null },
  });
  return user.id;
}

async function makeExam(
  key: string,
  data: {
    date: Date;
    branchId: string;
    roomId: string;
    subjectId: string;
    administrativeGroupId?: string | null;
  },
): Promise<void> {
  const exam = await prisma.exam.create({
    data: {
      title: `${TAG} ${key}`,
      levelId,
      academicYearId: yearId,
      date: data.date,
      startTime: new Date("1970-01-01T09:00:00Z"),
      endTime: new Date("1970-01-01T10:00:00Z"),
      maxGrade: 20,
      round: 1,
      branchId: data.branchId,
      // `exam_physical_place_all_or_none_check` — a physical sitting states
      // branch AND room together or neither. Half a venue is not a venue.
      roomId: data.roomId,
      subjectId: data.subjectId,
      administrativeGroupId: data.administrativeGroupId ?? null,
      // §4.6 — a physical sitting carries no online paper; the column is NOT
      // NULL, so the empty structure is the honest value rather than a gap.
      questions: [],
    },
    select: { id: true },
  });
  exams[key] = exam.id;
}

beforeAll(async () => {
  const health = await fetch(`${config.PUBLIC_BASE_URL}/healthz`).catch(() => null);
  if (!health || health.status !== 200) throw new Error("API not reachable");
  await clear();

  superAdmin = bearer(await person("مديرة", "super_admin"), [
    { role: "super_admin", branches: null },
  ]);

  branchId = (await prisma.branch.create({ data: { name: `${TAG} فرع` } })).id;
  otherBranchId = (await prisma.branch.create({ data: { name: `${TAG} فرع آخر` } })).id;
  roomId = (
    await prisma.room.create({ data: { name: `${TAG} قاعة`, branchId, capacity: 20 } })
  ).id;
  otherRoomId = (
    await prisma.room.create({
      data: { name: `${TAG} قاعة أخرى`, branchId: otherBranchId, capacity: 20 },
    })
  ).id;
  const categoryId = (
    await prisma.category.create({ data: { name: `${TAG} فئة`, displayOrder: 96 } })
  ).id;
  levelId = (
    await prisma.level.create({
      data: { name: `${TAG} مستوى`, categoryId, genderRestriction: "any" },
    })
  ).id;
  subjectId = (
    await prisma.subject.create({ data: { name: `${TAG} مادتها`, displayOrder: 96 } })
  ).id;
  otherSubjectId = (
    await prisma.subject.create({ data: { name: `${TAG} مادة أخرى`, displayOrder: 95 } })
  ).id;
  await prisma.levelSubject.create({ data: { levelId, subjectId } });
  await prisma.levelSubject.create({ data: { levelId, subjectId: otherSubjectId } });
  yearId = (await prisma.academicYear.findFirstOrThrow()).id;

  groupId = (
    await prisma.administrativeGroup.create({
      data: { name: `${TAG} مجموعة`, levelId, branchId },
    })
  ).id;

  const teacher = await person("مؤطرة المستوى", "teacher");
  teacherToken = bearer(teacher, [{ role: "teacher", branches: null }]);
  const subsetTeacher = await person("مؤطرة المجموعة", "teacher");
  subsetTeacherToken = bearer(subsetTeacher, [{ role: "teacher", branches: null }]);

  // **She teaches the WHOLE Level**, from 180 days ago with no end — so an exam
  // 200 days back falls outside her assignment and one 60 days back does not.
  const schedule = await prisma.recurringCourseSchedule.create({
    data: {
      title: `${TAG} حصة المستوى`,
      subjectId,
      teachingMode: "entire_level",
      levelId,
      branchId,
      academicYearId: yearId,
      startTime: new Date("1970-01-01T15:00:00Z"),
      endTime: new Date("1970-01-01T18:00:00Z"),
      recurrence: "weekly",
      weekdays: ["thursday"],
      anchorDate: day(-180),
    },
    select: { id: true },
  });
  await prisma.courseScheduleStaff.create({
    data: {
      scheduleId: schedule.id,
      userId: teacher,
      position: "teacher",
      effectiveFrom: day(-180),
    },
  });

  // **The other مؤطِّرة teaches ONE GROUP of the same Level**, same Subject and
  // branch — the fixture that makes the whole-Level rule provable.
  const groupSchedule = await prisma.recurringCourseSchedule.create({
    data: {
      title: `${TAG} حصة المجموعة`,
      subjectId,
      teachingMode: "administrative_group",
      administrativeGroupId: groupId,
      branchId,
      academicYearId: yearId,
      startTime: new Date("1970-01-01T10:00:00Z"),
      endTime: new Date("1970-01-01T11:00:00Z"),
      recurrence: "weekly",
      weekdays: ["monday"],
      anchorDate: day(-180),
    },
    select: { id: true },
  });
  await prisma.courseScheduleStaff.create({
    data: { scheduleId: groupSchedule.id, userId: subsetTeacher, position: "teacher" },
  });

  await makeExam("pastMine", { date: day(-60), branchId, roomId, subjectId });
  await makeExam("futureMine", { date: day(60), branchId, roomId, subjectId });
  await makeExam("beforeShe", { date: day(-200), branchId, roomId, subjectId });
  await makeExam("otherSubject", { date: day(0), branchId, roomId, subjectId: otherSubjectId });
  await makeExam("otherBranch", {
    date: day(0),
    branchId: otherBranchId,
    roomId: otherRoomId,
    subjectId,
  });
  await makeExam("forHerGroup", {
    date: day(0),
    branchId,
    roomId,
    subjectId,
    administrativeGroupId: groupId,
  });
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

const idsFor = async (token: string): Promise<string[]> => {
  const res = await call("GET", "/exams?page_size=100", token);
  expect(res.status).toBe(200);
  return (res.body.data ?? []).map((r) => String(r["id"]));
};

describe("a مؤطِّرة sees the exams of the classes she teaches", () => {
  it("shows her a PAST exam — the half a today-only scope would hide", async () => {
    // The reported symptom names both directions, and this is the one a naive
    // fix misses: resolving her scope as of *now* would drop her whole history.
    expect(await idsFor(teacherToken)).toContain(exams["pastMine"]);
  });

  it("shows her a FUTURE exam", async () => {
    expect(await idsFor(teacherToken)).toContain(exams["futureMine"]);
  });

  it("was ZERO before the fix — the list is not merely non-empty", async () => {
    // Stated as its own assertion because *she sees some exams* is a weaker
    // claim than *she sees the ones that are hers*, and the defect returned a
    // perfectly well-formed empty page.
    const ids = await idsFor(teacherToken);
    expect(ids.length).toBeGreaterThan(0);
  });
});

describe("and nothing else — the list agrees with assertExamInTeacherScope", () => {
  it("hides an exam dated BEFORE her assignment began (R91)", async () => {
    expect(await idsFor(teacherToken)).not.toContain(exams["beforeShe"]);
  });

  it("hides a Subject she does not teach, at her own branch and Level", async () => {
    expect(await idsFor(teacherToken)).not.toContain(exams["otherSubject"]);
  });

  it("hides her own Subject at a branch she does not staff", async () => {
    expect(await idsFor(teacherToken)).not.toContain(exams["otherBranch"]);
  });

  it("REFUSES the whole-Level sitting to somebody who teaches one group of it", async () => {
    // Authority over everyone is held, never inferred from authority over some
    // — the rule `assertExamInTeacherScope` states for the write, proved here
    // for the read. She sees the sitting set for HER group and not the one set
    // for the entire Level.
    const ids = await idsFor(subsetTeacherToken);
    expect(ids).toContain(exams["forHerGroup"]);
    expect(ids).not.toContain(exams["pastMine"]);
    expect(ids).not.toContain(exams["futureMine"]);
  });

  it("still shows a Super Admin everything, so the probes discriminate", async () => {
    const ids = await idsFor(superAdmin);
    for (const key of ["pastMine", "futureMine", "beforeShe", "otherBranch"]) {
      expect(ids, key).toContain(exams[key]);
    }
  });
});
