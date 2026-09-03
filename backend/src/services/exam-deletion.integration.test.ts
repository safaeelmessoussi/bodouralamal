import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import { actorFor } from '../test-support/actor.js';
import { deleteExam } from './exam.service.js';
import { purgeEntry } from './trash.service.js';

/**
 * **What an assessment's deletion may and may not destroy** (Owner decision,
 * 2026-09-03; §4.6, R59, R123, R124).
 *
 * `deleteExam` is a soft delete, so not one of the six `Restrict` foreign keys
 * pointing at `exam` ever fires — the row is updated, never removed. Nine
 * distinct situations therefore behaved **identically** before this suite
 * existed: a bare draft and a delivered, marked, attended sitting were both
 * tombstoned by the same click, and every reader's `deleted_at IS NULL` filter
 * withdrew the paper, the marks and the register together.
 *
 * The line the Owner drew is **student educational evidence** — a submission in
 * any state, or a Grade in any status. Publication is not the line, because
 * publishing creates no student record; attendance is not the line either,
 * because R123 makes it a fact about the occurrence rather than about
 * achievement. Both halves are asserted here, in both directions, because a
 * guard that only ever refuses is as wrong as one that never does.
 *
 * Written at the service against a real schema: the FK behaviour, the Trash
 * snapshot, the audit row and the branch-scope refusal are all properties of
 * the database or of an authorization decision, and a unit test sees none of
 * them.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = '[exam-deletion-test]';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const clock = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);
const DATE = day(`${new Date().getUTCFullYear()}-06-15`);

let superAdminId = '';
let adminAId = '';
let adminBId = '';
let studentId = '';
let branchAId = '';
let branchBId = '';
let roomAId = '';
let levelId = '';
let groupId = '';
let subjectId = '';
let academicYearId = '';
let examTypeId = '';

async function makeUser(label: string, role?: string, branchId?: string | null): Promise<string> {
  const user = await prisma.user.create({
    // R80 — every person carries a recorded sex; the column is NOT NULL.
    data: { sex: 'female', nameArabic: `${TAG} ${label}`, accountStatus: 'active' },
  });
  if (role) {
    const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: role } });
    await prisma.userBranchRole.create({
      data: { userId: user.id, roleId: roleRow.id, branchId: branchId ?? null },
    });
  }
  return user.id;
}

/** A physical sitting: R58's CHECK wants branch, room and both times together. */
async function makeExam(
  label: string,
  opts: { status?: 'draft' | 'published' | 'closed'; branchId?: string } = {},
): Promise<string> {
  const row = await prisma.exam.create({
    data: {
      title: `${TAG} ${label}`,
      schedulingTypeId: examTypeId,
      levelId,
      administrativeGroupId: groupId,
      // R124 — the target arm is stored; `exam_target_check` refuses a row whose
      // columns disagree with it.
      targetKind: 'administrative_group',
      subjectId,
      academicYearId,
      branchId: opts.branchId ?? branchAId,
      roomId: roomAId,
      startTime: clock('09:00'),
      endTime: clock('11:00'),
      date: DATE,
      maxGrade: 20,
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.status === 'published' ? { publishedAt: new Date() } : {}),
    },
  });
  return row.id;
}

async function clear(): Promise<void> {
  const exams = await prisma.exam.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true },
  });
  const examIds = exams.map((e) => e.id);
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);

  // Every FK here is Restrict (TD-5), so the order is the test, not decoration.
  await prisma.studentExamAnswer.deleteMany({ where: { submission: { examId: { in: examIds } } } });
  await prisma.studentExamSubmission.deleteMany({ where: { examId: { in: examIds } } });
  await prisma.examQuestionOption.deleteMany({ where: { question: { examId: { in: examIds } } } });
  await prisma.examQuestion.deleteMany({ where: { examId: { in: examIds } } });
  await prisma.grade.deleteMany({ where: { examId: { in: examIds } } });
  await prisma.attendance.deleteMany({ where: { examId: { in: examIds } } });
  await prisma.notification.deleteMany({ where: { examId: { in: examIds } } });
  await prisma.examStaff.deleteMany({ where: { examId: { in: examIds } } });
  await prisma.trash.deleteMany({ where: { targetId: { in: [...examIds, ...userIds] } } });
  await prisma.auditLog.deleteMany({ where: { targetId: { in: [...examIds, ...userIds] } } });
  await prisma.exam.deleteMany({ where: { id: { in: examIds } } });

  await prisma.enrollment.deleteMany({ where: { studentId: { in: userIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.trash.deleteMany({ where: { deletedById: { in: userIds } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });

  await prisma.administrativeGroup.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.levelSubject.deleteMany({ where: { level: { name: { startsWith: TAG } } } });
  await prisma.level.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.subject.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.room.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.schedulingType.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await clear();

  branchAId = (await prisma.branch.create({ data: { name: `${TAG} فرع أ` } })).id;
  branchBId = (await prisma.branch.create({ data: { name: `${TAG} فرع ب` } })).id;
  roomAId = (
    await prisma.room.create({ data: { name: `${TAG} قاعة`, branchId: branchAId } })
  ).id;

  const categoryId = (await prisma.category.create({ data: { name: `${TAG} فئة` } })).id;
  levelId = (
    await prisma.level.create({
      data: { name: `${TAG} مستوى`, categoryId, genderRestriction: 'any' },
    })
  ).id;
  groupId = (
    await prisma.administrativeGroup.create({
      data: { name: `${TAG} مجموعة`, levelId, branchId: branchAId },
    })
  ).id;
  subjectId = (await prisma.subject.create({ data: { name: `${TAG} مادة` } })).id;
  await prisma.levelSubject.create({ data: { levelId, subjectId } });
  academicYearId = (await prisma.academicYear.findFirstOrThrow({ select: { id: true } })).id;
  examTypeId = (
    await prisma.schedulingType.create({
      data: {
        name: `${TAG} اختبار`,
        structuralKind: 'exam',
        attendanceMode: 'required',
        displayOrder: 9101,
      },
    })
  ).id;

  superAdminId = await makeUser('مديرة عامة', 'super_admin', null);
  adminAId = await makeUser('مديرة فرع أ', 'admin', branchAId);
  adminBId = await makeUser('مديرة فرع ب', 'admin', branchBId);
  studentId = await makeUser('مستفيدة');
  await prisma.enrollment.create({
    data: { studentId, administrativeGroupId: groupId, levelId, branchId: branchAId },
  });
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

/** No submission and no Grade: the sitting carries nothing a student made. */
async function expectDeleted(examId: string): Promise<void> {
  const row = await prisma.exam.findUniqueOrThrow({ where: { id: examId } });
  expect(row.deletedAt).not.toBeNull();
  expect(
    await prisma.trash.count({ where: { targetEntity: 'Exam', targetId: examId } }),
  ).toBe(1);
  expect(
    await prisma.auditLog.count({ where: { actionType: 'exam.delete', targetId: examId } }),
  ).toBe(1);
}

/**
 * A refusal must leave the transaction as it found it. The guard runs before
 * the cancellation notification and every write, so this asserts the row is
 * untouched AND that nothing was recorded suggesting a deletion happened.
 */
async function expectRefusedAndUnchanged(
  examId: string,
  actorId: string,
  counts: { submissions: number; grades: number },
): Promise<void> {
  const before = await prisma.exam.findUniqueOrThrow({ where: { id: examId } });
  const actor = await actorFor(prisma, actorId);
  await expect(deleteExam(prisma, actor, examId)).rejects.toMatchObject({
    code: 'STATE_CONFLICT',
    details: { reason: 'STUDENT_EVIDENCE_EXISTS', ...counts },
  });

  const after = await prisma.exam.findUniqueOrThrow({ where: { id: examId } });
  expect(after.deletedAt).toBeNull();
  expect(after).toEqual(before);
  expect(await prisma.trash.count({ where: { targetId: examId } })).toBe(0);
  expect(await prisma.auditLog.count({ where: { targetId: examId } })).toBe(0);
  expect(await prisma.notification.count({ where: { examId } })).toBe(0);
  // The staff tombstone is written in the same transaction and must not survive
  // a rollback either.
  expect(await prisma.examStaff.count({ where: { examId, deletedAt: { not: null } } })).toBe(0);
}

describe('exam deletion — publication does not block, student evidence does', () => {
  it('deletes a draft that carries no submission and no grade', async () => {
    const examId = await makeExam('مسودة فارغة');
    await deleteExam(prisma, await actorFor(prisma, adminAId), examId);
    await expectDeleted(examId);
  });

  it('deletes a PUBLISHED assessment that nobody sat — publishing creates no student record', async () => {
    const examId = await makeExam('منشور بلا أوراق', { status: 'published' });
    await deleteExam(prisma, await actorFor(prisma, adminAId), examId);
    await expectDeleted(examId);
  });

  it('refuses while a submission is still in progress — work somebody did is evidence', async () => {
    const examId = await makeExam('ورقة قيد الإنجاز');
    await prisma.studentExamSubmission.create({
      data: { examId, studentId, state: 'in_progress' },
    });
    await expectRefusedAndUnchanged(examId, adminAId, { submissions: 1, grades: 0 });
  });

  it('refuses once a submission is final', async () => {
    const examId = await makeExam('ورقة مسلَّمة');
    await prisma.studentExamSubmission.create({
      data: { examId, studentId, state: 'submitted', submittedAt: new Date() },
    });
    await expectRefusedAndUnchanged(examId, adminAId, { submissions: 1, grades: 0 });
  });

  it('refuses on a DRAFT grade — an unpublished mark is still a mark somebody awarded', async () => {
    const examId = await makeExam('نقطة مسودة');
    await prisma.grade.create({ data: { examId, studentId, score: 15, status: 'draft' } });
    await expectRefusedAndUnchanged(examId, adminAId, { submissions: 0, grades: 1 });
  });

  it('refuses on a published grade', async () => {
    const examId = await makeExam('نقطة منشورة');
    await prisma.grade.create({
      data: { examId, studentId, score: 18, status: 'published', publishedAt: new Date() },
    });
    await expectRefusedAndUnchanged(examId, adminAId, { submissions: 0, grades: 1 });
  });

  it('ATTENDANCE ALONE DOES NOT BLOCK — R123 makes it an occurrence fact, not achievement', async () => {
    const examId = await makeExam('حضور فقط');
    await prisma.attendance.create({
      data: { examId, occurrenceDate: DATE, studentId, markedById: adminAId },
    });
    await deleteExam(prisma, await actorFor(prisma, adminAId), examId);
    await expectDeleted(examId);
    // The register survives the tombstone and keeps pointing at it.
    expect(await prisma.attendance.count({ where: { examId } })).toBe(1);
  });

  it('QUESTIONS ALONE DO NOT BLOCK — a paper nobody answered is still a plan', async () => {
    const examId = await makeExam('أسئلة بلا إجابات');
    await prisma.examQuestion.create({
      data: { examId, displayOrder: 1, kind: 'short_text', prompt: 'سؤال' },
    });
    await deleteExam(prisma, await actorFor(prisma, adminAId), examId);
    await expectDeleted(examId);
  });

  it('reports both counts when submissions AND grades exist', async () => {
    const examId = await makeExam('ورقة ونقطة');
    await prisma.studentExamSubmission.create({
      data: { examId, studentId, state: 'submitted', submittedAt: new Date() },
    });
    await prisma.grade.create({ data: { examId, studentId, score: 12, status: 'draft' } });
    await expectRefusedAndUnchanged(examId, adminAId, { submissions: 1, grades: 1 });
  });
});

describe('exam deletion — authorization is unchanged by the evidence guard', () => {
  it('an Admin outside the branch is still refused, and told nothing more', async () => {
    const examId = await makeExam('خارج نطاق المديرة');
    await expect(
      deleteExam(prisma, await actorFor(prisma, adminBId), examId),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await prisma.exam.findUniqueOrThrow({ where: { id: examId } })).deletedAt).toBeNull();
  });

  it('a Super Admin deletes an evidence-free sitting in any branch', async () => {
    const examId = await makeExam('فرع آخر', { branchId: branchAId });
    await deleteExam(prisma, await actorFor(prisma, superAdminId), examId);
    await expectDeleted(examId);
  });

  it('a Super Admin is refused by the SAME guard — evidence is not a permission', async () => {
    const examId = await makeExam('نقطة أمام المديرة العامة');
    await prisma.grade.create({ data: { examId, studentId, score: 9, status: 'draft' } });
    await expectRefusedAndUnchanged(examId, superAdminId, { submissions: 0, grades: 1 });
  });

  it('a person with no administrative role cannot delete at all', async () => {
    const examId = await makeExam('بلا صلاحية');
    await expect(
      deleteExam(prisma, await actorFor(prisma, studentId), examId),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('exam deletion — the permanent purge remains FK-safe', () => {
  it('refuses to destroy a tombstoned exam whose questions still reference it', async () => {
    const examId = await makeExam('حذف نهائي محجوب');
    await prisma.examQuestion.create({
      data: { examId, displayOrder: 1, kind: 'long_text', prompt: 'سؤال' },
    });
    await deleteExam(prisma, await actorFor(prisma, adminAId), examId);

    const entry = await prisma.trash.findFirstOrThrow({
      where: { targetEntity: 'Exam', targetId: examId },
      select: { id: true },
    });
    // The soft delete is an UPDATE, so `Restrict` never fired. A purge is a
    // DELETE, and PostgreSQL is the authority on what still points at the row.
    await expect(
      purgeEntry(prisma, await actorFor(prisma, superAdminId), entry.id),
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT', details: { reason: 'DEPENDENTS_EXIST' } });
    expect(await prisma.exam.count({ where: { id: examId } })).toBe(1);
  });
});
