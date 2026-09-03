/**
 * The R124 assessment scenario: one مؤطِّرة who teaches a Level, one beneficiary
 * enrolled in it for a period covering today, and the curriculum behind them.
 *
 * Built here rather than driven through the forms because the harness verifies
 * **the builder and the student's paper reaching the page**, not registration or
 * scheduling — and re-driving those each run would make a failure ambiguous
 * between three features. It prints the ids the harness needs, and `--clean`
 * removes exactly the rows it made, by its own tag. **It sweeps nothing it does
 * not own.**
 */
import { createPrismaClient } from '../src/lib/prisma.js';

const TAG = '[asmguard]';
const url = process.env['DATABASE_URL'];
if (!url) throw new Error('DATABASE_URL is required');
const prisma = createPrismaClient(url);

const today = new Date();
const YEAR = today.getUTCFullYear();
const DAY = new Date(Date.UTC(YEAR, today.getUTCMonth(), 15));
const YEAR_LABEL = `${YEAR + 90}-${YEAR + 91}`;
const time = (hhmm: string): Date => new Date(`1970-01-01T${hhmm}:00.000Z`);
const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

async function wipe(): Promise<void> {
  const exams = await prisma.exam.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true },
  });
  const examIds = exams.map((e) => e.id);
  const submissions = await prisma.studentExamSubmission.findMany({
    where: { examId: { in: examIds } },
    select: { id: true },
  });
  const answers = await prisma.studentExamAnswer.findMany({
    where: { submissionId: { in: submissions.map((s) => s.id) } },
    select: { id: true },
  });
  await prisma.studentExamAnswerOption.deleteMany({
    where: { answerId: { in: answers.map((a) => a.id) } },
  });
  await prisma.studentExamAnswer.deleteMany({ where: { id: { in: answers.map((a) => a.id) } } });
  await prisma.studentExamSubmission.deleteMany({ where: { examId: { in: examIds } } });
  await prisma.notification.deleteMany({ where: { examId: { in: examIds } } });
  await prisma.attendance.deleteMany({ where: { examId: { in: examIds } } });
  await prisma.grade.deleteMany({ where: { examId: { in: examIds } } });
  const questions = await prisma.examQuestion.findMany({
    where: { examId: { in: examIds } },
    select: { id: true },
  });
  await prisma.examQuestionOption.deleteMany({
    where: { questionId: { in: questions.map((q) => q.id) } },
  });
  await prisma.examQuestion.deleteMany({ where: { examId: { in: examIds } } });
  await prisma.examStaff.deleteMany({ where: { examId: { in: examIds } } });
  await prisma.exam.deleteMany({ where: { id: { in: examIds } } });

  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.trash.deleteMany({ where: { deletedById: { in: userIds } } });
  await prisma.sessionStaff.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.courseScheduleStaff.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.session.deleteMany({ where: { schedule: { title: { startsWith: TAG } } } });
  await prisma.recurringCourseSchedule.deleteMany({ where: { title: { startsWith: TAG } } });
  await prisma.enrollment.deleteMany({ where: { studentId: { in: userIds } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });

  await prisma.administrativeGroup.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.levelSubject.deleteMany({ where: { level: { name: { startsWith: TAG } } } });
  await prisma.level.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.subject.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
  const years = await prisma.academicYear.findMany({
    where: { label: YEAR_LABEL },
    select: { id: true },
  });
  await prisma.academicPeriod.deleteMany({
    where: { academicYearId: { in: years.map((y) => y.id) } },
  });
  await prisma.academicYear.deleteMany({ where: { id: { in: years.map((y) => y.id) } } });
}

async function main(): Promise<void> {
  await wipe();
  if (process.argv.includes('--clean')) {
    await prisma.$disconnect();
    return;
  }

  const branch = await prisma.branch.create({ data: { name: `${TAG} فرع` } });
  const subject = await prisma.subject.create({ data: { name: `${TAG} مادة` } });
  const category = await prisma.category.create({ data: { name: `${TAG} فئة` } });
  const level = await prisma.level.create({
    data: { name: `${TAG} مستوى`, categoryId: category.id, genderRestriction: 'any' },
  });
  await prisma.levelSubject.create({ data: { levelId: level.id, subjectId: subject.id } });
  const group = await prisma.administrativeGroup.create({
    data: { name: `${TAG} مجموعة`, levelId: level.id, branchId: branch.id },
  });

  const year = await prisma.academicYear.create({ data: { label: YEAR_LABEL } });
  const period = await prisma.academicPeriod.create({
    data: {
      academicYearId: year.id,
      sequence: 1,
      startDate: new Date(Date.UTC(YEAR, 0, 1)),
      endDate: new Date(Date.UTC(YEAR, 11, 31)),
    },
  });

  const teacherRole = await prisma.role.findFirstOrThrow({ where: { name: 'teacher' } });
  const studentRole = await prisma.role.findFirstOrThrow({ where: { name: 'student' } });

  const teacher = await prisma.user.create({
    data: { nameArabic: `${TAG} مؤطرة`, sex: 'female', accountStatus: 'active' },
  });
  await prisma.userBranchRole.create({
    data: { userId: teacher.id, roleId: teacherRole.id, branchId: branch.id },
  });

  const student = await prisma.user.create({
    data: {
      nameArabic: `${TAG} مستفيدة`,
      sex: 'female',
      accountStatus: 'active',
      isBeneficiary: true,
    },
  });
  await prisma.userBranchRole.create({
    data: { userId: student.id, roleId: studentRole.id, branchId: branch.id },
  });
  await prisma.enrollment.create({
    data: {
      studentId: student.id,
      levelId: level.id,
      branchId: branch.id,
      administrativeGroupId: group.id,
      academicPeriodId: period.id,
    },
  });

  // **She must actually teach this Level**, or `assertExamInTeacherScope` refuses
  // her — which is the authority the new `/teacher/assessments` node exposes.
  await prisma.recurringCourseSchedule.create({
    data: {
      title: `${TAG} حصة`,
      subjectId: subject.id,
      teachingMode: 'administrative_group',
      administrativeGroupId: group.id,
      branchId: branch.id,
      startTime: time('09:00'),
      endTime: time('10:00'),
      recurrence: 'weekly',
      weekdays: [WEEKDAYS[DAY.getUTCDay()]!],
      anchorDate: DAY,
      academicYearId: year.id,
      staff: { create: [{ userId: teacher.id, position: 'teacher' }] },
    },
  });

  process.stdout.write(
    `${JSON.stringify({
      teacher: teacher.id,
      student: student.id,
      levelId: level.id,
      subjectId: subject.id,
      academicYearId: year.id,
      date: DAY.toISOString().slice(0, 10),
    })}\n`,
  );
  await prisma.$disconnect();
}

await main();
