import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import { personalCalendarOptions } from "./calendar.service.js";
import {
  clearTeachingContext,
  createTeachingContext,
  enrol,
  staff as staffSchedule,
  type TeachingFixture,
} from "../test-support/educational-fixture.js";

/**
 * `personalCalendarOptions` — تقويمي's own filter vocabulary (Owner-reported,
 * 2026-09-15): the fix for the dropdown that showed every Level/Category in
 * the association, sourced from the same public `GET /calendar/bootstrap`
 * chrome the anonymous timetable uses. This proves the replacement resolves
 * to the caller's OWN enrolment/staffing, the same union `personalFilters`
 * itself reads (R140 §3) — never the whole catalogue.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = "[personal-cal-options-test]";

async function person(label: string): Promise<string> {
  const u = await prisma.user.create({
    data: { sex: "female", nameArabic: `${TAG} ${label}`, accountStatus: "active" },
  });
  return u.id;
}

async function makeBranch(name: string): Promise<string> {
  const b = await prisma.branch.create({
    data: { name: `${TAG} ${name}`, operationalStartDate: new Date("2020-01-01") },
  });
  return b.id;
}

beforeEach(async () => clearTeachingContext(prisma, TAG));
afterAll(async () => {
  await clearTeachingContext(prisma, TAG);
  await prisma.user.deleteMany({ where: { nameArabic: { startsWith: TAG } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.$disconnect();
});

describe("a beneficiary's own vocabulary", () => {
  it("offers only her own enrolled Level, Category and group — never another", async () => {
    const branchA = await makeBranch("فرع أ");
    const branchB = await makeBranch("فرع ب");
    const mine: TeachingFixture = await createTeachingContext(prisma, TAG, branchA);
    const other: TeachingFixture = await createTeachingContext(prisma, `${TAG} أخرى`, branchB);
    const studentId = await person("مستفيدة");
    await enrol(prisma, mine, studentId);

    const options = await personalCalendarOptions(prisma, studentId);
    expect(options.levels.map((l) => l.id)).toEqual([mine.levelId]);
    expect(options.categories.map((c) => c.id)).toEqual([mine.categoryId]);
    expect(options.groups.map((g) => g.id)).toEqual([mine.administrativeGroupId]);
    expect(options.levels.map((l) => l.id)).not.toContain(other.levelId);
    expect(options.categories.map((c) => c.id)).not.toContain(other.categoryId);

    await clearTeachingContext(prisma, `${TAG} أخرى`);
  });

  it("offers her enrolled Level's own Subjects (مواد المستوى)", async () => {
    const branchId = await makeBranch("فرع");
    const fixture = await createTeachingContext(prisma, TAG, branchId);
    const studentId = await person("مستفيدة");
    await enrol(prisma, fixture, studentId);

    const options = await personalCalendarOptions(prisma, studentId);
    expect(options.subjects.map((s) => s.id)).toContain(fixture.subjectId);
  });

  it("offers nothing at all, honestly, to someone neither enrolled nor staffing — not a refusal", async () => {
    const studentId = await person("بلا شيء");
    const options = await personalCalendarOptions(prisma, studentId);
    expect(options).toEqual({
      branches: [],
      categories: [],
      levels: [],
      subjects: [],
      groups: [],
      circles: [],
    });
  });
});

describe("a مؤطرة's own vocabulary", () => {
  it("offers only the branch, Level and Category she currently staffs", async () => {
    const branchA = await makeBranch("فرع أ");
    const branchB = await makeBranch("فرع ب");
    const mine = await createTeachingContext(prisma, TAG, branchA);
    const other = await createTeachingContext(prisma, `${TAG} أخرى`, branchB);
    const teacherId = await person("مؤطرة");
    await staffSchedule(prisma, mine, teacherId);

    const options = await personalCalendarOptions(prisma, teacherId);
    expect(options.branches.map((b) => b.id)).toEqual([mine.branchId]);
    expect(options.levels.map((l) => l.id)).toEqual([mine.levelId]);
    expect(options.categories.map((c) => c.id)).toEqual([mine.categoryId]);
    expect(options.branches.map((b) => b.id)).not.toContain(other.branchId);

    await clearTeachingContext(prisma, `${TAG} أخرى`);
  });

  it("offers the Subject she teaches", async () => {
    const branchId = await makeBranch("فرع");
    const fixture = await createTeachingContext(prisma, TAG, branchId);
    const teacherId = await person("مؤطرة");
    await staffSchedule(prisma, fixture, teacherId);

    const options = await personalCalendarOptions(prisma, teacherId);
    expect(options.subjects.map((s) => s.id)).toEqual([fixture.subjectId]);
  });

  it("someone who both studies and teaches gets the union of both", async () => {
    const branchA = await makeBranch("فرع أ");
    const branchB = await makeBranch("فرع ب");
    const asStudent = await createTeachingContext(prisma, TAG, branchA);
    const asTeacher = await createTeachingContext(prisma, `${TAG} تدريس`, branchB);
    const personId = await person("مزدوجة");
    await enrol(prisma, asStudent, personId);
    await staffSchedule(prisma, asTeacher, personId);

    const options = await personalCalendarOptions(prisma, personId);
    expect(options.levels.map((l) => l.id).sort()).toEqual(
      [asStudent.levelId, asTeacher.levelId].sort(),
    );

    await clearTeachingContext(prisma, `${TAG} تدريس`);
  });
});
