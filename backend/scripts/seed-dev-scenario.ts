/**
 * **Builds the association's own scenario in the development database**, so a
 * browser can be driven over the real screens with real data.
 *
 *   المرأة — وميض الأمل · تفسير · كل اثنين 15:00–17:00 · تاركة · القاعة 5
 *   صفاء (أستاذة) · أمينة (مساعدة) · مستفيدة مسجّلة · مستفيدة غير معنية
 *
 * ## Why a script and not a test fixture
 *
 * The integration fixtures live inside vitest and are torn down when it exits.
 * Browser verification needs data that is still there when Chrome opens, and it
 * needs the ids printed so the driver can address the right rows.
 *
 * ## Safety
 *
 * Same discipline as `issue-dev-session.ts`: refuses `NODE_ENV=production` and
 * refuses a non-loopback `DATABASE_URL`. Every row it writes is tagged, and
 * `--clean` removes exactly those rows and nothing else — it is idempotent, so
 * a second run reuses what the first made rather than duplicating it.
 */
import { loadConfig } from '../src/lib/config.js';
import { createPrismaClient } from '../src/lib/prisma.js';
import {
  horizonFor,
  materializeSchedule,
} from '../src/services/session-materialize.service.js';

const config = loadConfig();
if (process.env['NODE_ENV'] === 'production') {
  throw new Error('refusing to seed a scenario in production');
}
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(config.DATABASE_URL)) {
  throw new Error('refusing to seed against a non-loopback database');
}

const prisma = createPrismaClient(config.DATABASE_URL, 4);
const TAG = '[dev-scenario]';

async function clean(): Promise<void> {
  const schedules = await prisma.recurringCourseSchedule.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = schedules.map((s) => s.id);
  await prisma.notification.deleteMany({ where: { session: { scheduleId: { in: ids } } } });
  await prisma.sessionContent.deleteMany({ where: { session: { scheduleId: { in: ids } } } });
  await prisma.sessionStaff.deleteMany({ where: { session: { scheduleId: { in: ids } } } });
  await prisma.session.deleteMany({ where: { scheduleId: { in: ids } } });
  await prisma.courseScheduleStaff.deleteMany({ where: { scheduleId: { in: ids } } });
  if (ids.length > 0) {
    await prisma.auditLog.deleteMany({ where: { targetId: { in: ids } } });
    await prisma.trash.deleteMany({ where: { targetId: { in: ids } } });
  }
  await prisma.recurringCourseSchedule.deleteMany({ where: { id: { in: ids } } });

  const levels = await prisma.level.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  const levelIds = levels.map((l) => l.id);
  await prisma.educationalContent.deleteMany({ where: { levelId: { in: levelIds } } });
  await prisma.enrollment.deleteMany({ where: { levelId: { in: levelIds } } });
  await prisma.administrativeGroup.deleteMany({ where: { levelId: { in: levelIds } } });
  await prisma.levelSubject.deleteMany({ where: { levelId: { in: levelIds } } });
  await prisma.level.deleteMany({ where: { id: { in: levelIds } } });
  await prisma.subject.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.room.deleteMany({ where: { branch: { name: { startsWith: TAG } } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });

  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  if (userIds.length > 0) {
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userBranchRole.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.courseScheduleStaff.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { targetId: { in: userIds } } });
    await prisma.trash.deleteMany({ where: { deletedById: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}

if (process.argv.includes('--clean')) {
  await clean();
  process.stdout.write('cleaned\n');
  await prisma.$disconnect();
  process.exit(0);
}

await clean();

async function person(
  label: string,
  role: string | null,
  sex: 'female' | null = 'female',
): Promise<string> {
  const user = await prisma.user.create({
    data: {
      nameArabic: `${TAG} ${label}`,
      accountStatus: 'active',
      ...(sex === null ? {} : { sex }),
    },
  });
  if (role !== null) {
    const row = await prisma.role.findUniqueOrThrow({ where: { name: role } });
    await prisma.userBranchRole.create({
      data: { userId: user.id, roleId: row.id, branchId: null },
    });
  }
  return user.id;
}

const branch = await prisma.branch.create({ data: { name: `${TAG} تاركة` } });
const room = await prisma.room.create({ data: { name: `${TAG} القاعة 5`, branchId: branch.id } });
const category = await prisma.category.create({ data: { name: `${TAG} المرأة`, displayOrder: 1 } });
const level = await prisma.level.create({
  data: {
    name: `${TAG} وميض الأمل`,
    categoryId: category.id,
    // The Category is المرأة, so the Level admits women only — and R27 makes a
    // NULL `sex` ineligible, which is why every beneficiary below carries one.
    genderRestriction: 'girls_only',
  },
});
const subject = await prisma.subject.create({ data: { name: `${TAG} تفسير` } });
await prisma.levelSubject.create({ data: { levelId: level.id, subjectId: subject.id } });
const group = await prisma.administrativeGroup.create({
  data: { name: `${TAG} المجموعة 1`, levelId: level.id, branchId: branch.id },
});

const year =
  (await prisma.academicYear.findFirst({ orderBy: { label: 'desc' } })) ??
  (await prisma.academicYear.create({ data: { label: '2026-2027' } }));

const safa = await person('صفاء', 'teacher');
const amina = await person('أمينة', 'teacher');
const student = await person('مستفيدة مسجّلة', 'student');
const outsider = await person('مستفيدة غير معنية', 'student');

await prisma.enrollment.create({
  data: {
    studentId: student,
    levelId: level.id,
    administrativeGroupId: group.id,
    branchId: branch.id,
  },
});

// Anchored on a past Monday so the horizon materializes occurrences on both
// sides of today: a calendar with nothing behind it cannot show a cancellation
// that has already been decided.
const anchor = new Date();
anchor.setUTCHours(0, 0, 0, 0);
anchor.setUTCDate(anchor.getUTCDate() - ((anchor.getUTCDay() + 6) % 7) - 7);

const schedule = await prisma.recurringCourseSchedule.create({
  data: {
    title: `${TAG} حلقة التفسير`,
    subjectId: subject.id,
    teachingMode: 'administrative_group',
    // `level_id` stays NULL — `course_schedule_mode_target_check` (R43) allows
    // exactly one target per mode, and the Level is reached through the Group.
    administrativeGroupId: group.id,
    branchId: branch.id,
    roomId: room.id,
    startTime: new Date('1970-01-01T15:00:00.000Z'),
    endTime: new Date('1970-01-01T17:00:00.000Z'),
    recurrence: 'weekly',
    weekdays: ['monday'],
    academicYearId: year.id,
    anchorDate: anchor,
  },
});

// §4.4c — the main teacher and the assistant, through the existing staffing
// relation. Positions are the schedule's, and a Session inherits its snapshot
// at materialization (R43.4).
await prisma.courseScheduleStaff.createMany({
  data: [
    { scheduleId: schedule.id, userId: safa, position: 'teacher' },
    { scheduleId: schedule.id, userId: amina, position: 'assistant' },
  ],
});

// **The production materializer**, not a hand-rolled loop: the occurrences a
// browser then reads must be the ones the platform would really have made,
// including the R43.4 staffing snapshot each one carries.
const now = new Date();
const horizon = await horizonFor(prisma, now);
const created = await prisma.$transaction((tx) =>
  materializeSchedule(
    tx,
    {
      id: schedule.id,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      roomId: schedule.roomId,
      academicYearId: schedule.academicYearId,
      recurrence: schedule.recurrence,
      weekdays: schedule.weekdays,
      anchorDate: schedule.anchorDate,
      effectiveUntil: schedule.effectiveUntil,
      staff: [
        { userId: safa, position: 'teacher' },
        { userId: amina, position: 'assistant' },
      ],
    } as never,
    // From the anchor rather than today, so the calendar has occurrences behind
    // it as well as ahead: a cancellation already decided must be visible.
    anchor,
    horizon,
  ),
);

process.stdout.write(
  `${JSON.stringify(
    {
      branchId: branch.id,
      roomId: room.id,
      categoryId: category.id,
      levelId: level.id,
      subjectId: subject.id,
      groupId: group.id,
      scheduleId: schedule.id,
      academicYearId: year.id,
      safa,
      amina,
      student,
      outsider,
      sessions: created,
      // The occurrence the recorder harness attaches to: the earliest one, so a
      // rerun addresses the same row rather than whichever came back first.
      firstSessionId: (
        await prisma.session.findFirstOrThrow({
          where: { scheduleId: schedule.id, deletedAt: null },
          orderBy: { date: 'asc' },
          select: { id: true },
        })
      ).id,
    },
    null,
    0,
  )}\n`,
);
await prisma.$disconnect();
