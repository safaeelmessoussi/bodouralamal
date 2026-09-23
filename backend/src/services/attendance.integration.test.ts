import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import type { Actor } from '../policies/actor.js';
import { sessionProtectionRules } from '../policies/session-protection.js';
import { readCalendar, type CalendarActor } from './calendar.service.js';
import { assertMayEdit as assertMayEditEvent } from './event.service.js';
import {
  attendanceCandidates,
  attendanceSheet,
  markPresent,
  removeAttendance,
  type OccurrenceRef,
} from './attendance.service.js';

/**
 * **Attendance — the register the association keeps on paper** (SRS §4.7 as
 * built by Revision 123).
 *
 * Every requirement the Owner stated is pinned here, against a real PostgreSQL
 * schema, because most of them are properties of the DATABASE or of an
 * authorization decision and neither can be observed from a unit test:
 *
 * * a vacation and a party have **no sheet at all**, refused server-side;
 * * an `optional` occurrence starts **empty**, a `required` one on its roster;
 * * a beneficiary who is not enrolled **may still be marked** — enrolment
 *   decides *expected*, never *allowed*;
 * * marking twice leaves **one row**, and an unmarked person needs **no absence
 *   row**;
 * * a woman self-marks where the class allows it and **nowhere else**, and a
 *   teen or a child **never**, whatever the class says;
 * * the roster is resolved against the `AcademicPeriod` covering **the
 *   occurrence's own date** (R122), so an expired enrolment is not current
 *   merely because `deleted_at IS NULL`;
 * * the audit row carries **ids and a date, never a name** (TD-14).
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = '[attendance-test]';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const clock = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);

/** `Date.getUTCDay()` is 0-based from Sunday; the column is a named enum. */
const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

const YEAR = new Date().getUTCFullYear();
/** The occurrence every "current" assertion uses. Mid-year, so the fixture
 *  periods below bracket it whenever the suite runs. */
const TODAY = day(`${YEAR}-06-15`);
/** Two years earlier — the historical sheet, whose roster must be the roster of
 *  ITS period rather than of today's. */
const LONG_AGO = day(`${YEAR - 2}-06-15`);

let superAdminId = '';
let teacherId = '';
let outsiderTeacherId = '';
let womanId = '';
let otherWomanId = '';
let teenId = '';
let childId = '';
/** Enrolled only in the OLD period — the R122 case. */
let alumnaId = '';
/** A beneficiary enrolled nowhere near this class. */
let strangerId = '';

let branchId = '';
let roomId = '';
let womenLevelId = '';
let teenLevelId = '';
let childLevelId = '';
let womenGroupId = '';
let teenGroupId = '';
let subjectId = '';
let academicYearId = '';
let oldPeriodId = '';
let currentPeriodId = '';

let classTypeId = '';
let lectureTypeId = '';
let holidayTypeId = '';
let partyTypeId = '';
let examTypeId = '';

/** A weekly activity — two of its occurrences must not share one sheet. */
let recurringEventId = '';

/** A women's class configured for self check-in. */
let selfSessionId = '';
/** A second self-marking women's class, so the self assertions start clean. */
let selfOnlySessionId = '';
/** The same class, two years earlier — the historical sheet. */
let historicSessionId = '';
/** A women's class that is staff-marked only. */
let staffOnlySessionId = '';
/** A teens' class configured — wrongly — for self check-in. */
let teenSelfSessionId = '';
/** A children's class configured for self check-in. */
let childSelfSessionId = '';
/** A lecture: `optional`, so its sheet starts empty. */
let lectureSessionId = '';

let holidayEventId = '';
let partyEventId = '';
let activityEventId = '';
let examId = '';

const actorOf = (userId: string, role: string): Actor => ({
  userId,
  roles: [role],
  roleScopes: [{ role, branches: null }],
  activeRole: role,
});
const superAdmin = (): Actor => actorOf(superAdminId, 'super_admin');
const teacher = (): Actor => actorOf(teacherId, 'teacher');
const outsider = (): Actor => actorOf(outsiderTeacherId, 'teacher');
const woman = (): Actor => actorOf(womanId, 'student');
const teen = (): Actor => actorOf(teenId, 'student');
const child = (): Actor => actorOf(childId, 'student');

async function person(name: string, opts: { beneficiary?: boolean } = {}): Promise<string> {
  return (
    await prisma.user.create({
      data: {
        nameArabic: `${TAG} ${name}`,
        sex: 'female',
        accountStatus: 'active',
        isBeneficiary: opts.beneficiary ?? false,
      },
    })
  ).id;
}

async function schedulingType(
  name: string,
  structuralKind: 'class' | 'activity' | 'exam' | 'holiday',
  attendanceMode: 'disabled' | 'optional' | 'required',
  displayOrder: number,
): Promise<string> {
  return (
    await prisma.schedulingType.create({
      data: { name: `${TAG} ${name}`, structuralKind, attendanceMode, displayOrder },
    })
  ).id;
}

/** A class and one materialised occurrence of it, staffed by `teacherId`. */
async function classOccurrence(
  title: string,
  levelId: string,
  administrativeGroupId: string,
  typeId: string,
  marking: 'staff_only' | 'self_or_staff',
  date: Date,
): Promise<string> {
  const schedule = await prisma.recurringCourseSchedule.create({
    data: {
      title: `${TAG} ${title}`,
      subjectId,
      schedulingTypeId: typeId,
      attendanceMarking: marking,
      teachingMode: 'administrative_group',
      administrativeGroupId,
      levelId: null,
      branchId,
      startTime: clock('09:00'),
      endTime: clock('10:00'),
      recurrence: 'weekly',
      weekdays: [WEEKDAYS[date.getUTCDay()]!],
      anchorDate: date,
      academicYearId,
      staff: { create: [{ userId: teacherId, position: 'teacher' }] },
    },
  });
  return (
    await prisma.session.create({
      data: {
        scheduleId: schedule.id,
        date,
        startTime: clock('09:00'),
        endTime: clock('10:00'),
        staff: { create: [{ userId: teacherId, position: 'teacher' }] },
      },
    })
  ).id;
}

async function clear(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);

  await prisma.attendance.deleteMany({ where: { studentId: { in: ids } } });
  await prisma.trash.deleteMany({ where: { deletedById: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
  await prisma.sessionStaff.deleteMany({ where: { userId: { in: ids } } });
  await prisma.courseScheduleStaff.deleteMany({ where: { userId: { in: ids } } });
  await prisma.examStaff.deleteMany({ where: { user: { nameArabic: { startsWith: TAG } } } });
  await prisma.eventStaff.deleteMany({ where: { userId: { in: ids } } });

  await prisma.session.deleteMany({
    where: { schedule: { title: { startsWith: TAG } } },
  });
  await prisma.recurringCourseSchedule.deleteMany({ where: { title: { startsWith: TAG } } });
  await prisma.exam.deleteMany({ where: { title: { startsWith: TAG } } });
  await prisma.eventBranch.deleteMany({ where: { event: { title: { startsWith: TAG } } } });
  await prisma.eventCategory.deleteMany({ where: { event: { title: { startsWith: TAG } } } });
  await prisma.eventLevel.deleteMany({ where: { event: { title: { startsWith: TAG } } } });
  await prisma.eventAdministrativeGroup.deleteMany({
    where: { event: { title: { startsWith: TAG } } },
  });
  await prisma.event.deleteMany({ where: { title: { startsWith: TAG } } });

  await prisma.enrollment.deleteMany({ where: { studentId: { in: ids } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });

  await prisma.administrativeGroup.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.levelSubject.deleteMany({ where: { level: { name: { startsWith: TAG } } } });
  await prisma.level.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.subject.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.room.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.schedulingType.deleteMany({ where: { name: { startsWith: TAG } } });

  const years = await prisma.academicYear.findMany({
    where: { label: { in: [`${YEAR - 3}-${YEAR - 2}`, `${YEAR + 60}-${YEAR + 61}`] } },
    select: { id: true },
  });
  await prisma.academicPeriod.deleteMany({
    where: { academicYearId: { in: years.map((y) => y.id) } },
  });
  await prisma.academicYear.deleteMany({ where: { id: { in: years.map((y) => y.id) } } });
}

beforeAll(async () => {
  await clear();

  superAdminId = await person('المديرة');
  teacherId = await person('المؤطرة');
  outsiderTeacherId = await person('مؤطرة أخرى');
  womanId = await person('امرأة', { beneficiary: true });
  otherWomanId = await person('امرأة ثانية', { beneficiary: true });
  teenId = await person('يافعة', { beneficiary: true });
  childId = await person('طفلة', { beneficiary: true });
  alumnaId = await person('خريجة', { beneficiary: true });
  strangerId = await person('غريبة', { beneficiary: true });

  branchId = (await prisma.branch.create({ data: { name: `${TAG} فرع` } })).id;
  roomId = (await prisma.room.create({ data: { name: `${TAG} قاعة`, branchId } })).id;
  subjectId = (await prisma.subject.create({ data: { name: `${TAG} مادة` } })).id;

  /**
   * **The Category flag, not the Category NAME.** §4.4b forbids reading a rule
   * off a label, so the fixture sets `selfAttendanceAllowed` structurally — an
   * adult Category and two that are not. Naming them المرأة / اليافعات / الطفل
   * would make the suite pass for the wrong reason.
   */
  const womenCategory = await prisma.category.create({
    data: { name: `${TAG} فئة بالغات`, selfAttendanceAllowed: true },
  });
  const teenCategory = await prisma.category.create({
    data: { name: `${TAG} فئة يافعات`, selfAttendanceAllowed: false },
  });
  const childCategory = await prisma.category.create({
    data: { name: `${TAG} فئة أطفال`, selfAttendanceAllowed: false },
  });

  womenLevelId = (
    await prisma.level.create({
      data: { name: `${TAG} مستوى نساء`, categoryId: womenCategory.id, genderRestriction: 'any' },
    })
  ).id;
  teenLevelId = (
    await prisma.level.create({
      data: { name: `${TAG} مستوى يافعات`, categoryId: teenCategory.id, genderRestriction: 'any' },
    })
  ).id;
  childLevelId = (
    await prisma.level.create({
      data: { name: `${TAG} مستوى أطفال`, categoryId: childCategory.id, genderRestriction: 'any' },
    })
  ).id;

  womenGroupId = (
    await prisma.administrativeGroup.create({
      data: { name: `${TAG} مجموعة نساء`, levelId: womenLevelId, branchId },
    })
  ).id;
  teenGroupId = (
    await prisma.administrativeGroup.create({
      data: { name: `${TAG} مجموعة يافعات`, levelId: teenLevelId, branchId },
    })
  ).id;
  const childGroupId = (
    await prisma.administrativeGroup.create({
      data: { name: `${TAG} مجموعة أطفال`, levelId: childLevelId, branchId },
    })
  ).id;

  academicYearId = (
    await prisma.academicYear.create({ data: { label: `${YEAR + 60}-${YEAR + 61}` } })
  ).id;
  const oldYearId = (
    await prisma.academicYear.create({ data: { label: `${YEAR - 3}-${YEAR - 2}` } })
  ).id;

  // Two periods that do NOT overlap: one containing `LONG_AGO`, one containing
  // `TODAY`. The gap between them is the point — an enrolment in the first is
  // not current on the second's dates, and `deleted_at IS NULL` says nothing.
  oldPeriodId = (
    await prisma.academicPeriod.create({
      data: {
        academicYearId: oldYearId,
        sequence: 1,
        startDate: day(`${YEAR - 2}-01-01`),
        endDate: day(`${YEAR - 2}-12-31`),
      },
    })
  ).id;
  currentPeriodId = (
    await prisma.academicPeriod.create({
      data: {
        academicYearId,
        sequence: 1,
        startDate: day(`${YEAR}-01-01`),
        endDate: day(`${YEAR}-12-31`),
      },
    })
  ).id;

  const enrol = (studentId: string, levelId: string, groupId: string, periodId: string) =>
    prisma.enrollment.create({
      data: {
        studentId,
        levelId,
        branchId,
        administrativeGroupId: groupId,
        academicPeriodId: periodId,
      },
    });

  await enrol(womanId, womenLevelId, womenGroupId, currentPeriodId);
  await enrol(otherWomanId, womenLevelId, womenGroupId, currentPeriodId);
  await enrol(teenId, teenLevelId, teenGroupId, currentPeriodId);
  await enrol(childId, childLevelId, childGroupId, currentPeriodId);
  // **Never soft-deleted, and no longer current.** The whole R122 case.
  await enrol(alumnaId, womenLevelId, womenGroupId, oldPeriodId);
  // `strangerId` is enrolled nowhere: a beneficiary of the association who is
  // not in this class.

  classTypeId = await schedulingType('حصة', 'class', 'required', 801);
  lectureTypeId = await schedulingType('محاضرة', 'class', 'optional', 802);
  holidayTypeId = await schedulingType('عطلة', 'holiday', 'disabled', 803);
  partyTypeId = await schedulingType('حفل', 'activity', 'disabled', 804);
  const activityTypeId = await schedulingType('نشاط', 'activity', 'optional', 805);
  examTypeId = await schedulingType('اختبار', 'exam', 'required', 806);

  selfSessionId = await classOccurrence(
    'حصة نساء ذاتية',
    womenLevelId,
    womenGroupId,
    classTypeId,
    'self_or_staff',
    TODAY,
  );
  selfOnlySessionId = await classOccurrence(
    'حصة نساء ذاتية ثانية',
    womenLevelId,
    womenGroupId,
    classTypeId,
    'self_or_staff',
    TODAY,
  );
  historicSessionId = await classOccurrence(
    'حصة نساء قديمة',
    womenLevelId,
    womenGroupId,
    classTypeId,
    'staff_only',
    LONG_AGO,
  );
  staffOnlySessionId = await classOccurrence(
    'حصة نساء بالمؤطرة',
    womenLevelId,
    womenGroupId,
    classTypeId,
    'staff_only',
    TODAY,
  );
  teenSelfSessionId = await classOccurrence(
    'حصة يافعات ذاتية',
    teenLevelId,
    teenGroupId,
    classTypeId,
    'self_or_staff',
    TODAY,
  );
  childSelfSessionId = await classOccurrence(
    'حصة أطفال ذاتية',
    childLevelId,
    childGroupId,
    classTypeId,
    'self_or_staff',
    TODAY,
  );
  lectureSessionId = await classOccurrence(
    'محاضرة نساء',
    womenLevelId,
    womenGroupId,
    lectureTypeId,
    'staff_only',
    TODAY,
  );

  const activityScope = {
    branchScopes: { create: [{ branchId }] },
    levelScopes: { create: [{ levelId: womenLevelId }] },
  };
  holidayEventId = (
    await prisma.event.create({
      data: {
        title: `${TAG} عطلة العيد`,
        schedulingTypeId: holidayTypeId,
        startDate: TODAY,
        recurrenceType: 'none',
        branchScopes: { create: [{ branchId }] },
        staff: { create: [{ userId: teacherId, position: 'responsible' }] },
      },
    })
  ).id;
  partyEventId = (
    await prisma.event.create({
      data: {
        title: `${TAG} حفل نهاية السنة`,
        schedulingTypeId: partyTypeId,
        startDate: TODAY,
        recurrenceType: 'none',
        ...activityScope,
        staff: { create: [{ userId: teacherId, position: 'responsible' }] },
      },
    })
  ).id;
  activityEventId = (
    await prisma.event.create({
      data: {
        title: `${TAG} نشاط`,
        schedulingTypeId: activityTypeId,
        attendanceMarking: 'self_or_staff',
        startDate: TODAY,
        recurrenceType: 'none',
        ...activityScope,
        staff: { create: [{ userId: teacherId, position: 'responsible' }] },
      },
    })
  ).id;

  recurringEventId = (
    await prisma.event.create({
      data: {
        title: `${TAG} نشاط أسبوعي`,
        schedulingTypeId: activityTypeId,
        startDate: TODAY,
        recurrenceType: 'weekly',
        recurrenceEndDate: day(`${YEAR}-12-31`),
        ...activityScope,
        staff: { create: [{ userId: teacherId, position: 'responsible' }] },
      },
    })
  ).id;

  examId = (
    await prisma.exam.create({
      data: {
        title: `${TAG} اختبار`,
        schedulingTypeId: examTypeId,
        levelId: teenLevelId,
        administrativeGroupId: teenGroupId,
        // R124 — the arm is stored now; `exam_target_check` refuses a row whose
        // columns disagree with it, and R58's *null group means the whole Level*
        // stopped being decidable once three more targets existed.
        targetKind: 'administrative_group',
        subjectId,
        academicYearId,
        // R58 — a physical sitting names branch, room and both times or none of
        // the four; the CHECK refuses any half of it.
        branchId,
        roomId,
        startTime: clock('09:00'),
        endTime: clock('11:00'),
        date: TODAY,
        maxGrade: 20,
        // A physical sitting has no questions (§4.6 R58); the column is NOT NULL.
        staff: { create: [{ userId: teacherId, position: 'supervisor' }] },
      },
    })
  ).id;
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

const session = (id: string): OccurrenceRef => ({ kind: 'session', id });
const event = (id: string, date: Date = TODAY): OccurrenceRef => ({
  kind: 'event',
  id,
  date,
});
const exam = (id: string): OccurrenceRef => ({ kind: 'exam', id });

describe('1–2 · vacations and parties have no attendance at all', () => {
  it('refuses the sheet, the mark and the removal for a عطلة', async () => {
    await expect(attendanceSheet(prisma, superAdmin(), event(holidayEventId))).rejects.toThrow(
      /takes no attendance/,
    );
    await expect(
      markPresent(prisma, superAdmin(), event(holidayEventId), womanId),
    ).rejects.toThrow(/takes no attendance/);
    await expect(
      removeAttendance(prisma, superAdmin(), event(holidayEventId), womanId),
    ).rejects.toThrow(/takes no attendance/);
  });

  it('refuses a حفل the same way, and says why in a code a client can branch on', async () => {
    await expect(attendanceSheet(prisma, superAdmin(), event(partyEventId))).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
      details: { reason: 'ATTENDANCE_NOT_AVAILABLE' },
    });
  });

  it('refuses an occurrence whose type is unrecorded rather than guessing', async () => {
    // Every row predating R110 records no type, and nothing in it says what it
    // was. *We do not know* is answered by refusing, not by the permissive branch.
    const untyped = await prisma.event.create({
      data: {
        title: `${TAG} نشاط بلا نوع`,
        startDate: TODAY,
        recurrenceType: 'none',
        branchScopes: { create: [{ branchId }] },
      },
    });
    await expect(attendanceSheet(prisma, superAdmin(), event(untyped.id))).rejects.toMatchObject({
      details: { reason: 'ATTENDANCE_NOT_AVAILABLE' },
    });
  });
});

describe('3–4 · the two kinds of paper sheet', () => {
  it('an OPTIONAL occurrence starts with no expected names and no rows', async () => {
    const sheet = await attendanceSheet(prisma, superAdmin(), session(lectureSessionId));
    expect(sheet.mode).toBe('optional');
    // Not "nobody is enrolled" — the same class's required sheet below is full.
    expect(sheet.expected).toEqual([]);
    expect(sheet.present).toEqual([]);
  });

  it('a REQUIRED occurrence opens on the roster its enrolment resolves to', async () => {
    const sheet = await attendanceSheet(prisma, superAdmin(), session(staffOnlySessionId));
    expect(sheet.mode).toBe('required');
    expect(sheet.expected.map((e) => e.id).sort()).toEqual([womanId, otherWomanId].sort());
    // And still nobody is marked: an expected person is not a present one.
    expect(sheet.present).toEqual([]);
  });
});

describe('5–8 · marking, and what is NOT recorded', () => {
  it('marks an expected beneficiary present', async () => {
    const result = await markPresent(prisma, teacher(), session(staffOnlySessionId), womanId);
    expect(result.created).toBe(true);

    const sheet = await attendanceSheet(prisma, teacher(), session(staffOnlySessionId));
    expect(sheet.present.map((p) => p.studentId)).toEqual([womanId]);
    expect(sheet.present[0]!.self).toBe(false);
    expect(sheet.present[0]!.beyondRoster).toBe(false);
  });

  it('marks a beneficiary who is NOT enrolled in this class — enrolment decides EXPECTED, not ALLOWED', async () => {
    const result = await markPresent(prisma, teacher(), session(staffOnlySessionId), strangerId);
    expect(result.created).toBe(true);

    const sheet = await attendanceSheet(prisma, teacher(), session(staffOnlySessionId));
    const stranger = sheet.present.find((p) => p.studentId === strangerId);
    // Present, and flagged as beyond the roster — the note the paper sheet takes
    // in the margin, not a refusal.
    expect(stranger?.beyondRoster).toBe(true);
    expect(sheet.expected.map((e) => e.id)).not.toContain(strangerId);
  });

  it('cannot duplicate an attendee, however many times the mark is sent', async () => {
    const first = await markPresent(prisma, teacher(), session(selfSessionId), womanId);
    const second = await markPresent(prisma, teacher(), session(selfSessionId), womanId);
    const third = await markPresent(prisma, teacher(), session(selfSessionId), womanId);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(third.id).toBe(first.id);

    expect(
      await prisma.attendance.count({
        where: { sessionId: selfSessionId, studentId: womanId, deletedAt: null },
      }),
    ).toBe(1);
  });

  it('codex review, 2026-09-20 — MEDIUM: a genuine race between two concurrent marks answers idempotently, never 409 DUPLICATE', async () => {
    // The migration's own comment already says the check-then-insert inside
    // `markPresent` is "not enough under a double-tap" and leans on
    // `attendance_occurrence_student_unique` to keep the DATA correct; this
    // proves the RESPONSE contract now agrees too. A dedicated session and a
    // never-before-marked beneficiary, so both concurrent calls genuinely
    // start from "no row exists" rather than one already having the fast
    // path from a prior test in this file.
    const racer = await person('امرأة متسابقة', { beneficiary: true });
    const raceSessionId = await classOccurrence(
      'سباق التسجيل',
      womenLevelId,
      womenGroupId,
      classTypeId,
      'staff_only',
      new Date('2026-05-16'),
    );

    const [first, second] = await Promise.all([
      markPresent(prisma, teacher(), session(raceSessionId), racer),
      markPresent(prisma, teacher(), session(raceSessionId), racer),
    ]);

    // Exactly one side created the row; the other answers with the SAME id
    // and `created: false` — never a thrown DUPLICATE error, whichever side
    // the database's unique index happened to let through first.
    const results = [first, second];
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(results.filter((r) => !r.created)).toHaveLength(1);
    expect(first.id).toBe(second.id);

    expect(
      await prisma.attendance.count({
        where: { sessionId: raceSessionId, studentId: racer, deletedAt: null },
      }),
    ).toBe(1);
  });

  it('needs NO absence row for an expected person who was not marked', async () => {
    const sheet = await attendanceSheet(prisma, teacher(), session(staffOnlySessionId));
    // `otherWomanId` is expected and unmarked. The model records nothing at all
    // about her, which is the point: an absence table would hold one row per
    // expected person per occurrence, recording that nothing happened.
    expect(sheet.expected.map((e) => e.id)).toContain(otherWomanId);
    expect(sheet.present.map((p) => p.studentId)).not.toContain(otherWomanId);
    expect(
      await prisma.attendance.count({
        where: { sessionId: staffOnlySessionId, studentId: otherWomanId },
      }),
    ).toBe(0);
  });

  it('withdrawing a mark soft-deletes it with a Trash snapshot, and re-marking revives one row', async () => {
    await markPresent(prisma, teacher(), session(lectureSessionId), womanId);
    await removeAttendance(prisma, teacher(), session(lectureSessionId), womanId);

    const sheet = await attendanceSheet(prisma, teacher(), session(lectureSessionId));
    expect(sheet.present).toEqual([]);
    expect(
      await prisma.trash.count({
        where: { targetEntity: 'Attendance', deletedById: teacherId },
      }),
    ).toBeGreaterThan(0);

    const revived = await markPresent(prisma, teacher(), session(lectureSessionId), womanId);
    // One row, revived — not a second beside a tombstone the sheet must forever
    // remember to ignore.
    expect(
      await prisma.attendance.count({
        where: { sessionId: lectureSessionId, studentId: womanId },
      }),
    ).toBe(1);
    // Codex review, 2026-09-22 — and its tombstone went with it: the Trash no
    // longer advertises the live mark as removed.
    expect(
      await prisma.trash.count({ where: { targetEntity: 'Attendance', targetId: revived.id } }),
    ).toBe(0);
  });
});

describe('9–14 · who may mark, and who may never', () => {
  it('a woman records her own presence where the class allows it', async () => {
    const result = await markPresent(prisma, woman(), session(selfOnlySessionId), womanId, {
      self: true,
    });
    expect(result.created).toBe(true);

    const row = await prisma.attendance.findFirstOrThrow({
      where: { sessionId: selfOnlySessionId, studentId: womanId, deletedAt: null },
      select: { markedById: true },
    });
    // Self is derived from `marked_by`, which is why there is no `source` column.
    expect(row.markedById).toBe(womanId);

    const sheet = await attendanceSheet(prisma, teacher(), session(selfOnlySessionId));
    expect(sheet.present.find((p) => p.studentId === womanId)?.self).toBe(true);
  });

  it('a redundant self-mark does NOT rewrite who first recorded the presence', async () => {
    // `selfSessionId` was marked by the مؤطِّرة above. *Who recorded this* is a
    // fact about what happened, and a later duplicate must not overwrite it —
    // otherwise the register would credit the beneficiary for a mark staff made.
    const before = await prisma.attendance.findFirstOrThrow({
      where: { sessionId: selfSessionId, studentId: womanId, deletedAt: null },
      select: { id: true, markedById: true },
    });
    expect(before.markedById).toBe(teacherId);

    const again = await markPresent(prisma, woman(), session(selfSessionId), womanId, {
      self: true,
    });
    expect(again.created).toBe(false);
    expect(again.id).toBe(before.id);

    const after = await prisma.attendance.findUniqueOrThrow({
      where: { id: before.id },
      select: { markedById: true },
    });
    expect(after.markedById).toBe(teacherId);
  });

  it('and cannot where the class is staff_only', async () => {
    await expect(
      markPresent(prisma, woman(), session(staffOnlySessionId), womanId, { self: true }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      details: { reason: 'SELF_CHECK_IN_NOT_ALLOWED' },
    });
  });

  it('cannot mark ANOTHER person through the self path', async () => {
    await expect(
      markPresent(prisma, woman(), session(selfSessionId), otherWomanId, { self: true }),
    ).rejects.toMatchObject({ details: { reason: 'SELF_CHECK_IN_OTHER_PERSON' } });
    expect(
      await prisma.attendance.count({
        where: { sessionId: selfSessionId, studentId: otherWomanId, deletedAt: null },
      }),
    ).toBe(0);
  });

  it('a teen cannot self-check-in EVEN THOUGH her class is configured self_or_staff', async () => {
    // The configuration is the mistake this test exists for. The server refuses
    // it from the Category's own column, so a misconfigured schedule grants a
    // minor nothing.
    const sheet = await attendanceSheet(prisma, superAdmin(), session(teenSelfSessionId));
    expect(sheet.marking).toBe('self_or_staff');
    await expect(
      markPresent(prisma, teen(), session(teenSelfSessionId), teenId, { self: true }),
    ).rejects.toMatchObject({ details: { reason: 'SELF_CHECK_IN_NOT_ALLOWED' } });
  });

  it('a child cannot either', async () => {
    await expect(
      markPresent(prisma, child(), session(childSelfSessionId), childId, { self: true }),
    ).rejects.toMatchObject({ details: { reason: 'SELF_CHECK_IN_NOT_ALLOWED' } });
  });

  it('but staff mark a teen and a child perfectly normally', async () => {
    await expect(
      markPresent(prisma, teacher(), session(teenSelfSessionId), teenId),
    ).resolves.toMatchObject({ created: true });
    await expect(
      markPresent(prisma, teacher(), session(childSelfSessionId), childId),
    ).resolves.toMatchObject({ created: true });
  });

  it('and a woman self-marking at an activity is offered it only when her Category allows', async () => {
    await expect(
      markPresent(prisma, woman(), event(activityEventId), womanId, { self: true }),
    ).resolves.toBeTruthy();
    await expect(
      markPresent(prisma, teen(), event(activityEventId), teenId, { self: true }),
    ).rejects.toMatchObject({ details: { reason: 'SELF_CHECK_IN_NOT_ALLOWED' } });
  });
});

describe('15–16 · the roster is the OCCURRENCE date’s period, never today’s', () => {
  it('an expired enrolment is NOT on today’s roster, though deleted_at IS NULL', async () => {
    const alumna = await prisma.enrollment.findFirstOrThrow({
      where: { studentId: alumnaId },
      select: { deletedAt: true, academicPeriodId: true },
    });
    // The premise: nobody ended it. Under the pre-R122 rule she would be current.
    expect(alumna.deletedAt).toBeNull();
    expect(alumna.academicPeriodId).toBe(oldPeriodId);

    const sheet = await attendanceSheet(prisma, superAdmin(), session(staffOnlySessionId));
    expect(sheet.expected.map((e) => e.id)).not.toContain(alumnaId);
  });

  it('and IS on the roster of a sheet for a date inside her own period', async () => {
    const sheet = await attendanceSheet(prisma, superAdmin(), session(historicSessionId));
    expect(sheet.occurrenceDate.toISOString().slice(0, 10)).toBe(
      LONG_AGO.toISOString().slice(0, 10),
    );
    expect(sheet.expected.map((e) => e.id)).toEqual([alumnaId]);
    // And this year's students are not on a sheet from two years ago.
    expect(sheet.expected.map((e) => e.id)).not.toContain(womanId);
  });

  it('an enrolment with NO period is unclassified history and is never expected', async () => {
    const legacy = await person('قديمة بلا فصل', { beneficiary: true });
    await prisma.enrollment.create({
      data: {
        studentId: legacy,
        levelId: womenLevelId,
        branchId,
        administrativeGroupId: womenGroupId,
        academicPeriodId: null,
      },
    });
    for (const ref of [session(staffOnlySessionId), session(historicSessionId)]) {
      const sheet = await attendanceSheet(prisma, superAdmin(), ref);
      expect(sheet.expected.map((e) => e.id)).not.toContain(legacy);
    }
  });

  it('a mark made on the historical sheet stays where it was put', async () => {
    await markPresent(prisma, superAdmin(), session(historicSessionId), alumnaId);
    const row = await prisma.attendance.findFirstOrThrow({
      where: { sessionId: historicSessionId, studentId: alumnaId, deletedAt: null },
      select: { occurrenceDate: true },
    });
    expect(row.occurrenceDate.toISOString().slice(0, 10)).toBe(
      LONG_AGO.toISOString().slice(0, 10),
    );
  });
});

describe('17 · role and branch boundaries are unchanged', () => {
  it('a مؤطِّرة who staffs nothing here reaches neither the sheet nor the mark', async () => {
    await expect(
      attendanceSheet(prisma, outsider(), session(staffOnlySessionId)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      markPresent(prisma, outsider(), session(staffOnlySessionId), womanId),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('a beneficiary cannot read the roster through the sheet', async () => {
    // Rule O — the component is handed the permitted dataset, and «who else is
    // in my class» is not one a student may ask for.
    await expect(attendanceSheet(prisma, woman(), session(selfSessionId))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('an Admin scoped to another branch is refused, and told nothing about it', async () => {
    const scoped: Actor = {
      userId: superAdminId,
      roles: ['admin'],
      roleScopes: [{ role: 'admin', branches: ['00000000-0000-4000-8000-00000000dead'] }],
      activeRole: 'admin',
    };
    await expect(
      attendanceSheet(prisma, scoped, session(staffOnlySessionId)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('the exam sitting is marked by its supervisor, and is staff_only by construction', async () => {
    const sheet = await attendanceSheet(prisma, teacher(), exam(examId));
    expect(sheet.marking).toBe('staff_only');
    expect(sheet.selfCheckInAvailable).toBe(false);
    expect(sheet.expected.map((e) => e.id)).toEqual([teenId]);
    await expect(markPresent(prisma, teacher(), exam(examId), teenId)).resolves.toMatchObject({
      created: true,
    });
  });
});

describe('18 · the audit record, and the schedule-edit safeguard', () => {
  it('records ids and a date, and never a name', async () => {
    const rows = await prisma.auditLog.findMany({
      where: { actionType: { startsWith: 'attendance.' }, actorUserId: { in: [teacherId, womanId] } },
      select: { actionType: true, detail: true },
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const detail = row.detail as Record<string, unknown>;
      expect(Object.keys(detail).sort()).toEqual(
        ['active_role', 'occurrence_date', 'occurrence_id', 'occurrence_kind', 'student_id'].sort(),
      );
      // The mechanical guard in `audit.repository` refuses a copied identity, but
      // the property is asserted here too: a register is about minors often
      // enough that «no name reached the log» must be a test, not a convention.
      expect(JSON.stringify(detail)).not.toContain(TAG);
    }
    expect(rows.some((r) => r.actionType === 'attendance.self')).toBe(true);
  });

  it('a session carrying attendance is protected from a schedule edit (§20 rule 24)', async () => {
    const rule = sessionProtectionRules().find((r) => r.code === 'HAS_ATTENDANCE');
    // A built-in, not a contributed rule: a protection that can be switched off
    // by forgetting a bootstrap call is not a protection.
    expect(rule).toBeDefined();

    const protectedIds = await rule!.evaluate(prisma, [
      { id: selfSessionId, date: TODAY, overridden: false, status: 'scheduled' },
      { id: teenSelfSessionId, date: TODAY, overridden: false, status: 'scheduled' },
    ]);
    expect(protectedIds.has(selfSessionId)).toBe(true);
  });
});

describe('19 · a recurring activity does not share one sheet across its dates', () => {
  /** The same weekly نشاط, one week apart. */
  const first = TODAY;
  const second = day(`${YEAR}-06-22`);

  it('marks a person on ONE date and leaves the other untouched', async () => {
    await markPresent(prisma, teacher(), event(recurringEventId, first), womanId);

    const one = await attendanceSheet(prisma, teacher(), event(recurringEventId, first));
    const other = await attendanceSheet(prisma, teacher(), event(recurringEventId, second));

    expect(one.present.map((p) => p.studentId)).toEqual([womanId]);
    // The defect this exists for: an Event is ONE row expanded over many dates,
    // so an attendance record keyed only by `event_id` would make «حضرت يوم
    // 15 يونيو» mean «حضرت كل أسبوع».
    expect(other.present).toEqual([]);
    expect(other.occurrenceDate.toISOString().slice(0, 10)).toBe(
      second.toISOString().slice(0, 10),
    );
  });

  it('and the two rows differ only by their date, in the database', async () => {
    await markPresent(prisma, teacher(), event(recurringEventId, second), womanId);
    const rows = await prisma.attendance.findMany({
      where: { eventId: recurringEventId, studentId: womanId, deletedAt: null },
      select: { occurrenceDate: true },
      orderBy: { occurrenceDate: 'asc' },
    });
    expect(rows.map((r) => r.occurrenceDate.toISOString().slice(0, 10))).toEqual([
      first.toISOString().slice(0, 10),
      second.toISOString().slice(0, 10),
    ]);
  });

  it('refuses a date the activity does not occur on', async () => {
    // Accepting any date would open a sheet for a day nothing happened on —
    // and, because the date is half the key, it would never collide with a real
    // one, so the row would look perfectly valid afterwards.
    await expect(
      attendanceSheet(prisma, teacher(), event(recurringEventId, day(`${YEAR}-06-17`))),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses an activity occurrence with no date at all', async () => {
    await expect(
      attendanceSheet(prisma, teacher(), { kind: 'event', id: recurringEventId }),
    ).rejects.toMatchObject({ details: { reason: 'OCCURRENCE_DATE_REQUIRED' } });
  });
});

describe('20 · who may be ADDED — a picker for one sheet, not a directory', () => {
  it('finds a beneficiary at the occurrence’s branch by name', async () => {
    const rows = await attendanceCandidates(
      prisma,
      teacher(),
      session(lectureSessionId),
      'امرأة ثانية',
    );
    expect(rows.map((r) => r.id)).toContain(otherWomanId);
  });

  it('excludes somebody already on the sheet, so a second click cannot be a no-op', async () => {
    await markPresent(prisma, teacher(), session(lectureSessionId), otherWomanId);
    const rows = await attendanceCandidates(
      prisma,
      teacher(),
      session(lectureSessionId),
      'امرأة ثانية',
    );
    expect(rows.map((r) => r.id)).not.toContain(otherWomanId);
  });

  it('is refused for somebody who may not mark this occurrence at all', async () => {
    await expect(
      attendanceCandidates(prisma, outsider(), session(lectureSessionId), ''),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('24 · a correction is staff work, and leaves one honest history', () => {
  it('refuses a beneficiary removing her own mark', async () => {
    await markPresent(prisma, woman(), session(selfOnlySessionId), womanId, { self: true });
    // Recording your own presence and withdrawing a record of what happened are
    // different acts. She reaches the removal path as an ordinary caller and is
    // refused exactly as she is refused the sheet.
    await expect(
      removeAttendance(prisma, woman(), session(selfOnlySessionId), womanId),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(
      await prisma.attendance.count({
        where: { sessionId: selfOnlySessionId, studentId: womanId, deletedAt: null },
      }),
    ).toBe(1);
  });

  it('leaves exactly one row after remove → re-mark → remove', async () => {
    const where = { sessionId: teenSelfSessionId, studentId: teenId };
    await removeAttendance(prisma, teacher(), session(teenSelfSessionId), teenId);
    await markPresent(prisma, teacher(), session(teenSelfSessionId), teenId);
    await removeAttendance(prisma, teacher(), session(teenSelfSessionId), teenId);

    // One row, soft-deleted — never a tombstone beside a live duplicate, which
    // is what a hard delete plus a fresh insert would leave the sheet to
    // disambiguate forever.
    const rows = await prisma.attendance.findMany({ where, select: { deletedAt: true } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.deletedAt).not.toBeNull();
  });
});

describe('R123 × R124 · an exam sheet resolves through the ONE exam-audience rule', () => {
  /**
   * **The divergence this pins.** R123 wrote its own two-arm resolution for an
   * exam's roster — *named group, else the whole Level* — which was R58's entire
   * targeting model and correct at the time. R124 then gave `Exam` three more
   * arms and a canonical `examAudienceWhere`. Two answers to *who sits this
   * exam* now existed, and the attendance one would resolve a paper addressed to
   * ONE beneficiary to the whole Level.
   *
   * No route produces such a row today — `/assessments` sets no scheduling type,
   * so an online assessment has no sheet, and `/exams` writes only the two old
   * arms. The row is constructed directly here because *unreachable* is not
   * *impossible*, and the second answer is the defect whether or not something
   * currently reaches it.
   */
  it('shows only the targeted beneficiary, not everybody in the Level', async () => {
    const examType = await schedulingType('اختبار موجَّه', 'exam', 'required', 807);
    const targeted = await prisma.exam.create({
      data: {
        title: `${TAG} اختبار لمستفيدة واحدة`,
        schedulingTypeId: examType,
        mode: 'online',
        status: 'published',
        levelId: womenLevelId,
        subjectId,
        academicYearId,
        date: TODAY,
        maxGrade: 20,
        targetKind: 'student',
        studentId: womanId,
        staff: { create: [{ userId: teacherId, position: 'supervisor' }] },
      },
      select: { id: true },
    });

    const sheet = await attendanceSheet(prisma, superAdmin(), exam(targeted.id));
    expect(sheet.expected.map((e) => e.id)).toEqual([womanId]);
    // The other woman is enrolled in the same Level and is NOT expected here.
    expect(sheet.expected.map((e) => e.id)).not.toContain(otherWomanId);
  });
});

/**
 * **SRS Revision 163 §3 — «الحضور» belongs to the administration and to the
 * main AND assistant staff of the occurrence**, and the calendar says so before
 * the dialog offers it.
 */
describe('SRS Revision 163 §3 — assistants mark, and the calendar\'s advisory flag agrees with the sheet', () => {
  let assistantId = '';

  const may = async (actor: Actor, ref: OccurrenceRef): Promise<boolean> => {
    try {
      await attendanceSheet(prisma, actor, ref);
      return true;
    } catch {
      return false;
    }
  };
  const scopedAdmin = (branches: string[]): Actor => ({
    userId: superAdminId,
    roles: ['admin'],
    roleScopes: [{ role: 'admin', branches }],
    activeRole: 'admin',
  });

  beforeAll(async () => {
    assistantId = await person('مساعدة النشاط والاختبار');
    await prisma.eventStaff.create({
      data: { eventId: activityEventId, userId: assistantId, position: 'assistant' },
    });
    await prisma.examStaff.create({
      data: { examId, userId: assistantId, position: 'assistant' },
    });
    // The calendar lists sittings, never drafts (R136) — and a physical sitting
    // is published from creation everywhere the application writes one.
    await prisma.exam.update({
      where: { id: examId },
      data: { status: 'published', publishedAt: new Date() },
    });
  });

  it('lets an Event\'s assistant open its sheet — and still refuses her the Event itself', async () => {
    const assistant = actorOf(assistantId, 'teacher');
    expect(await may(assistant, event(activityEventId))).toBe(true);
    // R71.3 stands: marking who came is not editing the item.
    await expect(
      prisma.$transaction((tx) => assertMayEditEvent(tx, assistant, activityEventId)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('lets an Exam\'s assistant open its sheet, not only its supervisor', async () => {
    expect(await may(actorOf(assistantId, 'teacher'), exam(examId))).toBe(true);
    expect(await may(teacher(), exam(examId))).toBe(true);
  });

  it('still refuses a مؤطِّرة who staffs none of it', async () => {
    expect(await may(outsider(), event(activityEventId))).toBe(false);
    expect(await may(outsider(), exam(examId))).toBe(false);
    expect(await may(outsider(), session(staffOnlySessionId))).toBe(false);
  });

  it('flags every occurrence exactly as the sheet answers it, actor by actor', async () => {
    const known = new Set([
      selfSessionId,
      staffOnlySessionId,
      lectureSessionId,
      activityEventId,
      recurringEventId,
      holidayEventId,
      partyEventId,
      examId,
    ]);
    const actors: [string, Actor][] = [
      ['super admin', superAdmin()],
      ['the staffing مؤطِّرة', teacher()],
      ['the assistant', actorOf(assistantId, 'teacher')],
      ['an unrelated مؤطِّرة', outsider()],
      ['an Admin scoped to this branch', scopedAdmin([branchId])],
      ['an Admin scoped elsewhere', scopedAdmin(['00000000-0000-4000-8000-000000000001'])],
      ['a beneficiary', woman()],
    ];

    let compared = 0;
    let offered = 0;
    for (const [label, actor] of actors) {
      const viewer: CalendarActor = {
        userId: actor.userId,
        roles: actor.roles,
        roleScopes: actor.roleScopes,
        accountStatus: 'active',
      };
      const occurrences = (await readCalendar(prisma, viewer, { from: TODAY, to: TODAY })).filter(
        (o) => known.has(o.id),
      );
      for (const o of occurrences) {
        const ref: OccurrenceRef =
          o.kind === 'session' ? session(o.id) : o.kind === 'exam' ? exam(o.id) : event(o.id, TODAY);
        expect(o.viewerMayMarkAttendance, `${label} · ${o.kind} · ${o.itemTitle}`).toBe(
          await may(actor, ref),
        );
        compared += 1;
        if (o.viewerMayMarkAttendance) offered += 1;
      }
    }
    // Not vacuous: all three kinds were compared, and both answers occurred.
    expect(compared).toBeGreaterThan(20);
    expect(offered).toBeGreaterThan(0);
    expect(offered).toBeLessThan(compared);
  });

  it('offers an anonymous reader nothing, and names each item by its own typed title', async () => {
    const occurrences = await readCalendar(prisma, null, { from: TODAY, to: TODAY });
    expect(occurrences.some((o) => o.viewerMayMarkAttendance)).toBe(false);

    const asStaff = await readCalendar(
      prisma,
      { userId: superAdminId, roles: ['super_admin'], roleScopes: superAdmin().roleScopes, accountStatus: 'active' },
      { from: TODAY, to: TODAY },
    );
    const aClass = asStaff.find((o) => o.id === staffOnlySessionId);
    // `title` stays the Subject (what the chip shows); `itemTitle` is R57's.
    expect(aClass?.title).not.toBe(aClass?.itemTitle);
    expect(asStaff.find((o) => o.id === activityEventId)?.itemTitle).toBe(`${TAG} نشاط`);
    expect(asStaff.find((o) => o.id === examId)?.itemTitle).toBe(`${TAG} اختبار`);
  });
});
