/**
 * **The manual flow's fixture** — the association's own shape, tagged.
 *
 * المرأة · وميض الأمل · تفسير · Targa, with a second branch so R92's combined
 * occurrence can be driven on the same data, and a replacement period so R91's
 * effective staffing decides who is told.
 *
 * Created through the SERVICES, never with raw inserts: materialization is what
 * writes the occurrences and their staffing snapshots, and a fixture that
 * bypasses the write path tests something the platform does not do.
 */
import { loadConfig } from '../src/lib/config.js';
import { createPrismaClient } from '../src/lib/prisma.js';
import { createCourseSchedule } from '../src/services/course-schedule.service.js';

const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL);
const TAG = '[notify]';

const day = (offset: number): Date => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
};

async function wipe(): Promise<void> {
  const schedules = await prisma.recurringCourseSchedule.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = schedules.map((s) => s.id);
  const sessions = await prisma.session.findMany({
    where: { scheduleId: { in: ids } },
    select: { id: true },
  });
  const sids = sessions.map((s) => s.id);
  await prisma.sessionAudienceBranch.deleteMany({ where: { sessionId: { in: sids } } });
  await prisma.notification.deleteMany({ where: { sessionId: { in: sids } } });
  await prisma.sessionStaff.deleteMany({ where: { sessionId: { in: sids } } });
  await prisma.session.deleteMany({ where: { id: { in: sids } } });
  await prisma.courseScheduleStaff.deleteMany({ where: { scheduleId: { in: ids } } });
  await prisma.recurringCourseSchedule.deleteMany({ where: { id: { in: ids } } });

  const exams = await prisma.exam.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true },
  });
  const examIds = exams.map((e) => e.id);
  await prisma.notification.deleteMany({ where: { examId: { in: examIds } } });
  await prisma.grade.deleteMany({ where: { examId: { in: examIds } } });
  await prisma.examStaff.deleteMany({ where: { examId: { in: examIds } } }).catch(() => undefined);
  await prisma.exam.deleteMany({ where: { id: { in: examIds } } });

  const events = await prisma.event.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true },
  });
  const eventIds = events.map((e) => e.id);
  await prisma.notification.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.eventBranch.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.eventCategory.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.eventLevel.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.eventStaff.deleteMany({ where: { eventId: { in: eventIds } } }).catch(() => undefined);
  await prisma.event.deleteMany({ where: { id: { in: eventIds } } });

  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const uids = users.map((u) => u.id);
  /**
   * **Schedules these people STAFF, whatever they are called.**
   *
   * The harnesses that use this fixture create a class through the real
   * scheduling form, so the title is whatever was typed — not this file's TAG.
   * Wiping by title therefore left `course_schedule_staff` rows behind, and the
   * RESTRICT on `user` then made the NEXT run of the seed fail at
   * `user.deleteMany` with a foreign-key error that names neither the schedule
   * nor the harness that made it.
   *
   * Keyed on the USER, which is the thing this fixture actually owns.
   */
  const staffedScheduleIds = (
    await prisma.courseScheduleStaff.findMany({
      where: { userId: { in: uids } },
      select: { scheduleId: true },
    })
  ).map((r) => r.scheduleId);
  if (staffedScheduleIds.length > 0) {
    const staffedSessions = await prisma.session.findMany({
      where: { scheduleId: { in: staffedScheduleIds } },
      select: { id: true },
    });
    const ssids = staffedSessions.map((r) => r.id);
    await prisma.sessionAudienceBranch.deleteMany({ where: { sessionId: { in: ssids } } });
    await prisma.sessionContent.deleteMany({ where: { sessionId: { in: ssids } } });
    await prisma.notification.deleteMany({ where: { sessionId: { in: ssids } } });
    await prisma.sessionStaff.deleteMany({ where: { sessionId: { in: ssids } } });
    await prisma.session.deleteMany({ where: { id: { in: ssids } } });
    await prisma.courseScheduleStaff.deleteMany({
      where: { scheduleId: { in: staffedScheduleIds } },
    });
    await prisma.recurringCourseSchedule.deleteMany({
      where: { id: { in: staffedScheduleIds } },
    });
  }

  await prisma.notification.deleteMany({ where: { userId: { in: uids } } });
  await prisma.enrollment.deleteMany({ where: { studentId: { in: uids } } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: uids } } });
  await prisma.auditLog.deleteMany({ where: { targetId: { in: uids } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: uids } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: uids } } });
  await prisma.user.deleteMany({ where: { id: { in: uids } } });

  await prisma.enrollment.deleteMany({
    where: { administrativeGroup: { name: { startsWith: TAG } } },
  });
  await prisma.administrativeGroup.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.levelSubject.deleteMany({ where: { subject: { name: { startsWith: TAG } } } });
  await prisma.subject.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.room.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.level.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
}

await wipe();
if (process.argv.includes('--clean')) {
  await prisma.$disconnect();
  process.exit(0);
}

const targa = await prisma.branch.create({ data: { name: `${TAG} تاركة` } });
const second = await prisma.branch.create({ data: { name: `${TAG} الفرع الثاني` } });
const category = await prisma.category.create({
  data: { name: `${TAG} المرأة`, displayOrder: 100 },
});
const level = await prisma.level.create({
  data: { name: `${TAG} وميض الأمل`, categoryId: category.id, genderRestriction: 'any' },
});
const subject = await prisma.subject.create({ data: { name: `${TAG} تفسير`, displayOrder: 100 } });
await prisma.levelSubject.create({ data: { levelId: level.id, subjectId: subject.id } });
const room = await prisma.room.create({
  data: { name: `${TAG} قاعة`, branchId: targa.id, capacity: 30 },
});
const year = await prisma.academicYear.findFirstOrThrow();
const teacherRole = await prisma.role.findFirstOrThrow({ where: { name: 'teacher' } });
const studentRole = await prisma.role.findFirstOrThrow({ where: { name: 'student' } });

async function person(label: string, roleId: string, beneficiary = false): Promise<string> {
  const user = await prisma.user.create({
    data: {
      nameArabic: `${TAG} ${label}`,
      sex: 'female',
      accountStatus: 'active',
      isBeneficiary: beneficiary,
    },
  });
  await prisma.userBranchRole.create({ data: { userId: user.id, roleId, branchId: null } });
  return user.id;
}

const safa = await person('صفاء', teacherRole.id);
const amina = await person('أمينة', teacherRole.id);
const nadia = await person('نادية', teacherRole.id);
const studentA = await person('الطالبة أ', studentRole.id, true);
const studentB = await person('الطالبة ب', studentRole.id, true);
const studentC = await person('الطالبة ج', studentRole.id, true);
await prisma.enrollment.create({ data: { studentId: studentA, levelId: level.id, branchId: targa.id } });
await prisma.enrollment.create({ data: { studentId: studentB, levelId: level.id, branchId: second.id } });
// C is enrolled at Targa in ANOTHER Level, so she is a real beneficiary who is
// simply not concerned — a stronger negative than somebody with no enrolment.
const otherLevel = await prisma.level.create({
  data: { name: `${TAG} مستوى آخر`, categoryId: category.id, genderRestriction: 'any' },
});
await prisma.enrollment.create({
  data: { studentId: studentC, levelId: otherLevel.id, branchId: targa.id },
});

const actor = {
  userId: (
    await prisma.userBranchRole.findFirstOrThrow({
      where: { deletedAt: null, role: { name: 'super_admin' } },
      select: { userId: true },
    })
  ).userId,
  roleScopes: [{ role: 'super_admin', branches: null }],
} as unknown as Parameters<typeof createCourseSchedule>[1];

const base = {
  subjectId: subject.id,
  teachingMode: 'entire_level' as const,
  targetId: level.id,
  academicYearId: year.id,
  startTime: new Date('1970-01-01T15:00:00Z'),
  endTime: new Date('1970-01-01T18:00:00Z'),
  recurrence: 'weekly',
  weekdays: ['thursday'],
  anchorDate: day(-7),
};

/**
 * **R91 — Safa now, Amina for a bounded future window, Safa again after.**
 * Whichever occurrence the harness cancels inside that window must reach Amina
 * and not Safa.
 */
const targaClass = await createCourseSchedule(prisma, actor, {
  ...base,
  title: `${TAG} تفسير تاركة`,
  branchId: targa.id,
  roomId: room.id,
  staff: [
    { userId: safa, position: 'teacher', effectiveUntil: day(20) },
    { userId: amina, position: 'teacher', effectiveFrom: day(21), effectiveUntil: day(60) },
    { userId: nadia, position: 'assistant', effectiveFrom: day(21), effectiveUntil: day(60) },
    { userId: safa, position: 'teacher', effectiveFrom: day(61) },
  ],
});
const secondClass = await createCourseSchedule(prisma, actor, {
  ...base,
  title: `${TAG} تفسير الفرع الثاني`,
  branchId: second.id,
  staff: [{ userId: nadia, position: 'teacher', effectiveUntil: day(20) }],
});

/**
 * **A group Safa teaches**, because TD-2 grants a مؤطرة event scope over the
 * Administrative Groups she teaches and nothing wider (R72). Without one she
 * cannot create an activity at all — correct behaviour, and a fixture that
 * omitted it made a working rule look like a broken form.
 */
const group = await prisma.administrativeGroup.create({
  data: { name: `${TAG} المجموعة 1`, levelId: level.id, branchId: targa.id },
  select: { id: true },
});
const groupClass = await createCourseSchedule(prisma, actor, {
  ...base,
  title: `${TAG} حصة المجموعة`,
  branchId: targa.id,
  teachingMode: 'administrative_group' as const,
  targetId: group.id,
  weekdays: ['monday'],
  startTime: new Date('1970-01-01T09:00:00Z'),
  endTime: new Date('1970-01-01T10:00:00Z'),
  staff: [{ userId: safa, position: 'teacher' }],
});

const upcoming = await prisma.session.findMany({
  where: { scheduleId: targaClass.id, deletedAt: null, date: { gt: day(0) } },
  orderBy: { date: 'asc' },
  select: { id: true, date: true },
});
/** The first future occurrence — cancelled with NO reason. */
const first = upcoming[0]!;
/** The second — rescheduled. */
const secondOcc = upcoming[1]!;
/** One inside Amina's replacement window — R91's recipient test. */
const inReplacement = upcoming.find((s) => s.date > day(21) && s.date <= day(60))!;
/** One more, for R92's combined audience. */
const combinable = upcoming.find(
  (s) => s.id !== first.id && s.id !== secondOcc.id && s.id !== inReplacement.id,
)!;
/** A spare, so the cross-branch case is driven on an occurrence nothing else touched. */
const spare = upcoming.find(
  (s) =>
    s.id !== first.id &&
    s.id !== secondOcc.id &&
    s.id !== inReplacement.id &&
    s.id !== combinable.id,
)!;

/**
 * **An exam, so the grade-publish notice is driven through its own screen.**
 * Draft must tell nobody; publishing must tell exactly the student it is about
 * (R82.4, BR-8).
 */
const exam = await prisma.exam.create({
  data: {
    title: `${TAG} امتحان التفسير`,
    mode: 'physical',
    subjectId: subject.id,
    levelId: level.id,
    branchId: targa.id,
    // `exam_physical_place_all_or_none_check` — a physical sitting states its
    // whole place or none of it: branch, room and both times together.
    roomId: room.id,
    academicYearId: year.id,
    date: day(3),
    startTime: new Date('1970-01-01T09:00:00Z'),
    endTime: new Date('1970-01-01T10:00:00Z'),
    maxGrade: 20,
    // R58/R81 — a physical sitting is organised in the platform and carries no
    // question set; the column is a required JSON, so an empty list says so.
    questions: [],
  },
  select: { id: true },
});

console.log(
  JSON.stringify({
    targaSchedule: targaClass.id,
    secondSchedule: secondClass.id,
    level: level.id,
    subject: subject.id,
    targa: targa.id,
    second: second.id,
    safa,
    amina,
    nadia,
    studentA,
    studentB,
    studentC,
    first: first.id,
    firstDate: first.date.toISOString().slice(0, 10),
    secondOcc: secondOcc.id,
    secondDate: secondOcc.date.toISOString().slice(0, 10),
    inReplacement: inReplacement.id,
    inReplacementDate: inReplacement.date.toISOString().slice(0, 10),
    group: group.id,
    groupSchedule: groupClass.id,
    combinable: combinable.id,
    combinableDate: combinable.date.toISOString().slice(0, 10),
    spare: spare.id,
    spareDate: spare.date.toISOString().slice(0, 10),
    exam: exam.id,
  }),
);
await prisma.$disconnect();
