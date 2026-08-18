import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import type { Actor } from "../policies/actor.js";
import type { RoleScope } from "../policies/branch-scope.js";
import { enqueueConsentReevaluationForStudent } from "./enrollment.service.js";
import { listLibrary } from "./library.service.js";
import { addMember, listUnassignedStudents } from "./teaching-group.service.js";

/**
 * **R66 — a group-less enrolment is a valid enrolment.**
 *
 * The semantic half of the guard beside this file. Each case is written as
 * *grouped versus group-less on the same Level*, because the defect is never
 * that a query is broken — it is that it works for one shape and silently
 * omits the other.
 *
 * These cover the path the source scanner cannot see (a nested
 * `level.enrollments.some`, where the consent defect lived) and the two it can.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = "[groupless-test]";

let adminId: string;
let branchA: string;
let branchB: string;
let levelId: string;
let groupA: string;
let subjectId: string;
let yearId: string;
let grouped: string;
let solo: string;

const actorOf = (userId: string, scopes: RoleScope[]): Actor => ({
  userId,
  roles: scopes.map((s) => s.role),
  roleScopes: scopes,
});
const superAdmin = (): Actor =>
  actorOf(adminId, [{ role: "super_admin", branches: null }]);

async function person(label: string): Promise<string> {
  return (
    await prisma.user.create({
      data: {
        nameArabic: `${TAG} ${label}`,
        accountStatus: "active",
        sex: "female",
      },
    })
  ).id;
}

async function clear(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await prisma.studentTeachingGroup.deleteMany({
    where: { studentId: { in: ids } },
  });
  await prisma.enrollment.deleteMany({ where: { studentId: { in: ids } } });
  await prisma.familyLink.deleteMany({
    where: { OR: [{ parentId: { in: ids } }, { studentId: { in: ids } }] },
  });
  const schedules = await prisma.recurringCourseSchedule.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true },
  });
  const sids = schedules.map((s) => s.id);
  // R77 — `notification.session_id` is RESTRICT, like every other reference
  // to a Session: a cancellation notice whose session vanished is unreadable.
  // Fixtures therefore unwind notices before the occurrences they name.
  await prisma.notification.deleteMany({
    where: { session: { scheduleId: { in: sids } } },
  });
  await prisma.session.deleteMany({ where: { scheduleId: { in: sids } } });
  await prisma.courseScheduleStaff.deleteMany({
    where: { scheduleId: { in: sids } },
  });
  await prisma.recurringCourseSchedule.deleteMany({
    where: { id: { in: sids } },
  });
  await prisma.educationalContent.deleteMany({
    where: { title: { startsWith: TAG } },
  });
  if (ids.length > 0) {
    await prisma.trash.deleteMany({ where: { deletedById: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
  const levels = await prisma.level.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  const lids = levels.map((l) => l.id);
  await prisma.teachingGroup.deleteMany({ where: { levelId: { in: lids } } });
  await prisma.administrativeGroup.deleteMany({
    where: { levelId: { in: lids } },
  });
  await prisma.levelSubject.deleteMany({ where: { levelId: { in: lids } } });
  await prisma.level.deleteMany({ where: { id: { in: lids } } });
  await prisma.subject.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeEach(async () => {
  await clear();
  adminId = await person("مسؤولة");
  yearId = (
    await prisma.academicYear.findFirstOrThrow({ where: { isCurrent: true } })
  ).id;
  const cat = await prisma.category.create({ data: { name: `${TAG} فئة` } });
  branchA = (
    await prisma.branch.create({
      data: {
        name: `${TAG} مقر أ`,
        operationalStartDate: new Date("2020-01-01"),
      },
    })
  ).id;
  branchB = (
    await prisma.branch.create({
      data: {
        name: `${TAG} مقر ب`,
        operationalStartDate: new Date("2020-01-01"),
      },
    })
  ).id;
  levelId = (
    await prisma.level.create({
      data: {
        name: `${TAG} مستوى`,
        categoryId: cat.id,
        genderRestriction: "any",
      },
    })
  ).id;
  groupA = (
    await prisma.administrativeGroup.create({
      data: { name: `${TAG} مجموعة`, levelId, branchId: branchA },
    })
  ).id;
  subjectId = (await prisma.subject.create({ data: { name: `${TAG} مادة` } }))
    .id;
  await prisma.levelSubject.create({ data: { levelId, subjectId } });

  grouped = await person("بمجموعة");
  solo = await person("بلا مجموعة");
  await prisma.enrollment.create({
    data: {
      studentId: grouped,
      levelId,
      administrativeGroupId: groupA,
      branchId: branchA,
    },
  });
  await prisma.enrollment.create({
    data: { studentId: solo, levelId, branchId: branchA },
  });
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe("P0 — consent re-evaluation reaches a group-less student", () => {
  /** An `entire_level` schedule with one materialized session. */
  async function entireLevelSession(): Promise<void> {
    const schedule = await prisma.recurringCourseSchedule.create({
      data: {
        title: `${TAG} حصة`,
        subjectId,
        teachingMode: "entire_level",
        levelId,
        branchId: branchA,
        startTime: new Date("1970-01-01T09:00:00Z"),
        endTime: new Date("1970-01-01T10:00:00Z"),
        recurrence: "weekly",
        weekdays: ["monday"],
        academicYearId: yearId,
      },
    });
    await prisma.session.create({
      data: {
        scheduleId: schedule.id,
        date: new Date("2098-03-02"),
        startTime: new Date("1970-01-01T09:00:00Z"),
        endTime: new Date("1970-01-01T10:00:00Z"),
      },
    });
  }

  it("requeues the session for BOTH shapes of enrolment", async () => {
    // The defect: the `entire_level` arm required a live group, so the
    // group-less student's sessions were never re-evaluated — and BR-2/§4.9
    // rely on that re-evaluation to force a recording private when consent
    // changes. Silently, which is what made it dangerous.
    await entireLevelSession();

    const forGrouped = await prisma.$transaction((tx) =>
      enqueueConsentReevaluationForStudent(tx, grouped),
    );
    const forSolo = await prisma.$transaction((tx) =>
      enqueueConsentReevaluationForStudent(tx, solo),
    );

    expect(forGrouped).toHaveLength(1);
    expect(forSolo).toHaveLength(1);
  });

  it("requeues nothing for a student who is not enrolled", async () => {
    // The guard the broken predicate stood in for, so the fix is a correction
    // rather than a removal.
    await entireLevelSession();
    const stranger = await person("غير مسجلة");
    expect(
      await prisma.$transaction((tx) =>
        enqueueConsentReevaluationForStudent(tx, stranger),
      ),
    ).toEqual([]);
  });

  it("is unchanged for administrative_group schedules", async () => {
    // The other two arms were correct and must stay correct: this one is
    // genuinely about a group, so the group-less student is rightly absent.
    const schedule = await prisma.recurringCourseSchedule.create({
      data: {
        title: `${TAG} حصة المجموعة`,
        subjectId,
        teachingMode: "administrative_group",
        administrativeGroupId: groupA,
        branchId: branchA,
        startTime: new Date("1970-01-01T09:00:00Z"),
        endTime: new Date("1970-01-01T10:00:00Z"),
        recurrence: "weekly",
        weekdays: ["monday"],
        academicYearId: yearId,
      },
    });
    await prisma.session.create({
      data: {
        scheduleId: schedule.id,
        date: new Date("2098-03-03"),
        startTime: new Date("1970-01-01T09:00:00Z"),
        endTime: new Date("1970-01-01T10:00:00Z"),
      },
    });

    expect(
      await prisma.$transaction((tx) =>
        enqueueConsentReevaluationForStudent(tx, grouped),
      ),
    ).toHaveLength(1);
    expect(
      await prisma.$transaction((tx) =>
        enqueueConsentReevaluationForStudent(tx, solo),
      ),
    ).toEqual([]);
  });
});

describe("P1 — a group-less student is a circle candidate", () => {
  beforeEach(async () => {
    await prisma.teachingGroup.create({
      data: { name: `${TAG} حلقة`, levelId, subjectId },
    });
  });

  const unassigned = async (actor = superAdmin()) =>
    (
      await listUnassignedStudents(prisma, actor, levelId, subjectId)
    ).unassigned.map((u) => u.studentId);

  it("lists both shapes of enrolment", async () => {
    const ids = await unassigned();
    expect(ids).toContain(grouped);
    expect(ids).toContain(solo);
  });

  it("excludes a student enrolled at another branch, for both shapes", async () => {
    // Branch scoping now reads `Enrollment.branch_id` rather than the group's,
    // so it must still narrow — including for a student who has no group.
    const elsewhereSolo = await person("بلا مجموعة بمقر آخر");
    await prisma.enrollment.create({
      data: { studentId: elsewhereSolo, levelId, branchId: branchB },
    });
    const scoped = await unassigned(
      actorOf(adminId, [{ role: "admin", branches: [branchA] }]),
    );
    expect(scoped).toContain(solo);
    expect(scoped).not.toContain(elsewhereSolo);
  });

  it("excludes a student not enrolled in the Level at all", async () => {
    const stranger = await person("غير مسجلة");
    expect(await unassigned()).not.toContain(stranger);
  });

  it("excludes a student already holding a seat for that Subject", async () => {
    const circle = await prisma.teachingGroup.findFirstOrThrow({
      where: { levelId, subjectId, deletedAt: null },
    });
    await addMember(prisma, superAdmin(), circle.id, solo);
    expect(await unassigned()).not.toContain(solo);
  });

  it("excludes a student whose enrolment has been ended", async () => {
    await prisma.enrollment.updateMany({
      where: { studentId: solo, levelId },
      data: { deletedAt: new Date(), deletedById: adminId },
    });
    expect(await unassigned()).not.toContain(solo);
  });

  it("returns a student whose seat was released — R59 tombstones, it does not erase", async () => {
    const circle = await prisma.teachingGroup.findFirstOrThrow({
      where: { levelId, subjectId, deletedAt: null },
    });
    await addMember(prisma, superAdmin(), circle.id, solo);
    await prisma.studentTeachingGroup.updateMany({
      where: { studentId: solo, deletedAt: null },
      data: { deletedAt: new Date(), deletedById: adminId },
    });
    // A tombstoned seat is not a seat: she is unassigned again.
    expect(await unassigned()).toContain(solo);
  });
});

describe("P1 — a group-less student sees her Level’s private library content", () => {
  async function privateContent(): Promise<string> {
    return (
      await prisma.educationalContent.create({
        data: {
          title: `${TAG} محتوى خاص`,
          levelId,
          subjectId,
          branchId: branchA,
          academicYearId: yearId,
          visibility: "private",
          storageBucket: "private",
          storageKey: `${TAG}/${Date.now()}-${Math.random()}`,
          originalFilename: "a.pdf",
          mimeType: "application/pdf",
          sizeBytes: 10,
        },
      })
    ).id;
  }

  const seen = async (userId: string, actingStudentId?: string) =>
    (
      await listLibrary(
        prisma,
        {
          userId,
          roles: [],
          roleScopes: [],
          // `listLibrary` resolves private Levels only for an ACTIVE non-staff
          // account — omitting this made the fixture, not the code, the reason
          // nothing was visible.
          accountStatus: "active",
          ...(actingStudentId === undefined ? {} : { actingStudentId }),
        },
        {},
      )
    ).data.map((c) => c.id);

  it("is visible to BOTH shapes of enrolment", async () => {
    const id = await privateContent();
    expect(await seen(grouped, grouped)).toContain(id);
    expect(await seen(solo, solo)).toContain(id);
  });

  it("is not visible to a student of another Level", async () => {
    const id = await privateContent();
    const stranger = await person("مستوى آخر");
    expect(await seen(stranger, stranger)).not.toContain(id);
  });

  it("is not visible once the enrolment is ended", async () => {
    const id = await privateContent();
    await prisma.enrollment.updateMany({
      where: { studentId: solo, levelId },
      data: { deletedAt: new Date(), deletedById: adminId },
    });
    expect(await seen(solo, solo)).not.toContain(id);
  });

  it("reaches a PARENT of a group-less child, exactly as of a grouped one", async () => {
    const id = await privateContent();
    const parent = await person("ولية أمر");
    await prisma.familyLink.create({
      data: { parentId: parent, studentId: solo, status: "approved" },
    });
    expect(await seen(parent)).toContain(id);
  });
});
