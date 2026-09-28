import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import { readCalendar, type CalendarQuery } from "./calendar.service.js";
import {
  clearTeachingContext,
  createTeachingContext,
  type TeachingFixture,
} from "../test-support/educational-fixture.js";

/**
 * **R176 §3/§4 (Owner-reported, 2026-09-28) — a `multi_dimension` class is in
 * the calendar of its Category, its Level, its group and its circle, and its
 * occurrence names all four.**
 *
 * Every class an administrator creates since R163 §5 is `multi_dimension`:
 * the three legacy single-target columns are NULL and the audience lives in
 * five join tables. The public filters and the occurrence mapper read only
 * the legacy columns, so the calendar of «النساء» showed none of the
 * women's classes and each of them rendered with no Category, no Level and no
 * audience. The event side had been corrected on 2026-09-21 (R169 §6,
 * `calendar.integration.test.ts`); this pins the same reading for a class.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);

const TAG = "[r176-cal-test]";
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const range = { from: day("2026-09-01"), to: day("2026-09-30") };

async function makeBranch(name: string): Promise<string> {
  const b = await prisma.branch.create({
    data: { name: `${TAG} ${name}`, operationalStartDate: day("2020-01-01") },
  });
  return b.id;
}

/**
 * A `multi_dimension` class naming the given dimensions — and ONLY those, an
 * unnamed dimension being «الكل» (R169 §6). One transaction, because
 * `course_schedule_multi_dimension_nonempty` is checked at COMMIT.
 */
async function multiDimensionClass(
  ctx: TeachingFixture,
  scope: { levelIds?: string[]; categoryIds?: string[]; groupIds?: string[]; circleIds?: string[] },
): Promise<string> {
  const academicYear = await prisma.academicYear.findFirstOrThrow({ select: { id: true } });
  return prisma.$transaction(async (tx) => {
    const schedule = await tx.recurringCourseSchedule.create({
      data: {
        title: `${TAG} حصة`,
        subjectId: ctx.subjectId,
        teachingMode: "multi_dimension",
        branchId: ctx.branchId,
        startTime: new Date(Date.UTC(1970, 0, 1, 9, 0, 0)),
        endTime: new Date(Date.UTC(1970, 0, 1, 10, 30, 0)),
        recurrence: "weekly",
        weekdays: ["saturday" as never],
        academicYearId: academicYear.id,
      },
    });
    for (const levelId of scope.levelIds ?? [])
      await tx.courseScheduleLevel.create({ data: { scheduleId: schedule.id, levelId } });
    for (const categoryId of scope.categoryIds ?? [])
      await tx.courseScheduleCategory.create({ data: { scheduleId: schedule.id, categoryId } });
    for (const administrativeGroupId of scope.groupIds ?? [])
      await tx.courseScheduleAdministrativeGroup.create({
        data: { scheduleId: schedule.id, administrativeGroupId },
      });
    for (const teachingGroupId of scope.circleIds ?? [])
      await tx.courseScheduleTeachingGroup.create({ data: { scheduleId: schedule.id, teachingGroupId } });
    const session = await tx.session.create({
      data: {
        scheduleId: schedule.id,
        date: day("2026-09-12"),
        startTime: schedule.startTime,
        endTime: schedule.endTime,
      },
    });
    return session.id;
  });
}

async function clear(): Promise<void> {
  const scheduleIds = (
    await prisma.recurringCourseSchedule.findMany({ where: { title: { startsWith: TAG } }, select: { id: true } })
  ).map((s) => s.id);
  const sessionIds = (
    await prisma.session.findMany({ where: { scheduleId: { in: scheduleIds } }, select: { id: true } })
  ).map((s) => s.id);
  await prisma.auditLog.deleteMany({ where: { targetId: { in: sessionIds } } });
  await prisma.session.deleteMany({ where: { id: { in: sessionIds } } });
  await prisma.courseScheduleLevel.deleteMany({ where: { scheduleId: { in: scheduleIds } } });
  await prisma.courseScheduleCategory.deleteMany({ where: { scheduleId: { in: scheduleIds } } });
  await prisma.courseScheduleAdministrativeGroup.deleteMany({ where: { scheduleId: { in: scheduleIds } } });
  await prisma.courseScheduleTeachingGroup.deleteMany({ where: { scheduleId: { in: scheduleIds } } });
  await prisma.recurringCourseSchedule.deleteMany({ where: { id: { in: scheduleIds } } });
  await prisma.teachingGroup.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.event.deleteMany({ where: { title: { startsWith: TAG } } });
  await clearTeachingContext(prisma, TAG);
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
}

let ctx: TeachingFixture;
let otherCategoryId: string;

beforeEach(async () => {
  await clear();
  ctx = await createTeachingContext(prisma, TAG, await makeBranch("فرع"));
  otherCategoryId = (await prisma.category.create({ data: { name: `${TAG} فئة أخرى` } })).id;
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

type Narrowing = Partial<Pick<CalendarQuery, "levelId" | "categoryId" | "administrativeGroupId" | "teachingGroupId">>;
const idsOf = async (query: Narrowing): Promise<string[]> =>
  (await readCalendar(prisma, null, { ...range, ...query }))
    .filter((r) => r.kind === "session")
    .map((r) => r.id);

describe("R176 §4 — the Category and Level filters admit a multi_dimension class", () => {
  it("a class addressed to a Level is in the calendar of that Level AND of its Category", async () => {
    const forLevel = await multiDimensionClass(ctx, { levelIds: [ctx.levelId] });

    expect(await idsOf({ levelId: ctx.levelId })).toContain(forLevel);
    expect(await idsOf({ categoryId: ctx.categoryId })).toContain(forLevel);
    expect(await idsOf({ categoryId: otherCategoryId })).not.toContain(forLevel);
  });

  it("a class addressed to a group is in the calendar of that group, its Level and its Category", async () => {
    const forGroup = await multiDimensionClass(ctx, { groupIds: [ctx.administrativeGroupId] });

    expect(await idsOf({ administrativeGroupId: ctx.administrativeGroupId })).toContain(forGroup);
    expect(await idsOf({ levelId: ctx.levelId })).toContain(forGroup);
    expect(await idsOf({ categoryId: ctx.categoryId })).toContain(forGroup);
  });

  it("a class for a whole Category is in the calendar of each of its Levels, and of no other Category", async () => {
    const forCategory = await multiDimensionClass(ctx, { categoryIds: [ctx.categoryId] });

    expect(await idsOf({ categoryId: ctx.categoryId })).toContain(forCategory);
    expect(await idsOf({ levelId: ctx.levelId })).toContain(forCategory);
    expect(await idsOf({ categoryId: otherCategoryId })).not.toContain(forCategory);
  });

  it("a circle's calendar is the classes addressed to it, and its Level's calendar includes them", async () => {
    const circle = await prisma.teachingGroup.create({
      data: { name: `${TAG} حلقة`, subjectId: ctx.subjectId, levelId: ctx.levelId, branchId: ctx.branchId },
    });
    const forCircle = await multiDimensionClass(ctx, { circleIds: [circle.id] });
    const forGroup = await multiDimensionClass(ctx, { groupIds: [ctx.administrativeGroupId] });

    const byCircle = await idsOf({ teachingGroupId: circle.id });
    expect(byCircle).toContain(forCircle);
    // A group is orthogonal to a circle: the group's class names no circle,
    // so it does not narrow to one — and «الكل» on that dimension admits it.
    expect(byCircle).toContain(forGroup);
    expect(await idsOf({ levelId: ctx.levelId })).toContain(forCircle);
  });
});

describe("R176 §3 — the occurrence names every dimension the class is addressed to", () => {
  it("a multi_dimension class carries its Category, Level, group and circle by id and by name", async () => {
    const circle = await prisma.teachingGroup.create({
      data: { name: `${TAG} حلقة`, subjectId: ctx.subjectId, levelId: ctx.levelId, branchId: ctx.branchId },
    });
    const sessionId = await multiDimensionClass(ctx, {
      levelIds: [ctx.levelId],
      groupIds: [ctx.administrativeGroupId],
      circleIds: [circle.id],
    });
    const row = (await readCalendar(prisma, null, range)).find((r) => r.id === sessionId);
    expect(row).toBeDefined();

    // Category inferred from the named Level — never left empty for a class
    // that plainly has one.
    expect(row!.categoryIds).toEqual([ctx.categoryId]);
    expect(row!.categoryId).toBe(ctx.categoryId);
    expect(row!.levelIds).toEqual([ctx.levelId]);
    expect(row!.levelId).toBe(ctx.levelId);
    expect(row!.administrativeGroupIds).toEqual([ctx.administrativeGroupId]);
    expect(row!.teachingGroupIds).toEqual([circle.id]);
    expect(row!.teachingGroupNames).toEqual([`${TAG} حلقة`]);
    expect(row!.administrativeGroupNames).toHaveLength(1);
    expect(row!.audienceLabel).toBe(row!.administrativeGroupNames[0]);
  });

  it("a class addressed to a whole Category names no Level, group or circle — «الكل» there is empty, not invented", async () => {
    const sessionId = await multiDimensionClass(ctx, { categoryIds: [ctx.categoryId] });
    const row = (await readCalendar(prisma, null, range)).find((r) => r.id === sessionId)!;
    expect(row.categoryIds).toEqual([ctx.categoryId]);
    expect(row.levelIds).toEqual([]);
    expect(row.administrativeGroupIds).toEqual([]);
    expect(row.teachingGroupIds).toEqual([]);
    expect(row.audienceLabel).toBe(row.categoryNames[0]);
  });
});

describe("R176 §4 — the Surah filter lists what the occurrence shows, and nothing else", () => {
  it("a class about a Surah is under that Surah, not under another; an activity is never under any", async () => {
    // The fixture Subject does not work by Surah; a Quran one does (R165 §2).
    await prisma.subject.update({ where: { id: ctx.subjectId }, data: { requiresSurahs: true } });
    const sessionId = await multiDimensionClass(ctx, { levelIds: [ctx.levelId] });
    const { scheduleId } = await prisma.session.findUniqueOrThrow({ where: { id: sessionId }, select: { scheduleId: true } });
    await prisma.courseScheduleSurah.create({ data: { scheduleId, surahId: 112 } });
    const activity = await prisma.event.create({
      data: {
        title: `${TAG} نشاط`,
        startDate: day("2026-09-12"),
        visibility: "public",
        recurrenceType: "none",
      },
    });

    const under112 = (await readCalendar(prisma, null, { ...range, surahId: 112 })).map((r) => r.id);
    expect(under112).toContain(sessionId);
    expect(under112).not.toContain(activity.id);
    expect((await readCalendar(prisma, null, { ...range, surahId: 113 })).map((r) => r.id)).not.toContain(sessionId);

    // An occurrence's OWN Surah replaces the class's for that date (R165 §5).
    await prisma.sessionSurah.create({ data: { sessionId, surahId: 113 } });
    expect((await readCalendar(prisma, null, { ...range, surahId: 113 })).map((r) => r.id)).toContain(sessionId);
    expect((await readCalendar(prisma, null, { ...range, surahId: 112 })).map((r) => r.id)).not.toContain(sessionId);

    await prisma.sessionSurah.deleteMany({ where: { sessionId } });
    await prisma.courseScheduleSurah.deleteMany({ where: { scheduleId } });
    await prisma.event.delete({ where: { id: activity.id } });
  });

  it("a class whose Subject does not work by Surah inherits none from its schedule", async () => {
    const sessionId = await multiDimensionClass(ctx, { levelIds: [ctx.levelId] });
    const { scheduleId } = await prisma.session.findUniqueOrThrow({ where: { id: sessionId }, select: { scheduleId: true } });
    await prisma.courseScheduleSurah.create({ data: { scheduleId, surahId: 112 } });
    expect((await readCalendar(prisma, null, { ...range, surahId: 112 })).map((r) => r.id)).not.toContain(sessionId);
    await prisma.courseScheduleSurah.deleteMany({ where: { scheduleId } });
  });
});
