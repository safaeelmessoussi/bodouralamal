/**
 * **R98 — the online-class scenario, as a fixture.**
 *
 * Women · Level 1 at Targa, **running right now**, because the join window is
 * real: the classes below start an hour ago and end two hours from now on the
 * association's own clock, so the harness exercises the same window a مؤطِّرة
 * does rather than a relaxed test-only one.
 *
 * Four classes, each existing for a property the harness must prove and none
 * of them for decoration:
 *
 * | class | delivery | why it exists |
 * |---|---|---|
 * | **تفسير** | عن بُعد · صوت وصورة | the main room: صفاء teaches, أمينة assists, مستفيدة attends |
 * | **فقه** | عن بُعد · صوت وصورة | **R91 handover** (سعاد's period ended yesterday, نادية's begins today) **and R92** (today's occurrence draws from both branches) |
 * | **سيرة** | عن بُعد · صوت فقط | a **one-off cover** on today's occurrence only, and the audio-only surface |
 * | **حديث** | حضوري · قاعة 5 | there must be **no «دخول الحصة»** at all |
 *
 * **صفاء appears on exactly one schedule.** She is the obvious person to also
 * hand over in the second class, and putting her on two classes in the same
 * hour is a staff-time conflict the platform correctly refuses — so the
 * handover uses سعاد → نادية and proves precisely the same rule.
 *
 * Created through the SERVICE, because materialization is what writes the
 * occurrences and a raw insert would test something the platform does not do.
 */
import { loadConfig } from '../src/lib/config.js';
import { createPrismaClient } from '../src/lib/prisma.js';
import { createCourseSchedule } from '../src/services/course-schedule.service.js';
import { overrideSession } from '../src/services/session.service.js';

const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL);
const TAG = '[r98-join]';

/**
 * A calendar date on **the association's own clock** (TD-11), written as the
 * UTC midnight every `@db.Date` column stores.
 *
 * **Built from the LOCAL date parts, and that is the whole point.** Zeroing the
 * UTC hours of an instant — which is what the delivery fixture does — gives the
 * wrong day for the first hour after local midnight: at 00:34 in Casablanca it
 * is still the previous day in UTC. That fixture only ever asks for occurrences
 * *after* today, so it never noticed; this one needs **today exactly**, and the
 * seed failed with «no record was found» at 00:34 while the occurrence sat
 * there under tomorrow's date.
 *
 * The weekday below comes from `new Date().getDay()` — also local — so the two
 * halves must agree or the recurrence lands on a day the fixture then cannot
 * find.
 */
const day = (offset: number): Date => {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + offset));
};

/** The weekday name the recurrence needs, for *today*. */
const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

/**
 * A wall-clock block that certainly contains **now**, clamped inside the day.
 * The window is [start − 15 min, end + 30 min], so an hour of lead and two of
 * tail leave no timing race even on a slow run.
 */
function nowBlock(): { start: Date; end: Date } {
  const hour = new Date().getHours();
  const startHour = Math.max(0, Math.min(21, hour - 1));
  const endHour = Math.min(23, startHour + 3);
  const t = (h: number, m = 0): Date => new Date(Date.UTC(1970, 0, 1, h, m, 0));
  return { start: t(startHour), end: t(endHour, endHour === 23 ? 59 : 0) };
}

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
  await prisma.sessionRecording.deleteMany({ where: { sessionId: { in: sids } } });
  await prisma.sessionAudienceBranch.deleteMany({ where: { sessionId: { in: sids } } });
  await prisma.notification.deleteMany({ where: { sessionId: { in: sids } } });
  await prisma.sessionContent.deleteMany({ where: { sessionId: { in: sids } } });
  await prisma.sessionStaff.deleteMany({ where: { sessionId: { in: sids } } });
  await prisma.session.deleteMany({ where: { id: { in: sids } } });
  await prisma.courseScheduleStaff.deleteMany({ where: { scheduleId: { in: ids } } });
  await prisma.recurringCourseSchedule.deleteMany({ where: { id: { in: ids } } });

  /**
   * **Keyed on the PEOPLE, not on a title.** The delivery harness learned this
   * the hard way (`testing.md`): a fixture that wipes by tag leaves rows behind
   * whenever a harness creates something through the real UI, and the leftover
   * `course_schedule_staff` row then kills the NEXT run inside its own wipe.
   */
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const uids = users.map((u) => u.id);
  const theirSchedules = await prisma.courseScheduleStaff.findMany({
    where: { userId: { in: uids } },
    select: { scheduleId: true },
  });
  const theirIds = [...new Set(theirSchedules.map((s) => s.scheduleId))];
  const theirSessions = await prisma.session.findMany({
    where: { scheduleId: { in: theirIds } },
    select: { id: true },
  });
  const theirSids = theirSessions.map((s) => s.id);
  await prisma.sessionRecording.deleteMany({ where: { sessionId: { in: theirSids } } });
  await prisma.sessionAudienceBranch.deleteMany({ where: { sessionId: { in: theirSids } } });
  await prisma.notification.deleteMany({ where: { sessionId: { in: theirSids } } });
  await prisma.sessionContent.deleteMany({ where: { sessionId: { in: theirSids } } });
  await prisma.sessionStaff.deleteMany({ where: { userId: { in: uids } } });
  await prisma.sessionStaff.deleteMany({ where: { sessionId: { in: theirSids } } });
  await prisma.session.deleteMany({ where: { id: { in: theirSids } } });
  await prisma.courseScheduleStaff.deleteMany({ where: { scheduleId: { in: theirIds } } });
  await prisma.recurringCourseSchedule.deleteMany({ where: { id: { in: theirIds } } });

  await prisma.sessionRecording.deleteMany({ where: { startedById: { in: uids } } });
  await prisma.familyLink.deleteMany({ where: { parentId: { in: uids } } });
  await prisma.familyLink.deleteMany({ where: { studentId: { in: uids } } });
  await prisma.notification.deleteMany({ where: { userId: { in: uids } } });
  await prisma.enrollment.deleteMany({ where: { studentId: { in: uids } } });
  await prisma.teacherSubjectCapability.deleteMany({ where: { userId: { in: uids } } });
  await prisma.teacherCategoryCapability.deleteMany({ where: { userId: { in: uids } } });
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
const masira = await prisma.branch.create({ data: { name: `${TAG} المسيرة` } });
const category = await prisma.category.create({
  data: { name: `${TAG} المرأة`, displayOrder: 97 },
});
const level = await prisma.level.create({
  data: { name: `${TAG} المستوى 1`, categoryId: category.id, genderRestriction: 'any' },
});
const year = await prisma.academicYear.findFirstOrThrow();
const teacherRole = await prisma.role.findFirstOrThrow({ where: { name: 'teacher' } });
const studentRole = await prisma.role.findFirstOrThrow({ where: { name: 'student' } });
const parentRole = await prisma.role.findFirstOrThrow({ where: { name: 'parent' } });

async function subjectNamed(name: string): Promise<string> {
  const s = await prisma.subject.create({
    data: { name: `${TAG} ${name}`, displayOrder: 97 },
  });
  await prisma.levelSubject.create({ data: { levelId: level.id, subjectId: s.id } });
  return s.id;
}
const tafseer = await subjectNamed('تفسير');
const fiqh = await subjectNamed('فقه');
const seerah = await subjectNamed('سيرة');
const hadith = await subjectNamed('حديث');

const room = await prisma.room.create({
  data: { name: `${TAG} قاعة 5`, branchId: targa.id, capacity: 30 },
});

async function person(
  label: string,
  roleId: string,
  branchId: string | null = null,
  beneficiary = false,
): Promise<string> {
  const user = await prisma.user.create({
    data: {
      nameArabic: `${TAG} ${label}`,
      sex: 'female',
      accountStatus: 'active',
      isBeneficiary: beneficiary,
    },
  });
  await prisma.userBranchRole.create({ data: { userId: user.id, roleId, branchId } });
  return user.id;
}

const safa = await person('صفاء', teacherRole.id);
const amina = await person('أمينة', teacherRole.id);
const souad = await person('سعاد', teacherRole.id);
const nadia = await person('نادية', teacherRole.id);
const hind = await person('هند', teacherRole.id);
/** R88 — she DECLARED she can teach تفسير, and staffs nothing. */
const rim = await person('ريم', teacherRole.id);
await prisma.teacherSubjectCapability.create({ data: { userId: rim, subjectId: tafseer } });
await prisma.teacherCategoryCapability.create({
  data: { userId: rim, categoryId: category.id },
});

const studentA = await person('مستفيدة أ', studentRole.id, targa.id, true);
await prisma.enrollment.create({
  data: { studentId: studentA, levelId: level.id, branchId: targa.id },
});
/** Unrelated: the same Level at the OTHER branch, so she is legitimately
 *  elsewhere rather than nowhere — and she is R92's visitor as well. */
const studentB = await person('مستفيدة ب', studentRole.id, masira.id, true);
await prisma.enrollment.create({
  data: { studentId: studentB, levelId: level.id, branchId: masira.id },
});

/** A guardian and her daughter — the daughter has no login of her own. */
const parent = await person('الوالدة', parentRole.id, targa.id);
const child = await prisma.user.create({
  data: {
    nameArabic: `${TAG} الابنة`,
    sex: 'female',
    accountStatus: 'active',
    isBeneficiary: true,
  },
});
await prisma.enrollment.create({
  data: { studentId: child.id, levelId: level.id, branchId: targa.id },
});
await prisma.familyLink.create({
  data: { parentId: parent, studentId: child.id, status: 'approved', decidedAt: new Date() },
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

const block = nowBlock();
const base = {
  teachingMode: 'entire_level' as const,
  targetId: level.id,
  branchId: targa.id,
  academicYearId: year.id,
  startTime: block.start,
  endTime: block.end,
  recurrence: 'weekly',
  weekdays: [WEEKDAYS[new Date().getDay()]],
  anchorDate: day(-7),
};

type Input = Parameters<typeof createCourseSchedule>[2];

const tafseerClass = await createCourseSchedule(prisma, actor, {
  ...base,
  title: `${TAG} تفسير عن بُعد`,
  subjectId: tafseer,
  roomId: null,
  deliveryMode: 'online',
  onlineMediaMode: 'audio_video',
  staff: [
    { userId: safa, position: 'teacher' },
    { userId: amina, position: 'assistant' },
  ],
} as unknown as Input);

const fiqhClass = await createCourseSchedule(prisma, actor, {
  ...base,
  title: `${TAG} فقه عن بُعد`,
  subjectId: fiqh,
  roomId: null,
  deliveryMode: 'online',
  onlineMediaMode: 'audio_video',
  // R91 — the handover. سعاد's period ended yesterday; نادية's begins today.
  staff: [
    { userId: souad, position: 'teacher', effectiveUntil: day(-1) },
    { userId: nadia, position: 'teacher', effectiveFrom: day(0) },
  ],
} as unknown as Input);

const seerahClass = await createCourseSchedule(prisma, actor, {
  ...base,
  title: `${TAG} سيرة صوت فقط`,
  subjectId: seerah,
  roomId: null,
  deliveryMode: 'online',
  onlineMediaMode: 'audio_only',
  staff: [],
} as unknown as Input);

const hadithClass = await createCourseSchedule(prisma, actor, {
  ...base,
  title: `${TAG} حديث حضوري`,
  subjectId: hadith,
  roomId: room.id,
  staff: [],
} as unknown as Input);

/** Today's occurrence of a class, and the next one — the pair every
 *  "one occurrence only" proof needs. */
async function todayAndNext(
  scheduleId: string,
): Promise<{ today: string; next: string; nextDate: string }> {
  const todayRow = await prisma.session.findFirstOrThrow({
    where: { scheduleId, deletedAt: null, date: day(0) },
    select: { id: true },
  });
  const nextRow = await prisma.session.findFirstOrThrow({
    where: { scheduleId, deletedAt: null, date: { gt: day(0) } },
    orderBy: { date: 'asc' },
    select: { id: true, date: true },
  });
  return {
    today: todayRow.id,
    next: nextRow.id,
    nextDate: nextRow.date.toISOString().slice(0, 10),
  };
}

const tafseerOcc = await todayAndNext(tafseerClass.id);
const fiqhOcc = await todayAndNext(fiqhClass.id);
const seerahOcc = await todayAndNext(seerahClass.id);
const hadithOcc = await todayAndNext(hadithClass.id);

/**
 * **R92 — today's فقه draws from BOTH branches**, and only today's. The
 * override replaces the audience branches for that one occurrence.
 */
await prisma.sessionAudienceBranch.createMany({
  data: [
    { sessionId: fiqhOcc.today, branchId: targa.id },
    { sessionId: fiqhOcc.today, branchId: masira.id },
  ],
});

/**
 * **R91 — a one-off cover on today's سيرة, and on nothing else.** هند staffs
 * no schedule at all; the occurrence's own snapshot is her whole authority.
 *
 * **Written through `session.override`, not with a raw insert**, and the
 * difference is not cosmetic: a `SessionStaff` row on an occurrence that is not
 * `overridden` is un-protected, so the next materialization resyncs the
 * occurrence from its schedule — which names nobody — and soft-deletes the
 * cover. The fixture did exactly that once, and the harness then reported the
 * cover as *refused* when the platform had simply forgotten her. The real cover
 * flow is this endpoint, and it sets `overridden` precisely so that cannot
 * happen (R43.6).
 */
const seerahRow = await prisma.session.findUniqueOrThrow({
  where: { id: seerahOcc.today },
  select: { version: true },
});
await overrideSession(prisma, actor as never, seerahOcc.today, {
  version: seerahRow.version,
  staff: [{ userId: hind, position: 'teacher' }],
} as never);

console.log(
  JSON.stringify({
    tafseerSchedule: tafseerClass.id,
    tafseerToday: tafseerOcc.today,
    fiqhToday: fiqhOcc.today,
    fiqhNext: fiqhOcc.next,
    seerahToday: seerahOcc.today,
    seerahNext: seerahOcc.next,
    hadithToday: hadithOcc.today,
    branch: targa.id,
    otherBranch: masira.id,
    room: room.id,
    level: level.id,
    safa,
    amina,
    souad,
    nadia,
    hind,
    rim,
    studentA,
    studentB,
    parent,
    child: child.id,
  }),
);
await prisma.$disconnect();
