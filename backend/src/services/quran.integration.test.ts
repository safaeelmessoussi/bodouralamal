import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import type { Actor } from "../policies/actor.js";
import type { RoleScope } from "../policies/branch-scope.js";
import { inProgressEnrolmentWhere } from "../policies/level-completion.js";
import { getStudentIdentity } from "./student.service.js";
import { personalCalendarOptions } from "./calendar.service.js";
import { requireMemorisationSubject } from "../test-support/quran-subject.js";
import * as marks from "./level-completion-mark.service.js";
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
    // R167 §3 — a mark is RESTRICT against the student, the Level and the branch.
    await prisma.levelCompletionMark.deleteMany({ where: { studentId: { in: ids } } });
    await prisma.enrollment.deleteMany({ where: { studentId: { in: ids } } });
  }
  // R166 §1 — the sittings the completion tests create, by the Level they
  // belong to (a Grade and an Exam are both RESTRICT against what they name).
  const sittings = { exam: { level: { name: { startsWith: TAG } } } };
  await prisma.grade.deleteMany({ where: sittings });
  await prisma.studentExamSubmission.deleteMany({ where: sittings });
  await prisma.exam.deleteMany({ where: { level: { name: { startsWith: TAG } } } });
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

describe("SRS Revision 167 §3 — «إتمام المستوى»: the administration's attestation and its certificate", () => {
  withOwnCurriculum();

  const admin = (): Actor => actorOf(adminId, [{ role: "admin", branches: [branchA] }]);
  const otherBranchAdmin = async (): Promise<Actor> => {
    const elsewhere = await prisma.branch.create({ data: { name: `${TAG} فرع آخر` } });
    return actorOf(adminId, [{ role: "admin", branches: [elsewhere.id] }]);
  };
  const row = async () =>
    (await marks.listForStudent(prisma, admin(), student)).find((r) => r.level_id === levelId)!;

  it("shows what BR-11 reads beside what was recorded — and refuses an UNMET mark until the caller says she has seen it", async () => {
    await assignSurahToLevel(prisma, superAdmin(), levelId, 1);
    expect(await row()).toMatchObject({
      requirements: { complete: false, configured_surahs: 1, memorised_surahs: 0 },
      mark: null,
    });

    const refusal = await failure(() =>
      marks.markCompleted(prisma, admin(), student, levelId, { acknowledgeUnmet: false }),
    );
    expect(refusal).toMatchObject({
      code: "STATE_CONFLICT",
      details: { reason: "REQUIREMENTS_NOT_MET", configured_surahs: 1, memorised_surahs: 0 },
    });
    expect((await row()).mark).toBeNull();

    // Told, and marking anyway: allowed — and the record says so for ever.
    await marks.markCompleted(prisma, admin(), student, levelId, { acknowledgeUnmet: true });
    // R168 §3 — THIS is what «حفظي» reads as «أتمّت المستوى»: the mark, while
    // the conditions beside it still read unmet.
    const hers = (await readOwnCoverage(prisma, student)).levels.find((l) => l.level_id === levelId)!;
    expect(hers.completion.marked_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(hers.completion.complete).toBe(false);
    const marked = await row();
    expect(marked.mark).toMatchObject({ requirements_met: false, certificate_number: null });
    expect(marked.mark!.completed_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // BR-11 itself is untouched by the attestation: still derived, still false.
    expect(marked.requirements.complete).toBe(false);

    // Idempotent, and audited once.
    await marks.markCompleted(prisma, admin(), student, levelId, { acknowledgeUnmet: true });
    expect(
      await prisma.auditLog.count({ where: { actionType: "level_completion.mark", actorUserId: adminId } }),
    ).toBe(1);
  });

  it("a MET Level needs no acknowledgement, and records that it was met", async () => {
    await assignSurahToLevel(prisma, superAdmin(), levelId, 1);
    await logProgress(prisma, teacher(quranTeacher), range(1, 7));
    await marks.markCompleted(prisma, admin(), student, levelId, { acknowledgeUnmet: false });
    expect((await row()).mark).toMatchObject({ requirements_met: true });
  });

  it("the certificate is a SECOND confirmation: nothing reaches her until it is given, and withdrawing keeps its number", async () => {
    await assignSurahToLevel(prisma, superAdmin(), levelId, 1);
    expect(
      await failure(() => marks.issueCertificate(prisma, admin(), student, levelId)),
    ).toMatchObject({ code: "STATE_CONFLICT", details: { reason: "LEVEL_NOT_COMPLETED" } });

    await marks.markCompleted(prisma, admin(), student, levelId, { acknowledgeUnmet: true });
    expect(await marks.certificatesOf(prisma, student)).toEqual([]);

    await marks.issueCertificate(prisma, admin(), student, levelId);
    const [certificate] = await marks.certificatesOf(prisma, student);
    expect(certificate).toMatchObject({
      student_name: expect.stringContaining(TAG),
      level_name: expect.stringContaining(TAG),
      branch_name: expect.stringContaining(TAG),
    });
    expect(certificate!.certificate_number).toBeGreaterThan(0);
    expect(certificate!.completed_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // What she can see and print cannot be unmade underneath her.
    expect(
      await failure(() => marks.unmarkCompleted(prisma, admin(), student, levelId)),
    ).toMatchObject({ code: "STATE_CONFLICT", details: { reason: "CERTIFICATE_ISSUED" } });

    await marks.withdrawCertificate(prisma, admin(), student, levelId);
    expect(await marks.certificatesOf(prisma, student)).toEqual([]);
    await marks.issueCertificate(prisma, admin(), student, levelId);
    expect((await marks.certificatesOf(prisma, student))[0]!.certificate_number).toBe(
      certificate!.certificate_number,
    );

    await marks.withdrawCertificate(prisma, admin(), student, levelId);
    await marks.unmarkCompleted(prisma, admin(), student, levelId);
    expect((await row()).mark).toBeNull();
  });

  it("R172 §14 — a completed Level is behind her: gone from «her Levels» (the library's tree, the calendar's filters), the enrolment kept", async () => {
    await assignSurahToLevel(prisma, superAdmin(), levelId, 1);
    const before = await getStudentIdentity(prisma, student);
    expect(before.enrollments.map((e) => e.level.id)).toContain(levelId);

    await marks.markCompleted(prisma, admin(), student, levelId, { acknowledgeUnmet: true });
    const after = await getStudentIdentity(prisma, student);
    expect(after.enrollments.map((e) => e.level.id)).not.toContain(levelId);
    // History stands: the enrolment row is untouched.
    expect(await prisma.enrollment.count({ where: { studentId: student, levelId, deletedAt: null } })).toBe(1);
    // The one predicate every reader asks.
    expect(await prisma.enrollment.count({ where: { studentId: student, ...inProgressEnrolmentWhere(student) } })).toBe(0);
    // 2026-09-25 (the Owner: «تقويمي is still showing the levels») — the
    // calendar's FILTER OPTIONS read the same predicate, not only its rows.
    expect((await personalCalendarOptions(prisma, student)).levels.map((l) => l.id)).not.toContain(levelId);

    // Un-marked (a mistake), she is in it again.
    await marks.unmarkCompleted(prisma, admin(), student, levelId);
    expect((await getStudentIdentity(prisma, student)).enrollments.map((e) => e.level.id)).toContain(levelId);
  });

  it("Codex review 2026-09-22 — concurrent issues draw ONE number, and a double-tapped mark answers like a repeat", async () => {
    await assignSurahToLevel(prisma, superAdmin(), levelId, 1);
    // Two identical marks at once: one row, no 409 for the loser.
    await Promise.all([
      marks.markCompleted(prisma, admin(), student, levelId, { acknowledgeUnmet: true }),
      marks.markCompleted(prisma, admin(), student, levelId, { acknowledgeUnmet: true }),
    ]);
    expect(await prisma.levelCompletionMark.count({ where: { studentId: student, levelId } })).toBe(1);

    // Two issues at once: the row lock serialises them, so the second reads
    // «already issued» and draws nothing — one number, one audit row.
    const before = Number(
      (await prisma.$queryRaw<{ n: bigint }[]>`SELECT last_value AS n FROM level_certificate_number_seq`)[0]!.n,
    );
    await Promise.all([
      marks.issueCertificate(prisma, admin(), student, levelId),
      marks.issueCertificate(prisma, admin(), student, levelId),
      marks.issueCertificate(prisma, admin(), student, levelId),
    ]);
    const after = Number(
      (await prisma.$queryRaw<{ n: bigint }[]>`SELECT last_value AS n FROM level_certificate_number_seq`)[0]!.n,
    );
    expect(after - before).toBe(1);
    const [certificate] = await marks.certificatesOf(prisma, student);
    expect(certificate!.certificate_number).toBe(after);
    expect(
      await prisma.auditLog.count({
        where: {
          actionType: "level_completion.certificate_issue",
          targetId: (await prisma.levelCompletionMark.findUniqueOrThrow({
            where: { studentId_levelId: { studentId: student, levelId } },
            select: { id: true },
          })).id,
        },
      }),
    ).toBe(1);

    // An unmark racing a withdraw waits for it instead of deleting the row
    // from under it (or being refused for a certificate that is being taken back).
    await Promise.all([
      marks.withdrawCertificate(prisma, admin(), student, levelId),
      marks.withdrawCertificate(prisma, admin(), student, levelId),
    ]);
    await marks.unmarkCompleted(prisma, admin(), student, levelId);
    expect((await row()).mark).toBeNull();
  });

  it("is an Admin's act within her branches: a مؤطرة is refused, another branch's Admin finds nothing (404, never 403)", async () => {
    expect(
      await failure(() =>
        marks.markCompleted(prisma, teacher(quranTeacher), student, levelId, { acknowledgeUnmet: true }),
      ),
    ).toMatchObject({ code: "FORBIDDEN" });
    const elsewhere = await otherBranchAdmin();
    expect(
      await failure(() =>
        marks.markCompleted(prisma, elsewhere, student, levelId, { acknowledgeUnmet: true }),
      ),
    ).toMatchObject({ code: "NOT_FOUND" });
    expect(await marks.listForStudent(prisma, elsewhere, student)).toEqual([]);
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

  /**
   * **R166 §1 — BR-11's second clause**: where the Level teaches a Subject that
   * works by Surah and is not the memorisation tracker (تفسير القرآن, by its
   * COLUMNS — this fixture's is deliberately not called that), every Surah of
   * the syllabus must also have had an exam TAKEN on it.
   */
  describe("R166 §1 — memorised AND examined", () => {
    let tafseerLike: string;
    const yearId = async (): Promise<string> =>
      (await prisma.academicYear.findFirstOrThrow({ where: { deletedAt: null } })).id;

    async function teachBySurahSubject(): Promise<void> {
      tafseerLike = (
        await prisma.subject.create({
          data: { name: `${TAG} مادة تُختبَر بالسور`, requiresSurahs: true },
        })
      ).id;
      await prisma.levelSubject.create({ data: { levelId, subjectId: tafseerLike } });
    }

    async function sitting(surahId: number): Promise<string> {
      return (
        await prisma.exam.create({
          data: {
            title: `${TAG} اختبار ${surahId}`,
            mode: "physical",
            status: "published",
            maxGrade: 20,
            levelId,
            subjectId: tafseerLike,
            surahId,
            academicYearId: await yearId(),
            targetKind: "level",
            date: new Date("2026-06-10T00:00:00.000Z"),
          },
          select: { id: true },
        })
      ).id;
    }

    const mineOf = async () =>
      (await levelCompletion(prisma, superAdmin(), levelId)).find((r) => r.student_id === student)!;

    it("memorisation alone no longer completes a Level that teaches such a Subject", async () => {
      await teachBySurahSubject();
      await assignSurahToLevel(prisma, superAdmin(), levelId, 1);
      await logProgress(prisma, teacher(quranTeacher), range(1, 7));

      const mine = await mineOf();
      expect(mine.completed_surahs).toBe(1);
      expect(mine.final_exam_configured).toBe(true);
      expect(mine.examined_surahs).toBe(0);
      expect(mine.surahs[0]?.exam_taken).toBe(false);
      expect(mine.complete).toBe(false);
    });

    it("a recorded mark completes it — and a mark of «غائبة» does not", async () => {
      await teachBySurahSubject();
      await assignSurahToLevel(prisma, superAdmin(), levelId, 1);
      await logProgress(prisma, teacher(quranTeacher), range(1, 7));
      const examId = await sitting(1);

      const absent = await prisma.grade.create({
        data: { examId, studentId: student, score: 0, absent: true },
      });
      expect((await mineOf()).complete).toBe(false);

      // No pass mark exists on this platform (§4.6), so ANY recorded score is
      // «taken» — the Owner's word — including a low one.
      await prisma.grade.update({ where: { id: absent.id }, data: { absent: false, score: 3 } });
      const mine = await mineOf();
      expect(mine.surahs[0]?.exam_taken).toBe(true);
      expect(mine.examined_surahs).toBe(1);
      expect(mine.complete).toBe(true);
    });

    it("a SUBMITTED remote paper counts; one still in progress does not", async () => {
      await teachBySurahSubject();
      await assignSurahToLevel(prisma, superAdmin(), levelId, 1);
      await logProgress(prisma, teacher(quranTeacher), range(1, 7));
      const examId = await sitting(1);
      const paper = await prisma.studentExamSubmission.create({
        data: { examId, studentId: student, state: "in_progress" },
      });
      expect((await mineOf()).complete).toBe(false);
      await prisma.studentExamSubmission.update({
        where: { id: paper.id },
        data: { state: "submitted", submittedAt: new Date() },
      });
      expect((await mineOf()).complete).toBe(true);
    });

    it("needs an exam on EVERY Surah of the syllabus, and an exam of another Surah is no substitute", async () => {
      await teachBySurahSubject();
      await assignSurahToLevel(prisma, superAdmin(), levelId, 1);
      await assignSurahToLevel(prisma, superAdmin(), levelId, 114);
      await logProgress(prisma, teacher(quranTeacher), range(1, 7));
      await logProgress(prisma, teacher(quranTeacher), { ...range(1, 6), surahId: 114 });
      await prisma.grade.create({
        data: { examId: await sitting(1), studentId: student, score: 15 },
      });

      const half = await mineOf();
      expect(half.completed_surahs).toBe(2);
      expect(half.examined_surahs).toBe(1);
      expect(half.complete).toBe(false);

      await prisma.grade.create({
        data: { examId: await sitting(114), studentId: student, score: 12 },
      });
      expect((await mineOf()).complete).toBe(true);
    });

    it("an exam of the MEMORISATION Subject is not the تفسير exam — the tracker is excluded by its column", async () => {
      await teachBySurahSubject();
      await assignSurahToLevel(prisma, superAdmin(), levelId, 1);
      await logProgress(prisma, teacher(quranTeacher), range(1, 7));
      const hifzExam = await prisma.exam.create({
        data: {
          title: `${TAG} اختبار حفظ`,
          mode: "physical",
          status: "published",
          maxGrade: 20,
          levelId,
          subjectId: quranSubject,
          surahId: 1,
          academicYearId: await yearId(),
          targetKind: "level",
          date: new Date("2026-06-10T00:00:00.000Z"),
        },
      });
      await prisma.grade.create({ data: { examId: hifzExam.id, studentId: student, score: 18 } });
      expect((await mineOf()).complete).toBe(false);
    });

    it("«حفظي» tells HER the same verdict, by the same rule", async () => {
      await teachBySurahSubject();
      await assignSurahToLevel(prisma, superAdmin(), levelId, 1);
      await logProgress(prisma, teacher(quranTeacher), range(1, 7));

      const before = (await readOwnCoverage(prisma, student)).levels.find((l) => l.level_id === levelId)!;
      expect(before.completion).toEqual({
        complete: false,
        configured_surahs: 1,
        memorised_surahs: 1,
        examined_surahs: 0,
        exams_required: true,
        // R168 §3 — nobody has RECORDED her completion; the rest are conditions.
        marked_on: null,
      });
      expect(before.surahs[0]?.exam_taken).toBe(false);

      await prisma.grade.create({
        data: { examId: await sitting(1), studentId: student, score: 16 },
      });
      const after = (await readOwnCoverage(prisma, student)).levels.find((l) => l.level_id === levelId)!;
      expect(after.completion.complete).toBe(true);
      expect(after.surahs[0]?.exam_taken).toBe(true);
    });
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
