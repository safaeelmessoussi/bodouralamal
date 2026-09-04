import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import {
  EDUCATIONAL_RETENTION_YEARS,
  elapsedRetentionReport,
  retentionFor,
} from './educational-retention.service.js';

/**
 * **Ten years after the LAST EDUCATIONAL ACTIVITY** (SRS §4.10a, Revision 131) —
 * the association's own purpose-based policy, and **not** a CNDP-prescribed or
 * legally mandated duration.
 *
 * The property under test is that the boundary is **derived from canonical
 * durable facts** and is **explainable**: every answer names the fact that
 * decided it, so a report can be checked rather than trusted. §4.10a's whole
 * reason for forbidding a maintained `last_activity_at` column is that a stale
 * clock deletes the wrong records — so these tests assert the derivation
 * directly, including that a row's `updated_at` plays no part.
 *
 * **Nothing here deletes.** The computation and its dry-run report are the whole
 * of the implementation until §4.10a's open classifications are settled.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = '[retention-test]';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/**
 * **A per-RUN academic-year label, not a fixed one.**
 *
 * `AcademicYear.label` is unique application-wide, so a hard-coded `2911-2912`
 * collides with a concurrent suite or with anything an interrupted run of this
 * one left behind — which is exactly how this test failed under full-suite load
 * while passing alone. The shared `provisionAcademicPeriod` helper cannot serve
 * here because its dates are relative to today and this suite needs a
 * *historical* period end to assert the ten-year boundary, so the label is made
 * unique the same way instead. The `28xx` band is distinct from the helper's own
 * reserved band and from any seeded year.
 */
const RUN_YEAR = 2800 + Math.floor(Math.random() * 90);
const YEAR_LABEL = `${RUN_YEAR}-${RUN_YEAR + 1}`;
let counter = 0;
let branchId = '';
let levelId = '';
let groupId = '';
let staffId = '';

async function makeBeneficiary(label: string): Promise<string> {
  counter += 1;
  const u = await prisma.user.create({
    data: {
      sex: 'female',
      nameArabic: `${TAG} ${label} ${counter}`,
      accountStatus: 'active',
      isBeneficiary: true,
    },
  });
  return u.id;
}

async function makeExam(dateIso: string): Promise<string> {
  const exam = await prisma.exam.create({
    data: {
      title: `${TAG} اختبار ${dateIso}`,
      levelId,
      targetKind: 'level',
      date: day(dateIso),
      maxGrade: 20,
    },
  });
  return exam.id;
}

async function clear(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await prisma.grade.deleteMany({ where: { exam: { title: { startsWith: TAG } } } });
  await prisma.studentExamAnswer.deleteMany({
    where: { submission: { exam: { title: { startsWith: TAG } } } },
  });
  await prisma.studentExamSubmission.deleteMany({
    where: { exam: { title: { startsWith: TAG } } },
  });
  await prisma.attendance.deleteMany({ where: { exam: { title: { startsWith: TAG } } } });
  if (ids.length > 0) {
    await prisma.grade.deleteMany({ where: { studentId: { in: ids } } });
    await prisma.studentExamSubmission.deleteMany({ where: { studentId: { in: ids } } });
    await prisma.attendance.deleteMany({
      where: { OR: [{ studentId: { in: ids } }, { markedById: { in: ids } }] },
    });
    await prisma.quranProgressLog.deleteMany({
      where: { OR: [{ studentId: { in: ids } }, { loggedById: { in: ids } }] },
    });
    await prisma.enrollment.deleteMany({ where: { studentId: { in: ids } } });
    await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.exam.deleteMany({ where: { title: { startsWith: TAG } } });
  await prisma.enrollment.deleteMany({
    where: { administrativeGroup: { name: { startsWith: TAG } } },
  });
  await prisma.administrativeGroup.deleteMany({ where: { name: { startsWith: TAG } } });
  // This suite's OWN year, by exact label — never a band, which would sweep a
  // concurrent suite's rows. Periods first: `academic_period_id` is Restrict.
  await prisma.academicPeriod.deleteMany({
    where: { academicYear: { label: YEAR_LABEL } },
  });
  await prisma.academicYear.deleteMany({ where: { label: YEAR_LABEL } });
  await prisma.level.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeEach(async () => {
  await clear();
  branchId = (await prisma.branch.create({ data: { name: `${TAG} فرع` } })).id;
  const categoryId = (await prisma.category.create({ data: { name: `${TAG} فئة` } })).id;
  levelId = (
    await prisma.level.create({
      data: { name: `${TAG} مستوى`, categoryId, genderRestriction: 'any' },
    })
  ).id;
  groupId = (
    await prisma.administrativeGroup.create({
      data: { name: `${TAG} مجموعة`, levelId, branchId },
    })
  ).id;
  staffId = await makeBeneficiary('مؤطرة');
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe('the boundary is derived, and it says which fact decided it', () => {
  it('no educational history at all yields NO retention period — never "now"', async () => {
    /**
     * A guardian-only account and a beneficiary who never attended anything have
     * no educational retention period. Reporting one would invite a purge this
     * policy never authorised, which is why the answer is `null` rather than a
     * date in the past.
     */
    const her = await makeBeneficiary('بلا سجل');
    const report = await retentionFor(prisma, her, day('2030-01-01'));
    expect(report.lastActivityAt).toBeNull();
    expect(report.retainUntil).toBeNull();
    expect(report.elapsed).toBe(false);
  });

  it('an enrolment with a period uses the PERIOD END', async () => {
    const her = await makeBeneficiary('بفترة');
    const year = await prisma.academicYear.create({ data: { label: YEAR_LABEL } });
    const period = await prisma.academicPeriod.create({
      data: {
        academicYearId: year.id,
        sequence: 1,
        startDate: day(`${RUN_YEAR}-09-01`),
        endDate: day(`${RUN_YEAR + 1}-06-30`),
      },
    });
    await prisma.enrollment.create({
      data: {
        studentId: her,
        administrativeGroupId: groupId,
        levelId,
        branchId,
        academicPeriodId: period.id,
      },
    });

    const report = await retentionFor(prisma, her, day(`${RUN_YEAR + 2}-01-01`));
    expect(report.lastActivityKind).toBe('enrolment_period_end');
    expect(report.lastActivityAt?.toISOString()).toBe(day(`${RUN_YEAR + 1}-06-30`).toISOString());
    expect(report.retainUntil?.toISOString()).toBe(day(`${RUN_YEAR + 11}-06-30`).toISOString());
  });

  it('a LEGACY enrolment with no period falls back to the enrolment instant', async () => {
    // R122 left historical rows without a period deliberately; guessing a
    // semester the association never recorded would be indistinguishable from a
    // real one.
    const her = await makeBeneficiary('بلا فترة');
    const enrolment = await prisma.enrollment.create({
      data: { studentId: her, administrativeGroupId: groupId, levelId, branchId },
    });
    const report = await retentionFor(prisma, her, day('2030-01-01'));
    expect(report.lastActivityKind).toBe('enrolment_instant');
    expect(report.lastActivityAt?.toISOString()).toBe(enrolment.enrolledAt.toISOString());
  });

  it('a NEWER grade beats an older enrolment — the latest fact wins', async () => {
    const her = await makeBeneficiary('نقطة أحدث');
    await prisma.enrollment.create({
      data: { studentId: her, administrativeGroupId: groupId, levelId, branchId },
    });
    const examId = await makeExam('2914-05-20');
    await prisma.grade.create({
      data: { examId, studentId: her, score: 15, status: 'published', publishedAt: new Date() },
    });

    const report = await retentionFor(prisma, her, day('2915-01-01'));
    expect(report.lastActivityKind).toBe('grade_exam_date');
    expect(report.retainUntil?.toISOString()).toBe(day('2924-05-20').toISOString());
  });

  it('attendance, a submission and a Quran entry each win when they are the latest', async () => {
    const attendee = await makeBeneficiary('حضور');
    const examId = await makeExam('2913-01-10');
    await prisma.attendance.create({
      data: {
        examId,
        occurrenceDate: day('2916-03-03'),
        studentId: attendee,
        markedById: staffId,
      },
    });
    expect((await retentionFor(prisma, attendee, day('2917-01-01'))).lastActivityKind).toBe(
      'attendance',
    );

    const submitter = await makeBeneficiary('ورقة');
    await prisma.studentExamSubmission.create({
      data: {
        examId,
        studentId: submitter,
        state: 'submitted',
        startedAt: day('2917-04-01'),
        submittedAt: day('2917-04-02'),
      },
    });
    const sub = await retentionFor(prisma, submitter, day('2918-01-01'));
    expect(sub.lastActivityKind).toBe('assessment_submission');
    expect(sub.lastActivityAt?.toISOString()).toBe(day('2917-04-02').toISOString());

    const reciter = await makeBeneficiary('حفظ');
    await prisma.quranProgressLog.create({
      data: {
        studentId: reciter,
        loggedById: staffId,
        surahId: 1,
        startAyah: 1,
        endAyah: 7,
        category: 'new_memorization',
        loggedAt: day('2918-08-08'),
      },
    });
    expect((await retentionFor(prisma, reciter, day('2919-01-01'))).lastActivityKind).toBe(
      'quran_progress',
    );
  });

  it('an unsubmitted draft falls back to when she STARTED it', async () => {
    const her = await makeBeneficiary('مسودة');
    const examId = await makeExam('2913-01-10');
    await prisma.studentExamSubmission.create({
      data: {
        examId,
        studentId: her,
        state: 'in_progress',
        startedAt: day('2920-02-02'),
      },
    });
    const report = await retentionFor(prisma, her, day('2921-01-01'));
    expect(report.lastActivityAt?.toISOString()).toBe(day('2920-02-02').toISOString());
  });

  it('a SOFT-DELETED enrolment still counts — history, not the live roster', async () => {
    /**
     * A withdrawn enrolment still records that she was there. Counting only live
     * rows would shorten the retention period on the strength of an
     * administrative correction, which is precisely the accident §4.10a's
     * derivation exists to avoid.
     */
    const her = await makeBeneficiary('انسحبت');
    await prisma.enrollment.create({
      data: {
        studentId: her,
        administrativeGroupId: groupId,
        levelId,
        branchId,
        deletedAt: new Date(),
      },
    });
    const report = await retentionFor(prisma, her, day('2030-01-01'));
    expect(report.lastActivityAt).not.toBeNull();
    expect(report.lastActivityKind).toBe('enrolment_instant');
  });
});

describe('the boundary itself', () => {
  async function withGradeOn(iso: string): Promise<string> {
    const her = await makeBeneficiary(`نقطة ${iso}`);
    const examId = await makeExam(iso);
    await prisma.grade.create({
      data: { examId, studentId: her, score: 12, status: 'published', publishedAt: new Date() },
    });
    return her;
  }

  it('EXACTLY ten years later has not elapsed — the day itself is still retained', async () => {
    const her = await withGradeOn('2910-06-01');
    const onTheDay = await retentionFor(prisma, her, day('2920-06-01'));
    expect(onTheDay.retainUntil?.toISOString()).toBe(day('2920-06-01').toISOString());
    expect(onTheDay.elapsed).toBe(false);
  });

  it('one day before has not elapsed, and one day after has', async () => {
    const her = await withGradeOn('2910-06-01');
    expect((await retentionFor(prisma, her, day('2920-05-31'))).elapsed).toBe(false);
    expect((await retentionFor(prisma, her, day('2920-06-02'))).elapsed).toBe(true);
  });

  it('an INACTIVE account with recent activity is still within its period', async () => {
    // Account state is not educational activity: a suspended or closed account
    // whose last lesson was last year is retained exactly as long as any other.
    const her = await withGradeOn('2919-01-01');
    await prisma.user.update({ where: { id: her }, data: { accountStatus: 'suspended' } });
    expect((await retentionFor(prisma, her, day('2920-01-01'))).elapsed).toBe(false);
  });

  it('`updated_at` plays no part — touching a row does not extend retention', async () => {
    /**
     * The rule §4.10a exists to prevent. A row's `updated_at` moves when
     * somebody fixes a typo, and a clock driven by it would retain records for a
     * decade after an edit that taught nobody anything.
     */
    const her = await withGradeOn('2905-06-01');
    const before = await retentionFor(prisma, her, day('2916-01-01'));
    expect(before.elapsed).toBe(true);

    // Touch the row: `updated_at` moves, the answer must not.
    await prisma.user.update({ where: { id: her }, data: { nickname: 'لقب' } });
    const after = await retentionFor(prisma, her, day('2916-01-01'));
    expect(after.retainUntil?.toISOString()).toBe(before.retainUntil?.toISOString());
    expect(after.elapsed).toBe(true);
  });

  it('the policy constant is ten years', () => {
    expect(EDUCATIONAL_RETENTION_YEARS).toBe(10);
  });
});

describe('the dry run reports and deletes nothing', () => {
  it('lists elapsed beneficiaries with the deciding fact, and touches no row', async () => {
    const elapsed = await makeBeneficiary('انقضت');
    const examOld = await makeExam('2900-01-01');
    await prisma.grade.create({
      data: { examId: examOld, studentId: elapsed, score: 10, status: 'published', publishedAt: new Date() },
    });
    const current = await makeBeneficiary('سارية');
    const examNew = await makeExam('2919-01-01');
    await prisma.grade.create({
      data: { examId: examNew, studentId: current, score: 10, status: 'published', publishedAt: new Date() },
    });

    const before = await prisma.grade.count();
    const report = await elapsedRetentionReport(prisma, day('2915-01-01'));

    const mine = report.find((r) => r.studentId === elapsed);
    expect(mine).toBeDefined();
    expect(mine!.lastActivityKind).toBe('grade_exam_date');
    expect(report.map((r) => r.studentId)).not.toContain(current);

    // The whole point of a dry run.
    expect(await prisma.grade.count()).toBe(before);
    expect(await prisma.user.count({ where: { id: elapsed } })).toBe(1);
  });
});
