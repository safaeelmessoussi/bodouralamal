/**
 * **إدخال الحفظ, as a fixture** (Section C §C19–§C23, §C31).
 *
 * One scenario that carries every scope dimension the Owner's matrix names, so
 * the harness drives real screens rather than asserting shapes:
 *
 * * **whole-Level** Quran at فرع أ, and the same Level at فرع ب;
 * * an **Administrative Group** class and a **Teaching Circle** class;
 * * a **replacement** — صفاء's period ended yesterday, أمينة's began today (R91);
 * * a **combined occurrence today** drawing both branches (R92), plus an
 *   ordinary one next week that must NOT be widened;
 * * a مؤطِّرة teaching only **Tafseer**, who must reach no memorisation at all;
 * * a beneficiary enrolled in **two Levels**, so the Level selector is exercised.
 *
 * Every date is relative to today, so the scenario never rots. Schedules are
 * created **through the service**, because materialization is what writes the
 * occurrences — a raw insert produces a schedule with no lessons, which is a
 * fixture testing something the platform does not do.
 */
import { loadConfig } from '../src/lib/config.js';
import { createPrismaClient } from '../src/lib/prisma.js';
import { createCourseSchedule } from '../src/services/course-schedule.service.js';

const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL);
const TAG = '[quran-c]';

const AL_FATIHA = 1;
const AL_BAQARA = 2;
const AN_NAS = 114;

const day = (offset: number): Date => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
};
const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;
/** Today's own weekday, so every schedule materialises an occurrence TODAY —
 *  which is the day `studentsTaughtBy` and `teachesQuran` both ask about. */
const todayWeekday = WEEKDAYS[day(0).getUTCDay()]!;

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
  await prisma.quranProgressLog.deleteMany({
    where: { OR: [{ studentId: { in: uids } }, { loggedById: { in: uids } }] },
  });
  await prisma.studentSurahProgress.deleteMany({ where: { studentId: { in: uids } } });
  await prisma.notification.deleteMany({ where: { userId: { in: uids } } });
  await prisma.studentTeachingGroup.deleteMany({ where: { studentId: { in: uids } } });
  await prisma.enrollment.deleteMany({ where: { studentId: { in: uids } } });
  await prisma.teacherSubjectCapability.deleteMany({ where: { userId: { in: uids } } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: uids } } });
  await prisma.auditLog.deleteMany({ where: { targetId: { in: uids } } });
  await prisma.trash.deleteMany({ where: { deletedById: { in: uids } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: uids } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: uids } } });
  await prisma.user.deleteMany({ where: { id: { in: uids } } });

  const levels = await prisma.level.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  const lids = levels.map((l) => l.id);
  await prisma.teachingGroup.deleteMany({ where: { levelId: { in: lids } } });
  await prisma.administrativeGroup.deleteMany({ where: { levelId: { in: lids } } });
  await prisma.levelSurah.deleteMany({ where: { levelId: { in: lids } } });
  await prisma.levelSubject.deleteMany({ where: { levelId: { in: lids } } });
  await prisma.level.deleteMany({ where: { id: { in: lids } } });
  await prisma.subject.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
}

await wipe();
if (process.argv.includes('--clean')) {
  await prisma.$disconnect();
  process.exit(0);
}

const branchA = await prisma.branch.create({ data: { name: `${TAG} فرع أ` } });
const branchB = await prisma.branch.create({ data: { name: `${TAG} فرع ب` } });
const category = await prisma.category.create({
  data: { name: `${TAG} المرأة`, displayOrder: 97 },
});
const levelOne = await prisma.level.create({
  data: { name: `${TAG} المستوى 1`, categoryId: category.id, genderRestriction: 'any' },
});
const levelTwo = await prisma.level.create({
  data: { name: `${TAG} المستوى 2`, categoryId: category.id, genderRestriction: 'any' },
});

/**
 * **R73's structural marker.** At most one live Subject may carry it, so this
 * fixture owns the only one while it runs and `--clean` returns the database to
 * having none. The name is irrelevant to authorization and deliberately so.
 */
const quran = await prisma.subject.create({
  data: { name: `${TAG} حفظ القرآن`, displayOrder: 97, tracksQuranProgress: true },
});
const tafseer = await prisma.subject.create({ data: { name: `${TAG} تفسير`, displayOrder: 98 } });
for (const levelId of [levelOne.id, levelTwo.id]) {
  await prisma.levelSubject.createMany({
    data: [
      { levelId, subjectId: quran.id },
      { levelId, subjectId: tafseer.id },
    ],
  });
}

/**
 * **The syllabus** (`LevelSurah`) — normative for entry (§C11).
 *
 * Level 1 teaches الفاتحة (7 ayahs) and البقرة (286); Level 2 teaches الفاتحة
 * and الناس. The overlap on الفاتحة is what proves §C17: the same Surah under
 * two Levels, one figure, never a merged list.
 */
await prisma.levelSurah.createMany({
  data: [
    { levelId: levelOne.id, surahId: AL_FATIHA },
    { levelId: levelOne.id, surahId: AL_BAQARA },
    { levelId: levelTwo.id, surahId: AL_FATIHA },
    { levelId: levelTwo.id, surahId: AN_NAS },
  ],
});

const group = await prisma.administrativeGroup.create({
  data: { name: `${TAG} مجموعة أ`, levelId: levelOne.id, branchId: branchA.id },
});
const circle = await prisma.teachingGroup.create({
  data: { name: `${TAG} حلقة الحفظ`, levelId: levelOne.id, subjectId: quran.id },
});

const year = await prisma.academicYear.findFirstOrThrow({ where: { isCurrent: true } });
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

// ── the people ────────────────────────────────────────────────────────────
const hafsa = await person('حفصة كل المستوى', studentRole.id, true); // whole Level, فرع أ
const zineb = await person('زينب الفرع ب', studentRole.id, true); // فرع ب — the visitor
const khadija = await person('خديجة المجموعة', studentRole.id, true); // Administrative Group
const maryam = await person('مريم الحلقة', studentRole.id, true); // Teaching Circle
const salma = await person('سلمى مستويان', studentRole.id, true); // two Levels

const nawal = await person('نوال مؤطرة الحفظ', teacherRole.id); // whole-Level Quran, فرع أ
const houda = await person('هدى مساعدة', teacherRole.id); // assistant on the same class
const rajaa = await person('رجاء مؤطرة التفسير', teacherRole.id); // Tafseer only
const safa = await person('صفاء المنتهية', teacherRole.id); // R91 — ended yesterday
const amina = await person('أمينة الحالية', teacherRole.id); // R91 — began today
const samira = await person('سميرة مؤطرة المجموعة', teacherRole.id);
const latifa = await person('لطيفة مؤطرة الحلقة', teacherRole.id);

// **R88 planning data on رجاء: she DECLARES Quran and is assigned only Tafseer.**
// It must grant her nothing — the fixture states it so the harness can prove it.
await prisma.teacherSubjectCapability.create({
  data: { userId: rajaa, subjectId: quran.id },
});

await prisma.enrollment.create({
  data: { studentId: hafsa, levelId: levelOne.id, branchId: branchA.id },
});
await prisma.enrollment.create({
  data: { studentId: zineb, levelId: levelOne.id, branchId: branchB.id },
});
await prisma.enrollment.create({
  data: {
    studentId: khadija,
    levelId: levelOne.id,
    branchId: branchA.id,
    administrativeGroupId: group.id,
  },
});
await prisma.enrollment.create({
  data: { studentId: maryam, levelId: levelOne.id, branchId: branchA.id },
});
await prisma.studentTeachingGroup.create({
  data: {
    studentId: maryam,
    teachingGroupId: circle.id,
    subjectId: quran.id,
    levelId: levelOne.id,
  },
});
// Two Levels, so حفظي groups and the entry form must ask which.
await prisma.enrollment.create({
  data: { studentId: salma, levelId: levelOne.id, branchId: branchA.id },
});
await prisma.enrollment.create({
  data: { studentId: salma, levelId: levelTwo.id, branchId: branchA.id },
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
  academicYearId: year.id,
  recurrence: 'weekly',
  weekdays: [todayWeekday],
  // A week back, so today is a materialised occurrence rather than the first.
  anchorDate: day(-7),
};

/** The whole-Level Quran class at فرع أ — نوال teaches, هدى assists. */
const wholeLevel = await createCourseSchedule(prisma, actor, {
  ...base,
  title: `${TAG} حفظ كل المستوى`,
  subjectId: quran.id,
  teachingMode: 'entire_level' as const,
  targetId: levelOne.id,
  branchId: branchA.id,
  startTime: new Date('1970-01-01T09:00:00Z'),
  endTime: new Date('1970-01-01T10:00:00Z'),
  staff: [
    { userId: nawal, position: 'teacher' },
    { userId: houda, position: 'assistant' },
  ],
});

/** The Administrative Group class — سميرة reaches خديجة and nobody else. */
const groupClass = await createCourseSchedule(prisma, actor, {
  ...base,
  title: `${TAG} حفظ المجموعة`,
  subjectId: quran.id,
  teachingMode: 'administrative_group' as const,
  targetId: group.id,
  branchId: branchA.id,
  startTime: new Date('1970-01-01T10:00:00Z'),
  endTime: new Date('1970-01-01T11:00:00Z'),
  staff: [{ userId: samira, position: 'teacher' }],
});

/** The Circle class — لطيفة reaches مريم and nobody else. */
const circleClass = await createCourseSchedule(prisma, actor, {
  ...base,
  title: `${TAG} حفظ الحلقة`,
  subjectId: quran.id,
  teachingMode: 'teaching_group' as const,
  targetId: circle.id,
  branchId: branchA.id,
  startTime: new Date('1970-01-01T11:00:00Z'),
  endTime: new Date('1970-01-01T12:00:00Z'),
  staff: [{ userId: latifa, position: 'teacher' }],
});

/** Tafseer only — رجاء must reach no memorisation through it (§C7). */
await createCourseSchedule(prisma, actor, {
  ...base,
  title: `${TAG} تفسير`,
  subjectId: tafseer.id,
  teachingMode: 'entire_level' as const,
  targetId: levelOne.id,
  branchId: branchA.id,
  startTime: new Date('1970-01-01T14:00:00Z'),
  endTime: new Date('1970-01-01T15:00:00Z'),
  staff: [{ userId: rajaa, position: 'teacher' }],
});

/**
 * **R91 — the replacement, on Level 2 so it does not double-book Level 1.**
 * صفاء's period ended yesterday; أمينة's began today. Both bounds are
 * inclusive calendar dates (TD-11).
 */
const replaced = await createCourseSchedule(prisma, actor, {
  ...base,
  title: `${TAG} حفظ المستوى 2`,
  subjectId: quran.id,
  teachingMode: 'entire_level' as const,
  targetId: levelTwo.id,
  branchId: branchA.id,
  startTime: new Date('1970-01-01T16:00:00Z'),
  endTime: new Date('1970-01-01T17:00:00Z'),
  staff: [{ userId: amina, position: 'teacher' }],
});
await prisma.courseScheduleStaff.updateMany({
  where: { scheduleId: replaced.id, userId: amina },
  data: { effectiveFrom: day(0) },
});
await prisma.courseScheduleStaff.create({
  data: {
    scheduleId: replaced.id,
    userId: safa,
    position: 'teacher',
    effectiveUntil: day(-1),
  },
});

/**
 * **R92 — today's whole-Level lesson is delivered once for both branches.**
 *
 * Replacement semantics: the rows ARE the audience's branches, so فرع أ is
 * named explicitly alongside فرع ب. The venue does not move and no Enrollment
 * is touched — زينب stays a فرع ب beneficiary throughout.
 */
const combined = await prisma.session.findFirstOrThrow({
  where: { scheduleId: wholeLevel.id, deletedAt: null, date: day(0) },
  select: { id: true, date: true, version: true },
});
await prisma.sessionAudienceBranch.createMany({
  data: [
    { sessionId: combined.id, branchId: branchA.id },
    { sessionId: combined.id, branchId: branchB.id },
  ],
});
/** Next week's, deliberately ordinary — the roster must narrow again. */
const nextOrdinary = await prisma.session.findFirstOrThrow({
  where: { scheduleId: wholeLevel.id, deletedAt: null, date: { gt: combined.date } },
  orderBy: { date: 'asc' },
  select: { id: true, date: true },
});

console.log(
  JSON.stringify({
    branchA: branchA.id,
    branchB: branchB.id,
    levelOne: levelOne.id,
    levelTwo: levelTwo.id,
    quranSubject: quran.id,
    wholeLevel: wholeLevel.id,
    groupClass: groupClass.id,
    circleClass: circleClass.id,
    replaced: replaced.id,
    combined: combined.id,
    combinedDate: combined.date.toISOString().slice(0, 10),
    // TD-15 — the audience write is version-checked, so the harness needs the
    // value as the fixture left it.
    combinedVersion: combined.version,
    nextOrdinary: nextOrdinary.id,
    nextOrdinaryDate: nextOrdinary.date.toISOString().slice(0, 10),
    hafsa,
    zineb,
    khadija,
    maryam,
    salma,
    nawal,
    houda,
    rajaa,
    safa,
    amina,
    samira,
    latifa,
  }),
);
await prisma.$disconnect();
