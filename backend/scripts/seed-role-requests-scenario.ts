/**
 * **One registration form, four roles — as a fixture** (SRS Revision 168 §1).
 *
 * The browser journey (`scripts/dev/browser/verify-role-requests.mjs`) needs the
 * one thing a populated Localhost may not have: a Category whose FIRST Level has
 * memorisation حلقات with SCHEDULED weekly classes at a branch, because that —
 * and nothing typed into a form or a seed — is what the registration form offers
 * a first-time مستفيدة to rank. The Owner's own example, as data:
 *
 * * three حلقات of the memorisation Subject at «المستوى الأول» — الثلاثاء
 *   15:00–20:00, الخميس 09:00–12:00, السبت 15:00–20:00;
 * * a whole-Level class of another Subject (الأربعاء 09:00–12:00), which is no
 *   choice and is shown as such;
 * * a second Level, which must offer nothing.
 *
 * It also mints a branch-less **Admin** — the approver who may decide every
 * request except a place in the administration — and, ONLY when no academic
 * period covers today, one fixture period in the far-future label band the
 * integration helpers already reserve (approval enrols as of TODAY, R122, and
 * fails closed without one). `--clean` removes every row this created, the
 * applicants the browser registered included, and leaves the Owner's data alone:
 * everything here is found by its tag.
 */
import { loadConfig } from '../src/lib/config.js';
import { createPrismaClient } from '../src/lib/prisma.js';
import { ownedSchedules } from '../src/test-support/owned-schedules.js';
import { requireMemorisationSubject } from '../src/test-support/quran-subject.js';

const config = loadConfig();
if (process.env['NODE_ENV'] === 'production') throw new Error('refusing to seed a scenario in production');
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(config.DATABASE_URL)) {
  throw new Error('refusing to seed a scenario against a non-loopback database');
}

const prisma = createPrismaClient(config.DATABASE_URL, 2);
const TAG = '[r168-roles]';
/** Inside the band `test-support/academic-period.ts` reserves (2100–2900). */
const FIXTURE_YEAR = '2868-2869';

async function wipe(): Promise<void> {
  const ids = (
    await prisma.user.findMany({ where: { nameArabic: { startsWith: TAG } }, select: { id: true } })
  ).map((user) => user.id);
  await prisma.notification.deleteMany({
    where: { OR: [{ userId: { in: ids } }, { subjectUserId: { in: ids } }] },
  });
  await prisma.childApplication.deleteMany({
    where: { OR: [{ parentId: { in: ids } }, { childUserId: { in: ids } }, { decidedById: { in: ids } }] },
  });
  await prisma.auditLog.deleteMany({
    where: { OR: [{ targetId: { in: ids } }, { actorUserId: { in: ids } }] },
  });
  await prisma.consentRecord.deleteMany({
    where: { OR: [{ studentId: { in: ids } }, { grantedByUserId: { in: ids } }] },
  });
  await prisma.familyLink.deleteMany({ where: { OR: [{ parentId: { in: ids } }, { studentId: { in: ids } }] } });
  await prisma.enrollment.deleteMany({ where: { studentId: { in: ids } } });
  await prisma.framingPreferenceBranch.deleteMany({ where: { userId: { in: ids } } });
  await prisma.framingPreference.deleteMany({ where: { userId: { in: ids } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.refreshSession.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userIdentity.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
  // role_request and circle_preference go WITH the person (ON DELETE CASCADE).
  await prisma.user.deleteMany({ where: { id: { in: ids } } });

  const schedules = (
    await prisma.recurringCourseSchedule.findMany({ where: ownedSchedules(TAG), select: { id: true } })
  ).map((schedule) => schedule.id);
  await prisma.session.deleteMany({ where: { scheduleId: { in: schedules } } });
  await prisma.recurringCourseSchedule.deleteMany({ where: { id: { in: schedules } } });

  const levels = (
    await prisma.level.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } })
  ).map((level) => level.id);
  await prisma.teachingGroup.deleteMany({ where: { levelId: { in: levels } } });
  await prisma.levelSubject.deleteMany({ where: { levelId: { in: levels } } });
  await prisma.level.deleteMany({ where: { id: { in: levels } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
  // Rooms a harness created at the scenario's branch (R169 §3), their Trash and
  // audit rows with them — a room is soft-deleted through the API, never gone.
  const rooms = (
    await prisma.room.findMany({ where: { branch: { name: { startsWith: TAG } } }, select: { id: true } })
  ).map((room) => room.id);
  await prisma.trash.deleteMany({ where: { targetEntity: 'Room', targetId: { in: rooms } } });
  await prisma.auditLog.deleteMany({ where: { targetEntity: 'Room', targetId: { in: rooms } } });
  await prisma.room.deleteMany({ where: { id: { in: rooms } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });

  // The fixture period, once nothing is enrolled in it — never anybody else's.
  const year = await prisma.academicYear.findFirst({
    where: { label: FIXTURE_YEAR },
    select: { id: true, periods: { select: { id: true, enrollments: { select: { id: true }, take: 1 } } } },
  });
  if (year) {
    await prisma.academicPeriod.deleteMany({
      where: { id: { in: year.periods.filter((p) => p.enrollments.length === 0).map((p) => p.id) } },
    });
    await prisma.academicYear.deleteMany({ where: { id: year.id, periods: { none: {} } } });
  }
}

await wipe();
if (process.argv.includes('--clean')) {
  await prisma.$disconnect();
  process.exit(0);
}

const tracker = await requireMemorisationSubject(prisma);
const other = await prisma.subject.findFirst({
  where: { tracksQuranProgress: false, deletedAt: null },
  orderBy: { name: 'asc' },
  select: { id: true, name: true },
});
const year = await prisma.academicYear.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } });

const branch = await prisma.branch.create({ data: { name: `${TAG} مقر تاركة` } });
const category = await prisma.category.create({ data: { name: `${TAG} المرأة`, displayOrder: 96 } });
const first = await prisma.level.create({
  data: { name: `${TAG} المستوى الأول`, categoryId: category.id, genderRestriction: 'any', displayOrder: 1 },
});
await prisma.level.create({
  data: { name: `${TAG} المستوى الثاني`, categoryId: category.id, genderRestriction: 'any', displayOrder: 2 },
});

const at = (hour: number): Date => new Date(Date.UTC(1970, 0, 1, hour, 0, 0));
const anchorDate = new Date('2026-01-05T00:00:00.000Z');

const circles: { name: string; weekday: 'tuesday' | 'thursday' | 'saturday'; from: number; to: number }[] = [
  { name: `${TAG} حلقة الثلاثاء`, weekday: 'tuesday', from: 15, to: 20 },
  { name: `${TAG} حلقة الخميس`, weekday: 'thursday', from: 9, to: 12 },
  { name: `${TAG} حلقة السبت`, weekday: 'saturday', from: 15, to: 20 },
];
for (const [index, circle] of circles.entries()) {
  const group = await prisma.teachingGroup.create({
    data: { name: circle.name, levelId: first.id, subjectId: tracker.id, displayOrder: index + 1 },
  });
  await prisma.recurringCourseSchedule.create({
    data: {
      subjectId: tracker.id,
      teachingMode: 'teaching_group',
      teachingGroupId: group.id,
      branchId: branch.id,
      academicYearId: year.id,
      recurrence: 'weekly',
      weekdays: [circle.weekday],
      startTime: at(circle.from),
      endTime: at(circle.to),
      anchorDate,
    },
  });
}
if (other) {
  // «للجميع»: the whole Level, no حلقة — shown for information, never a choice.
  await prisma.recurringCourseSchedule.create({
    data: {
      subjectId: other.id,
      teachingMode: 'entire_level',
      levelId: first.id,
      branchId: branch.id,
      academicYearId: year.id,
      recurrence: 'weekly',
      weekdays: ['wednesday'],
      startTime: at(9),
      endTime: at(12),
      anchorDate,
    },
  });
}

const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'admin' } });
const admin = await prisma.user.create({
  data: { nameArabic: `${TAG} مسؤولة`, sex: 'female', accountStatus: 'active' },
});
await prisma.userBranchRole.create({ data: { userId: admin.id, roleId: adminRole.id, branchId: null } });

// R169 §1 — an account that ALREADY exists: an active مؤطِّرة with no request
// row at all (she was pre-provisioned), who will ask for a further role.
const teacherRole = await prisma.role.findUniqueOrThrow({ where: { name: 'teacher' } });
const existing = await prisma.user.create({
  data: { nameArabic: `${TAG} مؤطِّرة قائمة`, sex: 'female', accountStatus: 'active' },
});
await prisma.userBranchRole.create({ data: { userId: existing.id, roleId: teacherRole.id, branchId: null } });

// R122 — approval enrols as of TODAY and fails closed with no period covering it.
const today = new Date();
const covering = await prisma.academicPeriod.findFirst({
  where: { startDate: { lte: today }, endDate: { gte: today } },
  select: { id: true },
});
if (!covering) {
  const fixtureYear = await prisma.academicYear.create({ data: { label: FIXTURE_YEAR } });
  await prisma.academicPeriod.create({
    data: {
      academicYearId: fixtureYear.id,
      sequence: 1,
      startDate: new Date(Date.UTC(today.getUTCFullYear() - 1, 0, 1)),
      endDate: new Date(Date.UTC(today.getUTCFullYear() + 1, 11, 31)),
    },
  });
}

console.log(
  JSON.stringify({
    tag: TAG,
    admin: admin.id,
    existing: existing.id,
    branch: { id: branch.id, name: branch.name },
    category: { id: category.id, name: category.name },
    firstLevel: { id: first.id, name: first.name },
    circles: circles.map((circle) => circle.name),
    fixedSubject: other?.name ?? null,
    fixturePeriod: !covering,
  }),
);
await prisma.$disconnect();
