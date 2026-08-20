import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import type { Actor } from "../policies/actor.js";
import type { RoleScope } from "../policies/branch-scope.js";
import {
  listQuranStudents,
  logProgress,
  readOwnCoverage,
} from "./quran.service.js";

/**
 * **Section C — إدخال الحفظ: whose memorisation, in which curriculum, on which
 * day** (2026-08-20).
 *
 * `quran.integration.test.ts` covers the engine and R73's subject narrowing.
 * This file covers the three dimensions Section C added or corrected, each of
 * which had a way of being *structurally* right and operationally wrong:
 *
 * * **scope** — whole-Level, Administrative Group, Teaching Circle, and the
 *   refusals around them, driven through the same predicate the write asserts;
 * * **time and audience** — R91's effective staffing and R92's combined
 *   occurrence, including the property that a combined occurrence must NOT
 *   permanently widen a roster;
 * * **curriculum and category** — `LevelSurah` as the authority for entry, and
 *   مراجعة never inflating memorisation.
 */

const TAG = "[qentry]";
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);

const AL_FATIHA = 1;
const AL_BAQARA = 2;

let adminId: string;
let branchA: string;
let branchB: string;
let levelOne: string;
let levelTwo: string;
let groupA: string;
let circle: string;
let quranSubject: string;
let tafseerSubject: string;
let yearId: string;

const actorOf = (userId: string, scopes: RoleScope[]): Actor => ({
  userId,
  roles: scopes.map((s) => s.role),
  roleScopes: scopes,
});
const superAdmin = (): Actor =>
  actorOf(adminId, [{ role: "super_admin", branches: null }]);
const branchAdmin = (id: string, branches: string[]): Actor =>
  actorOf(id, [{ role: "admin", branches }]);
const teacher = (id: string): Actor =>
  actorOf(id, [{ role: "teacher", branches: null }]);

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
  return (
    await prisma.user.create({
      data: {
        sex: "female",
        nameArabic: `${TAG} ${label}`,
        accountStatus: "active",
        // R79 — the durable marker that says somebody is a مستفيدة. The Quran
        // selector reads it, so a fixture beneficiary must carry it.
        isBeneficiary: label.includes("مستفيدة"),
      },
    })
  ).id;
}

async function enrol(
  studentId: string,
  levelId: string,
  branchId: string,
  administrativeGroupId: string | null = null,
): Promise<void> {
  await prisma.enrollment.create({
    data: {
      studentId,
      levelId,
      branchId,
      ...(administrativeGroupId ? { administrativeGroupId } : {}),
    },
  });
}

/** A schedule in one of §4.4c's three modes, staffed by `who` from `from`. */
async function schedule(opts: {
  subjectId: string;
  mode: "entire_level" | "administrative_group" | "teaching_group";
  levelId?: string;
  groupId?: string;
  circleId?: string;
  branchId: string;
  who?: string;
  position?: "teacher" | "assistant";
  from?: Date | null;
  until?: Date | null;
}): Promise<string> {
  const row = await prisma.recurringCourseSchedule.create({
    data: {
      title: `${TAG} حصة`,
      subjectId: opts.subjectId,
      teachingMode: opts.mode,
      ...(opts.mode === "entire_level" ? { levelId: opts.levelId! } : {}),
      ...(opts.mode === "administrative_group"
        ? { administrativeGroupId: opts.groupId! }
        : {}),
      ...(opts.mode === "teaching_group"
        ? { teachingGroupId: opts.circleId! }
        : {}),
      branchId: opts.branchId,
      startTime: new Date("1970-01-01T09:00:00Z"),
      endTime: new Date("1970-01-01T10:00:00Z"),
      recurrence: "weekly",
      weekdays: ["monday"],
      academicYearId: yearId,
    },
  });
  if (opts.who) {
    await prisma.courseScheduleStaff.create({
      data: {
        scheduleId: row.id,
        userId: opts.who,
        position: opts.position ?? "teacher",
        ...(opts.from !== undefined ? { effectiveFrom: opts.from } : {}),
        ...(opts.until !== undefined ? { effectiveUntil: opts.until } : {}),
      },
    });
  }
  return row.id;
}

/**
 * One occurrence of a schedule on a given day.
 *
 * **A Session carries no branch** — the venue comes from its schedule, which is
 * exactly why R92 needed `SessionAudienceBranch` rather than overloading a
 * column here: *where it happens* and *who is expected* are different facts.
 */
async function occurrence(scheduleId: string, date: Date): Promise<string> {
  const row = await prisma.session.create({
    data: {
      scheduleId,
      date,
      startTime: new Date("1970-01-01T09:00:00Z"),
      endTime: new Date("1970-01-01T10:00:00Z"),
      status: "scheduled",
    },
  });
  return row.id;
}

const today = (): Date => {
  const d = new Date();
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
};
const daysFromToday = (n: number): Date => {
  const d = today();
  return new Date(d.getTime() + n * 86_400_000);
};

const entry = (
  studentId: string,
  levelId: string,
  surahId: number,
  start: number,
  end: number,
  category: "new_memorization" | "revision" = "new_memorization",
) => ({ studentId, levelId, surahId, startAyah: start, endAyah: end, category });

async function clear(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  const schedules = await prisma.recurringCourseSchedule.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true },
  });
  const sids = schedules.map((s) => s.id);
  const sessions = await prisma.session.findMany({
    where: { scheduleId: { in: sids } },
    select: { id: true },
  });
  const sessionIds = sessions.map((s) => s.id);

  if (sessionIds.length > 0) {
    await prisma.sessionAudienceBranch.deleteMany({
      where: { sessionId: { in: sessionIds } },
    });
    await prisma.sessionStaff.deleteMany({
      where: { sessionId: { in: sessionIds } },
    });
    await prisma.session.deleteMany({ where: { id: { in: sessionIds } } });
  }
  if (ids.length > 0) {
    await prisma.quranProgressLog.deleteMany({
      where: { OR: [{ studentId: { in: ids } }, { loggedById: { in: ids } }] },
    });
    await prisma.studentSurahProgress.deleteMany({
      where: { studentId: { in: ids } },
    });
    await prisma.studentTeachingGroup.deleteMany({
      where: { studentId: { in: ids } },
    });
    await prisma.enrollment.deleteMany({ where: { studentId: { in: ids } } });
    // R88 planning data — RESTRICT on `user`, so it must go before the person.
    await prisma.teacherSubjectCapability.deleteMany({
      where: { userId: { in: ids } },
    });
    await prisma.teacherCategoryCapability.deleteMany({
      where: { userId: { in: ids } },
    });
    await prisma.teacherAvailability.deleteMany({
      where: { userId: { in: ids } },
    });
  }
  if (sids.length > 0) {
    await prisma.courseScheduleStaff.deleteMany({
      where: { scheduleId: { in: sids } },
    });
    await prisma.recurringCourseSchedule.deleteMany({
      where: { id: { in: sids } },
    });
  }
  if (ids.length > 0) {
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
    await prisma.trash.deleteMany({ where: { deletedById: { in: ids } } });
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
  await prisma.levelSurah.deleteMany({ where: { levelId: { in: lids } } });
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
  const mkLevel = async (n: string): Promise<string> =>
    (
      await prisma.level.create({
        data: { name: `${TAG} ${n}`, categoryId: cat.id, genderRestriction: "any" },
      })
    ).id;
  levelOne = await mkLevel("مستوى ١");
  levelTwo = await mkLevel("مستوى ٢");

  const mkBranch = async (n: string): Promise<string> =>
    (
      await prisma.branch.create({
        data: { name: `${TAG} ${n}`, operationalStartDate: new Date("2020-01-01") },
      })
    ).id;
  branchA = await mkBranch("فرع أ");
  branchB = await mkBranch("فرع ب");

  groupA = (
    await prisma.administrativeGroup.create({
      data: { name: `${TAG} مجموعة`, levelId: levelOne, branchId: branchA },
    })
  ).id;

  // R73.4 — the marker, never the name.
  quranSubject = (
    await prisma.subject.create({
      data: { name: `${TAG} قرآن`, tracksQuranProgress: true },
    })
  ).id;
  tafseerSubject = (
    await prisma.subject.create({ data: { name: `${TAG} تفسير` } })
  ).id;

  circle = (
    await prisma.teachingGroup.create({
      data: {
        // A Circle is per (Level, Subject) and carries NO branch — the branch
        // lives on the schedule that delivers it (R43.3).
        name: `${TAG} حلقة`,
        levelId: levelOne,
        subjectId: quranSubject,
      },
    })
  ).id;

  // Both Levels teach الفاتحة; only Level 1 teaches البقرة. That asymmetry is
  // what makes the curriculum refusals meaningful rather than incidental.
  await prisma.levelSurah.createMany({
    data: [
      { levelId: levelOne, surahId: AL_FATIHA },
      { levelId: levelOne, surahId: AL_BAQARA },
      { levelId: levelTwo, surahId: AL_FATIHA },
    ],
  });
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe("§C7 — the roster is the ACTUAL Quran teaching scope", () => {
  it("whole-Level reaches that Level at that BRANCH, and no further", async () => {
    const her = await person("مستفيدة أ");
    const other = await person("مستفيدة ب");
    await enrol(her, levelOne, branchA);
    await enrol(other, levelOne, branchB);

    const she = await person("مؤطرة");
    await schedule({
      subjectId: quranSubject,
      mode: "entire_level",
      levelId: levelOne,
      branchId: branchA,
      who: she,
    });

    const scope = await listQuranStudents(prisma, teacher(she));
    expect(scope.students.map((s) => s.id)).toEqual([her]);

    // And the refusal is the same predicate, asserted rather than assumed.
    const denied = await failure(() =>
      logProgress(prisma, teacher(she), entry(other, levelOne, AL_FATIHA, 1, 3)),
    );
    // §20 rule 17 — out of scope is NOT_FOUND, never FORBIDDEN.
    expect(denied.code).toBe("NOT_FOUND");
  });

  it("an Administrative Group reaches its members only", async () => {
    const inGroup = await person("مستفيدة أ");
    const ungrouped = await person("مستفيدة ب");
    await enrol(inGroup, levelOne, branchA, groupA);
    await enrol(ungrouped, levelOne, branchA);

    const she = await person("مؤطرة");
    await schedule({
      subjectId: quranSubject,
      mode: "administrative_group",
      groupId: groupA,
      branchId: branchA,
      who: she,
    });

    const scope = await listQuranStudents(prisma, teacher(she));
    expect(scope.students.map((s) => s.id)).toEqual([inGroup]);
  });

  it("a Teaching Circle reaches its seated members only", async () => {
    const seated = await person("مستفيدة أ");
    const unseated = await person("مستفيدة ب");
    await enrol(seated, levelOne, branchA);
    await enrol(unseated, levelOne, branchA);
    await prisma.studentTeachingGroup.create({
      data: {
        studentId: seated,
        teachingGroupId: circle,
        // The seat is per (subject, level) — R43.3's shape, so one student sits
        // in Quran Circle 2 and Tajweed Circle 1 at once.
        subjectId: quranSubject,
        levelId: levelOne,
      },
    });

    const she = await person("مؤطرة");
    await schedule({
      subjectId: quranSubject,
      mode: "teaching_group",
      circleId: circle,
      branchId: branchA,
      who: she,
    });

    const scope = await listQuranStudents(prisma, teacher(she));
    expect(scope.students.map((s) => s.id)).toEqual([seated]);
  });

  it("an assistant has the SAME reach as the main مؤطرة (§C6)", async () => {
    const her = await person("مستفيدة");
    await enrol(her, levelOne, branchA);
    const lead = await person("مؤطرة أولى");
    const helper = await person("مؤطرة مساعدة");
    const id = await schedule({
      subjectId: quranSubject,
      mode: "entire_level",
      levelId: levelOne,
      branchId: branchA,
      who: lead,
    });
    await prisma.courseScheduleStaff.create({
      data: { scheduleId: id, userId: helper, position: "assistant" },
    });

    // `position` is responsibility and audit, never a weaker permission branch.
    for (const who of [lead, helper]) {
      const scope = await listQuranStudents(prisma, teacher(who));
      expect(scope.students.map((s) => s.id)).toEqual([her]);
      const saved = await logProgress(
        prisma,
        teacher(who),
        entry(her, levelOne, AL_FATIHA, 1, 3),
      );
      expect(saved.merged_ayah_count).toBe(3);
    }
  });

  it("teaching an unrelated Subject grants NOTHING (R73.3)", async () => {
    const her = await person("مستفيدة");
    await enrol(her, levelOne, branchA);
    const she = await person("مؤطرة التفسير");
    await schedule({
      subjectId: tafseerSubject,
      mode: "entire_level",
      levelId: levelOne,
      branchId: branchA,
      who: she,
    });

    expect((await listQuranStudents(prisma, teacher(she))).students).toEqual([]);
    expect(
      (
        await failure(() =>
          logProgress(prisma, teacher(she), entry(her, levelOne, AL_FATIHA, 1, 3)),
        )
      ).code,
    ).toBe("NOT_FOUND");
  });

  it("an R88 DECLARED capability grants nothing without an assignment", async () => {
    const her = await person("مستفيدة");
    await enrol(her, levelOne, branchA);
    const she = await person("مؤطرة");
    // She says she can teach Quran. Planning data — it authorises nothing.
    await prisma.teacherSubjectCapability.create({
      data: { userId: she, subjectId: quranSubject },
    });

    expect((await listQuranStudents(prisma, teacher(she))).students).toEqual([]);
    expect(
      (
        await failure(() =>
          logProgress(prisma, teacher(she), entry(her, levelOne, AL_FATIHA, 1, 3)),
        )
      ).code,
    ).toBe("NOT_FOUND");
  });
});

describe("§C8 — R91: authority is dated, and the date is the occurrence's", () => {
  it("the effective مؤطرة may act and the finished one may not", async () => {
    const her = await person("مستفيدة");
    await enrol(her, levelOne, branchA);
    const safa = await person("مؤطرة سابقة");
    const amina = await person("مؤطرة حالية");

    const id = await schedule({
      subjectId: quranSubject,
      mode: "entire_level",
      levelId: levelOne,
      branchId: branchA,
      who: safa,
      from: null,
      // Ended yesterday — inclusive bounds (TD-11).
      until: daysFromToday(-1),
    });
    await prisma.courseScheduleStaff.create({
      data: {
        scheduleId: id,
        userId: amina,
        position: "teacher",
        effectiveFrom: today(),
      },
    });

    expect(
      (await listQuranStudents(prisma, teacher(amina))).students.map((s) => s.id),
    ).toEqual([her]);
    // **Having taught the class before is not authority now.**
    expect((await listQuranStudents(prisma, teacher(safa))).students).toEqual([]);
    expect(
      (
        await failure(() =>
          logProgress(prisma, teacher(safa), entry(her, levelOne, AL_FATIHA, 1, 3)),
        )
      ).code,
    ).toBe("NOT_FOUND");
  });

  it("a FUTURE assignment grants nothing today", async () => {
    const her = await person("مستفيدة");
    await enrol(her, levelOne, branchA);
    const later = await person("مؤطرة لاحقة");
    await schedule({
      subjectId: quranSubject,
      mode: "entire_level",
      levelId: levelOne,
      branchId: branchA,
      who: later,
      from: daysFromToday(30),
    });

    expect((await listQuranStudents(prisma, teacher(later))).students).toEqual([]);
  });

  it("a one-off SessionStaff cover reaches that occurrence's students today", async () => {
    const her = await person("مستفيدة");
    await enrol(her, levelOne, branchA);
    const regular = await person("مؤطرة أصلية");
    const cover = await person("مؤطرة بديلة");

    const id = await schedule({
      subjectId: quranSubject,
      mode: "entire_level",
      levelId: levelOne,
      branchId: branchA,
      who: regular,
    });
    const sessionId = await occurrence(id, today());
    await prisma.sessionStaff.create({
      data: { sessionId, userId: cover, position: "teacher" },
    });

    // She staffs no schedule at all — only this lesson, on this day.
    expect(
      (await listQuranStudents(prisma, teacher(cover))).students.map((s) => s.id),
    ).toEqual([her]);
    const saved = await logProgress(
      prisma,
      teacher(cover),
      entry(her, levelOne, AL_FATIHA, 1, 4),
    );
    expect(saved.merged_ayah_count).toBe(4);
  });

  it("a cover on ANOTHER day reaches nobody today", async () => {
    const her = await person("مستفيدة");
    await enrol(her, levelOne, branchA);
    const cover = await person("مؤطرة بديلة");
    const id = await schedule({
      subjectId: quranSubject,
      mode: "entire_level",
      levelId: levelOne,
      branchId: branchA,
    });
    const sessionId = await occurrence(id, daysFromToday(7));
    await prisma.sessionStaff.create({
      data: { sessionId, userId: cover, position: "teacher" },
    });

    expect((await listQuranStudents(prisma, teacher(cover))).students).toEqual([]);
  });
});

describe("§C9 — R92: a combined occurrence, and only for that occurrence", () => {
  it("reaches the visiting branch today and NOT on an ordinary occurrence", async () => {
    const home = await person("مستفيدة أ");
    const visitor = await person("مستفيدة ب");
    await enrol(home, levelOne, branchA);
    await enrol(visitor, levelOne, branchB);

    const she = await person("مؤطرة");
    const id = await schedule({
      subjectId: quranSubject,
      mode: "entire_level",
      levelId: levelOne,
      branchId: branchA,
      who: she,
    });

    // Today's lesson is delivered once for both branches; the venue does not
    // move, and no Enrollment is touched.
    const combined = await occurrence(id, today());
    await prisma.sessionAudienceBranch.createMany({
      data: [
        { sessionId: combined, branchId: branchA },
        { sessionId: combined, branchId: branchB },
      ],
    });
    // And an ordinary one next week, with no override.
    await occurrence(id, daysFromToday(7));

    const scope = await listQuranStudents(prisma, teacher(she));
    expect(scope.students.map((s) => s.id).sort()).toEqual([home, visitor].sort());

    const saved = await logProgress(
      prisma,
      teacher(she),
      entry(visitor, levelOne, AL_FATIHA, 1, 5),
    );
    expect(saved.merged_ayah_count).toBe(5);

    // **The combined audience is a fact about ONE occurrence.** Nothing about
    // the visitor's enrolment changed, and nothing about the schedule did.
    expect(
      await prisma.enrollment.count({
        where: { studentId: visitor, branchId: branchA, deletedAt: null },
      }),
    ).toBe(0);
    expect(
      await prisma.sessionAudienceBranch.count({
        where: { sessionId: combined },
      }),
    ).toBe(2);
  });

  it("does NOT widen the roster once the combined occurrence has passed", async () => {
    const home = await person("مستفيدة أ");
    const visitor = await person("مستفيدة ب");
    await enrol(home, levelOne, branchA);
    await enrol(visitor, levelOne, branchB);

    const she = await person("مؤطرة");
    const id = await schedule({
      subjectId: quranSubject,
      mode: "entire_level",
      levelId: levelOne,
      branchId: branchA,
      who: she,
    });
    // The combination was LAST week; today is ordinary.
    const past = await occurrence(id, daysFromToday(-7));
    await prisma.sessionAudienceBranch.createMany({
      data: [
        { sessionId: past, branchId: branchA },
        { sessionId: past, branchId: branchB },
      ],
    });
    await occurrence(id, today());

    const scope = await listQuranStudents(prisma, teacher(she));
    expect(scope.students.map((s) => s.id)).toEqual([home]);
    expect(
      (
        await failure(() =>
          logProgress(
            prisma,
            teacher(she),
            entry(visitor, levelOne, AL_FATIHA, 1, 3),
          ),
        )
      ).code,
    ).toBe("NOT_FOUND");
  });
});

describe("§C25 — the administration reaches beneficiaries, not users", () => {
  it("a Super Admin reaches every enrolled beneficiary and no staff account", async () => {
    const her = await person("مستفيدة");
    await enrol(her, levelOne, branchA);
    // A مؤطرة and an administrator both exist and are NOT candidates.
    const she = await person("مؤطرة");

    const scope = await listQuranStudents(prisma, superAdmin());
    const ids = scope.students.map((s) => s.id);
    // **Scoped to this fixture, deliberately.** A Super Admin is unscoped, so
    // the seeded database legitimately appears too; asserting an exact list
    // would pin the seed rather than the rule. The rule is: the beneficiary is
    // in, and the staff accounts — who are Users but not مستفيدات — are not.
    expect(ids).toContain(her);
    expect(ids).not.toContain(she);
    expect(ids).not.toContain(adminId);

    const saved = await logProgress(
      prisma,
      superAdmin(),
      entry(her, levelOne, AL_FATIHA, 1, 7),
    );
    expect(saved.coverage_percent).toBe(100);
  });

  it("an Admin reaches their own branches only, and the difference is preserved", async () => {
    const mine = await person("مستفيدة أ");
    const theirs = await person("مستفيدة ب");
    await enrol(mine, levelOne, branchA);
    await enrol(theirs, levelOne, branchB);
    const admin = await person("مسؤولة الفرع");

    const scope = await listQuranStudents(prisma, branchAdmin(admin, [branchA]));
    expect(scope.students.map((s) => s.id)).toEqual([mine]);

    expect(
      (
        await failure(() =>
          logProgress(
            prisma,
            branchAdmin(admin, [branchA]),
            entry(theirs, levelOne, AL_FATIHA, 1, 3),
          ),
        )
      ).code,
    ).toBe("NOT_FOUND");
  });
});

describe("§C10/§C11 — the curriculum is the authority for entry", () => {
  it("offers EVERY relevant Level for a beneficiary enrolled in two", async () => {
    const her = await person("مستفيدة");
    await enrol(her, levelOne, branchA);
    await enrol(her, levelTwo, branchA);

    const scope = await listQuranStudents(prisma, superAdmin());
    const row = scope.students.find((s) => s.id === her)!;
    // Never `enrollments[0]` — both, so the form can ask which.
    expect(row.level_ids.sort()).toEqual([levelOne, levelTwo].sort());
    // Both are carried with their syllabuses (the unscoped seed's Levels come
    // too, which is correct for a Super Admin — see the §C25 case).
    const offered = scope.levels.map((l) => l.level_id);
    expect(offered).toContain(levelOne);
    expect(offered).toContain(levelTwo);

    // Level 2 teaches الفاتحة only; Level 1 teaches البقرة too.
    const two = scope.levels.find((l) => l.level_id === levelTwo)!;
    expect(two.surahs.map((s) => s.surah_id)).toEqual([AL_FATIHA]);
  });

  it("refuses a Surah outside the named Level's syllabus", async () => {
    const her = await person("مستفيدة");
    await enrol(her, levelTwo, branchA);

    const denied = await failure(() =>
      logProgress(prisma, superAdmin(), entry(her, levelTwo, AL_BAQARA, 1, 3)),
    );
    expect(denied.code).toBe("VALIDATION_FAILED");
    expect(denied.details?.["reason"]).toBe("SURAH_NOT_IN_LEVEL");
  });

  it("refuses a forged Level the beneficiary is not enrolled in", async () => {
    const her = await person("مستفيدة");
    await enrol(her, levelTwo, branchA);

    const denied = await failure(() =>
      logProgress(prisma, superAdmin(), entry(her, levelOne, AL_FATIHA, 1, 3)),
    );
    expect(denied.code).toBe("NOT_FOUND");
    expect(denied.details?.["reason"]).toBe("LEVEL_NOT_ENROLLED");
  });

  it("refuses a missing level rather than silently dropping the filter", async () => {
    const her = await person("مستفيدة");
    await enrol(her, levelOne, branchA);
    const denied = await failure(() =>
      logProgress(prisma, superAdmin(), {
        ...entry(her, levelOne, AL_FATIHA, 1, 3),
        // A caller that bypassed the compiler. `{ levelId: undefined }` in a
        // Prisma `where` means NO FILTER — this suite proved it by passing.
        levelId: undefined as unknown as string,
      }),
    );
    expect(denied.details?.["reason"]).toBe("LEVEL_REQUIRED");
  });
});

describe("§C12 — ayah bounds are refused, never clamped", () => {
  it("accepts the exact boundary and refuses one past it", async () => {
    const her = await person("مستفيدة");
    await enrol(her, levelOne, branchA);

    // الفاتحة has exactly 7.
    const ok = await logProgress(
      prisma,
      superAdmin(),
      entry(her, levelOne, AL_FATIHA, 1, 7),
    );
    expect(ok.coverage_percent).toBe(100);

    const past = await failure(() =>
      logProgress(prisma, superAdmin(), entry(her, levelOne, AL_FATIHA, 1, 8)),
    );
    expect(past.details?.["reason"]).toBe("AYAH_OUT_OF_RANGE");
    // Refused, not clamped: the stored coverage is still the 1–7 union.
    const after = await readOwnCoverage(prisma, her);
    expect(after.logs).toHaveLength(1);
  });

  it("refuses a reversed range", async () => {
    const her = await person("مستفيدة");
    await enrol(her, levelOne, branchA);
    const denied = await failure(() =>
      logProgress(prisma, superAdmin(), entry(her, levelOne, AL_FATIHA, 5, 2)),
    );
    expect(denied.code).toBeDefined();
    expect((await readOwnCoverage(prisma, her)).logs).toHaveLength(0);
  });
});

describe("§C14 — مراجعة is history, never memorisation", () => {
  it("does not raise the percentage for a range already memorised", async () => {
    const her = await person("مستفيدة");
    await enrol(her, levelOne, branchA);

    const memorised = await logProgress(
      prisma,
      superAdmin(),
      entry(her, levelOne, AL_FATIHA, 1, 4),
    );
    expect(memorised.merged_ayah_count).toBe(4);

    const revised = await logProgress(
      prisma,
      superAdmin(),
      entry(her, levelOne, AL_FATIHA, 1, 4, "revision"),
    );
    expect(revised.merged_ayah_count).toBe(4);
    expect(revised.coverage_percent).toBe(memorised.coverage_percent);
    // It IS recorded — the history is the point of the category.
    expect(revised.revision_log_count).toBe(1);
    expect(revised.last_revised_at).not.toBeNull();
  });

  it("creates NO memorisation for a range only ever revised", async () => {
    const her = await person("مستفيدة");
    await enrol(her, levelOne, branchA);

    const only = await logProgress(
      prisma,
      superAdmin(),
      entry(her, levelOne, AL_FATIHA, 1, 4, "revision"),
    );
    // The defect §C14 names: 4 ayahs of memorisation conjured out of a revision.
    expect(only.merged_ayah_count).toBe(0);
    expect(only.coverage_percent).toBe(0);
    expect(only.revision_log_count).toBe(1);

    // And the log is preserved and readable — nothing was discarded.
    const read = await readOwnCoverage(prisma, her);
    expect(read.logs).toHaveLength(1);
    expect(read.logs[0]!.category).toBe("revision");
  });

  it("keeps BR-11 completion honest — revision alone never completes a Level", async () => {
    const her = await person("مستفيدة");
    await enrol(her, levelTwo, branchA);
    await logProgress(
      prisma,
      superAdmin(),
      entry(her, levelTwo, AL_FATIHA, 1, 7, "revision"),
    );
    const read = await readOwnCoverage(prisma, her);
    const fatiha = read.levels
      .find((l) => l.level_id === levelTwo)!
      .surahs.find((s) => s.surah_id === AL_FATIHA)!;
    expect(fatiha.coverage_percent).toBe(0);
  });
});

describe("§C15/§C17 — حفظي shows the syllabus, grouped by Level", () => {
  it("lists every configured Surah including the untouched ones", async () => {
    const her = await person("مستفيدة");
    await enrol(her, levelOne, branchA);
    await logProgress(prisma, superAdmin(), entry(her, levelOne, AL_FATIHA, 1, 7));

    const read = await readOwnCoverage(prisma, her);
    expect(read.levels).toHaveLength(1);
    const level = read.levels[0]!;
    // Both configured Surahs, in mushaf order — البقرة at zero rather than absent.
    expect(level.surahs.map((s) => s.surah_id)).toEqual([AL_FATIHA, AL_BAQARA]);
    expect(level.surahs[0]!.coverage_percent).toBe(100);
    expect(level.surahs[1]!.coverage_percent).toBe(0);
    expect(level.category_name).toContain(TAG);
  });

  it("groups two Levels separately and never merges the curricula", async () => {
    const her = await person("مستفيدة");
    await enrol(her, levelOne, branchA);
    await enrol(her, levelTwo, branchA);
    await logProgress(prisma, superAdmin(), entry(her, levelOne, AL_FATIHA, 1, 7));

    const read = await readOwnCoverage(prisma, her);
    expect(read.levels).toHaveLength(2);
    // الفاتحة belongs to both syllabuses and shows the SAME figure under each —
    // memorisation is a fact about (student, surah) and does not fork per Level.
    for (const level of read.levels) {
      const fatiha = level.surahs.find((s) => s.surah_id === AL_FATIHA)!;
      expect(fatiha.coverage_percent).toBe(100);
    }
    expect(
      read.levels.find((l) => l.level_id === levelTwo)!.surahs,
    ).toHaveLength(1);
  });
});

describe("§C26 — the audit records who entered it, and in which curriculum", () => {
  it("names the actor and the Level, and recalculation never rewrites it", async () => {
    const her = await person("مستفيدة");
    await enrol(her, levelOne, branchA);
    const she = await person("مؤطرة");
    await schedule({
      subjectId: quranSubject,
      mode: "entire_level",
      levelId: levelOne,
      branchId: branchA,
      who: she,
    });

    await logProgress(prisma, teacher(she), entry(her, levelOne, AL_FATIHA, 1, 3));
    const row = await prisma.auditLog.findFirstOrThrow({
      where: { actionType: "quranlog.create", actorUserId: she },
    });
    const detail = row.detail as Record<string, unknown>;
    expect(detail["level_id"]).toBe(levelOne);
    expect(detail["category"]).toBe("new_memorization");

    // A later entry by somebody ELSE must not rewrite the first row's actor.
    await logProgress(prisma, superAdmin(), entry(her, levelOne, AL_FATIHA, 4, 7));
    const still = await prisma.auditLog.findFirstOrThrow({ where: { id: row.id } });
    expect(still.actorUserId).toBe(she);
    expect(
      await prisma.auditLog.count({
        where: { actionType: "quranlog.create", actorUserId: adminId },
      }),
    ).toBe(1);
  });
});
