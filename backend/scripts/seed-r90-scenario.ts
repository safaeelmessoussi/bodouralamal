/**
 * **The staff picker's five teachers** (R90).
 *
 * Each one is shaped to isolate exactly one appraisal, so a browser run can show
 * that an administrator can tell them apart — and then that she can assign any
 * of them regardless.
 *
 * | | Subject | Category | Availability | Other class |
 * |---|---|---|---|---|
 * | أ | declared | declared | covers the class | none |
 * | ب | declared | declared | mornings only | none |
 * | ج | **not** declared | declared | covers the class | none |
 * | د | declared | declared | covers the class | **clashing** |
 * | هـ | — | — | — | none |
 *
 * Its own reference data throughout: a fixture that borrows whichever row sorts
 * first in the development database asserts something nobody chose, which is
 * how `verify-portals` came to read a correct behaviour as a defect.
 */
import { loadConfig } from '../src/lib/config.js';
import { createPrismaClient } from '../src/lib/prisma.js';

const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL);
const TAG = '[r90-picker]';

async function wipe(): Promise<void> {
  const schedules = await prisma.recurringCourseSchedule.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true },
  });
  const scheduleIds = schedules.map((s) => s.id);
  await prisma.sessionStaff.deleteMany({ where: { session: { scheduleId: { in: scheduleIds } } } });
  await prisma.session.deleteMany({ where: { scheduleId: { in: scheduleIds } } });
  await prisma.courseScheduleStaff.deleteMany({ where: { scheduleId: { in: scheduleIds } } });
  await prisma.recurringCourseSchedule.deleteMany({ where: { id: { in: scheduleIds } } });

  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await prisma.teacherSubjectCapability.deleteMany({ where: { userId: { in: ids } } });
  await prisma.teacherCategoryCapability.deleteMany({ where: { userId: { in: ids } } });
  await prisma.teacherAvailability.deleteMany({ where: { userId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { targetId: { in: ids } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });

  await prisma.teacherSubjectCapability.deleteMany({
    where: { subject: { name: { startsWith: TAG } } },
  });
  await prisma.levelSubject.deleteMany({ where: { subject: { name: { startsWith: TAG } } } });
  await prisma.subject.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.room.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.level.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.teacherCategoryCapability.deleteMany({
    where: { category: { name: { startsWith: TAG } } },
  });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
}

await wipe();
if (process.argv.includes('--clean')) {
  await prisma.$disconnect();
  process.exit(0);
}

const branch = await prisma.branch.create({ data: { name: `${TAG} فرع` } });
const category = await prisma.category.create({
  data: { name: `${TAG} فئة`, displayOrder: 95 },
});
const level = await prisma.level.create({
  data: { name: `${TAG} مستوى`, categoryId: category.id, genderRestriction: 'any' },
});
const subject = await prisma.subject.create({ data: { name: `${TAG} مادة`, displayOrder: 95 } });
const otherSubject = await prisma.subject.create({
  data: { name: `${TAG} مادة أخرى`, displayOrder: 96 },
});
await prisma.levelSubject.create({ data: { levelId: level.id, subjectId: subject.id } });
await prisma.levelSubject.create({ data: { levelId: level.id, subjectId: otherSubject.id } });
const room = await prisma.room.create({
  data: { name: `${TAG} قاعة`, branchId: branch.id, capacity: 20 },
});
const year = await prisma.academicYear.findFirstOrThrow();
const teacherRole = await prisma.role.findFirstOrThrow({ where: { name: 'teacher' } });

const AFTERNOON = { start: '14:00', end: '18:00' };

async function teacher(
  label: string,
  profile: {
    subjects?: string[];
    categories?: string[];
    availability?: { weekday: string; start: string; end: string }[];
  },
): Promise<string> {
  const user = await prisma.user.create({
    data: { nameArabic: `${TAG} ${label}`, sex: 'female', accountStatus: 'active' },
  });
  await prisma.userBranchRole.create({
    data: { userId: user.id, roleId: teacherRole.id, branchId: branch.id },
  });
  for (const id of profile.subjects ?? []) {
    await prisma.teacherSubjectCapability.create({ data: { userId: user.id, subjectId: id } });
  }
  for (const id of profile.categories ?? []) {
    await prisma.teacherCategoryCapability.create({ data: { userId: user.id, categoryId: id } });
  }
  for (const r of profile.availability ?? []) {
    await prisma.teacherAvailability.create({
      data: {
        userId: user.id,
        weekday: r.weekday as never,
        startTime: new Date(`1970-01-01T${r.start}:00.000Z`),
        endTime: new Date(`1970-01-01T${r.end}:00.000Z`),
      },
    });
  }
  return user.id;
}

const wed = { weekday: 'wednesday', ...AFTERNOON };
const both = { subjects: [subject.id], categories: [category.id] };

const a = await teacher('أ المناسبة', { ...both, availability: [wed] });
const b = await teacher('ب غير المتفرغة', {
  ...both,
  availability: [{ weekday: 'wednesday', start: '08:00', end: '12:00' }],
});
const c = await teacher('ج بلا مادة', {
  subjects: [otherSubject.id],
  categories: [category.id],
  availability: [wed],
});
const d = await teacher('د المرتبطة', { ...both, availability: [wed] });
const e = await teacher('هـ بلا ملف', {});

/** د already teaches at that hour — a TIME overlap, not merely other work. */
const clashing = await prisma.recurringCourseSchedule.create({
  data: {
    title: `${TAG} حصة د القائمة`,
    subjectId: subject.id,
    teachingMode: 'entire_level',
    levelId: level.id,
    branchId: branch.id,
    roomId: room.id,
    academicYearId: year.id,
    startTime: new Date('1970-01-01T16:00:00Z'),
    endTime: new Date('1970-01-01T17:30:00Z'),
    recurrence: 'weekly',
    weekdays: ['wednesday'],
    anchorDate: new Date('2026-09-02T00:00:00Z'),
  },
  select: { id: true },
});
await prisma.courseScheduleStaff.create({
  data: { scheduleId: clashing.id, userId: d, position: 'teacher' },
});

/**
 * **The class under discussion, created UNSTAFFED.**
 *
 * The browser run opens it, reads the five appraisals in the real picker, then
 * assigns هـ — who has no profile at all — and proves the assignment carries
 * authority her profile never could.
 */
const planned = await prisma.recurringCourseSchedule.create({
  data: {
    title: `${TAG} الحصة المخطط لها`,
    subjectId: subject.id,
    teachingMode: 'entire_level',
    levelId: level.id,
    branchId: branch.id,
    academicYearId: year.id,
    startTime: new Date('1970-01-01T15:30:00Z'),
    endTime: new Date('1970-01-01T17:00:00Z'),
    recurrence: 'weekly',
    weekdays: ['wednesday'],
    anchorDate: new Date('2026-09-02T00:00:00Z'),
  },
  select: { id: true },
});

console.log(
  JSON.stringify({
    branch: branch.id,
    level: level.id,
    subject: subject.id,
    planned: planned.id,
    clashing: clashing.id,
    teachers: { a, b, c, d, e },
  }),
);
await prisma.$disconnect();
