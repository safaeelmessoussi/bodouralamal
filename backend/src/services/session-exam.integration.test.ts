/**
 * **R269 — a class occurrence changed into an exam that replaces it**
 * (the Owner, 2026-11-14), against a real database.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import type { RoleScope } from "../policies/branch-scope.js";
import type { Actor } from "../policies/actor.js";
import { createLevel } from "./level.service.js";
import { createCourseSchedule } from "./course-schedule.service.js";
import { readCalendar } from "./calendar.service.js";
import { deleteExam } from "./exam.service.js";
import { authorizeJoin } from "./online-class.service.js";
import { convertSessionToExam, readExamConversion } from "./session-exam.service.js";
import { cancelSession } from "./session.service.js";
import { convertToExamSchema } from "../validators/session.validators.js";

const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = "[session-exam-r269]";

const CLASS_DATE = "2026-06-09";
const DURING = new Date(`${CLASS_DATE}T15:30:00+01:00`);
const NOW = new Date("2026-06-01T08:00:00.000Z");
const at = (hh: number, mm = 0): Date => new Date(Date.UTC(1970, 0, 1, hh, mm, 0));
const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

let adminId: string;
let branchA: string;
let levelId: string;
let otherLevelId: string;
let roomId: string;
let subjectId: string;
let academicYearId: string;
let examTypeId: string;
let classTypeId: string;

const actorOf = (userId: string, scopes: RoleScope[]): Actor => ({
  userId,
  roles: scopes.map((s) => s.role),
  roleScopes: scopes,
});
const superAdmin = (): Actor => actorOf(adminId, [{ role: "super_admin", branches: null }]);
const viewer = (actor: Actor) => ({ ...actor, accountStatus: "active" });

async function person(label: string, roles: { role: string; branchId: string | null }[] = []): Promise<string> {
  const user = await prisma.user.create({
    data: { sex: "female", nameArabic: `${TAG} ${label}`, accountStatus: "active" },
  });
  for (const assignment of roles) {
    const role = await prisma.role.findFirstOrThrow({ where: { name: assignment.role }, select: { id: true } });
    await prisma.userBranchRole.create({ data: { userId: user.id, roleId: role.id, branchId: assignment.branchId } });
  }
  return user.id;
}

async function aClass(online: boolean): Promise<{ scheduleId: string; sessionId: string }> {
  const { id } = await createCourseSchedule(
    prisma,
    superAdmin(),
    {
      subjectId,
      teachingMode: "entire_level",
      targetId: levelId,
      branchId: branchA,
      roomId: online ? null : roomId,
      startTime: at(15),
      endTime: at(17),
      recurrence: "weekly",
      weekdays: ["tuesday"],
      academicYearId,
      staff: [],
      ...(online ? { deliveryMode: "online" as const, onlineMediaMode: "audio_video" as const } : {}),
    },
    NOW,
  );
  const session = await prisma.session.findFirstOrThrow({
    where: { scheduleId: id, date: day(CLASS_DATE) },
    select: { id: true },
  });
  return { scheduleId: id, sessionId: session.id };
}

async function teacherOf(scheduleId: string): Promise<{ id: string; actor: Actor }> {
  const id = await person("مؤطِّرة", [{ role: "teacher", branchId: branchA }]);
  await prisma.courseScheduleStaff.create({ data: { scheduleId, userId: id, position: "teacher" } });
  return { id, actor: actorOf(id, [{ role: "teacher", branches: [branchA] }]) };
}

async function version(sessionId: string): Promise<number> {
  return (await prisma.session.findUniqueOrThrow({ where: { id: sessionId }, select: { version: true } })).version;
}

async function convert(actor: Actor, sessionId: string, over: Partial<{ levelId: string; schedulingTypeId: string }> = {}) {
  return convertSessionToExam(prisma, actor, sessionId, {
    schedulingTypeId: over.schedulingTypeId ?? examTypeId,
    levelId: over.levelId ?? levelId,
    subjectId,
    surahId: null,
    maxGrade: 10,
    version: await version(sessionId),
  });
}

async function cleanup(): Promise<void> {
  const tagged = { name: { startsWith: TAG } };
  const taggedPerson = { nameArabic: { startsWith: TAG } };
  const scheduleWhere = { schedule: { subject: tagged } };
  await prisma.examStaff.deleteMany({ where: { exam: { subject: tagged } } });
  await prisma.notification.deleteMany({ where: { user: taggedPerson } });
  await prisma.notification.deleteMany({ where: { exam: { subject: tagged } } });
  await prisma.trash.deleteMany({ where: { targetId: { in: (await prisma.exam.findMany({ where: { subject: tagged }, select: { id: true } })).map((e) => e.id) } } });
  await prisma.exam.deleteMany({ where: { subject: tagged } });
  await prisma.sessionStaff.deleteMany({ where: { session: scheduleWhere } });
  await prisma.notification.deleteMany({ where: { session: scheduleWhere } });
  await prisma.session.deleteMany({ where: scheduleWhere });
  await prisma.courseScheduleStaff.deleteMany({ where: { schedule: { subject: tagged } } });
  await prisma.recurringCourseSchedule.deleteMany({ where: { subject: tagged } });
  await prisma.enrollment.deleteMany({ where: { student: taggedPerson } });
  await prisma.levelSubject.deleteMany({ where: { subject: tagged } });
  await prisma.userBranchRole.deleteMany({ where: { user: taggedPerson } });
  await prisma.auditLog.deleteMany({ where: { actor: taggedPerson } });
  await prisma.user.deleteMany({ where: taggedPerson });
  await prisma.subject.deleteMany({ where: tagged });
  await prisma.schedulingType.deleteMany({ where: tagged });
  await prisma.level.deleteMany({ where: tagged });
  await prisma.room.deleteMany({ where: tagged });
  await prisma.branch.deleteMany({ where: tagged });
  await prisma.category.deleteMany({ where: tagged });
}

beforeEach(async () => {
  await cleanup();
  adminId = await person("المسؤولة", [{ role: "super_admin", branchId: null }]);
  const categoryId = (await prisma.category.create({ data: { name: `${TAG} النساء` } })).id;
  branchA = (
    await prisma.branch.create({ data: { name: `${TAG} تاركة`, operationalStartDate: day("2026-01-01") } })
  ).id;
  levelId = (
    await createLevel(prisma, superAdmin(), { name: `${TAG} المستوى 1`, categoryId, genderRestriction: "any" })
  ).level.id;
  otherLevelId = (
    await createLevel(prisma, superAdmin(), { name: `${TAG} المستوى 2`, categoryId, genderRestriction: "any" })
  ).level.id;
  roomId = (await prisma.room.create({ data: { name: `${TAG} قاعة 5`, branchId: branchA } })).id;
  subjectId = (await prisma.subject.create({ data: { name: `${TAG} تفسير القرآن` } })).id;
  await prisma.levelSubject.create({ data: { levelId, subjectId } });
  await prisma.levelSubject.create({ data: { levelId: otherLevelId, subjectId } });
  academicYearId = (await prisma.academicYear.findFirstOrThrow({ select: { id: true } })).id;
  examTypeId = (
    await prisma.schedulingType.create({
      data: { name: `${TAG} اختبار`, structuralKind: "exam", attendanceMode: "disabled", displayOrder: 900 },
    })
  ).id;
  classTypeId = (
    await prisma.schedulingType.create({
      data: { name: `${TAG} حصة`, structuralKind: "class", attendanceMode: "disabled", displayOrder: 901 },
    })
  ).id;
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("R269 — «تعديل الحصة» → النوع: اختبار", () => {
  it("offers the class's own choices, prefilled", async () => {
    const { scheduleId, sessionId } = await aClass(false);
    const { actor } = await teacherOf(scheduleId);
    const facts = await readExamConversion(prisma, actor, sessionId);
    expect(facts.exam_types.map((t) => t.id)).toContain(examTypeId);
    expect(facts.exam_types.map((t) => t.id)).not.toContain(classTypeId);
    expect(facts.levels.map((l) => l.id)).toEqual([levelId]);
    expect(facts.levels[0]!.category_name).toBe(`${TAG} النساء`);
    expect(facts.levels[0]!.subjects.map((s) => s.id)).toContain(subjectId);
    expect(facts.level_id).toBe(levelId);
    expect(facts.subject_id).toBe(subjectId);
    expect(facts.max_grade).toBe(20);
  });

  it("the مؤطِّرة changes her class into an exam that keeps its place, time, people and staff", async () => {
    const { scheduleId, sessionId } = await aClass(false);
    const teacher = await teacherOf(scheduleId);
    const { examId } = await convert(teacher.actor, sessionId);

    const exam = await prisma.exam.findUniqueOrThrow({
      where: { id: examId },
      include: { staff: { where: { deletedAt: null } } },
    });
    expect(exam).toMatchObject({
      mode: "physical",
      status: "published",
      replacesSession: true,
      targetKind: "session",
      sessionId,
      branchId: branchA,
      roomId,
      levelId,
      subjectId,
      schedulingTypeId: examTypeId,
      date: day(CLASS_DATE),
      startTime: at(15),
      endTime: at(17),
    });
    expect(Number(exam.maxGrade)).toBe(10);
    expect(exam.title).not.toBe("—");
    expect(exam.staff.map((s) => [s.userId, s.position])).toEqual([[teacher.id, "supervisor"]]);
    // Kept, and spared by any schedule regeneration.
    const session = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
    expect(session.overridden).toBe(true);
    expect(session.status).toBe("scheduled");
    expect(
      await prisma.auditLog.count({ where: { targetId: sessionId, actionType: "session.convert_to_exam" } }),
    ).toBe(1);
  });

  it("the calendar shows the exam in the class's place, and the class not at all", async () => {
    const { sessionId } = await aClass(false);
    const { examId } = await convert(superAdmin(), sessionId);
    const shown = await readCalendar(prisma, viewer(superAdmin()), { from: day(CLASS_DATE), to: day(CLASS_DATE) });
    expect(shown.some((o) => o.id === sessionId)).toBe(false);
    const exam = shown.find((o) => o.id === examId);
    expect(exam?.kind).toBe("exam");
    expect(exam?.replacedSessionId).toBe(sessionId);
  });

  it("a class عن بُعد becomes an exam held in the class's own call: no room, the same door", async () => {
    const { scheduleId, sessionId } = await aClass(true);
    const teacher = await teacherOf(scheduleId);
    const { examId } = await convert(teacher.actor, sessionId);
    expect((await prisma.exam.findUniqueOrThrow({ where: { id: examId } })).roomId).toBeNull();

    const shown = await readCalendar(prisma, viewer(superAdmin()), { from: day(CLASS_DATE), to: day(CLASS_DATE) });
    const exam = shown.find((o) => o.id === examId);
    expect(exam?.deliveryMode).toBe("online");
    expect(exam?.onlineJoin?.ended).toBe(false);
    // Its people still enter the class's room.
    await expect(authorizeJoin(prisma, teacher.actor, sessionId, undefined, DURING)).resolves.toMatchObject({
      role: "teacher",
    });
  });

  it("deleting the exam changes it back: the class returns, and may be changed again", async () => {
    const { scheduleId, sessionId } = await aClass(false);
    const teacher = await teacherOf(scheduleId);
    const { examId } = await convert(teacher.actor, sessionId);
    await deleteExam(prisma, teacher.actor, examId);

    const shown = await readCalendar(prisma, viewer(superAdmin()), { from: day(CLASS_DATE), to: day(CLASS_DATE) });
    expect(shown.some((o) => o.id === sessionId)).toBe(true);
    expect(shown.some((o) => o.id === examId)).toBe(false);
    await expect(convert(teacher.actor, sessionId)).resolves.toMatchObject({ examId: expect.any(String) });
  });

  it("R275 — her beneficiaries are told it became an exam, and told again when it is changed back", async () => {
    const { scheduleId, sessionId } = await aClass(false);
    const teacher = await teacherOf(scheduleId);
    const student = await person("مستفيدة", [{ role: "student", branchId: branchA }]);
    await prisma.enrollment.create({ data: { studentId: student, levelId, branchId: branchA } });
    const notices = async () =>
      (await prisma.notification.findMany({ where: { userId: student, sessionId }, select: { type: true } })).map(
        (n) => n.type,
      );

    const { examId } = await convert(teacher.actor, sessionId);
    expect(await notices()).toEqual(["session_became_exam"]);
    // The مؤطِّرة who did it is not told her own act.
    expect(await prisma.notification.count({ where: { userId: teacher.id, sessionId } })).toBe(0);

    await deleteExam(prisma, teacher.actor, examId);
    expect(await notices()).toEqual(["session_back_to_class"]);
  });

  it("refuses what it should", async () => {
    const { scheduleId, sessionId } = await aClass(false);
    const teacher = await teacherOf(scheduleId);

    const student = await person("مستفيدة", [{ role: "student", branchId: branchA }]);
    await expect(
      convert(actorOf(student, [{ role: "student", branches: [branchA] }]), sessionId),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const stranger = await person("مؤطِّرة أخرى", [{ role: "teacher", branchId: branchA }]);
    await expect(
      convert(actorOf(stranger, [{ role: "teacher", branches: [branchA] }]), sessionId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(convert(teacher.actor, sessionId, { levelId: otherLevelId })).rejects.toMatchObject({
      details: { reason: "LEVEL_NOT_OF_CLASS" },
    });
    await expect(convert(teacher.actor, sessionId, { schedulingTypeId: classTypeId })).rejects.toBeTruthy();
    await expect(
      convertSessionToExam(prisma, teacher.actor, sessionId, {
        schedulingTypeId: examTypeId,
        levelId,
        subjectId,
        surahId: null,
        maxGrade: 20,
        version: (await version(sessionId)) + 7,
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    expect(await prisma.exam.count({ where: { sessionId } })).toBe(0);

    await convert(teacher.actor, sessionId);
    await expect(convert(teacher.actor, sessionId)).rejects.toMatchObject({
      details: { reason: "ALREADY_AN_EXAM" },
    });
  });

  it("a cancelled class is not changed into an exam", async () => {
    const { sessionId } = await aClass(false);
    await cancelSession(prisma, superAdmin(), sessionId, null, await version(sessionId));
    await expect(convert(superAdmin(), sessionId)).rejects.toMatchObject({
      details: { reason: "SESSION_NOT_SCHEDULED" },
    });
  });

  it("accepts only what an exam needs — the rest is the class's own", () => {
    const ok = {
      scheduling_type_id: "11111111-1111-4111-8111-111111111111",
      level_id: "11111111-1111-4111-8111-111111111111",
      subject_id: "11111111-1111-4111-8111-111111111111",
      version: 0,
    };
    expect(convertToExamSchema.safeParse(ok).success).toBe(true);
    expect(convertToExamSchema.safeParse({ ...ok, room_id: ok.level_id }).success).toBe(false);
    expect(convertToExamSchema.safeParse({ ...ok, max_grade: 0 }).success).toBe(false);
  });
});
