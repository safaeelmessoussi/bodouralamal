import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import {
  audienceSize,
  audienceWhere,
  resolveAudience,
  staffsSession,
  studentsTaughtBy,
  teacherBranchIds,
  type AudienceSpec,
} from "./roster-resolution.js";

/** R66 — an enrolment carries its own branch, taken from the group so the
 *  composite FK `(administrative_group_id, branch_id)` holds. */
async function branchOf(groupId: string): Promise<string> {
  const g = await prisma.administrativeGroup.findUniqueOrThrow({
    where: { id: groupId },
    select: { branchId: true },
  });
  return g.branchId;
}

/**
 * Roster resolution — SRS §4.4c, the single definition every other rule cites.
 *
 * The fixture is deliberately the Document Owner's own example, because it is
 * the case the whole revision exists to make expressible and the one a reader
 * will check against:
 *
 *   Level 1  ── AdminGroup A (Amerchich) ── هدى · سارة
 *            └─ AdminGroup B (Targa)     ── ليلى
 *      Hifz   → TG Hifz-1 (هدى) · TG Hifz-2 (سارة)
 *      Tartil → TG Tartil-1 (هدى · سارة)
 *      Tafsir  → no teaching groups; taught to the entire Level
 *
 * هدى therefore sits in AdminGroup A, Hifz-1 **and** Tartil-1 at once, which
 * is the independence between Subjects that BR-22's per-(subject, level)
 * uniqueness delivers.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = "[roster-resolution-test]";

let categoryId: string;
let levelId: string;
let amerchichId: string;
let targaId: string;
let groupAId: string;
let groupBId: string;
let hifzId: string;
let tartilId: string;
let tafsirId: string;
let tgHifz1: string;
let tgHifz2: string;
let tgTartil1: string;
let academicYearId: string;

let huda: string;
let sara: string;
let layla: string;

const ids = (rows: { id: string }[]): string[] => rows.map((r) => r.id).sort();

async function person(label: string): Promise<string> {
  const u = await prisma.user.create({
    data: {
      // R80 — every person carries a recorded sex; the column is NOT NULL.
      sex: "female",
      nameArabic: `${TAG} ${label}`,
      accountStatus: "active",
    },
  });
  return u.id;
}

async function enrol(
  studentId: string,
  groupId: string,
  lvl: string,
): Promise<string> {
  const row = await prisma.enrollment.create({
    data: {
      studentId,
      administrativeGroupId: groupId,
      levelId: lvl,
      branchId: await branchOf(groupId),
    },
  });
  return row.id;
}

async function seat(
  studentId: string,
  teachingGroupId: string,
  subjectId: string,
): Promise<string> {
  const row = await prisma.studentTeachingGroup.create({
    data: { studentId, teachingGroupId, subjectId, levelId },
  });
  return row.id;
}

async function schedule(
  subjectId: string,
  spec: Partial<AudienceSpec> & {
    teachingMode: AudienceSpec["teachingMode"];
    branchId: string;
  },
): Promise<string> {
  const row = await prisma.recurringCourseSchedule.create({
    data: {
      title: `${TAG} حلقة`,
      subjectId,
      teachingMode: spec.teachingMode,
      levelId: spec.levelId ?? null,
      administrativeGroupId: spec.administrativeGroupId ?? null,
      teachingGroupId: spec.teachingGroupId ?? null,
      branchId: spec.branchId,
      startTime: new Date(Date.UTC(1970, 0, 1, 9, 0, 0)),
      endTime: new Date(Date.UTC(1970, 0, 1, 10, 0, 0)),
      recurrence: "weekly",
      weekdays: ["saturday"],
      academicYearId,
    },
  });
  return row.id;
}

const specOf = async (scheduleId: string): Promise<AudienceSpec> => {
  const s = await prisma.recurringCourseSchedule.findUniqueOrThrow({
    where: { id: scheduleId },
    select: {
      teachingMode: true,
      levelId: true,
      administrativeGroupId: true,
      teachingGroupId: true,
      branchId: true,
    },
  });
  return s;
};

beforeAll(async () => {
  const cat = await prisma.category.create({ data: { name: `${TAG} الكبار` } });
  categoryId = cat.id;
  levelId = (
    await prisma.level.create({
      data: { name: `${TAG} المستوى 1`, categoryId, genderRestriction: "any" },
    })
  ).id;

  amerchichId = (
    await prisma.branch.create({
      data: {
        name: `${TAG} أمرشيش`,
        operationalStartDate: new Date("2026-01-01"),
      },
    })
  ).id;
  targaId = (
    await prisma.branch.create({
      data: {
        name: `${TAG} تاركة`,
        operationalStartDate: new Date("2026-01-01"),
      },
    })
  ).id;

  groupAId = (
    await prisma.administrativeGroup.create({
      data: { name: `${TAG} المجموعة أ`, levelId, branchId: amerchichId },
    })
  ).id;
  groupBId = (
    await prisma.administrativeGroup.create({
      data: { name: `${TAG} المجموعة ب`, levelId, branchId: targaId },
    })
  ).id;

  hifzId = (await prisma.subject.create({ data: { name: `${TAG} حفظ القرآن` } }))
    .id;
  tartilId = (await prisma.subject.create({ data: { name: `${TAG} ترتيل وتجويد القرآن` } }))
    .id;
  tafsirId = (await prisma.subject.create({ data: { name: `${TAG} تفسير القرآن` } }))
    .id;

  tgHifz1 = (
    await prisma.teachingGroup.create({
      data: { name: `${TAG} حفظ القرآن 1`, subjectId: hifzId, levelId },
    })
  ).id;
  tgHifz2 = (
    await prisma.teachingGroup.create({
      data: { name: `${TAG} حفظ القرآن 2`, subjectId: hifzId, levelId },
    })
  ).id;
  tgTartil1 = (
    await prisma.teachingGroup.create({
      data: { name: `${TAG} ترتيل وتجويد القرآن 1`, subjectId: tartilId, levelId },
    })
  ).id;

  academicYearId = (
    await prisma.academicYear.findFirstOrThrow({ select: { id: true } })
  ).id;

  huda = await person("هدى");
  sara = await person("سارة");
  layla = await person("ليلى");

  await enrol(huda, groupAId, levelId);
  await enrol(sara, groupAId, levelId);
  await enrol(layla, groupBId, levelId);

  await seat(huda, tgHifz1, hifzId);
  await seat(sara, tgHifz2, hifzId);
  await seat(huda, tgTartil1, tartilId);
  await seat(sara, tgTartil1, tartilId);
});

afterAll(async () => {
  // Order matters: every FK is RESTRICT (TD-5), so children go first.
  await prisma.courseScheduleStaff.deleteMany({
    where: { schedule: { subject: { name: { startsWith: TAG } } } },
  });
  // R77 — `notification.session_id` is RESTRICT, like every other reference
  // to a Session: a cancellation notice whose session vanished is unreadable.
  // Fixtures therefore unwind notices before the occurrences they name.
  await prisma.notification.deleteMany({
    where: {
      session: { schedule: { subject: { name: { startsWith: TAG } } } },
    },
  });
  await prisma.session.deleteMany({
    where: { schedule: { subject: { name: { startsWith: TAG } } } },
  });
  await prisma.recurringCourseSchedule.deleteMany({
    where: { subject: { name: { startsWith: TAG } } },
  });
  await prisma.studentTeachingGroup.deleteMany({
    where: { student: { nameArabic: { startsWith: TAG } } },
  });
  await prisma.enrollment.deleteMany({
    where: { student: { nameArabic: { startsWith: TAG } } },
  });
  await prisma.teachingGroup.deleteMany({
    where: { name: { startsWith: TAG } },
  });
  await prisma.administrativeGroup.deleteMany({
    where: { name: { startsWith: TAG } },
  });
  await prisma.user.deleteMany({ where: { nameArabic: { startsWith: TAG } } });
  await prisma.subject.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.level.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.$disconnect();
});

describe("audienceWhere — the three teaching modes (§4.4c)", () => {
  it("administrative_group resolves to exactly that group", async () => {
    const spec = await specOf(
      await schedule(tafsirId, {
        teachingMode: "administrative_group",
        administrativeGroupId: groupAId,
        branchId: amerchichId,
      }),
    );
    expect(ids(await resolveAudience(prisma, spec))).toEqual(
      [huda, sara].sort(),
    );
  });

  it("teaching_group resolves to exactly that split, ignoring the administrative roster", async () => {
    const spec = await specOf(
      await schedule(hifzId, {
        teachingMode: "teaching_group",
        teachingGroupId: tgHifz2,
        branchId: amerchichId,
      }),
    );
    // سارة alone — even though she shares AdminGroup A with هدى.
    expect(ids(await resolveAudience(prisma, spec))).toEqual([sara]);
  });

  it("entire_level is BRANCH-BOUND — it never reaches the level’s students elsewhere", async () => {
    const atAmerchich = await specOf(
      await schedule(tafsirId, {
        teachingMode: "entire_level",
        levelId,
        branchId: amerchichId,
      }),
    );
    const atTarga = await specOf(
      await schedule(tafsirId, {
        teachingMode: "entire_level",
        levelId,
        branchId: targaId,
      }),
    );

    // ليلى is in the same Level but at Targa; a Level spans branches, a room
    // does not. Including her would put her on a roster for a class she cannot
    // attend — and, through BR-2, gate a recording on the consent of someone
    // who was never in the room.
    expect(ids(await resolveAudience(prisma, atAmerchich))).toEqual(
      [huda, sara].sort(),
    );
    expect(ids(await resolveAudience(prisma, atTarga))).toEqual([layla]);
  });

  it("counts agree with the resolved rows — the audit row and the roster cannot disagree", async () => {
    const spec = await specOf(
      await schedule(tafsirId, {
        teachingMode: "entire_level",
        levelId,
        branchId: amerchichId,
      }),
    );
    expect(await audienceSize(prisma, spec)).toBe(
      (await resolveAudience(prisma, spec)).length,
    );
  });
});

describe("independence between Subjects (BR-22)", () => {
  it("one student is in an administrative group AND two different subject splits at once", async () => {
    const admin = await specOf(
      await schedule(tafsirId, {
        teachingMode: "administrative_group",
        administrativeGroupId: groupAId,
        branchId: amerchichId,
      }),
    );
    const hifz1 = await specOf(
      await schedule(hifzId, {
        teachingMode: "teaching_group",
        teachingGroupId: tgHifz1,
        branchId: amerchichId,
      }),
    );
    const tartil1 = await specOf(
      await schedule(tartilId, {
        teachingMode: "teaching_group",
        teachingGroupId: tgTartil1,
        branchId: amerchichId,
      }),
    );

    expect(ids(await resolveAudience(prisma, admin))).toContain(huda);
    expect(ids(await resolveAudience(prisma, hifz1))).toEqual([huda]);
    expect(ids(await resolveAudience(prisma, tartil1))).toEqual(
      [huda, sara].sort(),
    );
  });

  it("the two subjects partition the SAME level differently — Hifz 2-way, Tartil 1-way", async () => {
    const q1 = await specOf(
      await schedule(hifzId, {
        teachingMode: "teaching_group",
        teachingGroupId: tgHifz1,
        branchId: amerchichId,
      }),
    );
    const q2 = await specOf(
      await schedule(hifzId, {
        teachingMode: "teaching_group",
        teachingGroupId: tgHifz2,
        branchId: amerchichId,
      }),
    );
    const t1 = await specOf(
      await schedule(tartilId, {
        teachingMode: "teaching_group",
        teachingGroupId: tgTartil1,
        branchId: amerchichId,
      }),
    );

    // Hifz splits هدى | سارة. Tartil keeps them together. Nothing aligns the
    // two, and nothing should try to (§4.4c).
    expect(ids(await resolveAudience(prisma, q1))).toEqual([huda]);
    expect(ids(await resolveAudience(prisma, q2))).toEqual([sara]);
    expect(ids(await resolveAudience(prisma, t1))).toEqual([huda, sara].sort());
  });

  it("a Subject with NO teaching groups is taught to the entire level", async () => {
    const tafsir = await specOf(
      await schedule(tafsirId, {
        teachingMode: "entire_level",
        levelId,
        branchId: amerchichId,
      }),
    );
    const split = await prisma.teachingGroup.count({
      where: { subjectId: tafsirId, deletedAt: null },
    });
    expect(split).toBe(0);
    expect(ids(await resolveAudience(prisma, tafsir))).toEqual(
      [huda, sara].sort(),
    );
  });
});

describe("the audience is live, never a snapshot (§20 rule 22)", () => {
  it("un-enrolling drops a student on the very next resolution", async () => {
    const spec = await specOf(
      await schedule(tafsirId, {
        teachingMode: "administrative_group",
        administrativeGroupId: groupBId,
        branchId: targaId,
      }),
    );
    expect(ids(await resolveAudience(prisma, spec))).toEqual([layla]);

    const row = await prisma.enrollment.findFirstOrThrow({
      where: {
        studentId: layla,
        administrativeGroupId: groupBId,
        deletedAt: null,
      },
    });
    await prisma.enrollment.update({
      where: { id: row.id },
      data: { deletedAt: new Date() },
    });
    expect(await resolveAudience(prisma, spec)).toEqual([]);

    await prisma.enrollment.update({
      where: { id: row.id },
      data: { deletedAt: null },
    });
    expect(ids(await resolveAudience(prisma, spec))).toEqual([layla]);
  });

  it("a soft-deleted teaching group empties its audience without touching seats", async () => {
    const spec = await specOf(
      await schedule(hifzId, {
        teachingMode: "teaching_group",
        teachingGroupId: tgHifz2,
        branchId: amerchichId,
      }),
    );
    await prisma.teachingGroup.update({
      where: { id: tgHifz2 },
      data: { deletedAt: new Date() },
    });
    expect(await resolveAudience(prisma, spec)).toEqual([]);
    await prisma.teachingGroup.update({
      where: { id: tgHifz2 },
      data: { deletedAt: null },
    });
    expect(ids(await resolveAudience(prisma, spec))).toEqual([sara]);
  });

  it("a mode/target disagreement throws rather than resolving a wrong roster", () => {
    // The database refuses this row, so reaching it means the schema was
    // bypassed. Resolving *something* would be worse than failing loudly.
    expect(() =>
      audienceWhere({
        teachingMode: "teaching_group",
        levelId: null,
        administrativeGroupId: null,
        teachingGroupId: null,
        branchId: amerchichId,
      }),
    ).toThrow(/course_schedule_mode_target_check/);
  });
});

describe("teacher scope resolves through CourseScheduleStaff (§4.4c, TD-2)", () => {
  it("a teacher reaches exactly the students of the schedules they staff", async () => {
    const zaynab = await person("الأستاذة زينب");
    const s = await schedule(hifzId, {
      teachingMode: "teaching_group",
      teachingGroupId: tgHifz1,
      branchId: amerchichId,
    });
    await prisma.courseScheduleStaff.create({
      data: { scheduleId: s, userId: zaynab, position: "teacher" },
    });

    const where = await studentsTaughtBy(prisma, zaynab);
    const reached = ids(
      await prisma.user.findMany({ where, select: { id: true } }),
    );

    // هدى only: سارة is in the same Level and the same administrative group,
    // but in a different Hifz split, and this teacher staffs only that split.
    expect(reached).toEqual([huda]);
    expect(reached).not.toContain(sara);
  });

  it("an ASSISTANT has the same reach as the teacher — one table, one rule", async () => {
    const helper = await person("المساعدة");
    const s = await schedule(tartilId, {
      teachingMode: "teaching_group",
      teachingGroupId: tgTartil1,
      branchId: amerchichId,
    });
    await prisma.courseScheduleStaff.create({
      data: { scheduleId: s, userId: helper, position: "assistant" },
    });

    const where = await studentsTaughtBy(prisma, helper);
    expect(
      ids(await prisma.user.findMany({ where, select: { id: true } })),
    ).toEqual([huda, sara].sort());
  });

  it("an entire-level schedule gives its teacher the level AT THAT BRANCH only", async () => {
    const t = await person("أستاذة التفسير");
    const s = await schedule(tafsirId, {
      teachingMode: "entire_level",
      levelId,
      branchId: amerchichId,
    });
    await prisma.courseScheduleStaff.create({
      data: { scheduleId: s, userId: t, position: "teacher" },
    });

    const where = await studentsTaughtBy(prisma, t);
    const reached = ids(
      await prisma.user.findMany({ where, select: { id: true } }),
    );
    expect(reached).toEqual([huda, sara].sort());
    // ليلى is in the same Level, at Targa. The branch bound is what keeps her
    // out of a Marrakesh teacher's reach.
    expect(reached).not.toContain(layla);
  });

  it("a teacher with no schedules reaches nobody — the role alone grants nothing", async () => {
    const idle = await person("أستاذة بلا حصص");
    const where = await studentsTaughtBy(prisma, idle);
    expect(await prisma.user.findMany({ where, select: { id: true } })).toEqual(
      [],
    );
  });

  it("revoking the staffing ends the reach on the NEXT call", async () => {
    const t = await person("أستاذة مؤقتة");
    const s = await schedule(hifzId, {
      teachingMode: "teaching_group",
      teachingGroupId: tgHifz1,
      branchId: amerchichId,
    });
    const staff = await prisma.courseScheduleStaff.create({
      data: { scheduleId: s, userId: t, position: "teacher" },
    });
    expect(
      await prisma.user.count({ where: await studentsTaughtBy(prisma, t) }),
    ).toBe(1);

    await prisma.courseScheduleStaff.update({
      where: { id: staff.id },
      data: { deletedAt: new Date() },
    });
    expect(
      await prisma.user.count({ where: await studentsTaughtBy(prisma, t) }),
    ).toBe(0);
  });

  it("branch scope is STATED by the schedule, not inferred through two hops", async () => {
    const t = await person("أستاذة الفرعين");
    const s1 = await schedule(tafsirId, {
      teachingMode: "entire_level",
      levelId,
      branchId: amerchichId,
    });
    const s2 = await schedule(tafsirId, {
      teachingMode: "administrative_group",
      administrativeGroupId: groupBId,
      branchId: targaId,
    });
    await prisma.courseScheduleStaff.createMany({
      data: [
        { scheduleId: s1, userId: t, position: "teacher" },
        { scheduleId: s2, userId: t, position: "teacher" },
      ],
    });
    expect((await teacherBranchIds(prisma, t)).sort()).toEqual(
      [amerchichId, targaId].sort(),
    );
  });

  it("staffsSession is true for a co-teacher and false for a stranger", async () => {
    const owner = await person("صاحبة الحصة");
    const stranger = await person("غريبة");
    const s = await schedule(tafsirId, {
      teachingMode: "administrative_group",
      administrativeGroupId: groupAId,
      branchId: amerchichId,
    });
    await prisma.courseScheduleStaff.create({
      data: { scheduleId: s, userId: owner, position: "teacher" },
    });
    const session = await prisma.session.create({
      data: {
        scheduleId: s,
        date: new Date("2026-09-12"),
        startTime: new Date(Date.UTC(1970, 0, 1, 9, 0, 0)),
        endTime: new Date(Date.UTC(1970, 0, 1, 10, 0, 0)),
      },
    });

    expect(await staffsSession(prisma, owner, session.id)).toBe(true);
    expect(await staffsSession(prisma, stranger, session.id)).toBe(false);
  });
});
