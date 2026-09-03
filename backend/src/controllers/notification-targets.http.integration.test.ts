import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { issueAccessToken } from "../lib/access-token.js";
import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import { httpCall } from "../test-support/http-client.js";
import { requireMemorisationSubject } from "../test-support/quran-subject.js";

/**
 * **Notifications about Events and published grades (SRS Revision 82).**
 *
 * What only real HTTP can establish here:
 *
 * * the **audience is resolved server-side** from the event's own scope rows —
 *   the request carries no recipient list and a body that tried to would be
 *   refused by the `.strict()` schema;
 * * **the actor is never a recipient**, on every type;
 * * declining to send creates **nothing**, while the change stays saved;
 * * publishing a grade notifies the student and **re-publishing adds nothing**;
 * * a personal calendar shows what concerns the caller and not the platform.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = `[r82-test:${randomUUID()}]`;

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

let adminId: string;
let adminToken: string;
let otherAdminToken: string;
/** Enrolled in levelA at branchA — the person a Level event concerns. */
let studentA: string;
let studentAToken: string;
/** Enrolled in levelB at branchB — the control, concerned by nothing here. */
let studentB: string;
/** Assigned to an Event directly — the staff half of R82.7's union. */
let eventStaffRecipient: string;
let eventStaffToken: string;
let examTeacherOnly: string;
let levelA: string;
let levelB: string;
let branchA: string;
let branchB: string;
let categoryA: string;
let categoryB: string;

async function clear(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } });

  const events = await prisma.event.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true },
  });
  const eventIds = events.map((e) => e.id);
  await prisma.notification.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.eventBranch.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.eventCategory.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.eventLevel.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.eventAdministrativeGroup.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.eventStaff.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
  // Event deletion records the scope in Trash before removing its joins. The
  // entry references the deleting actor, so it must go before tagged users.
  await prisma.trash.deleteMany({
    where: {
      OR: [
        { targetEntity: "Event", targetId: { in: eventIds } },
        { deletedById: { in: ids } },
      ],
    },
  });

  // Exams, their grades and their notices go before the Levels they hang off —
  // every one of these references is RESTRICT, so teardown order IS the test's
  // ability to run twice.
  const exams = await prisma.exam.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true },
  });
  const examIds = exams.map((e) => e.id);
  await prisma.notification.deleteMany({ where: { examId: { in: examIds } } });
  await prisma.grade.deleteMany({ where: { examId: { in: examIds } } });
  await prisma.examStaff.deleteMany({ where: { examId: { in: examIds } } });
  await prisma.exam.deleteMany({ where: { id: { in: examIds } } });
  await prisma.levelSubject.deleteMany({
    where: { level: { name: { startsWith: TAG } } },
  });
  // R87's Quran/Tafseer schedules and their staffing.
  const schedules = await prisma.recurringCourseSchedule.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true },
  });
  const scheduleIds = schedules.map((s) => s.id);
  await prisma.courseScheduleStaff.deleteMany({ where: { scheduleId: { in: scheduleIds } } });
  await prisma.recurringCourseSchedule.deleteMany({ where: { id: { in: scheduleIds } } });
  await prisma.room.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.levelSubject.deleteMany({ where: { subject: { name: { startsWith: TAG } } } });
  await prisma.subject.deleteMany({ where: { name: { startsWith: TAG } } });

  await prisma.enrollment.deleteMany({ where: { studentId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.room.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.levelSubject.deleteMany({ where: { subject: { name: { startsWith: TAG } } } });
  await prisma.subject.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.level.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  const health = await fetch(`${config.PUBLIC_BASE_URL}/healthz`).catch(() => null);
  if (!health || health.status !== 200) throw new Error("API not reachable");
  await clear();

  const catA = await prisma.category.create({ data: { name: `${TAG} فئة أ`, displayOrder: 1 } });
  const catB = await prisma.category.create({ data: { name: `${TAG} فئة ب`, displayOrder: 2 } });
  categoryA = catA.id;
  categoryB = catB.id;
  levelA = (
    await prisma.level.create({
      data: { name: `${TAG} مستوى أ`, categoryId: catA.id, displayOrder: 1, genderRestriction: "any" },
    })
  ).id;
  levelB = (
    await prisma.level.create({
      data: { name: `${TAG} مستوى ب`, categoryId: catB.id, displayOrder: 1, genderRestriction: "any" },
    })
  ).id;
  branchA = (await prisma.branch.create({ data: { name: `${TAG} فرع أ` } })).id;
  branchB = (await prisma.branch.create({ data: { name: `${TAG} فرع ب` } })).id;

  const admin = await prisma.user.create({
    data: { nameArabic: `${TAG} مديرة`, sex: "female", accountStatus: "active" },
  });
  adminId = admin.id;
  adminToken = bearer(admin.id, [{ role: "super_admin", branches: null }]);
  const role = await prisma.role.findFirstOrThrow({ where: { name: "super_admin" } });
  await prisma.userBranchRole.create({
    data: { userId: admin.id, roleId: role.id, branchId: null },
  });
  const otherAdmin = await prisma.user.create({
    data: { nameArabic: `${TAG} مديرة أخرى`, sex: "female", accountStatus: "active" },
  });
  otherAdminToken = bearer(otherAdmin.id, [{ role: "super_admin", branches: null }]);
  await prisma.userBranchRole.create({
    data: { userId: otherAdmin.id, roleId: role.id, branchId: null },
  });

  const a = await prisma.user.create({
    data: { nameArabic: `${TAG} مستفيدة أ`, sex: "female", accountStatus: "active", isBeneficiary: true },
  });
  studentA = a.id;
  studentAToken = bearer(a.id, [{ role: "student", branches: null }]);
  await prisma.enrollment.create({ data: { studentId: a.id, levelId: levelA, branchId: branchA } });

  const b = await prisma.user.create({
    data: { nameArabic: `${TAG} مستفيدة ب`, sex: "female", accountStatus: "active", isBeneficiary: true },
  });
  studentB = b.id;
  await prisma.enrollment.create({ data: { studentId: b.id, levelId: levelB, branchId: branchB } });

  const staff = await prisma.user.create({
    data: {
      nameArabic: `${TAG} مؤطرة النشاط`,
      sex: "female",
      accountStatus: "active",
      isBeneficiary: true,
    },
  });
  eventStaffRecipient = staff.id;
  eventStaffToken = bearer(staff.id, [{ role: "teacher", branches: null }]);
  const teacherRole = await prisma.role.findFirstOrThrow({ where: { name: "teacher" } });
  await prisma.userBranchRole.create({
    data: { userId: staff.id, roleId: teacherRole.id, branchId: branchA },
  });
  await prisma.enrollment.create({
    data: { studentId: staff.id, levelId: levelA, branchId: branchA },
  });
  const teacher = await prisma.user.create({
    data: { nameArabic: `${TAG} مؤطرة الامتحان`, sex: "female", accountStatus: "active" },
  });
  examTeacherOnly = teacher.id;
  await prisma.userBranchRole.create({
    data: { userId: teacher.id, roleId: teacherRole.id, branchId: branchA },
  });
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

/** An event addressed to the given scopes, created directly. */
async function makeEvent(
  title: string,
  scopes: { branchIds?: string[]; categoryIds?: string[]; levelIds?: string[] },
  details: {
    startTime?: Date;
    visibility?: "public" | "private" | "hidden";
  } = {},
): Promise<string> {
  const event = await prisma.event.create({
    data: {
      title: `${TAG} ${title}`,
      visibility: details.visibility ?? "public",
      startDate: new Date("2099-05-05T00:00:00Z"),
      startTime: details.startTime ?? null,
      recurrenceType: "none",
    },
    select: { id: true },
  });
  for (const branchId of scopes.branchIds ?? []) {
    await prisma.eventBranch.create({ data: { eventId: event.id, branchId } });
  }
  for (const categoryId of scopes.categoryIds ?? []) {
    await prisma.eventCategory.create({ data: { eventId: event.id, categoryId } });
  }
  for (const levelId of scopes.levelIds ?? []) {
    await prisma.eventLevel.create({ data: { eventId: event.id, levelId } });
  }
  return event.id;
}

const notificationsOf = (userId: string) =>
  prisma.notification.findMany({
    where: { userId },
    // `id` and `readAt` too: the republish rule is about a row becoming UNREAD
    // again, which cannot be observed from the type alone.
    select: { id: true, type: true, eventId: true, examId: true, readAt: true },
  });

/* ── the target constraint ──────────────────────────────────────────────── */

describe("a notification carries exactly one target (R82.1)", () => {
  it("refuses a row with no target at all", async () => {
    await expect(
      prisma.notification.create({ data: { userId: studentA, type: "event_created" } }),
    ).rejects.toThrow();
  });

  it("refuses a row with two targets", async () => {
    const eventId = await makeEvent("مزدوج", { levelIds: [levelA] });
    const session = await prisma.session.findFirst({ select: { id: true } });
    if (!session) return; // no session in this database; the single-target case below still holds
    await expect(
      prisma.notification.create({
        data: { userId: studentA, type: "event_created", eventId, sessionId: session.id },
      }),
    ).rejects.toThrow();
  });

  it("accepts exactly one, and the existing session rows were preserved", async () => {
    const eventId = await makeEvent("واحد", { levelIds: [levelA] });
    const row = await prisma.notification.create({
      data: { userId: studentA, type: "event_created", eventId },
      select: { id: true, sessionId: true, eventId: true, examId: true },
    });
    expect(row.sessionId).toBeNull();
    expect(row.examId).toBeNull();
    await prisma.notification.delete({ where: { id: row.id } });
  });
});

/* ── audience resolution ────────────────────────────────────────────────── */

describe("the audience comes from the event's scope (R82.7)", () => {
  it("a LEVEL event reaches the student enrolled in it, and not the other", async () => {
    const eventId = await makeEvent("نشاط المستوى", { levelIds: [levelA] });
    const res = await call("POST", `/events/${eventId}/notify`, adminToken, { change: "created" });
    expect(res.status).toBe(200);

    const forA = await notificationsOf(studentA);
    const forB = await notificationsOf(studentB);
    expect(forA.filter((n) => n.eventId === eventId)).toHaveLength(1);
    expect(forB.filter((n) => n.eventId === eventId)).toHaveLength(0);
  });

  it("a BRANCH + CATEGORY event intersects them rather than unioning", async () => {
    // Branch A with Category B names a combination nobody here is in: student A
    // is Category A at Branch A, student B is Category B at Branch B.
    const eventId = await makeEvent("فرع أ + فئة ب", {
      branchIds: [branchA],
      categoryIds: [categoryB],
    });
    await call("POST", `/events/${eventId}/notify`, adminToken, { change: "created" });

    const forA = (await notificationsOf(studentA)).filter((n) => n.eventId === eventId);
    const forB = (await notificationsOf(studentB)).filter((n) => n.eventId === eventId);
    expect(forA).toHaveLength(0);
    expect(forB).toHaveLength(0);
  });

  it("a CATEGORY-wide event reaches that category across branches", async () => {
    const eventId = await makeEvent("فئة أ في كل الفروع", { categoryIds: [categoryA] });
    await call("POST", `/events/${eventId}/notify`, adminToken, { change: "created" });

    expect((await notificationsOf(studentA)).filter((n) => n.eventId === eventId)).toHaveLength(1);
    expect((await notificationsOf(studentB)).filter((n) => n.eventId === eventId)).toHaveLength(0);
  });

  it("a GLOBAL event notifies nobody, though it is on every calendar", async () => {
    const eventId = await makeEvent("عام", {});
    const res = await call("POST", `/events/${eventId}/notify`, adminToken, { change: "created" });
    expect(res.status).toBe(200);
    expect((res.body.data as { notified: number }).notified).toBe(0);
  });

  it("never notifies the actor of their own act", async () => {
    // The administrator is enrolled nowhere, so the decisive case is built:
    // enrol her in the level she is about to announce to.
    await prisma.enrollment.create({
      data: { studentId: adminId, levelId: levelA, branchId: branchA },
    });
    const eventId = await makeEvent("إعلاني", { levelIds: [levelA] });
    await call("POST", `/events/${eventId}/notify`, adminToken, { change: "created" });

    expect((await notificationsOf(adminId)).filter((n) => n.eventId === eventId)).toHaveLength(0);
    expect((await notificationsOf(studentA)).filter((n) => n.eventId === eventId)).toHaveLength(1);
    await prisma.enrollment.deleteMany({ where: { studentId: adminId } });
  });

  it("refuses a body that tries to name recipients", async () => {
    const eventId = await makeEvent("قائمة مرسلة", { levelIds: [levelA] });
    const res = await call("POST", `/events/${eventId}/notify`, adminToken, {
      change: "created",
      user_ids: [studentB],
    });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("VALIDATION_FAILED");
  });
});

/* ── optional send, and idempotency ─────────────────────────────────────── */

describe("sending is a decision, and repeating it is harmless (R82.5)", () => {
  it("declining creates nothing — the endpoint is simply not called", async () => {
    const eventId = await makeEvent("بلا إشعار", { levelIds: [levelA] });
    // The change is saved; no notify request follows. Asserting the ABSENCE is
    // the whole of «بدون إشعار».
    expect((await notificationsOf(studentA)).filter((n) => n.eventId === eventId)).toHaveLength(0);
    const stillThere = await prisma.event.findUnique({ where: { id: eventId } });
    expect(stillThere).not.toBeNull();
  });

  it("sending twice writes one notification, not two", async () => {
    const eventId = await makeEvent("مكرر", { levelIds: [levelA] });
    const first = await call("POST", `/events/${eventId}/notify`, adminToken, { change: "created" });
    const second = await call("POST", `/events/${eventId}/notify`, adminToken, { change: "created" });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((second.body.data as { notified: number }).notified).toBe(0);
    expect((await notificationsOf(studentA)).filter((n) => n.eventId === eventId)).toHaveLength(1);
  });

  it("deleting without the separate send leaves the Event deleted and tells nobody", async () => {
    const eventId = await makeEvent("إلغاء بلا إشعار", { levelIds: [levelA] });

    const removed = await call("DELETE", `/events/${eventId}`, adminToken);
    expect(removed.status).toBe(204);
    expect(
      await prisma.event.findFirst({ where: { id: eventId, deletedAt: { not: null } } }),
    ).not.toBeNull();
    expect((await notificationsOf(studentA)).filter((n) => n.eventId === eventId)).toHaveLength(0);
  });

  it("announces a deleted Event from its Trash scope, with staff, identity, and no duplicates", async () => {
    const eventId = await makeEvent(
      "نشاط ملغى",
      { levelIds: [levelA] },
      { startTime: new Date("1970-01-01T09:30:00Z") },
    );
    await prisma.eventStaff.create({
      data: {
        eventId,
        userId: eventStaffRecipient,
        position: "responsible",
      },
    });

    const removed = await call("DELETE", `/events/${eventId}`, adminToken);
    expect(removed.status).toBe(204);
    expect(await prisma.eventLevel.count({ where: { eventId } })).toBe(0);
    expect(
      await prisma.trash.findFirst({
        where: { targetEntity: "Event", targetId: eventId, deletedById: adminId },
      }),
    ).not.toBeNull();

    // The delete commits alone. Only this second request delivers anything.
    expect((await notificationsOf(studentA)).filter((n) => n.eventId === eventId)).toHaveLength(0);
    const first = await call("POST", `/events/${eventId}/notify`, adminToken, {
      change: "cancelled",
    });
    expect(first.status).toBe(200);
    expect((first.body.data as { notified: number }).notified).toBe(2);

    // The same actor may retry safely; somebody else cannot announce a deletion
    // merely by learning its id.
    const retry = await call("POST", `/events/${eventId}/notify`, adminToken, {
      change: "cancelled",
    });
    expect(retry.status).toBe(200);
    expect((retry.body.data as { notified: number }).notified).toBe(0);
    const unrelatedSend = await call("POST", `/events/${eventId}/notify`, otherAdminToken, {
      change: "cancelled",
    });
    expect(unrelatedSend.status).toBe(404);

    const beneficiaryRows = (await notificationsOf(studentA)).filter(
      (n) => n.eventId === eventId,
    );
    const staffRows = (await notificationsOf(eventStaffRecipient)).filter(
      (n) => n.eventId === eventId,
    );
    expect(beneficiaryRows).toHaveLength(1);
    expect(beneficiaryRows[0]!.type).toBe("event_cancelled");
    expect(staffRows).toHaveLength(1);
    expect(staffRows[0]!.type).toBe("event_cancelled");
    expect((await notificationsOf(studentB)).filter((n) => n.eventId === eventId)).toHaveLength(0);

    // Rendering joins the soft-deleted Event, so the notice remains actionable
    // and names the exact activity, day, and wall-clock time.
    for (const token of [studentAToken, eventStaffToken]) {
      const list = await call("GET", "/notifications", token);
      expect(list.status).toBe(200);
      const notice = (list.body.data as unknown as Record<string, unknown>[]).find(
        (row) => row["event_id"] === eventId,
      );
      expect(notice).toMatchObject({
        type: "event_cancelled",
        title: `${TAG} نشاط ملغى`,
        date: "2099-05-05",
        start_time: "09:30",
      });
    }
  });

  it("a reschedule is its own kind, not a cancellation followed by a creation", async () => {
    const eventId = await makeEvent("مؤجل", { levelIds: [levelA] });
    await call("POST", `/events/${eventId}/notify`, adminToken, { change: "rescheduled" });
    const rows = (await notificationsOf(studentA)).filter((n) => n.eventId === eventId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe("event_rescheduled");
  });

  it("refuses a caller who may not edit the event", async () => {
    const eventId = await makeEvent("ممنوع", { levelIds: [levelA] });
    const res = await call("POST", `/events/${eventId}/notify`, studentAToken, {
      change: "created",
    });
    expect([403, 404]).toContain(res.status);
  });
});

/* ── R116 exam assignment and scheduling ───────────────────────────────── */

describe("hidden Events expose notification coordinates only to the responsible person (R109/R116)", () => {
  it("withdraws audience/assistant notices and resolves later sends from the hidden tier", async () => {
    const eventId = await makeEvent(
      "نشاط يتحول إلى مخفي",
      { levelIds: [levelA] },
      { visibility: "private" },
    );
    const staffed = await call("PUT", `/events/${eventId}/staff`, adminToken, {
      staff: [
        { user_id: examTeacherOnly, position: "responsible" },
        { user_id: eventStaffRecipient, position: "assistant" },
      ],
    });
    expect(staffed.status, JSON.stringify(staffed.body)).toBe(204);
    expect(
      (await notificationsOf(eventStaffRecipient)).filter((row) => row.eventId === eventId),
    ).toHaveLength(1);

    expect(
      (await call("POST", `/events/${eventId}/notify`, adminToken, { change: "created" })).status,
    ).toBe(200);
    expect(
      (await notificationsOf(studentA)).filter((row) => row.eventId === eventId),
    ).toHaveLength(1);

    const hidden = await call("PATCH", `/events/${eventId}`, adminToken, {
      version: 0,
      visibility: "hidden",
    });
    expect(hidden.status, JSON.stringify(hidden.body)).toBe(200);
    for (const userId of [studentA, eventStaffRecipient]) {
      expect(
        (await notificationsOf(userId)).filter((row) => row.eventId === eventId),
      ).toHaveLength(0);
    }
    expect(
      (await notificationsOf(examTeacherOnly))
        .filter((row) => row.eventId === eventId)
        .map((row) => row.type)
        .sort(),
    ).toEqual(["event_created", "event_staff_assigned"]);

    // Prove a fresh send resolves the CURRENT hidden audience rather than
    // succeeding only because the pre-transition row already exists.
    await prisma.notification.deleteMany({
      where: { userId: examTeacherOnly, eventId, type: "event_created" },
    });

    const sendWhileHidden = await call("POST", `/events/${eventId}/notify`, adminToken, {
      change: "created",
    });
    expect(sendWhileHidden.status, JSON.stringify(sendWhileHidden.body)).toBe(200);
    expect((sendWhileHidden.body.data as { notified: number }).notified).toBe(1);
    expect(
      (await notificationsOf(examTeacherOnly))
        .filter((row) => row.eventId === eventId)
        .map((row) => row.type)
        .sort(),
    ).toEqual(["event_created", "event_staff_assigned"]);
    for (const userId of [studentA, eventStaffRecipient]) {
      expect(
        (await notificationsOf(userId)).filter((row) => row.eventId === eventId),
      ).toHaveLength(0);
    }
  });
});

describe("exam notifications preserve assignment, audience, and dual-role meaning (R116)", () => {
  let subjectId: string;
  let academicYearId: string;
  let roomId: string;

  beforeAll(async () => {
    const subject = await prisma.subject.findFirstOrThrow({ where: { deletedAt: null } });
    subjectId = subject.id;
    await prisma.levelSubject.upsert({
      where: { levelId_subjectId: { levelId: levelA, subjectId } },
      create: { levelId: levelA, subjectId },
      update: {},
    });
    academicYearId = (await prisma.academicYear.findFirstOrThrow()).id;
    roomId = (
      await prisma.room.create({
        data: { name: `${TAG} قاعة إشعارات الامتحان`, branchId: branchA, capacity: 20 },
      })
    ).id;
  });

  const createExam = async (visibility: "public" | "private" | "hidden" = "private") => {
    const res = await call("POST", "/exams", adminToken, {
      mode: "physical",
      title: `${TAG} امتحان الإشعارات ${visibility}`,
      max_grade: 20,
      date: visibility === "hidden" ? "2099-06-08" : "2099-06-07",
      start_time: "09:00",
      end_time: "11:00",
      level_id: levelA,
      subject_id: subjectId,
      academic_year_id: academicYearId,
      branch_id: branchA,
      room_id: roomId,
      visibility,
      staff: [
        { user_id: examTeacherOnly, position: "supervisor" },
        // This same person is enrolled in the sitting's Level and is assigned
        // to it. Two meanings must survive the unique index as two types.
        { user_id: eventStaffRecipient, position: "assistant" },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body["id"] as string;
  };

  const examTypesFor = async (examId: string, userId: string) =>
    (await notificationsOf(userId))
      .filter((row) => row.examId === examId)
      .map((row) => row.type)
      .sort();

  it("teacher-only gets assignment, student-only gets scheduling, dual-role gets both, unrelated gets none", async () => {
    const examId = await createExam();

    expect(await examTypesFor(examId, examTeacherOnly)).toEqual(["exam_teacher_assigned"]);
    expect(await examTypesFor(examId, studentA)).toEqual(["exam_scheduled"]);
    expect(await examTypesFor(examId, eventStaffRecipient)).toEqual([
      "exam_scheduled",
      "exam_teacher_assigned",
    ]);
    expect(await examTypesFor(examId, studentB)).toEqual([]);

    const list = await call("GET", "/notifications", eventStaffToken);
    const rows = (list.body.data as unknown as Record<string, unknown>[]).filter(
      (row) => row["exam_id"] === examId,
    );
    expect(rows.map((row) => row["type"]).sort()).toEqual([
      "exam_scheduled",
      "exam_teacher_assigned",
    ]);
    expect(rows.every((row) => row["start_time"] === "09:00")).toBe(true);

    // An unchanged retry-shaped save increments the entity version but emits
    // no new semantic notification and does not resurface the existing rows.
    const unchanged = await call("PATCH", `/exams/${examId}`, adminToken, {
      version: 0,
      staff: [
        { user_id: examTeacherOnly, position: "supervisor" },
        { user_id: eventStaffRecipient, position: "assistant" },
      ],
    });
    expect(unchanged.status).toBe(204);
    expect(await examTypesFor(examId, eventStaffRecipient)).toEqual([
      "exam_scheduled",
      "exam_teacher_assigned",
    ]);
  });

  it("reconciles reschedule, removal, re-grant and cancellation without stale or duplicate facts", async () => {
    const examId = await createExam();
    const moved = await call("PATCH", `/exams/${examId}`, adminToken, {
      version: 0,
      date: "2099-06-09",
      staff: [{ user_id: eventStaffRecipient, position: "assistant" }],
    });
    expect(moved.status, JSON.stringify(moved.body)).toBe(204);

    expect(await examTypesFor(examId, examTeacherOnly)).toEqual([
      "exam_teacher_unassigned",
    ]);
    expect(await examTypesFor(examId, studentA)).toEqual([
      "exam_rescheduled",
      "exam_scheduled",
    ]);
    // One reschedule row even though this recipient is both retained staff and
    // a retained student.
    expect(await examTypesFor(examId, eventStaffRecipient)).toEqual([
      "exam_rescheduled",
      "exam_scheduled",
      "exam_teacher_assigned",
    ]);

    const unchanged = await call("PATCH", `/exams/${examId}`, adminToken, {
      version: 1,
      date: "2099-06-09",
      staff: [{ user_id: eventStaffRecipient, position: "assistant" }],
    });
    expect(unchanged.status, JSON.stringify(unchanged.body)).toBe(204);
    expect(await examTypesFor(examId, eventStaffRecipient)).toEqual([
      "exam_rescheduled",
      "exam_scheduled",
      "exam_teacher_assigned",
    ]);

    const reassigned = await call("PATCH", `/exams/${examId}`, adminToken, {
      version: 2,
      staff: [
        { user_id: examTeacherOnly, position: "supervisor" },
        { user_id: eventStaffRecipient, position: "assistant" },
      ],
    });
    expect(reassigned.status, JSON.stringify(reassigned.body)).toBe(204);
    expect(await examTypesFor(examId, examTeacherOnly)).toEqual([
      "exam_teacher_assigned",
    ]);

    const detailsChanged = await call("PATCH", `/exams/${examId}`, adminToken, {
      version: 3,
      title: `${TAG} امتحان الإشعارات بتفاصيل محدثة`,
      staff: [
        { user_id: examTeacherOnly, position: "supervisor" },
        { user_id: eventStaffRecipient, position: "assistant" },
      ],
    });
    expect(detailsChanged.status, JSON.stringify(detailsChanged.body)).toBe(204);
    expect(await examTypesFor(examId, studentA)).toContain("exam_changed");
    expect(await examTypesFor(examId, examTeacherOnly)).toEqual([
      "exam_changed",
      "exam_teacher_assigned",
    ]);

    const cancelled = await call("DELETE", `/exams/${examId}`, adminToken);
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(204);
    for (const userId of [examTeacherOnly, studentA, eventStaffRecipient]) {
      expect(await examTypesFor(examId, userId)).toEqual(["exam_cancelled"]);
    }
    expect((await call("DELETE", `/exams/${examId}`, adminToken)).status).toBe(404);
  });

  it("hidden sittings notify assigned staff but leak no scheduling notice to students", async () => {
    const examId = await createExam("hidden");
    expect(
      (await notificationsOf(examTeacherOnly)).filter(
        (row) => row.examId === examId && row.type === "exam_teacher_assigned",
      ),
    ).toHaveLength(1);
    for (const userId of [studentA, eventStaffRecipient, studentB]) {
      expect(
        (await notificationsOf(userId)).filter(
          (row) => row.examId === examId && row.type === "exam_scheduled",
        ),
      ).toHaveLength(0);
    }
    // R109: an assistant is not the responsible reader of a hidden sitting.
    expect(await examTypesFor(examId, eventStaffRecipient)).toEqual([]);
  });

  it("withdrawing a published sitting to hidden removes student-facing coordinates", async () => {
    const examId = await createExam("private");
    expect(await examTypesFor(examId, studentA)).toEqual(["exam_scheduled"]);

    const hidden = await call("PATCH", `/exams/${examId}`, adminToken, {
      version: 0,
      visibility: "hidden",
      staff: [
        { user_id: examTeacherOnly, position: "supervisor" },
        { user_id: eventStaffRecipient, position: "assistant" },
      ],
    });
    expect(hidden.status, JSON.stringify(hidden.body)).toBe(204);
    expect(await examTypesFor(examId, studentA)).toEqual([]);
    expect(await examTypesFor(examId, eventStaffRecipient)).toEqual([]);
    expect(await examTypesFor(examId, examTeacherOnly)).toEqual([
      "exam_teacher_assigned",
    ]);
  });
});

/* ── grade publication ──────────────────────────────────────────────────── */

describe("a published grade notifies the student it is about (R82.4)", () => {
  let examId: string;

  beforeAll(async () => {
    const subject = await prisma.subject.findFirstOrThrow();
    await prisma.levelSubject.upsert({
      where: { levelId_subjectId: { levelId: levelA, subjectId: subject.id } },
      create: { levelId: levelA, subjectId: subject.id },
      update: {},
    });
    // A physical sitting is all-or-none on place and clock
    // (`exam_physical_place_all_or_none_check`) — the constraint doing its job.
    const room = await prisma.room.create({
      data: { name: `${TAG} قاعة`, branchId: branchA, capacity: 20 },
    });
    const exam = await prisma.exam.create({
      data: {
        title: `${TAG} امتحان`,
        mode: "physical",
        maxGrade: 20,
        levelId: levelA,
        subjectId: subject.id,
        branchId: branchA,
        roomId: room.id,
        startTime: new Date("1970-01-01T09:00:00Z"),
        endTime: new Date("1970-01-01T11:00:00Z"),
        date: new Date("2099-06-06T00:00:00Z"),
      },
      select: { id: true },
    });
    examId = exam.id;
  });

  it("a DRAFT save notifies nobody (BR-8)", async () => {
    const res = await call("PUT", `/exams/${examId}/grades`, adminToken, {
      entries: [{ student_id: studentA, score: 15, absent: false }],
    });
    expect(res.status).toBe(200);
    expect((await notificationsOf(studentA)).filter((n) => n.examId === examId)).toHaveLength(0);
  });

  it("publishing notifies her, naming the exam", async () => {
    const res = await call("POST", `/exams/${examId}/grades/publish`, adminToken);
    expect(res.status).toBe(200);

    const rows = (await notificationsOf(studentA)).filter((n) => n.examId === examId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe("grade_published");

    // And it renders with the exam's identity rather than a bare id.
    const list = await call("GET", "/notifications", studentAToken);
    const mine = (list.body.data as unknown as Record<string, unknown>[]).find(
      (n) => n["exam_id"] === examId,
    )!;
    expect(mine["title"]).toContain("امتحان");
    // R81 — no verdict language anywhere near a grade.
    expect(JSON.stringify(mine)).not.toContain("ناجح");
    expect(JSON.stringify(mine)).not.toContain("راسب");
  });

  it("an unrelated student is told nothing", async () => {
    expect((await notificationsOf(studentB)).filter((n) => n.examId === examId)).toHaveLength(0);
  });

  /**
   * **Restated 2026-08-20 — the RULE changed, so the test did.**
   *
   * This asserted `notified: 0` after a republish that changed the score,
   * pinning R82.4's *re-publication writes nothing*. The Owner reported the
   * consequence from real use: a student who read the notice, saw one mark and
   * was later given another had nothing anywhere telling her to look again.
   *
   * The row is still one per (student, exam) — a list repeating *your grade was
   * published* is noise, and the fact announced is the same fact. What changed
   * is that a **real change reactivates it**.
   */
  it("re-publishing after the score CHANGED makes the notice unread again", async () => {
    // Read it first, so "unread again" is an observation rather than an
    // assumption about a row that was never read.
    const before = (await notificationsOf(studentA)).filter((n) => n.examId === examId);
    expect(before).toHaveLength(1);
    await prisma.notification.update({
      where: { id: before[0]!.id },
      data: { readAt: new Date() },
    });

    await call("PUT", `/exams/${examId}/grades`, adminToken, {
      entries: [{ student_id: studentA, score: 17, absent: false }],
    });
    const res = await call("POST", `/exams/${examId}/grades/publish`, adminToken);
    expect(res.status).toBe(200);
    expect((res.body.data as { notified: number }).notified).toBe(1);

    const after = (await notificationsOf(studentA)).filter((n) => n.examId === examId);
    // **Still ONE row**, and unread again.
    expect(after).toHaveLength(1);
    expect(after[0]!.readAt).toBeNull();
  });

  it("and re-publishing with NOTHING changed makes no noise", async () => {
    const before = (await notificationsOf(studentA)).filter((n) => n.examId === examId);
    await prisma.notification.update({
      where: { id: before[0]!.id },
      data: { readAt: new Date() },
    });

    // No `PUT` — the sheet is republished exactly as it stands.
    const res = await call("POST", `/exams/${examId}/grades/publish`, adminToken);
    expect(res.status).toBe(200);
    expect((res.body.data as { notified: number }).notified).toBe(0);

    const after = (await notificationsOf(studentA)).filter((n) => n.examId === examId);
    expect(after).toHaveLength(1);
    // Left read: nothing happened, so nothing is announced.
    expect(after[0]!.readAt).not.toBeNull();
  });
});

/* ── the personal calendar ──────────────────────────────────────────────── */

describe("a personal calendar shows what concerns the caller (R82.8)", () => {
  it("a student sees an event addressed to her Level", async () => {
    const eventId = await makeEvent("في تقويمي", { levelIds: [levelA] });
    const res = await call(
      "GET",
      "/me/calendar?from=2099-05-01&to=2099-05-31",
      studentAToken,
    );
    expect(res.status).toBe(200);
    const ids = (res.body.data as unknown as { id: string }[]).map((o) => o.id);
    expect(ids).toContain(eventId);
  });

  it("and does NOT see one addressed to a Level she is not in", async () => {
    const otherId = await makeEvent("ليس لي", { levelIds: [levelB] });
    const res = await call("GET", "/me/calendar?from=2099-05-01&to=2099-05-31", studentAToken);
    const ids = (res.body.data as unknown as { id: string }[]).map((o) => o.id);
    expect(ids).not.toContain(otherId);

    // **The control**: the PUBLIC calendar still shows it, so the narrowing is
    // the personal read's and not the event vanishing from the platform.
    const pub = await call("GET", "/calendar?from=2099-05-01&to=2099-05-31");
    const publicIds = (pub.body.data as unknown as { id: string }[]).map((o) => o.id);
    expect(publicIds).toContain(otherId);
  });

  it("requires authentication — there is no id in the request to widen", async () => {
    const res = await call("GET", "/me/calendar?from=2099-05-01&to=2099-05-31");
    expect([401, 403]).toContain(res.status);
  });
});

/**
 * **R87 §M — «إدخال الحفظ» follows real Quran assignments** (and §G's parity).
 *
 * The Owner named what the condition may NOT be: the teacher role, a declared
 * capability, the Subject's Arabic name, or hard-coded text. It is staffing a
 * schedule whose Subject carries R73's `tracks_quran_progress` marker — and an
 * **assistant** on that class teaches Quran exactly as the main teacher does.
 */
describe("teaching Quran is an assignment, not a role (R87 §M/§G)", () => {
  let quranSubject: string;
  let otherSubject: string;
  let quranTeacher: string;
  let quranAssistant: string;
  let tafseerTeacher: string;
  let scheduleId: string;

  beforeAll(async () => {
    // R107 — consume the Production حفظ marker instead of violating its
    // platform-wide partial unique index with a second fixture row.
    quranSubject = (await requireMemorisationSubject(prisma)).id;
    otherSubject = (
      await prisma.subject.create({
        data: { name: `${TAG} تفسير القرآن`, displayOrder: 91, tracksQuranProgress: false },
      })
    ).id;

    const make = async (label: string): Promise<string> => {
      const u = await prisma.user.create({
        data: { nameArabic: `${TAG} ${label}`, sex: "female", accountStatus: "active" },
      });
      return u.id;
    };
    quranTeacher = await make("مؤطرة الحفظ");
    quranAssistant = await make("مساعدة الحفظ");
    tafseerTeacher = await make("مؤطرة التفسير");

    const room = await prisma.room.create({
      data: { name: `${TAG} قاعة الحفظ`, branchId: branchA, capacity: 10 },
    });
    for (const [subjectId, staff] of [
      [quranSubject, [quranTeacher, quranAssistant]],
      [otherSubject, [tafseerTeacher]],
    ] as [string, string[]][]) {
      await prisma.levelSubject.upsert({
        where: { levelId_subjectId: { levelId: levelA, subjectId } },
        create: { levelId: levelA, subjectId },
        update: {},
      });
      const schedule = await prisma.recurringCourseSchedule.create({
        data: {
          title: `${TAG} ${subjectId === quranSubject ? "حفظ" : "تفسير"}`,
          subjectId,
          teachingMode: "entire_level",
          levelId: levelA,
          branchId: branchA,
          roomId: room.id,
          // Required: without it Prisma falls back to the checked input and
          // reports a missing RELATION, which is a confusing way to say
          // "a schedule belongs to an academic year".
          academicYearId: (await prisma.academicYear.findFirstOrThrow()).id,
          startTime: new Date("1970-01-01T09:00:00Z"),
          endTime: new Date("1970-01-01T10:00:00Z"),
          recurrence: "weekly",
          weekdays: ["monday"],
          anchorDate: new Date("2099-01-05T00:00:00Z"),
        },
        select: { id: true },
      });
      if (subjectId === quranSubject) scheduleId = schedule.id;
      await prisma.courseScheduleStaff.createMany({
        data: staff.map((userId, i) => ({
          scheduleId: schedule.id,
          userId,
          // **The assistant is the point**: parity is asserted, not assumed.
          position: i === 0 ? "teacher" : "assistant",
        })),
      });
    }
  });

  const asks = async (userId: string): Promise<boolean> => {
    const res = await call("GET", "/me", bearer(userId, [{ role: "teacher", branches: null }]));
    return (res.body as unknown as { teaches_quran: boolean }).teaches_quran;
  };

  it("says YES to the مؤطرة staffing the Quran class", async () => {
    expect(await asks(quranTeacher)).toBe(true);
  });

  it("says YES to her ASSISTANT — parity, not a weaker branch (§G)", async () => {
    expect(await asks(quranAssistant)).toBe(true);
  });

  it("says NO to a مؤطرة who teaches only another Subject", async () => {
    // She holds the same teacher role; the role is exactly what must not decide.
    expect(await asks(tafseerTeacher)).toBe(false);
  });

  it("says NO once the Quran assignment is withdrawn", async () => {
    await prisma.courseScheduleStaff.updateMany({
      where: { scheduleId, userId: quranTeacher },
      data: { deletedAt: new Date() },
    });
    expect(await asks(quranTeacher)).toBe(false);
    // And her assistant is unaffected by the other's withdrawal.
    expect(await asks(quranAssistant)).toBe(true);
  });
});
