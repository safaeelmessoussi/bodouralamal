/**
 * **The combined lesson, as a fixture** (R92 §B16 — integrated with R91).
 *
 * Women · Level 1 · Tafseer, running at two branches. One future occurrence is
 * delivered once, physically at Targa, for both branches' beneficiaries — and
 * **Amina covers that occurrence** while Safa staffs the schedule, so the two
 * dimensions are exercised together.
 *
 * Dates are relative to today, so the scenario never rots. Created through the
 * SERVICE, because materialization is what writes the occurrences.
 */
import { loadConfig } from '../src/lib/config.js';
import { createPrismaClient } from '../src/lib/prisma.js';
import { createCourseSchedule } from '../src/services/course-schedule.service.js';
import { overrideSession } from '../src/services/session.service.js';

const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL);
const TAG = '[r92-combined]';

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

  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const uids = users.map((u) => u.id);
  await prisma.notification.deleteMany({ where: { userId: { in: uids } } });
  await prisma.enrollment.deleteMany({ where: { studentId: { in: uids } } });
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

const targa = await prisma.branch.create({ data: { name: `${TAG} تاركة` } });
const second = await prisma.branch.create({ data: { name: `${TAG} الفرع الثاني` } });
const far = await prisma.branch.create({ data: { name: `${TAG} فرع بعيد` } });
const category = await prisma.category.create({
  data: { name: `${TAG} المرأة`, displayOrder: 99 },
});
const level = await prisma.level.create({
  data: { name: `${TAG} المستوى 1`, categoryId: category.id, genderRestriction: 'any' },
});
const subject = await prisma.subject.create({
  data: { name: `${TAG} تفسير القرآن`, displayOrder: 99 },
});
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
/**
 * **The second branch has its own مؤطِّرة**, and that is not decoration: the two
 * classes meet at the same hour, so staffing Safa on both is a real double
 * booking and TD-4.6c refuses the second — correctly. The fixture states the
 * association's actual arrangement instead of fighting the invariant.
 */
const nadia = await person('نادية', teacherRole.id);
const studentA = await person('أ تاركة', studentRole.id, true);
const studentB = await person('ب الفرع الثاني', studentRole.id, true);
const studentC = await person('ج فرع بعيد', studentRole.id, true);
await prisma.enrollment.create({ data: { studentId: studentA, levelId: level.id, branchId: targa.id } });
await prisma.enrollment.create({ data: { studentId: studentB, levelId: level.id, branchId: second.id } });
await prisma.enrollment.create({ data: { studentId: studentC, levelId: level.id, branchId: far.id } });

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

const targaClass = await createCourseSchedule(prisma, actor, {
  ...base,
  title: `${TAG} تفسير تاركة`,
  branchId: targa.id,
  roomId: room.id,
  staff: [{ userId: safa, position: 'teacher' }],
});
const secondClass = await createCourseSchedule(prisma, actor, {
  ...base,
  title: `${TAG} تفسير الفرع الثاني`,
  branchId: second.id,
  staff: [{ userId: nadia, position: 'teacher' }],
});

/** The occurrence the two branches will attend together — the first future one. */
const combined = await prisma.session.findFirstOrThrow({
  where: { scheduleId: targaClass.id, deletedAt: null, date: { gt: day(0) } },
  orderBy: { date: 'asc' },
  select: { id: true, date: true, version: true },
});
/** The following week's, which must return to normal on both dimensions. */
const next = await prisma.session.findFirstOrThrow({
  where: { scheduleId: targaClass.id, deletedAt: null, date: { gt: combined.date } },
  orderBy: { date: 'asc' },
  select: { id: true, date: true },
});

/**
 * **R91 — Amina covers THAT occurrence only, recorded the way the product
 * records it.**
 *
 * A raw `sessionStaff` insert does not survive: materialization resyncs future,
 * un-overridden occurrences from the schedule's own staffing (R43.4), so the
 * cover was silently replaced by Safa moments later and the مؤطِّرة's calendar
 * was correctly empty. **The occurrence must be marked `overridden`**, which is
 * what `overrideSession` does and what makes the protection predicate spare it.
 * A fixture that bypasses the write path is a fixture testing something the
 * platform does not do.
 */
await overrideSession(prisma, actor, combined.id, {
  version: combined.version,
  staff: [{ userId: amina, position: 'teacher' }],
} as unknown as Parameters<typeof overrideSession>[3]);

console.log(
  JSON.stringify({
    targaSchedule: targaClass.id,
    secondSchedule: secondClass.id,
    combined: combined.id,
    combinedDate: combined.date.toISOString().slice(0, 10),
    next: next.id,
    nextDate: next.date.toISOString().slice(0, 10),
    targa: targa.id,
    second: second.id,
    far: far.id,
    safa,
    amina,
    nadia,
    studentA,
    studentB,
    studentC,
  }),
);
await prisma.$disconnect();
