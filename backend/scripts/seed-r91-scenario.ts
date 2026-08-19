/**
 * **The temporary replacement, as a fixture** (R91 §24).
 *
 * Women · Level 1 · Tafseer · Branch Targa · Thursday 15:00–18:00 — the Owner's
 * own case. **Every date is relative to today**, so the scenario never rots into
 * a past-date conflict, and the ids are printed so the harness identifies rows
 * by id rather than by title.
 *
 *   Safa   ── open ──▶ day+29
 *   Amina                day+30 ──▶ day+60
 *   Safa                             day+61 ──▶ open
 */
import { loadConfig } from '../src/lib/config.js';
import { createPrismaClient } from '../src/lib/prisma.js';
import { createCourseSchedule } from '../src/services/course-schedule.service.js';

const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL);
const TAG = '[r91-replacement]';

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
  await prisma.sessionStaff.deleteMany({ where: { session: { scheduleId: { in: ids } } } });
  await prisma.notification.deleteMany({ where: { session: { scheduleId: { in: ids } } } });
  await prisma.session.deleteMany({ where: { scheduleId: { in: ids } } });
  await prisma.courseScheduleStaff.deleteMany({ where: { scheduleId: { in: ids } } });
  await prisma.recurringCourseSchedule.deleteMany({ where: { id: { in: ids } } });

  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const uids = users.map((u) => u.id);
  await prisma.notification.deleteMany({ where: { userId: { in: uids } } });
  await prisma.enrollment.deleteMany({ where: { studentId: { in: uids } } });
  await prisma.teacherSubjectCapability.deleteMany({ where: { userId: { in: uids } } });
  await prisma.teacherAvailability.deleteMany({ where: { userId: { in: uids } } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: uids } } });
  await prisma.auditLog.deleteMany({ where: { targetId: { in: uids } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: uids } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: uids } } });
  await prisma.user.deleteMany({ where: { id: { in: uids } } });

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

const branch = await prisma.branch.create({ data: { name: `${TAG} تاركة` } });
const category = await prisma.category.create({
  data: { name: `${TAG} المرأة`, displayOrder: 98 },
});
const level = await prisma.level.create({
  data: { name: `${TAG} المستوى 1`, categoryId: category.id, genderRestriction: 'any' },
});
// Marked as a Quran Subject, so §15's boundary is visible on the same fixture.
const subject = await prisma.subject.create({
  data: { name: `${TAG} تفسير`, displayOrder: 98, tracksQuranProgress: true },
});
await prisma.levelSubject.create({ data: { levelId: level.id, subjectId: subject.id } });
const room = await prisma.room.create({
  data: { name: `${TAG} قاعة`, branchId: branch.id, capacity: 20 },
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
  await prisma.userBranchRole.create({
    data: { userId: user.id, roleId, branchId: null },
  });
  return user.id;
}

const safa = await person('صفاء', teacherRole.id);
const amina = await person('أمينة', teacherRole.id);
const helper = await person('مساعدة', teacherRole.id);
const student = await person('مستفيدة', studentRole.id, true);
await prisma.enrollment.create({ data: { studentId: student, levelId: level.id, branchId: branch.id } });

/**
 * **Created through the SERVICE, not with a raw insert.**
 *
 * A `prisma.create` leaves the schedule with no occurrences at all, because
 * materialization lives in the service — and the whole thing this fixture must
 * show is that materialization snapshots each occurrence with the staff
 * effective on its own date. A seed that wrote the Sessions by hand would be
 * re-implementing the behaviour under test.
 */
const superAdmin = await prisma.userBranchRole.findFirstOrThrow({
  where: { deletedAt: null, role: { name: 'super_admin' } },
  select: { userId: true },
});
const actor = {
  userId: superAdmin.userId,
  roleScopes: [{ role: 'super_admin', branches: null }],
} as unknown as Parameters<typeof createCourseSchedule>[1];

const created = await createCourseSchedule(prisma, actor, {
  title: `${TAG} تفسير المستوى 1`,
  subjectId: subject.id,
  teachingMode: 'entire_level',
  targetId: level.id,
  branchId: branch.id,
  roomId: room.id,
  academicYearId: year.id,
  startTime: new Date('1970-01-01T15:00:00Z'),
  endTime: new Date('1970-01-01T18:00:00Z'),
  recurrence: 'weekly',
  weekdays: ['thursday'],
  anchorDate: day(-60),
  /** The replacement, as three rows — two of them Safa's. */
  staff: [
    { userId: safa, position: 'teacher', effectiveUntil: day(29) },
    { userId: amina, position: 'teacher', effectiveFrom: day(30), effectiveUntil: day(60) },
    { userId: safa, position: 'teacher', effectiveFrom: day(61) },
    { userId: helper, position: 'assistant' },
  ],
});
const schedule = { id: created.id };

/**
 * **A past occurrence, so history has something to preserve.** The horizon only
 * materializes forward, and the rule R91 must never break is about what already
 * happened.
 */
const pastDate = day(-7);
pastDate.setUTCDate(pastDate.getUTCDate() - ((pastDate.getUTCDay() + 3) % 7));
const pastSession = await prisma.session.create({
  data: {
    scheduleId: created.id,
    date: pastDate,
    startTime: new Date('1970-01-01T15:00:00Z'),
    endTime: new Date('1970-01-01T18:00:00Z'),
    status: 'held',
  },
  select: { id: true },
});
await prisma.sessionStaff.create({
  data: { sessionId: pastSession.id, userId: safa, position: 'teacher' },
});

console.log(
  JSON.stringify({
    schedule: schedule.id,
    branch: branch.id,
    level: level.id,
    subject: subject.id,
    safa,
    amina,
    helper,
    student,
    replaceFrom: day(30).toISOString().slice(0, 10),
    replaceUntil: day(60).toISOString().slice(0, 10),
  }),
);
await prisma.$disconnect();
