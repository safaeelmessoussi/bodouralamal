/**
 * **R97 — the delivery scenario, as a fixture.**
 *
 * Women · Level 1, Thursday 15:00–18:00, at Targa, with a room available. Two
 * classes so both directions of the override are exercised through the real
 * screens:
 *
 * * **`onlineClass`** — عن بُعد / صوت وصورة by default. One future occurrence
 *   will be moved to حضوري + قاعة 5 by the browser harness.
 * * **`inPersonClass`** — حضوري / قاعة 5 by default. One future occurrence
 *   will be moved to عن بُعد.
 *
 * A third, **`audioOnlyClass`**, exists to prove صوت فقط persists and renders
 * on every calendar surface.
 *
 * Dates are relative to today, so the scenario never rots. Created through the
 * SERVICE, because materialization is what writes the occurrences and a raw
 * insert would be testing something the platform does not do.
 */
import { loadConfig } from '../src/lib/config.js';
import { createPrismaClient } from '../src/lib/prisma.js';
import { createCourseSchedule } from '../src/services/course-schedule.service.js';

const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL);
const TAG = '[r97-delivery]';

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
  await prisma.sessionContent.deleteMany({ where: { sessionId: { in: sids } } });
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
const category = await prisma.category.create({
  data: { name: `${TAG} المرأة`, displayOrder: 98 },
});
const level = await prisma.level.create({
  data: { name: `${TAG} المستوى 1`, categoryId: category.id, genderRestriction: 'any' },
});
const year = await prisma.academicYear.findFirstOrThrow();
const teacherRole = await prisma.role.findFirstOrThrow({ where: { name: 'teacher' } });
const studentRole = await prisma.role.findFirstOrThrow({ where: { name: 'student' } });

/** Three Subjects: the three classes share a weekday and an hour, and a مؤطِّرة
 *  each, so nothing collides on staff time either. */
async function subjectNamed(name: string): Promise<string> {
  const s = await prisma.subject.create({ data: { name: `${TAG} ${name}`, displayOrder: 98 } });
  await prisma.levelSubject.create({ data: { levelId: level.id, subjectId: s.id } });
  return s.id;
}
const tafseer = await subjectNamed('تفسير');
const fiqh = await subjectNamed('فقه');
const seerah = await subjectNamed('سيرة');

const room = await prisma.room.create({
  data: { name: `${TAG} قاعة 5`, branchId: targa.id, capacity: 30 },
});

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
const student = await person('مستفيدة', studentRole.id, true);
await prisma.enrollment.create({
  data: { studentId: student, levelId: level.id, branchId: targa.id },
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
  teachingMode: 'entire_level' as const,
  targetId: level.id,
  branchId: targa.id,
  academicYearId: year.id,
  startTime: new Date('1970-01-01T15:00:00Z'),
  endTime: new Date('1970-01-01T18:00:00Z'),
  recurrence: 'weekly',
  weekdays: ['thursday'],
  anchorDate: day(-7),
};

const onlineClass = await createCourseSchedule(prisma, actor, {
  ...base,
  title: `${TAG} تفسير عن بُعد`,
  subjectId: tafseer,
  // **No room, and that is enforced** (R97.5) — an online class has no venue.
  roomId: null,
  deliveryMode: 'online',
  onlineMediaMode: 'audio_video',
  staff: [{ userId: safa, position: 'teacher' }],
} as unknown as Parameters<typeof createCourseSchedule>[2]);

const inPersonClass = await createCourseSchedule(prisma, actor, {
  ...base,
  title: `${TAG} فقه حضوري`,
  subjectId: fiqh,
  roomId: room.id,
  staff: [{ userId: amina, position: 'teacher' }],
});

const audioOnlyClass = await createCourseSchedule(prisma, actor, {
  ...base,
  title: `${TAG} سيرة صوت فقط`,
  subjectId: seerah,
  roomId: null,
  deliveryMode: 'online',
  onlineMediaMode: 'audio_only',
  staff: [{ userId: nadia, position: 'teacher' }],
} as unknown as Parameters<typeof createCourseSchedule>[2]);

/** The first FUTURE occurrence of each, and the one after it — the harness
 *  overrides the first and asserts the second is untouched. */
async function firstTwoFuture(scheduleId: string): Promise<{
  first: { id: string; date: string };
  next: { id: string; date: string };
}> {
  const rows = await prisma.session.findMany({
    where: { scheduleId, deletedAt: null, date: { gt: day(0) } },
    orderBy: { date: 'asc' },
    take: 2,
    select: { id: true, date: true },
  });
  const [a, b] = rows;
  if (!a || !b) throw new Error('fixture needs two future occurrences');
  return {
    first: { id: a.id, date: a.date.toISOString().slice(0, 10) },
    next: { id: b.id, date: b.date.toISOString().slice(0, 10) },
  };
}

const onlineOcc = await firstTwoFuture(onlineClass.id);
const inPersonOcc = await firstTwoFuture(inPersonClass.id);

console.log(
  JSON.stringify({
    onlineSchedule: onlineClass.id,
    inPersonSchedule: inPersonClass.id,
    audioOnlySchedule: audioOnlyClass.id,
    onlineFirst: onlineOcc.first.id,
    onlineFirstDate: onlineOcc.first.date,
    onlineNext: onlineOcc.next.id,
    onlineNextDate: onlineOcc.next.date,
    inPersonFirst: inPersonOcc.first.id,
    inPersonFirstDate: inPersonOcc.first.date,
    inPersonNext: inPersonOcc.next.id,
    inPersonNextDate: inPersonOcc.next.date,
    branch: targa.id,
    room: room.id,
    level: level.id,
    safa,
    amina,
    nadia,
    student,
  }),
);
await prisma.$disconnect();
