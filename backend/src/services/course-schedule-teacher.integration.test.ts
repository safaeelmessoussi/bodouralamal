import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import type { RoleScope } from "../policies/branch-scope.js";
import type { Actor } from "../policies/actor.js";
import { createLevel } from "./level.service.js";
import {
  createCourseSchedule,
  updateCourseSchedule,
  type CourseScheduleInput,
} from "./course-schedule.service.js";
import { readCalendar, type CalendarActor } from "./calendar.service.js";
import { enrol } from "../test-support/educational-fixture.js";

/**
 * **§2 — a مؤطِّرة may create a class within her own declared scope**
 * (SRS Revision 140), which supersedes R114(2)'s blanket *"grants no
 * scheduling authority"* for this ONE grant only. Every other TD-2 row this
 * revision does not name (Manage Administrative Groups, delete a schedule,
 * `this_and_future` splitting) is UNCHANGED and asserted so here, not merely
 * assumed by omission.
 *
 * The anchor decision, stated once rather than re-derived per test: she may
 * create/edit `entire_level` schedules within a branch she holds a `teacher`
 * `UserBranchRole` in, for a Level whose Category she has declared
 * (`TeacherCategoryCapability`) OR whose Subject she has declared
 * (`TeacherSubjectCapability`) — an OR, never an AND — and she must be named
 * the schedule's own `teacher`. `UserBranchRole`, not `teacherBranchIds`
 * (where she already teaches): deliberately, because she has by construction
 * no `CourseScheduleStaff` row on the schedule she is about to create.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = "[schedule-teacher-test]";

const NOW = new Date("2026-06-01T08:00:00.000Z");
const at = (hh: number, mm = 0): Date => new Date(Date.UTC(1970, 0, 1, hh, mm, 0));
const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

let categoryId: string;
let otherCategoryId: string;
let branchId: string;
let otherBranchId: string;
let levelId: string;
let otherLevelId: string;
let subjectId: string;
let otherSubjectId: string;
let academicYearId: string;
let teacherUserId: string;
let otherUserId: string;

const actorOf = (userId: string, scopes: RoleScope[]): Actor => ({
  userId,
  roles: scopes.map((s) => s.role),
  roleScopes: scopes,
});
const superAdmin = (): Actor => actorOf(teacherUserId, [{ role: "super_admin", branches: null }]);
/**
 * **Mirrors what request-time middleware actually resolves** (`freshness
 * .policy.ts`: `roleScopes` read fresh from live `UserBranchRole` rows) — at
 * the service layer, nothing re-derives it, so a test actor that does not
 * match what `grantTeacherBranch` actually inserted would assert against a
 * caller the server can never produce. Defaults to exactly the one branch
 * `grantTeacherBranch(teacherUserId, branchId)` grants in the common case;
 * `[]` (no branches at all) is passed explicitly where a test grants none.
 */
const teacherActor = (branches: string[] = [branchId]): Actor =>
  actorOf(teacherUserId, [{ role: "teacher", branches }]);

async function failure(
  run: () => Promise<unknown>,
): Promise<{ code?: string; details?: Record<string, unknown> }> {
  try {
    await run();
    return {};
  } catch (e) {
    return e as { code?: string; details?: Record<string, unknown> };
  }
}

async function person(label: string): Promise<string> {
  const u = await prisma.user.create({
    data: { sex: "female", nameArabic: `${TAG} ${label}`, accountStatus: "active" },
  });
  return u.id;
}

async function grantTeacherBranch(userId: string, branch: string | null): Promise<void> {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: "teacher" } });
  await prisma.userBranchRole.create({ data: { userId, roleId: role.id, branchId: branch } });
}

const baseInput = (over: Partial<CourseScheduleInput> = {}): CourseScheduleInput => ({
  title: `${TAG} حلقة`,
  subjectId,
  teachingMode: "entire_level",
  targetId: levelId,
  branchId,
  startTime: at(15),
  endTime: at(17),
  recurrence: "weekly",
  weekdays: ["tuesday"],
  academicYearId,
  staff: [{ userId: teacherUserId, position: "teacher" }],
  ...over,
});

async function cleanup(): Promise<void> {
  const tagged = { name: { startsWith: TAG } };
  const scheduleWhere = { schedule: { subject: tagged } };
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  // RESTRICT against `category`/`subject` (TD-5) — unwound before either, or
  // the deletes below fail exactly as they should on a real request.
  await prisma.teacherCategoryCapability.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.teacherSubjectCapability.deleteMany({ where: { userId: { in: userIds } } });

  await prisma.sessionStaff.deleteMany({ where: { session: scheduleWhere } });
  await prisma.session.deleteMany({ where: scheduleWhere });
  await prisma.courseScheduleStaff.deleteMany({ where: { schedule: { subject: tagged } } });
  await prisma.recurringCourseSchedule.deleteMany({ where: { subject: tagged } });
  await prisma.enrollment.deleteMany({ where: { level: tagged } });
  await prisma.administrativeGroup.deleteMany({ where: { level: tagged } });
  await prisma.levelSubject.deleteMany({ where: { subject: tagged } });
  await prisma.subject.deleteMany({ where: tagged });
  await prisma.level.deleteMany({ where: tagged });
  await prisma.category.deleteMany({ where: tagged });

  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeEach(async () => {
  await cleanup();
  teacherUserId = await person("المؤطرة");
  otherUserId = await person("مؤطرة أخرى");

  categoryId = (await prisma.category.create({ data: { name: `${TAG} فئة` } })).id;
  otherCategoryId = (await prisma.category.create({ data: { name: `${TAG} فئة أخرى` } })).id;
  branchId = (
    await prisma.branch.create({ data: { name: `${TAG} فرع`, operationalStartDate: day("2026-01-01") } })
  ).id;
  otherBranchId = (
    await prisma.branch.create({ data: { name: `${TAG} فرع آخر`, operationalStartDate: day("2026-01-01") } })
  ).id;

  levelId = (await createLevel(prisma, superAdmin(), {
    name: `${TAG} مستوى`,
    categoryId,
    genderRestriction: "any",
  })).level.id;
  otherLevelId = (await createLevel(prisma, superAdmin(), {
    name: `${TAG} مستوى آخر`,
    categoryId: otherCategoryId,
    genderRestriction: "any",
  })).level.id;

  subjectId = (await prisma.subject.create({ data: { name: `${TAG} مادة` } })).id;
  otherSubjectId = (await prisma.subject.create({ data: { name: `${TAG} مادة أخرى` } })).id;
  await prisma.levelSubject.create({ data: { levelId, subjectId } });
  await prisma.levelSubject.create({ data: { levelId, subjectId: otherSubjectId } });
  await prisma.levelSubject.create({ data: { levelId: otherLevelId, subjectId: otherSubjectId } });

  academicYearId = (await prisma.academicYear.findFirstOrThrow({ select: { id: true } })).id;
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("§2 — a مؤطِّرة creates a class within her declared Category and her UserBranchRole branch", () => {
  it("succeeds when both anchors hold — branch role AND a declared Category capability", async () => {
    await grantTeacherBranch(teacherUserId, branchId);
    await prisma.teacherCategoryCapability.create({ data: { userId: teacherUserId, categoryId } });

    const created = await createCourseSchedule(prisma, teacherActor(), baseInput(), NOW);
    expect(created.id).toBeDefined();

    const staff = await prisma.courseScheduleStaff.findMany({ where: { scheduleId: created.id } });
    expect(staff).toHaveLength(1);
    expect(staff[0]!.userId).toBe(teacherUserId);
    expect(staff[0]!.position).toBe("teacher");
  });

  it("succeeds through a declared SUBJECT capability alone, with no Category declared", async () => {
    await grantTeacherBranch(teacherUserId, branchId);
    await prisma.teacherSubjectCapability.create({ data: { userId: teacherUserId, subjectId } });

    const created = await createCourseSchedule(prisma, teacherActor(), baseInput(), NOW);
    expect(created.id).toBeDefined();
  });

  it("refuses a branch she holds no teacher UserBranchRole in", async () => {
    await grantTeacherBranch(teacherUserId, branchId);
    await prisma.teacherCategoryCapability.create({ data: { userId: teacherUserId, categoryId } });

    const err = await failure(() =>
      createCourseSchedule(prisma, teacherActor(), baseInput({ branchId: otherBranchId }), NOW),
    );
    expect(err.code).toBe("NOT_FOUND");
  });

  it("refuses a Level whose Category and whose Subject are both undeclared", async () => {
    await grantTeacherBranch(teacherUserId, branchId);
    // She holds the branch, and even declares the OTHER Category — never this one.
    await prisma.teacherCategoryCapability.create({ data: { userId: teacherUserId, categoryId: otherCategoryId } });

    const err = await failure(() => createCourseSchedule(prisma, teacherActor(), baseInput(), NOW));
    expect(err.code).toBe("FORBIDDEN");
    expect(err.details?.["reason"]).toBe("CAPABILITY_NOT_DECLARED");
  });

  it("a Category declaration does not leak to a DIFFERENT Level's Category via the target's own branch — direct UUID substitution is still checked against the resolved target", async () => {
    await grantTeacherBranch(teacherUserId, branchId);
    await prisma.teacherCategoryCapability.create({ data: { userId: teacherUserId, categoryId } });
    // A caller could try substituting a Level whose Category is undeclared,
    // hoping the branch/subject checks alone would let it through.
    await prisma.levelSubject.create({ data: { levelId: otherLevelId, subjectId } });

    const err = await failure(() =>
      createCourseSchedule(
        prisma,
        teacherActor(),
        baseInput({ targetId: otherLevelId, subjectId }),
        NOW,
      ),
    );
    expect(err.code).toBe("FORBIDDEN");
    expect(err.details?.["reason"]).toBe("CAPABILITY_NOT_DECLARED");
  });

  it("refuses administrative_group / teaching_group targeting — entire_level only", async () => {
    await grantTeacherBranch(teacherUserId, branchId);
    await prisma.teacherCategoryCapability.create({ data: { userId: teacherUserId, categoryId } });
    const group = await prisma.administrativeGroup.create({
      data: { name: `${TAG} مجموعة`, levelId, branchId, displayOrder: 0 },
    });

    const err = await failure(() =>
      createCourseSchedule(
        prisma,
        teacherActor(),
        baseInput({ teachingMode: "administrative_group", targetId: group.id }),
        NOW,
      ),
    );
    expect(err.code).toBe("VALIDATION_FAILED");
    expect(err.details?.["reason"]).toBe("TEACHER_ENTIRE_LEVEL_ONLY");
  });

  it("refuses a class that does not name her as its own teacher", async () => {
    await grantTeacherBranch(teacherUserId, branchId);
    await prisma.teacherCategoryCapability.create({ data: { userId: teacherUserId, categoryId } });

    const empty = await failure(() =>
      createCourseSchedule(prisma, teacherActor(), baseInput({ staff: [] }), NOW),
    );
    expect(empty.code).toBe("VALIDATION_FAILED");
    expect(empty.details?.["reason"]).toBe("TEACHER_MUST_SELF_STAFF");

    const someoneElse = await failure(() =>
      createCourseSchedule(
        prisma,
        teacherActor(),
        baseInput({ staff: [{ userId: otherUserId, position: "teacher" }] }),
        NOW,
      ),
    );
    expect(someoneElse.code).toBe("VALIDATION_FAILED");
    expect(someoneElse.details?.["reason"]).toBe("TEACHER_MUST_SELF_STAFF");
  });

  it("a bare Teacher role with neither a branch role nor a capability is refused outright", async () => {
    const err = await failure(() =>
      createCourseSchedule(prisma, teacherActor([]), baseInput(), NOW),
    );
    // No UserBranchRole at all — refused at the branch check, before capability
    // is ever consulted.
    expect(err.code).toBe("NOT_FOUND");
  });
});

describe("§2 — editing is bounded by CURRENT staffing, never by declared capability", () => {
  async function createAsTeacher(): Promise<string> {
    await grantTeacherBranch(teacherUserId, branchId);
    await prisma.teacherCategoryCapability.create({ data: { userId: teacherUserId, categoryId } });
    return (await createCourseSchedule(prisma, teacherActor(), baseInput(), NOW)).id;
  }

  it("she may edit an operational field on a class she currently staffs", async () => {
    const id = await createAsTeacher();
    const row = await prisma.recurringCourseSchedule.findUniqueOrThrow({ where: { id }, select: { version: true } });

    const updated = await updateCourseSchedule(
      prisma,
      teacherActor(),
      id,
      { title: `${TAG} حلقة معدَّلة`, version: row.version },
      NOW,
    );
    expect(updated.id).toBe(id);
    const after = await prisma.recurringCourseSchedule.findUniqueOrThrow({ where: { id }, select: { title: true } });
    expect(after.title).toBe(`${TAG} حلقة معدَّلة`);
  });

  it("refuses editing a class she does not staff — answered as not-found, never forbidden (§20 rule 17)", async () => {
    // Admin-created, nobody's declared capability involved — she has no row on it.
    const created = await createCourseSchedule(
      prisma,
      { userId: otherUserId, roles: ["super_admin"], roleScopes: [{ role: "super_admin", branches: null }] },
      baseInput({ staff: [] }),
      NOW,
    );
    const row = await prisma.recurringCourseSchedule.findUniqueOrThrow({
      where: { id: created.id },
      select: { version: true },
    });

    const err = await failure(() =>
      updateCourseSchedule(prisma, teacherActor(), created.id, { title: "x", version: row.version }, NOW),
    );
    expect(err.code).toBe("NOT_FOUND");
  });

  it("refuses a staff patch that removes her own accountability", async () => {
    const id = await createAsTeacher();
    const row = await prisma.recurringCourseSchedule.findUniqueOrThrow({ where: { id }, select: { version: true } });

    const err = await failure(() =>
      updateCourseSchedule(
        prisma,
        teacherActor(),
        id,
        { staff: [{ userId: otherUserId, position: "assistant" }], version: row.version },
        NOW,
      ),
    );
    expect(err.code).toBe("VALIDATION_FAILED");
    expect(err.details?.["reason"]).toBe("TEACHER_MUST_REMAIN_STAFFED");
  });

  it("refuses this_and_future splitting outright — a manager-only act even on her own class", async () => {
    const id = await createAsTeacher();
    const row = await prisma.recurringCourseSchedule.findUniqueOrThrow({ where: { id }, select: { version: true } });

    const err = await failure(() =>
      updateCourseSchedule(
        prisma,
        teacherActor(),
        id,
        { scope: "this_and_future", fromDate: day("2026-07-01"), version: row.version },
        NOW,
      ),
    );
    expect(err.code).toBe("FORBIDDEN");
  });
});

describe("§2 — Admin/Super Admin scheduling is unaffected", () => {
  it("an Admin still creates an administrative_group class with no self-staffing requirement", async () => {
    const group = await prisma.administrativeGroup.create({
      data: { name: `${TAG} مجموعة إدارية`, levelId, branchId, displayOrder: 0 },
    });
    const admin: Actor = {
      userId: otherUserId,
      roles: ["admin"],
      roleScopes: [{ role: "admin", branches: [branchId] }],
    };
    const created = await createCourseSchedule(
      prisma,
      admin,
      baseInput({ teachingMode: "administrative_group", targetId: group.id, staff: [] }),
      NOW,
    );
    expect(created.id).toBeDefined();
  });
});

describe("§2/§3 — the created class reaches the intended personal calendars", () => {
  it("an enrolled student sees the materialized Session, and the مؤطِّرة sees it on her own calendar", async () => {
    await grantTeacherBranch(teacherUserId, branchId);
    await prisma.teacherCategoryCapability.create({ data: { userId: teacherUserId, categoryId } });

    await createCourseSchedule(
      prisma,
      teacherActor(),
      baseInput({ recurrence: "weekly", weekdays: ["tuesday"] }),
      NOW,
    );

    // `entire_level` mode materializes against the LEVEL, never a specific
    // Administrative Group (§4.4c) — this group exists only to satisfy
    // `Enrollment`'s own FK, and its identity is irrelevant to the match.
    const registrationGroup = await prisma.administrativeGroup.create({
      data: { name: `${TAG} تسجيل`, levelId, branchId, displayOrder: 1 },
    });
    const studentId = await person("مستفيدة");
    await enrol(
      prisma,
      { administrativeGroupId: registrationGroup.id, levelId, branchId },
      studentId,
    );

    const range = { from: day("2026-06-01"), to: day("2026-06-30") };
    const studentCal = await readCalendar(
      prisma,
      { userId: studentId, roles: ["student"], roleScopes: [{ role: "student", branches: null }], accountStatus: "active" } as CalendarActor,
      { ...range, mine: true },
    );
    expect(studentCal.some((o) => o.title.startsWith(TAG) && o.kind === "session")).toBe(true);

    const teacherCal = await readCalendar(
      prisma,
      { userId: teacherUserId, roles: ["teacher"], roleScopes: [{ role: "teacher", branches: null }], accountStatus: "active" } as CalendarActor,
      { ...range, mine: true },
    );
    expect(teacherCal.some((o) => o.title.startsWith(TAG) && o.kind === "session")).toBe(true);
  });
});
