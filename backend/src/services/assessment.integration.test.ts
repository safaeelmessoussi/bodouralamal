import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import type { Actor } from '../policies/actor.js';
import { markPresent, removeAttendance } from './attendance.service.js';
import {
  publishGrades,
  readGradeSheet,
  saveGradeDraft,
} from './grade.service.js';
import {
  addQuestion,
  assessmentsForStudent,
  closeAssessment,
  createAssessment,
  listSubmissions,
  publishAssessment,
  readSubmission,
  removeQuestion,
  reorderQuestions,
  saveResponses,
  studentPaper,
  updateQuestion,
} from './assessment.service.js';

/**
 * **The assessment builder, end to end** (SRS §4.6 as extended by R124).
 *
 * Every property the Owner listed is pinned here against a real PostgreSQL
 * schema, because most of them are facts about **constraints** or about an
 * **authorization decision** and neither is observable from a unit test:
 *
 * * a draft is invisible to students, and indistinguishable from one they are
 *   not eligible for;
 * * all four question kinds, with justification where it is allowed and refused
 *   where it is not;
 * * the five targets, and the student each one does *not* reach;
 * * save ≠ submit, and submitted is immutable;
 * * every response type validated server-side;
 * * an unpublished grade is invisible;
 * * a later enrolment change does not erase a submission;
 * * no answer text reaches the audit log.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = '[assessment-test]';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const YEAR = new Date().getUTCFullYear();
const TODAY = day(`${YEAR}-06-15`);
const ISO_TODAY = `${YEAR}-06-15`;

let superAdminId = '';
let teacherId = '';
let outsiderId = '';
let alice = '';
let bob = '';
let carol = '';
/** Enrolled in an EXPIRED period only — R122's case. */
let alumna = '';

let branchId = '';
let levelId = '';
let otherLevelId = '';
let subjectId = '';
let groupId = '';
let otherGroupId = '';
let teachingGroupId = '';
let sessionId = '';
let academicYearId = '';
let currentPeriodId = '';
let oldPeriodId = '';

const actorOf = (userId: string, role: string): Actor => ({
  userId,
  roles: [role],
  roleScopes: [{ role, branches: null }],
  activeRole: role,
});
const superAdmin = (): Actor => actorOf(superAdminId, 'super_admin');
const outsider = (): Actor => actorOf(outsiderId, 'teacher');
const student = (id: string): Actor => actorOf(id, 'student');
/** The مؤطِّرة who staffs this fixture's class — she teaches `alice`, not `carol`. */
const teacherActor = (): Actor => actorOf(teacherId, 'teacher');

async function person(name: string, beneficiary = false): Promise<string> {
  return (
    await prisma.user.create({
      data: {
        nameArabic: `${TAG} ${name}`,
        sex: 'female',
        accountStatus: 'active',
        isBeneficiary: beneficiary,
      },
    })
  ).id;
}

/** A published assessment with one question of each requested kind. */
async function publishedPaper(
  target: Parameters<typeof createAssessment>[2]['target'],
  levelOverride = levelId,
): Promise<string> {
  const { id } = await createAssessment(prisma, superAdmin(), {
    title: `${TAG} ورقة`,
    maxGrade: 20,
    levelId: levelOverride,
    subjectId,
    academicYearId,
    target,
    ...(target.kind === 'session' ? {} : { date: TODAY }),
  });
  await addQuestion(prisma, superAdmin(), id, { kind: 'short_text', prompt: 'اسمك؟' });
  await publishAssessment(prisma, superAdmin(), id);
  return id;
}

async function clear(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);

  const exams = await prisma.exam.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true },
  });
  const examIds = exams.map((e) => e.id);
  const submissions = await prisma.studentExamSubmission.findMany({
    where: { examId: { in: examIds } },
    select: { id: true },
  });
  const answers = await prisma.studentExamAnswer.findMany({
    where: { submissionId: { in: submissions.map((s) => s.id) } },
    select: { id: true },
  });
  await prisma.studentExamAnswerOption.deleteMany({
    where: { answerId: { in: answers.map((a) => a.id) } },
  });
  await prisma.studentExamAnswer.deleteMany({ where: { id: { in: answers.map((a) => a.id) } } });
  await prisma.studentExamSubmission.deleteMany({ where: { examId: { in: examIds } } });
  await prisma.grade.deleteMany({ where: { examId: { in: examIds } } });
  const questions = await prisma.examQuestion.findMany({
    where: { examId: { in: examIds } },
    select: { id: true },
  });
  await prisma.examQuestionOption.deleteMany({
    where: { questionId: { in: questions.map((q) => q.id) } },
  });
  await prisma.examQuestion.deleteMany({ where: { examId: { in: examIds } } });
  await prisma.examStaff.deleteMany({ where: { examId: { in: examIds } } });
  // R116 — publishing a grade notifies, and `notification.exam_id` is RESTRICT.
  // Exercising the REAL grading path is what made this necessary; the earlier
  // hand-written `grade.create` never sent one.
  await prisma.notification.deleteMany({ where: { examId: { in: examIds } } });
  // R123 — a sitting's register, and `attendance.exam_id` is RESTRICT too. The
  // independence tests below mark somebody present at a physical sitting, which
  // is the point of them.
  await prisma.attendance.deleteMany({ where: { examId: { in: examIds } } });
  await prisma.exam.deleteMany({ where: { id: { in: examIds } } });

  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
  // R124 — removing a question snapshots it (§20 rule 11), and `trash.deleted_by`
  // is RESTRICT, so the tombstone has to go before the person who filed it.
  await prisma.trash.deleteMany({ where: { deletedById: { in: ids } } });
  await prisma.sessionStaff.deleteMany({ where: { userId: { in: ids } } });
  await prisma.courseScheduleStaff.deleteMany({ where: { userId: { in: ids } } });
  await prisma.session.deleteMany({ where: { schedule: { title: { startsWith: TAG } } } });
  await prisma.recurringCourseSchedule.deleteMany({ where: { title: { startsWith: TAG } } });
  await prisma.studentTeachingGroup.deleteMany({ where: { studentId: { in: ids } } });
  await prisma.teachingGroup.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.enrollment.deleteMany({ where: { studentId: { in: ids } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });

  await prisma.schedulingType.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.administrativeGroup.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.levelSubject.deleteMany({ where: { level: { name: { startsWith: TAG } } } });
  await prisma.level.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.subject.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.room.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });

  // Only this suite's own years, by the exact labels it mints — never a range a
  // concurrent suite could share.
  const years = await prisma.academicYear.findMany({
    where: { label: { in: [`${YEAR + 80}-${YEAR + 81}`, `${YEAR - 5}-${YEAR - 4}`] } },
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
  outsiderId = await person('مؤطرة أخرى');
  alice = await person('أمينة', true);
  bob = await person('بشرى', true);
  carol = await person('كوثر', true);
  alumna = await person('خريجة', true);

  branchId = (await prisma.branch.create({ data: { name: `${TAG} فرع` } })).id;
  subjectId = (await prisma.subject.create({ data: { name: `${TAG} مادة` } })).id;
  const category = await prisma.category.create({ data: { name: `${TAG} فئة` } });
  levelId = (
    await prisma.level.create({
      data: { name: `${TAG} مستوى`, categoryId: category.id, genderRestriction: 'any' },
    })
  ).id;
  otherLevelId = (
    await prisma.level.create({
      data: { name: `${TAG} مستوى آخر`, categoryId: category.id, genderRestriction: 'any' },
    })
  ).id;
  await prisma.levelSubject.create({ data: { levelId, subjectId } });

  groupId = (
    await prisma.administrativeGroup.create({
      data: { name: `${TAG} مجموعة`, levelId, branchId },
    })
  ).id;
  otherGroupId = (
    await prisma.administrativeGroup.create({
      data: { name: `${TAG} مجموعة ثانية`, levelId, branchId },
    })
  ).id;
  teachingGroupId = (
    await prisma.teachingGroup.create({
      data: { name: `${TAG} حلقة`, levelId, subjectId },
    })
  ).id;

  academicYearId = (
    await prisma.academicYear.create({ data: { label: `${YEAR + 80}-${YEAR + 81}` } })
  ).id;
  const oldYear = await prisma.academicYear.create({ data: { label: `${YEAR - 5}-${YEAR - 4}` } });
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
  oldPeriodId = (
    await prisma.academicPeriod.create({
      data: {
        academicYearId: oldYear.id,
        sequence: 1,
        startDate: day(`${YEAR - 4}-01-01`),
        endDate: day(`${YEAR - 4}-12-31`),
      },
    })
  ).id;

  const enrol = (studentId: string, level: string, group: string | null, period: string) =>
    prisma.enrollment.create({
      data: {
        studentId,
        levelId: level,
        branchId,
        administrativeGroupId: group,
        academicPeriodId: period,
      },
    });
  await enrol(alice, levelId, groupId, currentPeriodId);
  await enrol(bob, levelId, otherGroupId, currentPeriodId);
  // `carol` is in another Level entirely — the unrelated student.
  await enrol(carol, otherLevelId, null, currentPeriodId);
  // Never soft-deleted, and long over.
  await enrol(alumna, levelId, groupId, oldPeriodId);

  await prisma.studentTeachingGroup.create({
    data: { studentId: alice, teachingGroupId, subjectId, levelId },
  });

  const schedule = await prisma.recurringCourseSchedule.create({
    data: {
      title: `${TAG} حصة`,
      subjectId,
      teachingMode: 'administrative_group',
      administrativeGroupId: groupId,
      branchId,
      startTime: new Date('1970-01-01T09:00:00.000Z'),
      endTime: new Date('1970-01-01T10:00:00.000Z'),
      recurrence: 'weekly',
      weekdays: ['monday'],
      anchorDate: TODAY,
      academicYearId,
      staff: { create: [{ userId: teacherId, position: 'teacher' }] },
    },
  });
  sessionId = (
    await prisma.session.create({
      data: {
        scheduleId: schedule.id,
        date: TODAY,
        startTime: new Date('1970-01-01T09:00:00.000Z'),
        endTime: new Date('1970-01-01T10:00:00.000Z'),
      },
    })
  ).id;
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe('1–10 · authoring', () => {
  let examId = '';
  const ids: string[] = [];

  it('1 · staff create a draft', async () => {
    const created = await createAssessment(prisma, superAdmin(), {
      title: `${TAG} ورقة البناء`,
      description: 'تعليمات',
      maxGrade: 20,
      levelId,
      subjectId,
      academicYearId,
      target: { kind: 'level' },
      date: TODAY,
    });
    examId = created.id;
    const row = await prisma.exam.findUniqueOrThrow({
      where: { id: examId },
      select: { status: true, mode: true, targetKind: true },
    });
    expect(row.status).toBe('draft');
    expect(row.mode).toBe('online');
    expect(row.targetKind).toBe('level');
  });

  it('2–3 · a short-text and a long-text question', async () => {
    ids.push((await addQuestion(prisma, superAdmin(), examId, { kind: 'short_text', prompt: 'اسمك؟' })).id);
    ids.push(
      (await addQuestion(prisma, superAdmin(), examId, { kind: 'long_text', prompt: 'اشرحي.' })).id,
    );
    const rows = await prisma.examQuestion.findMany({
      where: { examId, deletedAt: null },
      select: { kind: true, displayOrder: true },
      orderBy: { displayOrder: 'asc' },
    });
    // Appended, so the order is the order they were written in.
    expect(rows.map((r) => [r.kind, r.displayOrder])).toEqual([
      ['short_text', 1],
      ['long_text', 2],
    ]);
  });

  it('4–5 · a single-choice question, which may require a justification', async () => {
    const q = await addQuestion(prisma, superAdmin(), examId, {
      kind: 'single_choice',
      prompt: 'اختاري واحدة',
      justification: 'required',
      options: ['أ', 'ب', 'ج'],
    });
    ids.push(q.id);
    const row = await prisma.examQuestion.findUniqueOrThrow({
      where: { id: q.id },
      select: { justification: true, options: { select: { label: true, displayOrder: true } } },
    });
    expect(row.justification).toBe('required');
    expect(row.options).toHaveLength(3);
  });

  it('6–7 · a multiple-choice question, which may too', async () => {
    const q = await addQuestion(prisma, superAdmin(), examId, {
      kind: 'multiple_choice',
      prompt: 'اختاري ما ينطبق',
      justification: 'optional',
      options: ['أ', 'ب'],
    });
    ids.push(q.id);
    expect(
      (await prisma.examQuestion.findUniqueOrThrow({ where: { id: q.id } })).justification,
    ).toBe('optional');
  });

  it('refuses the shapes a kind cannot have, rather than dropping them', async () => {
    await expect(
      addQuestion(prisma, superAdmin(), examId, {
        kind: 'short_text',
        prompt: 'س',
        options: ['أ', 'ب'],
      }),
    ).rejects.toMatchObject({ details: { reason: 'OPTIONS_NOT_ALLOWED' } });
    await expect(
      addQuestion(prisma, superAdmin(), examId, {
        kind: 'long_text',
        prompt: 'س',
        justification: 'required',
      }),
    ).rejects.toMatchObject({ details: { reason: 'JUSTIFICATION_NOT_ALLOWED' } });
    await expect(
      addQuestion(prisma, superAdmin(), examId, {
        kind: 'single_choice',
        prompt: 'س',
        options: ['أ'],
      }),
    ).rejects.toMatchObject({ details: { reason: 'OPTIONS_REQUIRED' } });
  });

  it('8 · reorders, and refuses a partial sequence', async () => {
    const reversed = [...ids].reverse();
    await reorderQuestions(prisma, superAdmin(), examId, reversed);
    const after = await prisma.examQuestion.findMany({
      where: { examId, deletedAt: null },
      select: { id: true },
      orderBy: { displayOrder: 'asc' },
    });
    expect(after.map((q) => q.id)).toEqual(reversed);

    await expect(
      reorderQuestions(prisma, superAdmin(), examId, [ids[0]!]),
    ).rejects.toMatchObject({ details: { reason: 'INCOMPLETE_ORDER' } });
  });

  it('removes a question and closes the order up', async () => {
    const spare = await addQuestion(prisma, superAdmin(), examId, {
      kind: 'short_text',
      prompt: 'مؤقت',
    });
    await removeQuestion(prisma, superAdmin(), examId, spare.id);
    const orders = await prisma.examQuestion.findMany({
      where: { examId, deletedAt: null },
      select: { displayOrder: true },
      orderBy: { displayOrder: 'asc' },
    });
    // 1..n with no gap — «السؤال 5» on a paper of four reads as one that went
    // missing.
    expect(orders.map((o) => o.displayOrder)).toEqual([1, 2, 3, 4]);
  });

  it('9 · a draft is invisible to a student, and says only «no such assessment»', async () => {
    await expect(studentPaper(prisma, student(alice), examId, alice)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect((await assessmentsForStudent(prisma, alice)).map((a) => a.id)).not.toContain(examId);
  });

  it('10 · publishes — and refuses to publish an empty paper', async () => {
    const empty = await createAssessment(prisma, superAdmin(), {
      title: `${TAG} فارغة`,
      maxGrade: 20,
      levelId,
      target: { kind: 'level' },
      date: TODAY,
    });
    await expect(publishAssessment(prisma, superAdmin(), empty.id)).rejects.toMatchObject({
      details: { reason: 'NO_QUESTIONS' },
    });

    await publishAssessment(prisma, superAdmin(), examId);
    const row = await prisma.exam.findUniqueOrThrow({ where: { id: examId } });
    expect(row.status).toBe('published');
    expect(row.publishedAt).not.toBeNull();
    // And now it reaches the student it was written for.
    expect((await assessmentsForStudent(prisma, alice)).map((a) => a.id)).toContain(examId);
  });
});

describe('11–15 · targeting', () => {
  it('11 · a SESSION quick test reaches that class, and takes the occurrence’s date', async () => {
    const id = await publishedPaper({ kind: 'session', id: sessionId });
    const row = await prisma.exam.findUniqueOrThrow({
      where: { id },
      select: { date: true, targetKind: true },
    });
    // The occurrence's own date, never the caller's — the audience and the
    // academic period are that day's.
    expect(row.date.toISOString().slice(0, 10)).toBe(ISO_TODAY);
    expect(row.targetKind).toBe('session');

    const eligible = (await assessmentsForStudent(prisma, alice)).map((a) => a.id);
    expect(eligible).toContain(id);
    // `bob` is in another Administrative Group, so the class is not his.
    expect((await assessmentsForStudent(prisma, bob)).map((a) => a.id)).not.toContain(id);
  });

  it('12 · a LEVEL paper reaches everyone enrolled in it', async () => {
    const id = await publishedPaper({ kind: 'level' });
    for (const who of [alice, bob]) {
      expect((await assessmentsForStudent(prisma, who)).map((a) => a.id)).toContain(id);
    }
  });

  it('13 · a TEACHING GROUP paper reaches its members only', async () => {
    const id = await publishedPaper({ kind: 'teaching_group', id: teachingGroupId });
    expect((await assessmentsForStudent(prisma, alice)).map((a) => a.id)).toContain(id);
    expect((await assessmentsForStudent(prisma, bob)).map((a) => a.id)).not.toContain(id);
  });

  it('14 · an INDIVIDUAL paper reaches exactly one person', async () => {
    const id = await publishedPaper({ kind: 'student', id: bob });
    expect((await assessmentsForStudent(prisma, bob)).map((a) => a.id)).toContain(id);
    expect((await assessmentsForStudent(prisma, alice)).map((a) => a.id)).not.toContain(id);
  });

  it('15 · an unrelated student reaches none of them, and cannot open one', async () => {
    const id = await publishedPaper({ kind: 'level' });
    expect((await assessmentsForStudent(prisma, carol)).map((a) => a.id)).not.toContain(id);
    await expect(studentPaper(prisma, student(carol), id, carol)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('refuses a group, circle or beneficiary the target cannot name', async () => {
    await expect(
      createAssessment(prisma, superAdmin(), {
        title: `${TAG} خاطئة`,
        maxGrade: 20,
        levelId: otherLevelId,
        target: { kind: 'administrative_group', id: groupId },
        date: TODAY,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      createAssessment(prisma, superAdmin(), {
        title: `${TAG} خاطئة`,
        maxGrade: 20,
        levelId,
        target: { kind: 'student' },
        date: TODAY,
      }),
    ).rejects.toMatchObject({ details: { reason: 'TARGET_ID_REQUIRED' } });
  });
});

describe('16–21 · the student', () => {
  let examId = '';
  let questions: { id: string; kind: string; optionIds: string[] }[] = [];

  beforeAll(async () => {
    const created = await createAssessment(prisma, superAdmin(), {
      title: `${TAG} ورقة الطالبة`,
      maxGrade: 20,
      levelId,
      target: { kind: 'level' },
      date: TODAY,
    });
    examId = created.id;
    await addQuestion(prisma, superAdmin(), examId, { kind: 'short_text', prompt: 'اسمك؟' });
    await addQuestion(prisma, superAdmin(), examId, {
      kind: 'single_choice',
      prompt: 'اختاري',
      justification: 'required',
      options: ['أ', 'ب'],
    });
    await addQuestion(prisma, superAdmin(), examId, {
      kind: 'multiple_choice',
      prompt: 'اختاري ما ينطبق',
      options: ['س', 'ص'],
    });
    await publishAssessment(prisma, superAdmin(), examId);

    const rows = await prisma.examQuestion.findMany({
      where: { examId, deletedAt: null },
      select: { id: true, kind: true, options: { select: { id: true } } },
      orderBy: { displayOrder: 'asc' },
    });
    questions = rows.map((r) => ({ id: r.id, kind: r.kind, optionIds: r.options.map((o) => o.id) }));
  });

  it('16 · saves a partial draft — incomplete is fine, nothing is final', async () => {
    const result = await saveResponses(
      prisma,
      student(alice),
      examId,
      alice,
      [{ questionId: questions[0]!.id, text: 'أمينة' }],
      { submit: false },
    );
    expect(result.state).toBe('in_progress');
  });

  it('17 · reopens it and finds exactly what was written', async () => {
    const paper = await studentPaper(prisma, student(alice), examId, alice);
    expect(paper.submission?.state).toBe('in_progress');
    expect(paper.submission?.answers).toHaveLength(1);
    expect(paper.submission?.answers[0]!.text).toBe('أمينة');
    // Three questions, in order, with their options.
    expect(paper.questions).toHaveLength(3);
    expect(paper.questions.map((q) => q.displayOrder)).toEqual([1, 2, 3]);
  });

  it('21 · validates every response type server-side', async () => {
    const [short, single, multi] = questions;
    const send = (answers: Parameters<typeof saveResponses>[4], submit = false) =>
      saveResponses(prisma, student(alice), examId, alice, answers, { submit });

    await expect(
      send([{ questionId: short!.id, optionIds: [single!.optionIds[0]!] }]),
    ).rejects.toMatchObject({ details: { reason: 'OPTIONS_NOT_ALLOWED' } });
    await expect(send([{ questionId: single!.id, text: 'نص' }])).rejects.toMatchObject({
      details: { reason: 'TEXT_NOT_ALLOWED' },
    });
    await expect(
      send([{ questionId: single!.id, optionIds: single!.optionIds }]),
    ).rejects.toMatchObject({ details: { reason: 'SINGLE_CHOICE_ONLY' } });
    await expect(
      // An option from ANOTHER question would attach an answer to a choice she
      // was never shown.
      send([{ questionId: single!.id, optionIds: [multi!.optionIds[0]!] }]),
    ).rejects.toMatchObject({ details: { reason: 'UNKNOWN_OPTION' } });
    await expect(
      send([{ questionId: short!.id, text: 'أ' }, { questionId: short!.id, text: 'ب' }]),
    ).rejects.toMatchObject({ details: { reason: 'DUPLICATE_ANSWER' } });

    // Completeness is required only on SUBMIT — a draft is half-finished by
    // definition, and refusing to save one would defeat having a save at all.
    await expect(send([{ questionId: short!.id, text: 'أمينة' }], true)).rejects.toMatchObject({
      details: { reason: 'INCOMPLETE_SUBMISSION' },
    });
    await expect(
      send(
        [
          { questionId: short!.id, text: 'أمينة' },
          { questionId: single!.id, optionIds: [single!.optionIds[0]!] },
          { questionId: multi!.id, optionIds: [] },
        ],
        true,
      ),
    ).rejects.toMatchObject({ details: { reason: 'JUSTIFICATION_REQUIRED' } });
  });

  it('20 · cannot write somebody else’s answers', async () => {
    await expect(
      saveResponses(
        prisma,
        student(alice),
        examId,
        bob,
        [{ questionId: questions[0]!.id, text: 'مزوّر' }],
        { submit: false },
      ),
    ).rejects.toMatchObject({ details: { reason: 'NOT_YOUR_SUBMISSION' } });
  });

  it('18–19 · submits, and the answers become immutable to her', async () => {
    const [short, single, multi] = questions;
    const result = await saveResponses(
      prisma,
      student(alice),
      examId,
      alice,
      [
        { questionId: short!.id, text: 'أمينة' },
        { questionId: single!.id, optionIds: [single!.optionIds[0]!], justification: 'لأنها' },
        { questionId: multi!.id, optionIds: multi!.optionIds },
      ],
      { submit: true },
    );
    expect(result.state).toBe('submitted');

    await expect(
      saveResponses(prisma, student(alice), examId, alice, [{ questionId: short!.id, text: 'تغيير' }], {
        submit: false,
      }),
    ).rejects.toMatchObject({ details: { reason: 'ALREADY_SUBMITTED' } });

    const stored = await prisma.studentExamAnswer.findFirstOrThrow({
      where: { question: { examId }, questionId: short!.id },
      select: { text: true },
    });
    expect(stored.text).toBe('أمينة');
  });

  it('29 · and the paper is frozen — no edit can rewrite what she answered', async () => {
    const [short] = questions;
    await expect(
      addQuestion(prisma, superAdmin(), examId, { kind: 'short_text', prompt: 'متأخر' }),
    ).rejects.toMatchObject({ details: { reason: 'ASSESSMENT_HAS_SUBMISSIONS' } });
    await expect(
      updateQuestion(prisma, superAdmin(), examId, short!.id, 0, { prompt: 'إعادة صياغة' }),
    ).rejects.toMatchObject({ details: { reason: 'ASSESSMENT_HAS_SUBMISSIONS' } });
    await expect(
      removeQuestion(prisma, superAdmin(), examId, short!.id),
    ).rejects.toMatchObject({ details: { reason: 'ASSESSMENT_HAS_SUBMISSIONS' } });
    await expect(
      reorderQuestions(prisma, superAdmin(), examId, questions.map((q) => q.id).reverse()),
    ).rejects.toMatchObject({ details: { reason: 'ASSESSMENT_HAS_SUBMISSIONS' } });
  });

  it('22 · staff read the submitted answers, and an in-progress draft is NOT readable', async () => {
    const paper = await readSubmission(prisma, superAdmin(), examId, alice);
    expect(paper.submission?.state).toBe('submitted');
    expect(paper.submission?.answers).toHaveLength(3);

    await saveResponses(
      prisma,
      student(bob),
      examId,
      bob,
      [{ questionId: questions[0]!.id, text: 'نصف إجابة' }],
      { submit: false },
    );
    // She has started; she has not handed anything in. Reading it would be
    // reading over her shoulder.
    await expect(readSubmission(prisma, superAdmin(), examId, bob)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('32 · one student’s answers never reach another’s paper', async () => {
    const hers = await studentPaper(prisma, student(bob), examId, bob);
    expect(hers.submission?.answers.map((a) => a.text)).toEqual(['نصف إجابة']);
    expect(JSON.stringify(hers)).not.toContain('أمينة');
  });

  it('the inbox lists statuses and an eligible count, and no analytics', async () => {
    const inbox = await listSubmissions(prisma, superAdmin(), examId);
    expect(inbox.eligibleCount).toBeGreaterThanOrEqual(2);
    const mine = inbox.rows.find((r) => r.studentId === alice);
    expect(mine?.state).toBe('submitted');
    expect(mine?.gradeStatus).toBeNull();
  });
});

describe('23–27 · grading, and what a student may see', () => {
  let examId = '';

  beforeAll(async () => {
    examId = await publishedPaper({ kind: 'level' });
    const question = await prisma.examQuestion.findFirstOrThrow({
      where: { examId },
      select: { id: true },
    });
    await saveResponses(
      prisma,
      student(alice),
      examId,
      alice,
      [{ questionId: question.id, text: 'إجابتي' }],
      { submit: true },
    );
  });

  it('23–24 · a grade saved as draft is invisible to the student', async () => {
    // The existing Grade model, unchanged — the whole reason no second
    // assessment entity was created.
    await prisma.grade.create({
      data: { examId, studentId: alice, score: 15, status: 'draft' },
    });
    const listed = await assessmentsForStudent(prisma, alice);
    expect(listed.find((a) => a.id === examId)?.gradePublished).toBe(false);
  });

  it('25–26 · publishing it makes it visible, and only then', async () => {
    await prisma.grade.updateMany({
      where: { examId, studentId: alice },
      data: { status: 'published', publishedAt: new Date() },
    });
    const listed = await assessmentsForStudent(prisma, alice);
    expect(listed.find((a) => a.id === examId)?.gradePublished).toBe(true);
  });

  it('27 · a مؤطِّرة who teaches none of this reaches neither the paper nor the inbox', async () => {
    await expect(listSubmissions(prisma, outsider(), examId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      addQuestion(prisma, outsider(), examId, { kind: 'short_text', prompt: 'دخيلة' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('28–31 · history and privacy', () => {
  it('28 · a later enrolment change does not erase a submission', async () => {
    const examId = await publishedPaper({ kind: 'level' });
    const question = await prisma.examQuestion.findFirstOrThrow({
      where: { examId },
      select: { id: true },
    });
    await saveResponses(
      prisma,
      student(bob),
      examId,
      bob,
      [{ questionId: question.id, text: 'حاضرة' }],
      { submit: true },
    );

    // She leaves the Level entirely.
    await prisma.enrollment.updateMany({
      where: { studentId: bob, levelId },
      data: { deletedAt: new Date() },
    });
    try {
      const paper = await studentPaper(prisma, student(bob), examId, bob);
      // **A submission is its own permission to read.** Eligibility decides
      // *may I start*, never *may I see what I wrote*.
      expect(paper.submission?.answers[0]!.text).toBe('حاضرة');
      // 30 — and it stays readable to staff.
      const staffView = await readSubmission(prisma, superAdmin(), examId, bob);
      expect(staffView.submission?.answers[0]!.text).toBe('حاضرة');
      // It also stays on her own list, though she may no longer start one.
      expect((await assessmentsForStudent(prisma, bob)).map((a) => a.id)).toContain(examId);
    } finally {
      await prisma.enrollment.updateMany({
        where: { studentId: bob, levelId },
        data: { deletedAt: null },
      });
    }
  });

  it('16b/R122 · an expired enrolment is not eligible, though deleted_at IS NULL', async () => {
    const examId = await publishedPaper({ kind: 'level' });
    const row = await prisma.enrollment.findFirstOrThrow({
      where: { studentId: alumna },
      select: { deletedAt: true, academicPeriodId: true },
    });
    expect(row.deletedAt).toBeNull();
    expect(row.academicPeriodId).toBe(oldPeriodId);
    expect((await assessmentsForStudent(prisma, alumna)).map((a) => a.id)).not.toContain(examId);
  });

  it('and an enrolment with NO period is unclassified history, never eligible', async () => {
    const legacy = await person('قديمة', true);
    await prisma.enrollment.create({
      data: { studentId: legacy, levelId, branchId, academicPeriodId: null },
    });
    const examId = await publishedPaper({ kind: 'level' });
    expect((await assessmentsForStudent(prisma, legacy)).map((a) => a.id)).not.toContain(examId);
  });

  it('31 · no answer text and no question text ever reaches the audit log', async () => {
    const rows = await prisma.auditLog.findMany({
      where: { actionType: { startsWith: 'assessment.' } },
      select: { actionType: true, detail: true },
    });
    expect(rows.length).toBeGreaterThan(0);
    const serialised = JSON.stringify(rows.map((r) => r.detail));
    // A student's answer and a teacher's question are both free text a person
    // wrote. The log says THAT something happened, never WHAT was written.
    for (const written of ['أمينة', 'اسمك؟', 'إجابتي', 'حاضرة', 'لأنها', TAG]) {
      expect(serialised).not.toContain(written);
    }
    expect(rows.some((r) => r.actionType === 'assessment.submit')).toBe(true);
  });

  it('a closed assessment stops new answers and hides nothing', async () => {
    const examId = await publishedPaper({ kind: 'level' });
    const question = await prisma.examQuestion.findFirstOrThrow({
      where: { examId },
      select: { id: true },
    });
    await saveResponses(
      prisma,
      student(alice),
      examId,
      alice,
      [{ questionId: question.id, text: 'قبل الإغلاق' }],
      { submit: true },
    );
    await closeAssessment(prisma, superAdmin(), examId);

    await expect(
      saveResponses(prisma, student(bob), examId, bob, [{ questionId: question.id, text: 'متأخرة' }], {
        submit: false,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // And what was answered is still hers to read.
    const paper = await studentPaper(prisma, student(alice), examId, alice);
    expect(paper.submission?.answers[0]!.text).toBe('قبل الإغلاق');
  });
});

describe('23–27b · the REAL grading path, not a hand-written Grade row', () => {
  /**
   * **The gap this closes.** The cases above wrote `prisma.grade.create`
   * directly, which proves the visibility rule and nothing about whether an
   * online assessment can actually be graded. R124 widened `loadForGrading` —
   * an online paper has neither a branch nor a Subject, and the pre-R58 guard
   * that refuses both had to be narrowed to physical sittings — so the path
   * itself needed a test rather than an argument.
   */
  let examId = '';

  beforeAll(async () => {
    examId = await publishedPaper({ kind: 'level' });
    const question = await prisma.examQuestion.findFirstOrThrow({
      where: { examId },
      select: { id: true },
    });
    await saveResponses(
      prisma,
      student(alice),
      examId,
      alice,
      [{ questionId: question.id, text: 'إجابة للتنقيط' }],
      { submit: true },
    );
  });

  it('opens the sheet on the assessment’s own audience, with its own maximum', async () => {
    const sheet = await readGradeSheet(prisma, superAdmin(), examId);
    const ids = sheet.rows.map((r) => r.student_id);
    expect(ids).toContain(alice);
    // The Level's students, resolved through the ONE exam-audience rule — not
    // the pre-R58 branch-bound arm, which an online paper has no branch for.
    expect(ids).toContain(bob);
    expect(ids).not.toContain(carol);
    expect(String(sheet.max_grade)).toBe('20');
  });

  it('saves a draft mark and publishes it, through the sheet every exam uses', async () => {
    const saved = await saveGradeDraft(prisma, superAdmin(), examId, [
      { studentId: alice, score: 17, absent: false, version: 0 },
    ]);
    expect(saved.saved).toBe(1);

    // Still invisible: publishing the assessment is not publishing the grade.
    expect(
      (await assessmentsForStudent(prisma, alice)).find((a) => a.id === examId)?.gradePublished,
    ).toBe(false);

    const published = await publishGrades(prisma, superAdmin(), examId);
    expect(published.published).toBeGreaterThan(0);
    expect(
      (await assessmentsForStudent(prisma, alice)).find((a) => a.id === examId)?.gradePublished,
    ).toBe(true);
  });

  it('and marking a grade does not touch attendance or the submission', async () => {
    // The three facts are independent (§4.7, R123 clause 10). Grading wrote no
    // attendance row and did not move the submission out of `submitted`.
    expect(await prisma.attendance.count({ where: { examId } })).toBe(0);
    const submission = await prisma.studentExamSubmission.findFirstOrThrow({
      where: { examId, studentId: alice },
      select: { state: true },
    });
    expect(submission.state).toBe('submitted');
  });
});

describe('R123 × R124 · attendance, submission and grade are three independent facts', () => {
  /**
   * **The invariant the Owner added at ratification** (§4.7, R123 clause 10):
   * nothing gates any of the three on another, in either direction. All three
   * states below are legitimate, and the platform must be able to hold each.
   *
   * The sitting is **physical** because that is the only kind with an
   * attendance sheet — an online paper records no scheduling type, so it has
   * none — and it is the case the Owner named: *«اختبار / exam sitting:
   * attendance REQUIRED»*.
   */
  let sittingId = '';

  beforeAll(async () => {
    const examType = await prisma.schedulingType.create({
      data: {
        name: `${TAG} اختبار حضوري`,
        structuralKind: 'exam',
        attendanceMode: 'required',
        displayOrder: 940,
      },
      select: { id: true },
    });
    const room = await prisma.room.create({
      data: { name: `${TAG} قاعة`, branchId },
      select: { id: true },
    });
    sittingId = (
      await prisma.exam.create({
        data: {
          title: `${TAG} جلسة امتحان`,
          schedulingTypeId: examType.id,
          mode: 'physical',
          status: 'published',
          levelId,
          subjectId,
          academicYearId,
          date: TODAY,
          maxGrade: 20,
          // R58 — a physical sitting states branch, room and both times or none.
          branchId,
          roomId: room.id,
          startTime: new Date('1970-01-01T09:00:00.000Z'),
          endTime: new Date('1970-01-01T11:00:00.000Z'),
          targetKind: 'level',
        },
        select: { id: true },
      })
    ).id;
  });

  it('records attendance with NO submission and NO grade', async () => {
    await markPresent(prisma, superAdmin(), { kind: 'exam', id: sittingId }, alice);

    expect(
      await prisma.attendance.count({ where: { examId: sittingId, deletedAt: null } }),
    ).toBe(1);
    // She sat in the room. Whether she answered anything is a different record,
    // and this sitting's paper is on paper.
    expect(await prisma.studentExamSubmission.count({ where: { examId: sittingId } })).toBe(0);
    expect(await prisma.grade.count({ where: { examId: sittingId } })).toBe(0);
  });

  it('grades her without her ever having submitted, and attendance is untouched', async () => {
    // BR-7's world: an offline paper marked by hand. Nothing about the grade
    // reads the attendance row, and nothing about the attendance row moves.
    await saveGradeDraft(prisma, superAdmin(), sittingId, [
      { studentId: alice, score: 14, absent: false, version: 0 },
    ]);
    await publishGrades(prisma, superAdmin(), sittingId);

    const grade = await prisma.grade.findFirstOrThrow({
      where: { examId: sittingId, studentId: alice },
      select: { status: true, score: true },
    });
    expect(grade.status).toBe('published');
    expect(await prisma.studentExamSubmission.count({ where: { examId: sittingId } })).toBe(0);
    expect(
      await prisma.attendance.count({ where: { examId: sittingId, deletedAt: null } }),
    ).toBe(1);
  });

  it('and marks somebody who was NOT present at all — absence gates no grade', async () => {
    /**
     * **`bob` has no attendance row for this sitting**, and BR-7 has already
     * given him a draft `0`/absent row: the first draft save initialises every
     * student in the audience, so nobody is missing from an average by omission.
     * That row was initialised from the AUDIENCE and **not** from the register —
     * which is the invariant, seen from the other side.
     */
    const before = await prisma.grade.findFirstOrThrow({
      where: { examId: sittingId, studentId: bob },
      select: { version: true, absent: true },
    });
    expect(before.absent).toBe(true);

    // He can then be marked a real score, with no attendance row anywhere.
    await saveGradeDraft(prisma, superAdmin(), sittingId, [
      { studentId: bob, score: 9, absent: false, version: before.version },
    ]);
    expect(
      await prisma.attendance.count({ where: { examId: sittingId, studentId: bob } }),
    ).toBe(0);
    const after = await prisma.grade.findFirstOrThrow({
      where: { examId: sittingId, studentId: bob },
      select: { score: true, absent: true },
    });
    expect(after.score.toString()).toBe('9');
    expect(after.absent).toBe(false);
  });

  it('withdrawing the attendance mark leaves the published grade standing', async () => {
    await removeAttendance(prisma, superAdmin(), { kind: 'exam', id: sittingId }, alice);
    expect(
      await prisma.attendance.count({ where: { examId: sittingId, deletedAt: null } }),
    ).toBe(0);
    // The mark she was given is not a consequence of the register.
    const grade = await prisma.grade.findFirstOrThrow({
      where: { examId: sittingId, studentId: alice },
      select: { status: true },
    });
    expect(grade.status).toBe('published');
  });
});

describe('SECURITY · an individual target may not name somebody outside the author’s reach', () => {
  /**
   * **The hole this probes.** `assertMayAuthor` checks the **Level**; the
   * `student` arm then checks only that the id names a live beneficiary. A
   * مؤطِّرة authorised for a Level could therefore address a paper **by name** to
   * a beneficiary she does not teach — and, having authored it, read that
   * student's submitted answers through her own inbox.
   *
   * `carol` is enrolled in another Level entirely and is taught by nobody in
   * this fixture.
   */
  it('refuses a مؤطِّرة who does not teach the whole Level the paper names', async () => {
    /**
     * **Stricter than the leak this probe was written for**, and recorded as it
     * is rather than as it was assumed. A `student` target names no group, so
     * `assertExamInTeacherScope` asks *do you teach this whole Level* — and a
     * مؤطِّرة staffing one Administrative Group inside it does not. She is
     * refused for `carol`, whom she does not teach, **and for `alice`, whom she
     * does**.
     *
     * The refusal is safe; the second half is a **usability gap, recorded for
     * the Owner**: she cannot address a paper to her own student by name.
     * Widening it means deciding what «her own» means for a target that carries
     * no group, which is a product decision and not this session's to take.
     */
    for (const who of [carol, alice]) {
      await expect(
        createAssessment(prisma, teacherActor(), {
          title: `${TAG} ورقة موجَّهة`,
          maxGrade: 20,
          levelId,
          subjectId,
          target: { kind: 'student', id: who },
          date: TODAY,
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });

  it('an Admin scoped to another branch cannot name a beneficiary at this one', async () => {
    /**
     * **The leak this closed.** An online paper carries no branch, and the first
     * reading turned *no branch to check* into *no check*: a branch-scoped Admin
     * could address a paper **by name** to a beneficiary anywhere in the
     * association, then read her submitted answers through the inbox authoring
     * brings. TD-2 scopes an Admin to her branches, and a paper having no room
     * of its own does not widen that.
     */
    const scoped: Actor = {
      userId: superAdminId,
      roles: ['admin'],
      roleScopes: [{ role: 'admin', branches: ['00000000-0000-4000-8000-0000000000ad'] }],
      activeRole: 'admin',
    };
    await expect(
      createAssessment(prisma, scoped, {
        title: `${TAG} ورقة من فرع آخر`,
        maxGrade: 20,
        levelId,
        subjectId,
        target: { kind: 'student', id: alice },
        date: TODAY,
      }),
    ).rejects.toBeTruthy();
  });
});
