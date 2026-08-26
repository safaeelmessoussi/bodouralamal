import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import type { Actor } from "../policies/actor.js";
import type { RoleScope } from "../policies/branch-scope.js";
import { requireMemorisationSubject } from "../test-support/quran-subject.js";
import {
  correctLog,
  deleteLog,
  levelCompletion,
  logProgress,
  readOwnCoverage,
  readStudentCoverage,
} from "./quran.service.js";
import {
  assignSurahToLevel,
  listLevelSurahs,
  unassignSurahFromLevel,
} from "./reference-data.service.js";

/**
 * **Quran memorization tracking (§4.5, BR-13; M4a, SRS Revision 73).**
 *
 * The two properties worth the cost of a database:
 *
 * * **R73.3's scope** — a مؤطرة reaches only the students whose **Quran** she
 *   teaches. Asserted from both sides, and specifically for the مؤطرة who
 *   teaches the same student **another Subject**, which §4.4c's subject-blind
 *   *own students* would have admitted and the Owner rejected.
 * * **The self-heal guard** — a cache row that lost its write is repaired on
 *   read, so a stale aggregate is unobservable (R10) and TD-15 needs no lock.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = "[quran-test]";

let adminId: string;
let branchA: string;
let levelId: string;
let groupA: string;
let quranSubject: string;
let fiqhSubject: string;
let student: string;
let quranTeacher: string;
let fiqhTeacher: string;
let assistant: string;

const actorOf = (userId: string, scopes: RoleScope[]): Actor => ({
  userId,
  roles: scopes.map((s) => s.role),
  roleScopes: scopes,
});
const superAdmin = (): Actor =>
  actorOf(adminId, [{ role: "super_admin", branches: null }]);
const teacher = (id: string): Actor =>
  actorOf(id, [{ role: "teacher", branches: null }]);

async function failure(
  run: () => Promise<unknown>,
): Promise<{ code?: string }> {
  try {
    await run();
    return {};
  } catch (e) {
    return e as { code?: string };
  }
}

async function person(label: string): Promise<string> {
  return (
    await prisma.user.create({
      data: {
        // R80 — every person carries a recorded sex; the column is NOT NULL.
        sex: "female",
        nameArabic: `${TAG} ${label}`,
        accountStatus: "active",
      },
    })
  ).id;
}

/** A schedule staffed by `who`, delivering `subjectId` to `groupA`. */
async function staffedSchedule(
  subjectId: string,
  who: string,
  position: "teacher" | "assistant",
) {
  const year = await prisma.academicYear.findFirstOrThrow({
    where: { isCurrent: true },
  });
  const schedule = await prisma.recurringCourseSchedule.create({
    data: {
      title: `${TAG} حصة`,
      subjectId,
      teachingMode: "administrative_group",
      administrativeGroupId: groupA,
      branchId: branchA,
      startTime: new Date("1970-01-01T09:00:00Z"),
      endTime: new Date("1970-01-01T10:00:00Z"),
      recurrence: "weekly",
      weekdays: ["monday"],
      academicYearId: year.id,
    },
  });
  await prisma.courseScheduleStaff.create({
    data: { scheduleId: schedule.id, userId: who, position },
  });
  return schedule.id;
}

async function clear(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  if (ids.length > 0) {
    await prisma.quranProgressLog.deleteMany({
      where: { OR: [{ studentId: { in: ids } }, { loggedById: { in: ids } }] },
    });
    await prisma.studentSurahProgress.deleteMany({
      where: { studentId: { in: ids } },
    });
    await prisma.enrollment.deleteMany({ where: { studentId: { in: ids } } });
  }
  const schedules = await prisma.recurringCourseSchedule.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true },
  });
  const sids = schedules.map((s) => s.id);
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
  await prisma.administrativeGroup.deleteMany({
    where: { levelId: { in: levels.map((l) => l.id) } },
  });
  await prisma.levelSubject.deleteMany({
    where: { levelId: { in: levels.map((l) => l.id) } },
  });
  await prisma.levelSurah.deleteMany({
    where: { levelId: { in: levels.map((l) => l.id) } },
  });
  await prisma.level.deleteMany({
    where: { id: { in: levels.map((l) => l.id) } },
  });
  await prisma.subject.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeEach(async () => {
  await clear();
  adminId = await person("مسؤولة");
  const cat = await prisma.category.create({ data: { name: `${TAG} فئة` } });
  levelId = (
    await prisma.level.create({
      data: {
        name: `${TAG} مستوى`,
        categoryId: cat.id,
        genderRestriction: "any",
      },
    })
  ).id;
  branchA = (
    await prisma.branch.create({
      data: {
        name: `${TAG} فرع`,
        operationalStartDate: new Date("2020-01-01"),
      },
    })
  ).id;
  groupA = (
    await prisma.administrativeGroup.create({
      data: { name: `${TAG} مجموعة`, levelId, branchId: branchA },
    })
  ).id;

  // R107 — fixtures consume the one Production marker rather than creating a
  // second one. Resetting it also repairs the deliberate fail-closed case from
  // the previous test before the next case starts.
  const seededMemorisationSubject = await prisma.subject.findFirstOrThrow({
    where: { name: 'حفظ القرآن', deletedAt: null },
    select: { id: true, tracksQuranProgress: true },
  });
  if (!seededMemorisationSubject.tracksQuranProgress) {
    await prisma.subject.update({
      where: { id: seededMemorisationSubject.id },
      data: { tracksQuranProgress: true },
    });
  }
  quranSubject = (await requireMemorisationSubject(prisma)).id;
  fiqhSubject = (await prisma.subject.create({ data: { name: `${TAG} فقه` } }))
    .id;

  student = await person("مستفيدة");
  await prisma.enrollment.create({
    data: {
      studentId: student,
      levelId,
      administrativeGroupId: groupA,
      branchId: branchA,
    },
  });

  // §C11 — `LevelSurah` is normative for entry, so the Level must configure
  // the Surah every `range()` below writes against. Surah 1 (الفاتحة, 7 ayahs)
  // is the fixture's syllabus.
  await prisma.levelSurah.create({ data: { levelId, surahId: 1 } });

  quranTeacher = await person("مؤطرة القرآن");
  fiqhTeacher = await person("مؤطرة الفقه");
  assistant = await person("مؤطرة مساعدة");
  await staffedSchedule(quranSubject, quranTeacher, "teacher");
  await staffedSchedule(fiqhSubject, fiqhTeacher, "teacher");
  await staffedSchedule(quranSubject, assistant, "assistant");
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

const range = (start: number, end: number) => ({
  studentId: student,
  levelId,
  surahId: 1,
  startAyah: start,
  endAyah: end,
  category: "new_memorization" as const,
});

describe("R73.3 — Quran scope is the Quran teaching, not any teaching", () => {
  it("the مؤطرة who teaches this student’s QURAN may log", async () => {
    const coverage = await logProgress(
      prisma,
      teacher(quranTeacher),
      range(1, 4),
    );
    expect(coverage.merged_ayah_count).toBe(4);
    // Al-Fatiha has 7 ayahs — the denominator is the Surah's own (§4.5).
    expect(coverage.coverage_percent).toBe(57.14);
  });

  it("the مؤطرة who teaches the same student only FIQH may not", async () => {
    // **The case the Owner rejected**, and the one §4.4c's subject-blind
    // "own students" would have admitted: she teaches this مستفيدة, just not
    // her Quran.
    const denied = await failure(() =>
      logProgress(prisma, teacher(fiqhTeacher), range(1, 4)),
    );
    // §20 rule 17 — out of scope is 404, never 403.
    expect(denied.code).toBe("NOT_FOUND");
  });

  it("an ASSISTANT on the Quran schedule may log — position is not consulted", async () => {
    // R43 gave co-teachers and assistants one table and one rule; R73 does not
    // introduce a second, and the Owner's decision 6 requires exactly this.
    const coverage = await logProgress(prisma, teacher(assistant), range(1, 3));
    expect(coverage.merged_ayah_count).toBe(3);
  });

  it("a مؤطرة who staffs nothing reaches nobody", async () => {
    const stranger = await person("غريبة");
    const denied = await failure(() =>
      logProgress(prisma, teacher(stranger), range(1, 2)),
    );
    expect(denied.code).toBe("NOT_FOUND");
  });

  it("with NO Subject marked, no مؤطرة has Quran scope — it fails closed", async () => {
    // Failing open would reinstate exactly the behaviour R73.3 was written to
    // stop, so an unconfigured association grants nobody rather than everybody.
    await prisma.subject.update({
      where: { id: quranSubject },
      data: { tracksQuranProgress: false },
    });
    const denied = await failure(() =>
      logProgress(prisma, teacher(quranTeacher), range(1, 2)),
    );
    expect(denied.code).toBe("NOT_FOUND");
  });

  it("a Super Admin is unaffected by the Subject rule", async () => {
    const coverage = await logProgress(prisma, superAdmin(), range(1, 7));
    expect(coverage.coverage_percent).toBe(100);
  });
});

describe("BR-13 — coverage is a union, recomputed synchronously", () => {
  it("does not inflate when ranges overlap, and updates in the same request", async () => {
    await logProgress(prisma, teacher(quranTeacher), range(1, 5));
    const after = await logProgress(prisma, teacher(quranTeacher), range(3, 7));
    // [1–5] ∪ [3–7] = [1–7] = 7 ayahs, not 10.
    expect(after.merged_ayah_count).toBe(7);
    expect(after.coverage_percent).toBe(100);

    // …and the cache row already holds it: the recalculation is synchronous,
    // never deferred to a job (§4.5, R6/R8/R10).
    const cached = await prisma.studentSurahProgress.findFirstOrThrow({
      where: { studentId: student, surahId: 1 },
    });
    expect(cached.mergedAyahCount).toBe(7);
  });

  it("recomputes downwards when a log is corrected", async () => {
    const coverage = await logProgress(
      prisma,
      teacher(quranTeacher),
      range(1, 7),
    );
    expect(coverage.merged_ayah_count).toBe(7);

    const log = await prisma.quranProgressLog.findFirstOrThrow({
      where: { studentId: student },
    });
    const after = await correctLog(prisma, teacher(quranTeacher), log.id, {
      endAyah: 3,
    });
    expect(after.merged_ayah_count).toBe(3);
  });

  it("recomputes to zero when the only log is deleted, and leaves a Trash entry", async () => {
    await logProgress(prisma, teacher(quranTeacher), range(1, 7));
    const log = await prisma.quranProgressLog.findFirstOrThrow({
      where: { studentId: student },
    });

    const after = await deleteLog(prisma, teacher(quranTeacher), log.id);
    expect(after.merged_ayah_count).toBe(0);
    expect(after.coverage_percent).toBe(0);

    // R59 — a deletion a person deliberately performed gets its own entry.
    expect(
      await prisma.trash.count({
        where: { targetEntity: "QuranProgressLog", targetId: log.id },
      }),
    ).toBe(1);
    // The stamp is cleared with the last log; a leftover would make an empty
    // coverage look freshly computed.
    const cached = await prisma.studentSurahProgress.findFirstOrThrow({
      where: { studentId: student, surahId: 1 },
    });
    expect(cached.lastLogId).toBeNull();
  });

  it("refuses an ayah past the end of the surah", async () => {
    // Al-Fatiha has 7. The database trigger enforces it too (TD-6); the service
    // turns it into a coded refusal rather than a driver error.
    const denied = await failure(() =>
      logProgress(prisma, teacher(quranTeacher), { ...range(1, 8) }),
    );
    expect(denied.code).toBe("VALIDATION_FAILED");
  });
});

describe("R10 — the cache is self-healing, which is why TD-15 needs no lock", () => {
  it("repairs a cache row that lost its write, on read", async () => {
    await logProgress(prisma, teacher(quranTeacher), range(1, 7));

    // Simulate the crash window between the log's commit and the cache upsert:
    // the row holds a stale count and a stamp naming an older log.
    await prisma.studentSurahProgress.updateMany({
      where: { studentId: student, surahId: 1 },
      data: { mergedAyahCount: 1, coveragePercent: 14.29, lastLogId: null },
    });

    const read = await readStudentCoverage(
      prisma,
      teacher(quranTeacher),
      student,
    );
    // The reader never sees the stale value — §4.5's guard recomputes first.
    expect(read.surahs[0]?.merged_ayah_count).toBe(7);

    const repaired = await prisma.studentSurahProgress.findFirstOrThrow({
      where: { studentId: student, surahId: 1 },
    });
    // …and repairs it in place, so the next reader pays nothing.
    expect(repaired.mergedAyahCount).toBe(7);
    expect(repaired.lastLogId).not.toBeNull();
  });

  it("reads a student with no logs as no surahs, not an error", async () => {
    const read = await readStudentCoverage(prisma, superAdmin(), student);
    expect(read.surahs).toEqual([]);
    expect(read.logs).toEqual([]);
  });
});

describe("M4b — the student reads her own, and only her own", () => {
  it("reads her own coverage with no scope question asked", async () => {
    // The subject was established by `childContext` before this call — the
    // service takes a verified id and never resolves one, exactly as
    // `getStudentIdentity` does.
    await logProgress(prisma, teacher(quranTeacher), range(1, 4));

    const own = await readOwnCoverage(prisma, student);
    expect(own.surahs[0]?.merged_ayah_count).toBe(4);
    expect(own.logs).toHaveLength(1);
  });

  it("shows an empty state rather than an error before anything is logged", async () => {
    const own = await readOwnCoverage(prisma, student);
    expect(own.surahs).toEqual([]);
    expect(own.logs).toEqual([]);
  });

  it("cannot reach another student — the STAFF path still refuses her", async () => {
    // A student holds no staff role, so the id-carrying route is closed to her
    // whatever id she supplies. The id-less route is the only one she has, and
    // it takes its subject from the middleware rather than from her request.
    const other = await person("مستفيدة أخرى");
    const asStudent = actorOf(student, [{ role: "student", branches: null }]);
    const denied = await failure(() =>
      readStudentCoverage(prisma, asStudent, other),
    );
    expect(denied.code).toBe("NOT_FOUND");
  });

  it("cannot reach another student through the staff path even for herself", async () => {
    // Belt and braces: the student role grants nothing on the staff read, so
    // even naming her own id there is refused. Her access is the `/me` route.
    const asStudent = actorOf(student, [{ role: "student", branches: null }]);
    const denied = await failure(() =>
      readStudentCoverage(prisma, asStudent, student),
    );
    expect(denied.code).toBe("NOT_FOUND");
  });

  it("leaves the مؤطرة and Admin paths exactly as they were", async () => {
    await logProgress(prisma, teacher(quranTeacher), range(1, 4));
    // The Quran مؤطرة still reads through the staff path…
    expect(
      (await readStudentCoverage(prisma, teacher(quranTeacher), student))
        .surahs,
    ).toHaveLength(1);
    // …the Fiqh-only مؤطرة still does not…
    expect(
      (
        await failure(() =>
          readStudentCoverage(prisma, teacher(fiqhTeacher), student),
        )
      ).code,
    ).toBe("NOT_FOUND");
    // …and a Super Admin is unaffected.
    expect(
      (await readStudentCoverage(prisma, superAdmin(), student)).surahs,
    ).toHaveLength(1);
  });
});

/**
 * **M4c — `LevelSurah` and BR-11.**
 *
 * BR-11: *"coverage 100% and, only if a final exam is configured for that level,
 * that exam passed. If no final exam is configured, coverage alone suffices."*
 * Completion is read from the **existing** engine — configured Surahs × the
 * coverage §4.5 already derives — and no second percentage is computed.
 */
/**
 * **These two blocks own the curriculum themselves.**
 *
 * The shared `beforeEach` seeds one `LevelSurah` row (surah 1) because §C11
 * makes the syllabus normative for *entry* — every `range()` above writes
 * against it. The blocks below are about the syllabus as a **subject** rather
 * than a precondition: one adds and removes rows, the other needs a Level that
 * configures **none**. So they clear the seeded row first and build their own
 * state, which is what they were always doing before entry required a syllabus.
 */
const withOwnCurriculum = (): void => {
  beforeEach(async () => {
    await prisma.levelSurah.deleteMany({ where: { levelId } });
  });
};

describe("M4c — LevelSurah is Super Admin curriculum", () => {
  withOwnCurriculum();
  it("a Super Admin adds and removes a Surah", async () => {
    await assignSurahToLevel(prisma, superAdmin(), levelId, 1);
    expect(
      (await listLevelSurahs(prisma, superAdmin(), levelId)).map(
        (s) => s.surah_id,
      ),
    ).toEqual([1]);

    await unassignSurahFromLevel(prisma, superAdmin(), levelId, 1);
    expect(await listLevelSurahs(prisma, superAdmin(), levelId)).toEqual([]);
  });

  it("revives a previously removed Surah rather than failing on the unique pair", async () => {
    await assignSurahToLevel(prisma, superAdmin(), levelId, 2);
    await unassignSurahFromLevel(prisma, superAdmin(), levelId, 2);
    await assignSurahToLevel(prisma, superAdmin(), levelId, 2);
    expect(
      (await listLevelSurahs(prisma, superAdmin(), levelId)).map(
        (s) => s.surah_id,
      ),
    ).toEqual([2]);
  });

  it("refuses a مؤطرة and an Admin — curriculum is Super Admin (R26)", async () => {
    expect(
      (
        await failure(() =>
          assignSurahToLevel(prisma, teacher(quranTeacher), levelId, 1),
        )
      ).code,
    ).toBe("FORBIDDEN");
    const asAdmin = actorOf(adminId, [{ role: "admin", branches: null }]);
    expect(
      (await failure(() => assignSurahToLevel(prisma, asAdmin, levelId, 1)))
        .code,
    ).toBe("FORBIDDEN");
    // …but an Admin may READ it: operational work depends on the syllabus.
    expect(await listLevelSurahs(prisma, asAdmin, levelId)).toEqual([]);
  });

  it("removing a Surah leaves the logged progress untouched", async () => {
    // §4.5 records against (student, surah) and BR-13 derives from the logs, so
    // the syllabus decides what BR-11 REQUIRES, never what she has recited.
    await assignSurahToLevel(prisma, superAdmin(), levelId, 1);
    await logProgress(prisma, teacher(quranTeacher), range(1, 7));
    await unassignSurahFromLevel(prisma, superAdmin(), levelId, 1);
    expect(
      await prisma.quranProgressLog.count({
        where: { studentId: student, deletedAt: null },
      }),
    ).toBe(1);
  });
});

describe("M4c — BR-11 level completion", () => {
  withOwnCurriculum();
  it("is NOT COMPUTABLE when the Level configures no Surahs", async () => {
    // Vacuous 100% would let an unconfigured Level mark everybody finished, so
    // the third state is the honest answer rather than a convenient one.
    const rows = await levelCompletion(prisma, superAdmin(), levelId);
    const mine = rows.find((r) => r.student_id === student)!;
    expect(mine.complete).toBeNull();
    expect(mine.configured_surahs).toBe(0);
  });

  it("is FALSE at 0% coverage of a configured syllabus", async () => {
    await assignSurahToLevel(prisma, superAdmin(), levelId, 1);
    const mine = (await levelCompletion(prisma, superAdmin(), levelId)).find(
      (r) => r.student_id === student,
    )!;
    expect(mine.complete).toBe(false);
    expect(mine.completed_surahs).toBe(0);
  });

  it("is FALSE at partial coverage", async () => {
    await assignSurahToLevel(prisma, superAdmin(), levelId, 1);
    // Al-Fatiha has 7 ayahs; four of them is 57.14%.
    await logProgress(prisma, teacher(quranTeacher), range(1, 4));
    const mine = (await levelCompletion(prisma, superAdmin(), levelId)).find(
      (r) => r.student_id === student,
    )!;
    expect(mine.complete).toBe(false);
    expect(mine.surahs[0]?.coverage_percent).toBe(57.14);
  });

  it("is TRUE at 100% of every configured Surah, with no final exam configured", async () => {
    await assignSurahToLevel(prisma, superAdmin(), levelId, 1);
    await logProgress(prisma, teacher(quranTeacher), range(1, 7));
    const mine = (await levelCompletion(prisma, superAdmin(), levelId)).find(
      (r) => r.student_id === student,
    )!;
    expect(mine.complete).toBe(true);
    // BR-11's own words: "if no final exam is configured, coverage alone
    // suffices" — and nothing in the model can configure one (§4.6 `round` is
    // explicitly a non-restricting selector).
    expect(mine.final_exam_configured).toBe(false);
  });

  it("needs EVERY configured Surah, not just one", async () => {
    await assignSurahToLevel(prisma, superAdmin(), levelId, 1);
    await assignSurahToLevel(prisma, superAdmin(), levelId, 114);
    await logProgress(prisma, teacher(quranTeacher), range(1, 7));
    const mine = (await levelCompletion(prisma, superAdmin(), levelId)).find(
      (r) => r.student_id === student,
    )!;
    expect(mine.configured_surahs).toBe(2);
    expect(mine.completed_surahs).toBe(1);
    expect(mine.complete).toBe(false);
  });

  it("refuses a مؤطرة — completion is an Admin read", async () => {
    expect(
      (
        await failure(() =>
          levelCompletion(prisma, teacher(quranTeacher), levelId),
        )
      ).code,
    ).toBe("FORBIDDEN");
  });
});
