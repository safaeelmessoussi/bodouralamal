/**
 * The R82 scenario: two beneficiaries in different Levels, Categories and
 * Branches, plus events addressed to each scope shape (§4.8, R82).
 *
 * Built here rather than driven through the forms because the harness verifies
 * **notification audiences and personal calendars**, not the scheduling form —
 * and re-driving that form each run would make a failure ambiguous between two
 * features. It prints the ids the harness needs and `--clean` removes them.
 */
import { createPrismaClient } from '../src/lib/prisma.js';

const TAG = '[r82-browser]';
const url = process.env['DATABASE_URL'];
if (!url) throw new Error('DATABASE_URL is required');
const prisma = createPrismaClient(url);

async function wipe(): Promise<void> {
  const events = await prisma.event.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true },
  });
  const eventIds = events.map((e) => e.id);
  await prisma.notification.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.eventBranch.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.eventCategory.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.eventLevel.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.event.deleteMany({ where: { id: { in: eventIds } } });

  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
  // The class, its occurrence and their staffing — before the people and the
  // Level they hang off, every reference being RESTRICT.
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
  await prisma.notification.deleteMany({ where: { sessionId: { in: sessionIds } } });
  await prisma.sessionStaff.deleteMany({ where: { sessionId: { in: sessionIds } } });
  await prisma.session.deleteMany({ where: { id: { in: sessionIds } } });
  await prisma.courseScheduleStaff.deleteMany({ where: { scheduleId: { in: scheduleIds } } });
  await prisma.recurringCourseSchedule.deleteMany({ where: { id: { in: scheduleIds } } });
  await prisma.levelSubject.deleteMany({ where: { level: { name: { startsWith: TAG } } } });
  await prisma.room.deleteMany({ where: { name: { startsWith: TAG } } });

  await prisma.enrollment.deleteMany({ where: { studentId: { in: ids } } });
  // R88 — the planning profile goes with the person it describes.
  await prisma.teacherSubjectCapability.deleteMany({ where: { userId: { in: ids } } });
  await prisma.teacherCategoryCapability.deleteMany({ where: { userId: { in: ids } } });
  await prisma.teacherAvailability.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
  // The dev sessions minted for these people wrote `auth.refresh` audit rows,
  // and `AuditLog.actor_user_id` is RESTRICT — the trail outlives the fixture
  // deliberately, so teardown has to clear it explicitly.
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.level.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
}

await wipe();
if (process.argv.includes('--clean')) {
  await prisma.$disconnect();
  process.exit(0);
}

const catA = await prisma.category.create({ data: { name: `${TAG} فئة أ`, displayOrder: 90 } });
const catB = await prisma.category.create({ data: { name: `${TAG} فئة ب`, displayOrder: 91 } });
const levelA = await prisma.level.create({
  data: { name: `${TAG} مستوى أ`, categoryId: catA.id, displayOrder: 1, genderRestriction: 'any' },
});
const levelB = await prisma.level.create({
  data: { name: `${TAG} مستوى ب`, categoryId: catB.id, displayOrder: 1, genderRestriction: 'any' },
});
const branchA = await prisma.branch.create({ data: { name: `${TAG} فرع أ` } });
const branchB = await prisma.branch.create({ data: { name: `${TAG} فرع ب` } });

async function student(label: string, levelId: string, branchId: string): Promise<string> {
  const user = await prisma.user.create({
    data: {
      nameArabic: `${TAG} ${label}`,
      sex: 'female',
      accountStatus: 'active',
      isBeneficiary: true,
    },
  });
  await prisma.enrollment.create({ data: { studentId: user.id, levelId, branchId } });
  /**
   * **The student ROLE, not only the enrolment.**
   *
   * R79 made *is she a beneficiary* a durable fact independent of roles, and her
   * own dashboard still reads `GET /students/me`, which TD-2 gates on the role.
   * Without the row the screen renders its error state — which the harness first
   * reported as a missing calendar.
   */
  const role = await prisma.role.findFirst({ where: { name: 'student' } });
  if (role) {
    await prisma.userBranchRole.create({
      data: { userId: user.id, roleId: role.id, branchId: null },
    });
  }
  return user.id;
}

const concerned = await student('المعنية', levelA.id, branchA.id);
const unrelated = await student('غير المعنية', levelB.id, branchB.id);

async function event(
  label: string,
  scopes: { branchIds?: string[]; categoryIds?: string[]; levelIds?: string[] },
): Promise<string> {
  const row = await prisma.event.create({
    data: {
      title: `${TAG} ${label}`,
      visibility: 'public',
      startDate: new Date('2026-08-25T00:00:00Z'),
      startTime: new Date('1970-01-01T10:00:00Z'),
      recurrenceType: 'none',
    },
    select: { id: true },
  });
  for (const branchId of scopes.branchIds ?? []) {
    await prisma.eventBranch.create({ data: { eventId: row.id, branchId } });
  }
  for (const categoryId of scopes.categoryIds ?? []) {
    await prisma.eventCategory.create({ data: { eventId: row.id, categoryId } });
  }
  for (const levelId of scopes.levelIds ?? []) {
    await prisma.eventLevel.create({ data: { eventId: row.id, levelId } });
  }
  return row.id;
}

const levelEvent = await event('نشاط المستوى أ', { levelIds: [levelA.id] });
const otherLevelEvent = await event('نشاط المستوى ب', { levelIds: [levelB.id] });
const branchCategoryEvent = await event('فرع أ + فئة أ', {
  branchIds: [branchA.id],
  categoryIds: [catA.id],
});
const categoryWideEvent = await event('فئة أ في كل الفروع', { categoryIds: [catA.id] });

/**
 * **A fifth event, for the UI phase alone.**
 *
 * Its notice is pre-delivered so the dashboard has something to render without
 * the harness first driving the API — which would mint a token and rotate the
 * refresh cookie out from under the app (TD-4.13). It is deliberately NOT one
 * of the four the API checks use: seeding a notice for `levelEvent` made the
 * *inbox is empty before sending* check false and the send idempotent, so two
 * assertions started failing for a reason that had nothing to do with them.
 */
/**
 * A مؤطرة, because her dashboard is gated on the **teacher role** and the dev
 * super admin does not hold one — the first run reported her calendar missing
 * when what was missing was the role to see it.
 */
const teacher = await prisma.user.create({
  data: { nameArabic: `${TAG} المؤطرة`, sex: 'female', accountStatus: 'active' },
});
const teacherRole = await prisma.role.findFirst({ where: { name: 'teacher' } });
if (teacherRole) {
  await prisma.userBranchRole.create({
    data: { userId: teacher.id, roleId: teacherRole.id, branchId: branchA.id },
  });
}

/**
 * **A مؤطرة who is ALSO a beneficiary** (R88 — إدارة المؤطِّرات).
 *
 * The decisive row for the teaching screen's population. R79 made *beneficiary*
 * a durable fact independent of every role precisely so that a مؤطرة may also
 * study, so a screen that excluded beneficiaries would hide her — and only a
 * person holding both can prove it did not.
 */
const teachingStudent = await prisma.user.create({
  data: {
    nameArabic: `${TAG} المؤطرة الدارسة`,
    sex: 'female',
    accountStatus: 'active',
    isBeneficiary: true,
  },
});
if (teacherRole) {
  await prisma.userBranchRole.create({
    data: { userId: teachingStudent.id, roleId: teacherRole.id, branchId: branchA.id },
  });
}

const uiEvent = await event('نشاط للواجهة', { levelIds: [levelA.id] });
await prisma.notification.create({
  data: { userId: concerned, eventId: uiEvent, type: 'event_created' },
});

/**
 * **A real Quran class with a real occurrence** (R86 §7/§16).
 *
 * The Owner cancelled a class and the enrolled beneficiary was told nothing.
 * Proving that end to end needs a Session whose schedule genuinely resolves to
 * her — a whole-Level class at HER branch, staffed by the مؤطرة — rather than a
 * notification row inserted directly, which would prove only that the table
 * accepts writes.
 */
const subject = await prisma.subject.findFirstOrThrow({ where: { deletedAt: null } });
await prisma.levelSubject.upsert({
  where: { levelId_subjectId: { levelId: levelA.id, subjectId: subject.id } },
  create: { levelId: levelA.id, subjectId: subject.id },
  update: {},
});
const room = await prisma.room.findFirst({ where: { branchId: branchA.id, deletedAt: null } })
  ?? (await prisma.room.create({
    data: { name: `${TAG} قاعة`, branchId: branchA.id, capacity: 20 },
  }));
const year = await prisma.academicYear.findFirst();

const schedule = await prisma.recurringCourseSchedule.create({
  data: {
    title: `${TAG} حلقة الحفظ`,
    subjectId: subject.id,
    // **Whole Level at that branch** — R66's pairing, which is what makes the
    // audience *her Level's students at this branch* rather than everywhere.
    teachingMode: 'entire_level',
    levelId: levelA.id,
    branchId: branchA.id,
    roomId: room.id,
    academicYearId: year ? year.id : undefined,
    startTime: new Date('1970-01-01T09:00:00Z'),
    endTime: new Date('1970-01-01T10:00:00Z'),
    recurrence: 'weekly',
    weekdays: ['monday'],
    anchorDate: new Date('2026-08-24T00:00:00Z'),
  },
  select: { id: true },
});
await prisma.courseScheduleStaff.create({
  data: { scheduleId: schedule.id, userId: teacher.id, position: 'teacher' },
});
const session = await prisma.session.create({
  data: {
    scheduleId: schedule.id,
    date: new Date('2026-08-24T00:00:00Z'),
    startTime: new Date('1970-01-01T09:00:00Z'),
    endTime: new Date('1970-01-01T10:00:00Z'),
    status: 'scheduled',
  },
  select: { id: true },
});
await prisma.sessionStaff.create({
  data: { sessionId: session.id, userId: teacher.id, position: 'teacher' },
});

console.log(
  JSON.stringify({
    concerned,
    unrelated,
    levelEvent,
    otherLevelEvent,
    branchCategoryEvent,
    categoryWideEvent,
    uiEvent,
    teacher: teacher.id,
    schedule: schedule.id,
    session: session.id,
    subject: subject.id,
  }),
);
await prisma.$disconnect();
