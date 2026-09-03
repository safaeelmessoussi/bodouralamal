/**
 * The R123 attendance scenario: one class occurrence with a register, one عطلة
 * on the same day, and one enrolled beneficiary to mark.
 *
 * Built here rather than driven through the forms because the harness verifies
 * **the register reaching the page**, not the scheduling form — and re-driving
 * that form each run would make a failure ambiguous between two features. It
 * prints the month the calendar must open on, and `--clean` removes exactly the
 * rows it made, by its own tag. **It sweeps nothing it does not own.**
 */
import { createPrismaClient } from '../src/lib/prisma.js';

const TAG = '[attguard]';
const url = process.env['DATABASE_URL'];
if (!url) throw new Error('DATABASE_URL is required');
const prisma = createPrismaClient(url);

/** A date inside the current month, so the calendar opens on it by default. */
const today = new Date();
const DAY = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 15));
const MONTH = `${DAY.getUTCFullYear()}-${String(DAY.getUTCMonth() + 1).padStart(2, '0')}`;
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
  const events = await prisma.event.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true },
  });
  const eventIds = events.map((e) => e.id);
  await prisma.attendance.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.eventBranch.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.eventStaff.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.event.deleteMany({ where: { id: { in: eventIds } } });

  const schedules = await prisma.recurringCourseSchedule.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true },
  });
  const scheduleIds = schedules.map((s) => s.id);
  const sessions = await prisma.session.findMany({
    where: { scheduleId: { in: scheduleIds } },
    select: { id: true },
  });
  const sessionIds = sessions.map((s) => s.id);
  await prisma.attendance.deleteMany({ where: { sessionId: { in: sessionIds } } });
  await prisma.sessionStaff.deleteMany({ where: { sessionId: { in: sessionIds } } });
  await prisma.session.deleteMany({ where: { id: { in: sessionIds } } });
  await prisma.courseScheduleStaff.deleteMany({ where: { scheduleId: { in: scheduleIds } } });
  await prisma.recurringCourseSchedule.deleteMany({ where: { id: { in: scheduleIds } } });

  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  await prisma.attendance.deleteMany({ where: { studentId: { in: userIds } } });
  await prisma.attendance.deleteMany({ where: { markedById: { in: userIds } } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.enrollment.deleteMany({ where: { studentId: { in: userIds } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });

  await prisma.administrativeGroup.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.levelSubject.deleteMany({ where: { level: { name: { startsWith: TAG } } } });
  await prisma.level.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.subject.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.room.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.schedulingType.deleteMany({ where: { name: { startsWith: TAG } } });
  const years = await prisma.academicYear.findMany({
    where: { label: `${DAY.getUTCFullYear() + 70}-${DAY.getUTCFullYear() + 71}` },
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
  const category = await prisma.category.create({
    data: { name: `${TAG} فئة`, selfAttendanceAllowed: true },
  });
  const level = await prisma.level.create({
    data: { name: `${TAG} مستوى`, categoryId: category.id, genderRestriction: 'any' },
  });
  const group = await prisma.administrativeGroup.create({
    data: { name: `${TAG} مجموعة`, levelId: level.id, branchId: branch.id },
  });

  const year = await prisma.academicYear.create({
    data: { label: `${DAY.getUTCFullYear() + 70}-${DAY.getUTCFullYear() + 71}` },
  });
  const period = await prisma.academicPeriod.create({
    data: {
      academicYearId: year.id,
      sequence: 1,
      startDate: new Date(Date.UTC(DAY.getUTCFullYear(), 0, 1)),
      endDate: new Date(Date.UTC(DAY.getUTCFullYear(), 11, 31)),
    },
  });

  const student = await prisma.user.create({
    data: {
      nameArabic: `${TAG} مستفيدة`,
      sex: 'female',
      accountStatus: 'active',
      isBeneficiary: true,
    },
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

  const classType = await prisma.schedulingType.create({
    data: {
      name: `${TAG} حصة دراسية`,
      structuralKind: 'class',
      attendanceMode: 'required',
      displayOrder: 950,
    },
  });
  const holidayType = await prisma.schedulingType.create({
    data: {
      name: `${TAG} عطلة`,
      structuralKind: 'holiday',
      attendanceMode: 'disabled',
      displayOrder: 951,
    },
  });

  const schedule = await prisma.recurringCourseSchedule.create({
    data: {
      title: `${TAG} حصة`,
      subjectId: subject.id,
      schedulingTypeId: classType.id,
      teachingMode: 'administrative_group',
      administrativeGroupId: group.id,
      branchId: branch.id,
      startTime: time('09:00'),
      endTime: time('10:00'),
      recurrence: 'weekly',
      weekdays: [WEEKDAYS[DAY.getUTCDay()]!],
      anchorDate: DAY,
      academicYearId: year.id,
    },
  });
  await prisma.session.create({
    data: {
      scheduleId: schedule.id,
      date: DAY,
      startTime: time('09:00'),
      endTime: time('10:00'),
    },
  });

  await prisma.event.create({
    data: {
      title: `${TAG} عطلة العيد`,
      schedulingTypeId: holidayType.id,
      startDate: DAY,
      recurrenceType: 'none',
      branchScopes: { create: [{ branchId: branch.id }] },
    },
  });

  process.stdout.write(`${JSON.stringify({ month: MONTH, student: student.id })}\n`);
  await prisma.$disconnect();
}

await main();
