import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { actorFor } from "../test-support/actor.js";

import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import {
  purgeExpiredAuthRows,
  type Db,
} from "../repositories/audit.repository.js";
import {
  clearTeachingContext,
  createTeachingContext,
  enrol as enrolStudent,
  staff as staffSchedule,
  type TeachingFixture,
} from "../test-support/educational-fixture.js";
import { readProfile, writeProfile } from "./social-profile.service.js";

/**
 * StudentSocialProfile — §4.10, BR-16, TD-2 Revision 28.
 *
 * The most restricted surface in the system, so the tests assert the matrix in
 * **both** directions (who may, and who must not), the audit trail for reads as
 * well as writes, and the §20-rule-17 property that out-of-scope and nonexistent
 * are indistinguishable.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = `[social-test:${randomUUID()}]`;
const AUDIT_PURGE_ROLLBACK = new Error("social-profile audit-purge rollback");

let levelId: string;

async function rolledBackAuditPurge(run: (tx: Db) => Promise<void>): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      await run(tx);
      throw AUDIT_PURGE_ROLLBACK;
    });
  } catch (error) {
    if (error === AUDIT_PURGE_ROLLBACK) return;
    throw error;
  }
}

async function person(label: string, status = "active"): Promise<string> {
  const u = await prisma.user.create({
    data: {
      // R80 — every person carries a recorded sex; the column is NOT NULL.
      sex: "female",
      nameArabic: `${TAG} ${label}`,
      accountStatus: status as never,
    },
  });
  return u.id;
}

async function staff(
  label: string,
  role: string,
  branchId: string | null,
): Promise<string> {
  const id = await person(label);
  const roleRow = await prisma.role.findUnique({ where: { name: role } });
  await prisma.userBranchRole.create({
    data: { userId: id, roleId: roleRow!.id, branchId },
  });
  return id;
}

async function makeBranch(name: string): Promise<string> {
  const b = await prisma.branch.create({
    data: {
      name: `${TAG} ${name}`,
      operationalStartDate: new Date("2026-01-01"),
    },
  });
  return b.id;
}

/**
 * Revision 43: a "group" for scope purposes is now an Administrative Group plus
 * the Course Schedule that makes a teacher's reach expressible (§4.4c). The
 * shared fixture builds both, so this suite states what it needs and not how
 * the model is wired.
 */
const contexts = new Map<string, TeachingFixture>();

async function makeGroup(branchId: string, name: string): Promise<string> {
  const ctx = await createTeachingContext(prisma, `${TAG} ${name}`, branchId, {
    levelId,
  });
  contexts.set(ctx.administrativeGroupId, ctx);
  return ctx.administrativeGroupId;
}

/** Staffs the group's schedule — the path by which a teacher reaches its
 *  students now that `GroupTeacher` is retired (§4.4c). */
const assign = (groupId: string, teacherId: string) =>
  staffSchedule(prisma, contexts.get(groupId)!, teacherId);
const enrol = (groupId: string, studentId: string) =>
  enrolStudent(prisma, contexts.get(groupId)!, studentId);

async function clear(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({
    where: { OR: [{ actorUserId: { in: ids } }, { targetId: { in: ids } }] },
  });
  await prisma.studentSocialProfile.deleteMany({
    where: { studentId: { in: ids } },
  });
  // FamilyLink references users under RESTRICT. Cleaning it here rather than
  // inside a test matters: a test that fails before its own cleanup line would
  // otherwise leave an orphan row that blocks teardown for every later run.
  await prisma.familyLink.deleteMany({
    where: { OR: [{ parentId: { in: ids } }, { studentId: { in: ids } }] },
  });
  await prisma.enrollment.deleteMany({ where: { studentId: { in: ids } } });
  await prisma.courseScheduleStaff.deleteMany({
    where: { userId: { in: ids } },
  });
  await clearTeachingContext(prisma, TAG);
  contexts.clear();
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeEach(async () => {
  await clear();
  const level = await prisma.level.findFirst({ select: { id: true } });
  levelId = level!.id;
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

/** A branch with one group, one assigned teacher, and one enrolled student. */
async function scenario() {
  const branchId = await makeBranch("مراكش");
  const groupId = await makeGroup(branchId, "مجموعة");
  const teacher = await staff("معلمة", "teacher", null);
  const student = await person("طالبة");
  await assign(groupId, teacher);
  await enrol(groupId, student);
  return { branchId, groupId, teacher, student };
}

describe("TD-2 R28 — who MAY reach a case file", () => {
  it("an assigned teacher reads and writes their own student", async () => {
    const { teacher, student } = await scenario();

    await writeProfile(prisma, await actorFor(prisma, teacher), student, {
      healthCondition: "ربو خفيف",
    });
    const profile = await readProfile(
      prisma,
      await actorFor(prisma, teacher),
      student,
    );
    expect(profile.healthCondition).toBe("ربو خفيف");
  });

  it("a Super Admin reaches any student", async () => {
    const { student } = await scenario();
    const superAdmin = await staff("مشرف عام", "super_admin", null);
    await expect(
      readProfile(prisma, await actorFor(prisma, superAdmin), student),
    ).resolves.toBeTruthy();
  });

  it("an Admin reaches a student inside their branch scope", async () => {
    const { branchId, student } = await scenario();
    const admin = await staff("مشرفة", "admin", branchId);
    await expect(
      writeProfile(prisma, await actorFor(prisma, admin), student, {
        homeAddress: "حي السلام",
      }),
    ).resolves.toBeTruthy();
  });

  it("returns nulls, not an error, when no profile exists yet", async () => {
    const { teacher, student } = await scenario();
    const profile = await readProfile(
      prisma,
      await actorFor(prisma, teacher),
      student,
    );
    expect(profile.studentId).toBe(student);
    expect(profile.healthCondition).toBeNull();
  });
});

describe("BR-16 — who MUST NOT reach a case file", () => {
  it("a teacher NOT assigned to the student is refused", async () => {
    const { student } = await scenario();
    const outsider = await staff("معلمة أخرى", "teacher", null);

    await expect(
      readProfile(prisma, await actorFor(prisma, outsider), student),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      writeProfile(prisma, await actorFor(prisma, outsider), student, {
        healthCondition: "محاولة",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("an Admin OUTSIDE the student's branch is refused", async () => {
    const { student } = await scenario();
    const elsewhere = await makeBranch("الدار البيضاء");
    const admin = await staff("مشرفة أخرى", "admin", elsewhere);

    await expect(
      readProfile(prisma, await actorFor(prisma, admin), student),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("BR-16 R28: the child's OWN approved parent is refused", async () => {
    // The correction this revision exists for: BR-16 previously said "never
    // *unrelated* guardians", which implied a related one might qualify.
    const { student } = await scenario();
    const parent = await staff("والدة", "parent", null);
    await prisma.familyLink.create({
      data: {
        parentId: parent,
        studentId: student,
        status: "approved",
        decidedAt: new Date(),
      },
    });

    await expect(
      readProfile(prisma, await actorFor(prisma, parent), student),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("a student is refused their own profile", async () => {
    const { student } = await scenario();
    const roleRow = await prisma.role.findUnique({
      where: { name: "student" },
    });
    await prisma.userBranchRole.create({
      data: { userId: student, roleId: roleRow!.id, branchId: null },
    });

    await expect(
      readProfile(prisma, await actorFor(prisma, student), student),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("§20 rule 17: out-of-scope and nonexistent are indistinguishable", async () => {
    const { student } = await scenario();
    const outsider = await staff("معلمة أخرى", "teacher", null);

    const outOfScope = await readProfile(
      prisma,
      await actorFor(prisma, outsider),
      student,
    ).catch((e: unknown) => e);
    const nonexistent = await readProfile(
      prisma,
      await actorFor(prisma, outsider),
      "11111111-2222-4333-8444-555555555555",
    ).catch((e: unknown) => e);

    // A 403 for the real student would confirm that this child has a case file.
    expect((outOfScope as { code: string }).code).toBe("NOT_FOUND");
    expect((nonexistent as { code: string }).code).toBe("NOT_FOUND");
  });

  it("TD-12: a teacher suspended mid-session loses access immediately", async () => {
    const { teacher, student } = await scenario();
    await prisma.user.update({
      where: { id: teacher },
      data: { accountStatus: "suspended" },
    });

    // The token is untouched; only the database row changed.
    await expect(
      readProfile(prisma, await actorFor(prisma, teacher), student),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("revoking the group assignment ends access on the very next call", async () => {
    const { groupId, teacher, student } = await scenario();
    await expect(
      readProfile(prisma, await actorFor(prisma, teacher), student),
    ).resolves.toBeTruthy();

    // Revocation now means un-staffing the schedule (§4.4c) — the reach ends
    // on the very next call, exactly as revoking a GroupTeacher row once did.
    await prisma.courseScheduleStaff.updateMany({
      where: { scheduleId: contexts.get(groupId)!.scheduleId, userId: teacher },
      data: { deletedAt: new Date() },
    });

    await expect(
      readProfile(prisma, await actorFor(prisma, teacher), student),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("TD-8 R28 — reads and writes are both audited", () => {
  it("a READ writes socialprofile.view naming the actor and student", async () => {
    const { teacher, student } = await scenario();
    await readProfile(prisma, await actorFor(prisma, teacher), student);

    const row = await prisma.auditLog.findFirst({
      where: { actorUserId: teacher, actionType: "socialprofile.view" },
    });
    expect(row).not.toBeNull();
    expect((row!.detail as Record<string, unknown>)["student_id"]).toBe(
      student,
    );
  });

  it("a read is audited even when no profile exists — the attempt is the event", async () => {
    const { teacher, student } = await scenario();
    await readProfile(prisma, await actorFor(prisma, teacher), student);

    const row = await prisma.auditLog.findFirst({
      where: { actorUserId: teacher, actionType: "socialprofile.view" },
    });
    expect((row!.detail as Record<string, unknown>)["existed"]).toBe(false);
  });

  it("a WRITE records which fields changed but NEVER their values (§14 no PII)", async () => {
    const { teacher, student } = await scenario();
    await writeProfile(prisma, await actorFor(prisma, teacher), student, {
      healthCondition: "حالة حساسة جدا",
      homeAddress: "عنوان سري",
    });

    const row = await prisma.auditLog.findFirst({
      where: { actorUserId: teacher, actionType: "socialprofile.update" },
    });
    const detail = row!.detail as Record<string, unknown>;
    expect(detail["fields_changed"]).toEqual(
      expect.arrayContaining(["healthCondition", "homeAddress"]),
    );
    // Copying the value here would move BR-16-restricted data into a table with
    // a different access rule.
    expect(JSON.stringify(detail)).not.toContain("حالة حساسة جدا");
    expect(JSON.stringify(detail)).not.toContain("عنوان سري");
  });

  it("a refused attempt writes NO audit row (nothing was viewed)", async () => {
    const { student } = await scenario();
    const outsider = await staff("معلمة أخرى", "teacher", null);
    await readProfile(prisma, await actorFor(prisma, outsider), student).catch(
      () => undefined,
    );

    expect(
      await prisma.auditLog.count({ where: { actorUserId: outsider } }),
    ).toBe(0);
  });

  it("socialprofile actions are NOT purgeable (R19 allowlist)", async () => {
    const { teacher, student } = await scenario();
    await readProfile(prisma, await actorFor(prisma, teacher), student);

    // Far-future horizon: age alone must not remove a safeguarding-access row.
    // The Production query is intentionally platform-wide, so the proof must
    // roll back: tagged cleanup cannot recreate somebody else's auth history.
    await rolledBackAuditPurge(async (tx) => {
      await purgeExpiredAuthRows(tx, new Date("2099-01-01"));
      expect(
        await tx.auditLog.count({
          where: { actorUserId: teacher, actionType: "socialprofile.view" },
        }),
      ).toBe(1);
    });
  });
});

describe("§4.10 — write semantics", () => {
  it("a partial update never blanks a colleague's entry by omission", async () => {
    const { teacher, student } = await scenario();
    await writeProfile(prisma, await actorFor(prisma, teacher), student, {
      healthCondition: "ربو",
      fatherName: "محمد",
    });
    await writeProfile(prisma, await actorFor(prisma, teacher), student, {
      fatherName: "أحمد",
    });

    const after = await readProfile(
      prisma,
      await actorFor(prisma, teacher),
      student,
    );
    expect(after.fatherName).toBe("أحمد");
    expect(after.healthCondition).toBe("ربو"); // untouched, not blanked
  });

  it("an explicit null clears a field", async () => {
    const { teacher, student } = await scenario();
    await writeProfile(prisma, await actorFor(prisma, teacher), student, {
      healthCondition: "ربو",
    });
    await writeProfile(prisma, await actorFor(prisma, teacher), student, {
      healthCondition: null,
    });

    expect(
      (await readProfile(prisma, await actorFor(prisma, teacher), student))
        .healthCondition,
    ).toBeNull();
  });

  it("writing twice upserts rather than creating a second record", async () => {
    const { teacher, student } = await scenario();
    await writeProfile(prisma, await actorFor(prisma, teacher), student, {
      healthCondition: "أ",
    });
    await writeProfile(prisma, await actorFor(prisma, teacher), student, {
      healthCondition: "ب",
    });

    expect(
      await prisma.studentSocialProfile.count({
        where: { studentId: student },
      }),
    ).toBe(1);
  });
});
