import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import type { Actor } from "../policies/actor.js";
import { requireMemorisationSubject } from "../test-support/quran-subject.js";
import { readCalendar } from "./calendar.service.js";
import {
  createCourseSchedule,
  listCourseSchedules,
  listScheduleSessions,
  updateCourseSchedule,
  type CourseScheduleInput,
} from "./course-schedule.service.js";
import { scheduleExam } from "./exam-scheduling.service.js";
import { updatePhysicalExam } from "./exam.service.js";
import { createLevel } from "./level.service.js";
import { readScopeOptions } from "./scope-options.service.js";
import { overrideSession } from "./session.service.js";
import { updateSubject } from "./taxonomy.service.js";

/**
 * **SRS Revision 165 §2/§5 — the Surahs a class, one occurrence or an exam is
 * about.**
 *
 * Each Level's Surahs are set in «مقرر الحفظ» (`LevelSurah`); a Subject that
 * works by Surah (`requires_surahs` — حفظ القرآن, تفسير القرآن) must say which
 * whenever it is scheduled. One rule (`resolveSurahs`), asked at every surface
 * below — these tests are what keep it asked at all of them.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = "[surah-test]";

const NOW = new Date("2026-06-01T08:00:00.000Z");
const at = (hh: number): Date => new Date(Date.UTC(1970, 0, 1, hh, 0, 0));
const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
const FIRST = "2026-06-02";

/** In the Level's «مقرر الحفظ»… */
const FATIHA = 1;
const BAQARA = 2;
/** …and not. */
const NAS = 114;

let actorUserId: string;
let branchId: string;
let roomId: string;
let levelId: string;
let tafseerId: string;
let fiqhId: string;
let academicYearId: string;

const superAdmin = (): Actor => ({
  userId: actorUserId,
  roles: ["super_admin"],
  roleScopes: [{ role: "super_admin", branches: null }],
});

async function reason(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
    return "(no error)";
  } catch (e) {
    return (e as { details?: Record<string, unknown> }).details?.["reason"];
  }
}

async function cleanup(): Promise<void> {
  const tagged = { name: { startsWith: TAG } };
  const taggedPerson = { nameArabic: { startsWith: TAG } };
  const ofTaggedSchedule = { schedule: { subject: tagged } };

  await prisma.examStaff.deleteMany({ where: { exam: { title: { startsWith: TAG } } } });
  await prisma.exam.deleteMany({ where: { title: { startsWith: TAG } } });
  await prisma.sessionSurah.deleteMany({ where: { session: ofTaggedSchedule } });
  await prisma.sessionStaff.deleteMany({ where: { session: ofTaggedSchedule } });
  await prisma.notification.deleteMany({ where: { session: ofTaggedSchedule } });
  await prisma.session.deleteMany({ where: ofTaggedSchedule });
  await prisma.courseScheduleStaff.deleteMany({ where: ofTaggedSchedule });
  // `course_schedule_surah` cascades with its schedule.
  await prisma.recurringCourseSchedule.deleteMany({ where: { subject: tagged } });
  await prisma.levelSurah.deleteMany({ where: { level: tagged } });
  await prisma.levelSubject.deleteMany({ where: { subject: tagged } });
  await prisma.administrativeGroup.deleteMany({ where: { level: tagged } });
  await prisma.trash.deleteMany({ where: { deletedBy: taggedPerson } });
  await prisma.auditLog.deleteMany({ where: { actor: taggedPerson } });
  await prisma.user.deleteMany({ where: taggedPerson });
  await prisma.subject.deleteMany({ where: tagged });
  await prisma.level.deleteMany({ where: tagged });
  await prisma.room.deleteMany({ where: tagged });
  await prisma.branch.deleteMany({ where: tagged });
  await prisma.category.deleteMany({ where: tagged });
}

beforeEach(async () => {
  await cleanup();
  actorUserId = (
    await prisma.user.create({
      data: { sex: "female", nameArabic: `${TAG} المسؤولة`, accountStatus: "active" },
    })
  ).id;
  const categoryId = (await prisma.category.create({ data: { name: `${TAG} الكبار` } })).id;
  branchId = (
    await prisma.branch.create({
      data: { name: `${TAG} أمرشيش`, operationalStartDate: day("2026-01-01") },
    })
  ).id;
  roomId = (await prisma.room.create({ data: { name: `${TAG} قاعة`, branchId } })).id;
  levelId = (
    await createLevel(prisma, superAdmin(), {
      name: `${TAG} المستوى 1`,
      categoryId,
      genderRestriction: "any",
    })
  ).level.id;
  // The marker is a COLUMN — neither name below is one the platform reads.
  tafseerId = (
    await prisma.subject.create({ data: { name: `${TAG} مادة بالسور`, requiresSurahs: true } })
  ).id;
  fiqhId = (await prisma.subject.create({ data: { name: `${TAG} مادة عادية` } })).id;
  await prisma.levelSubject.createMany({
    data: [
      { levelId, subjectId: tafseerId },
      { levelId, subjectId: fiqhId },
    ],
  });
  // «مقرر الحفظ»: the Level has reached الفاتحة and البقرة, and nothing else.
  await prisma.levelSurah.createMany({
    data: [
      { levelId, surahId: FATIHA },
      { levelId, surahId: BAQARA },
    ],
  });
  academicYearId = (
    (await prisma.academicYear.findFirst({ where: { deletedAt: null } })) ??
    (await prisma.academicYear.create({ data: { label: `${TAG} 2026-2027` } }))
  ).id;
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

const classInput = (over: Partial<CourseScheduleInput> = {}): CourseScheduleInput => ({
  title: `${TAG} حلقة`,
  subjectId: tafseerId,
  teachingMode: "entire_level",
  targetId: levelId,
  branchId,
  roomId,
  startTime: at(15),
  endTime: at(17),
  recurrence: "weekly",
  weekdays: ["tuesday"],
  anchorDate: day(FIRST),
  academicYearId,
  staff: [],
  ...over,
});

/** The calendar's own read, as the person who may see everything. */
const calendarOn = (iso: string) =>
  readCalendar(
    prisma,
    { userId: actorUserId, roles: ["super_admin"], roleScopes: superAdmin().roleScopes, accountStatus: "active" },
    { from: day(iso), to: day(iso), branchId },
  );

const surahsOf = async (scheduleId: string): Promise<number[]> =>
  (
    await prisma.courseScheduleSurah.findMany({
      where: { scheduleId },
      orderBy: { surahId: "asc" },
    })
  ).map((row) => row.surahId);

describe("a class of a Subject that works by Surah", () => {
  it("cannot be scheduled without saying which Surah", async () => {
    expect(
      await reason(() => createCourseSchedule(prisma, superAdmin(), classInput(), NOW)),
    ).toBe("SURAHS_REQUIRED");
  });

  it("refuses a Surah the Level's «مقرر الحفظ» does not hold", async () => {
    expect(
      await reason(() =>
        createCourseSchedule(prisma, superAdmin(), classInput({ surahIds: [FATIHA, NAS] }), NOW),
      ),
    ).toBe("SURAH_NOT_IN_SYLLABUS");
  });

  it("stores them, and the list and the calendar both say which", async () => {
    const { id } = await createCourseSchedule(
      prisma,
      superAdmin(),
      classInput({ surahIds: [BAQARA, FATIHA, BAQARA] }),
      NOW,
    );
    // Deduplicated, Mushaf order.
    expect(await surahsOf(id)).toEqual([FATIHA, BAQARA]);

    const listed = await listCourseSchedules(prisma, superAdmin(), { subjectId: tafseerId });
    const row = listed.data.find((r) => r.id === id) as unknown as {
      surahIds: number[];
      surahNames: string[];
    };
    expect(row.surahIds).toEqual([FATIHA, BAQARA]);
    expect(row.surahNames).toEqual(["الفاتحة", "البقرة"]);

    const occurrences = await calendarOn(FIRST);
    const mine = occurrences.find((o) => o.kind === "session" && o.itemTitle === `${TAG} حلقة`);
    expect(mine?.surahNames).toEqual(["الفاتحة", "البقرة"]);
  });

  it("a Subject that is NOT taught by Surah refuses one rather than keeping an invented value", async () => {
    expect(
      await reason(() =>
        createCourseSchedule(
          prisma,
          superAdmin(),
          classInput({ subjectId: fiqhId, surahIds: [FATIHA] }),
          NOW,
        ),
      ),
    ).toBe("SURAHS_NOT_APPLICABLE");
    // …and needs none.
    const { id } = await createCourseSchedule(
      prisma,
      superAdmin(),
      classInput({ subjectId: fiqhId }),
      NOW,
    );
    expect(await surahsOf(id)).toEqual([]);
  });

  it("an edit of the whole series replaces them, and cannot empty them", async () => {
    const { id } = await createCourseSchedule(
      prisma,
      superAdmin(),
      classInput({ surahIds: [FATIHA] }),
      NOW,
    );
    await updateCourseSchedule(prisma, superAdmin(), id, { version: 0, surahIds: [BAQARA] }, NOW);
    expect(await surahsOf(id)).toEqual([BAQARA]);
    expect(
      await reason(() =>
        updateCourseSchedule(prisma, superAdmin(), id, { version: 1, surahIds: [] }, NOW),
      ),
    ).toBe("SURAHS_REQUIRED");
    // An edit that does not mention them leaves them alone.
    await updateCourseSchedule(prisma, superAdmin(), id, { version: 1, title: `${TAG} حلقة 2` }, NOW);
    expect(await surahsOf(id)).toEqual([BAQARA]);
  });

  it("a «from this date onward» split hands them to the successor — or the ones it names", async () => {
    const { id } = await createCourseSchedule(
      prisma,
      superAdmin(),
      classInput({ surahIds: [FATIHA] }),
      NOW,
    );
    const inherited = await updateCourseSchedule(
      prisma,
      superAdmin(),
      id,
      { version: 0, scope: "this_and_future", fromDate: day("2026-06-16") },
      NOW,
    );
    expect(await surahsOf(inherited.successorId!)).toEqual([FATIHA]);

    const renamed = await updateCourseSchedule(
      prisma,
      superAdmin(),
      inherited.successorId!,
      { version: 0, scope: "this_and_future", fromDate: day("2026-06-30"), surahIds: [BAQARA] },
      NOW,
    );
    expect(await surahsOf(renamed.successorId!)).toEqual([BAQARA]);
    // The predecessor keeps what it taught.
    expect(await surahsOf(inherited.successorId!)).toEqual([FATIHA]);
  });

  it("a split that moves the class to a Subject with no Surahs drops them", async () => {
    const { id } = await createCourseSchedule(
      prisma,
      superAdmin(),
      classInput({ surahIds: [FATIHA] }),
      NOW,
    );
    const moved = await updateCourseSchedule(
      prisma,
      superAdmin(),
      id,
      {
        version: 0,
        scope: "this_and_future",
        fromDate: day("2026-06-16"),
        subjectId: fiqhId,
        branchId,
        academicYearId,
        teachingMode: "entire_level",
        targetId: levelId,
      },
      NOW,
    );
    expect(await surahsOf(moved.successorId!)).toEqual([]);
  });
});

describe("§5 — one occurrence may name its own Surahs", () => {
  async function firstSession(scheduleId: string): Promise<{ id: string; version: number }> {
    return prisma.session.findFirstOrThrow({
      where: { scheduleId, date: day(FIRST) },
      select: { id: true, version: true },
    });
  }

  it("they REPLACE the class's for that date only, and `[]` returns it to the class's", async () => {
    const { id } = await createCourseSchedule(
      prisma,
      superAdmin(),
      classInput({ surahIds: [FATIHA] }),
      NOW,
    );
    const session = await firstSession(id);
    await overrideSession(prisma, superAdmin(), session.id, {
      version: session.version,
      surahIds: [BAQARA],
    });

    const rows = await listScheduleSessions(prisma, superAdmin(), id, {});
    const edited = rows.data.find((r) => r.id === session.id);
    expect(edited?.surahIds).toEqual([BAQARA]);
    // Every other date still inherits.
    expect(rows.data.filter((r) => r.id !== session.id).every((r) => r.surahIds.length === 0)).toBe(
      true,
    );
    const occurrences = await calendarOn(FIRST);
    expect(occurrences.find((o) => o.id === session.id)?.surahNames).toEqual(["البقرة"]);

    await overrideSession(prisma, superAdmin(), session.id, {
      version: session.version + 1,
      surahIds: [],
    });
    const after = await calendarOn(FIRST);
    expect(after.find((o) => o.id === session.id)?.surahNames).toEqual(["الفاتحة"]);
  });

  it("is held to the same «مقرر الحفظ»", async () => {
    const { id } = await createCourseSchedule(
      prisma,
      superAdmin(),
      classInput({ surahIds: [FATIHA] }),
      NOW,
    );
    const session = await firstSession(id);
    expect(
      await reason(() =>
        overrideSession(prisma, superAdmin(), session.id, {
          version: session.version,
          surahIds: [NAS],
        }),
      ),
    ).toBe("SURAH_NOT_IN_SYLLABUS");
  });

  it("an ordinary class retaught by Surah for one day must say which Surah", async () => {
    const { id } = await createCourseSchedule(
      prisma,
      superAdmin(),
      classInput({ subjectId: fiqhId }),
      NOW,
    );
    const session = await firstSession(id);
    expect(
      await reason(() =>
        overrideSession(prisma, superAdmin(), session.id, {
          version: session.version,
          subjectId: tafseerId,
        }),
      ),
    ).toBe("SURAHS_REQUIRED");
    await overrideSession(prisma, superAdmin(), session.id, {
      version: session.version,
      subjectId: tafseerId,
      surahIds: [FATIHA],
    });
    // …and returning it to the class's own Subject clears the leftover Surah.
    await overrideSession(prisma, superAdmin(), session.id, {
      version: session.version + 1,
      subjectId: null,
    });
    expect(await prisma.sessionSurah.count({ where: { sessionId: session.id } })).toBe(0);
  });
});

describe("an exam of a Subject that works by Surah", () => {
  const sitting = (over: { surahId?: number | null; subjectId?: string; title: string }) =>
    scheduleExam(prisma, superAdmin(), {
      mode: "physical",
      bare: {
        title: over.title,
        levelId,
        subjectId: over.subjectId ?? tafseerId,
        academicYearId,
      },
      target: { kind: "level" },
      date: day("2026-06-10"),
      branchId,
      roomId,
      startTime: at(9),
      endTime: at(11),
      ...(over.surahId === undefined ? {} : { surahId: over.surahId }),
    });

  it("must name its Surah, from the Level's «مقرر الحفظ»", async () => {
    expect(await reason(() => sitting({ title: `${TAG} بلا سورة` }))).toBe("SURAHS_REQUIRED");
    expect(await reason(() => sitting({ title: `${TAG} خارج المقرر`, surahId: NAS }))).toBe(
      "SURAH_NOT_IN_SYLLABUS",
    );
    expect(
      await reason(() => sitting({ title: `${TAG} فقه`, subjectId: fiqhId, surahId: FATIHA })),
    ).toBe("SURAHS_NOT_APPLICABLE");
  });

  it("any number of exams may examine the same Surah", async () => {
    const first = await sitting({ title: `${TAG} اختبار 1`, surahId: FATIHA });
    const second = await sitting({ title: `${TAG} اختبار 2`, surahId: FATIHA });
    const stored = await prisma.exam.findMany({
      where: { id: { in: [first.id, second.id] } },
      select: { surahId: true },
    });
    expect(stored.map((e) => e.surahId)).toEqual([FATIHA, FATIHA]);
  });

  it("its Surah is editable, and held to the same rule", async () => {
    const { id } = await sitting({ title: `${TAG} اختبار`, surahId: FATIHA });
    const version = (await prisma.exam.findUniqueOrThrow({ where: { id } })).version;
    await updatePhysicalExam(prisma, superAdmin(), id, { version, surahId: BAQARA });
    expect((await prisma.exam.findUniqueOrThrow({ where: { id } })).surahId).toBe(BAQARA);
    expect(
      await reason(() =>
        updatePhysicalExam(prisma, superAdmin(), id, { version: version + 1, surahId: null }),
      ),
    ).toBe("SURAHS_REQUIRED");
  });
});

describe("a filter-built class addressed by group alone", () => {
  it("still answers which Level — so its editor opens with its Subject, and its Surahs are offered", async () => {
    const group = await prisma.administrativeGroup.create({
      data: { name: `${TAG} المجموعة 1`, levelId, branchId, displayOrder: 0 },
    });
    // `multi_dimension` names `dimensions` and NO `targetId` (the two are
    // exclusive), so the single-target default is dropped rather than blanked.
    const { targetId: _singleTarget, ...filterBuilt } = classInput({
      teachingMode: "multi_dimension",
      dimensions: { administrativeGroupIds: [group.id] },
      // Held to the «مقرر الحفظ» of the GROUP's Level — it names no Level itself.
      surahIds: [FATIHA],
    });
    void _singleTarget;
    const { id } = await createCourseSchedule(prisma, superAdmin(), filterBuilt, NOW);
    const listed = await listCourseSchedules(prisma, superAdmin(), { subjectId: tafseerId });
    const row = listed.data.find((r) => r.id === id) as unknown as {
      representativeLevelId: string | null;
    };
    expect(row.representativeLevelId).toBe(levelId);
  });
});

describe("what the scheduling form is told", () => {
  it("which Subjects work by Surah, and each Level's «مقرر الحفظ» with names", async () => {
    const options = await readScopeOptions(prisma, superAdmin());
    expect(options.subjects.find((s) => s.id === tafseerId)?.requiresSurahs).toBe(true);
    expect(options.subjects.find((s) => s.id === fiqhId)?.requiresSurahs).toBe(false);
    expect(options.levels.find((l) => l.id === levelId)?.surahIds).toEqual([FATIHA, BAQARA]);
    expect(options.surahs.filter((s) => s.id === FATIHA || s.id === BAQARA)).toEqual([
      { id: FATIHA, name: "الفاتحة" },
      { id: BAQARA, name: "البقرة" },
    ]);
  });
});

describe("the Subject's own marker", () => {
  it("cannot be removed from the Subject that tracks memorisation — a coded refusal, not a 500", async () => {
    // Throws when the Production seed's one tracker is absent — so this can
    // never pass by having had nothing to ask.
    const { id: trackerId } = await requireMemorisationSubject(prisma);
    const tracker = await prisma.subject.findUniqueOrThrow({
      where: { id: trackerId },
      select: { id: true, version: true, requiresSurahs: true },
    });
    expect(tracker.requiresSurahs).toBe(true);
    expect(
      await reason(() =>
        updateSubject(prisma, superAdmin(), tracker.id, tracker.version, { requiresSurahs: false }),
      ),
    ).toBe("TRACKER_REQUIRES_SURAHS");
  });

  it("is an ordinary editable fact on any other Subject", async () => {
    const before = await prisma.subject.findUniqueOrThrow({ where: { id: fiqhId } });
    await updateSubject(prisma, superAdmin(), fiqhId, before.version, { requiresSurahs: true });
    expect(
      (await prisma.subject.findUniqueOrThrow({ where: { id: fiqhId } })).requiresSurahs,
    ).toBe(true);
  });
});
