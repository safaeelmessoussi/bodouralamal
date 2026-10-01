import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import type { Actor } from '../policies/actor.js';
import { deleteAdministrativeGroup } from './administrative-group.service.js';
import { deleteEvent } from './event.service.js';
import { listTrash, purgeEntry, restoreEntry } from './trash.service.js';

/**
 * **SRS Revision 191 — every element in «سلة المحذوفات» can be destroyed, and
 * every element can be restored** (the Owner, 2026-10-01).
 *
 * Real PostgreSQL throughout: the properties are foreign keys, partial unique
 * indexes and transaction rollback — the things a mock would pass by default.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = '[trash-r191-test]';

let actorUserId = '';
const superAdmin = (): Actor => ({
  userId: actorUserId,
  roles: ['super_admin'],
  roleScopes: [{ role: 'super_admin', branches: null }],
  activeRole: 'super_admin',
});

async function failure(
  run: () => Promise<unknown>,
): Promise<{ code?: string; details?: Record<string, unknown> }> {
  try {
    await run();
    return {};
  } catch (e) {
    return e as { code?: string; details?: Record<string, unknown> };
  }
}

/** A tombstone + Trash entry, as the services write them. */
async function bin(entity: string, targetId: string, snapshot: object): Promise<string> {
  return (
    await prisma.trash.create({
      data: {
        targetEntity: entity,
        targetId,
        snapshot: JSON.parse(JSON.stringify(snapshot)) as object,
        deletedById: actorUserId,
        purgeAfter: new Date(Date.now() + 7 * 86_400_000),
      },
    })
  ).id;
}

async function cleanup(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  const categories = await prisma.category.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  const categoryIds = categories.map((c) => c.id);
  const levels = await prisma.level.findMany({
    where: { categoryId: { in: categoryIds } },
    select: { id: true },
  });
  const levelIds = levels.map((l) => l.id);
  const subjects = await prisma.subject.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  const subjectIds = subjects.map((s) => s.id);
  const branches = await prisma.branch.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  const branchIds = branches.map((b) => b.id);
  const events = await prisma.event.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true },
  });
  const eventIds = events.map((e) => e.id);
  const exams = await prisma.exam.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true },
  });
  const examIds = exams.map((e) => e.id);
  const content = await prisma.educationalContent.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true },
  });
  const contentIds = content.map((c) => c.id);
  const years = await prisma.academicYear.findMany({
    where: { label: { in: ['2090-2091', '2091-2092'] } },
    select: { id: true },
  });
  const yearIds = years.map((y) => y.id);
  const types = await prisma.schedulingType.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  const typeIds = types.map((t) => t.id);

  await prisma.notification.deleteMany({
    where: { OR: [{ eventId: { in: eventIds } }, { userId: { in: userIds } }] },
  });
  await prisma.attendance.deleteMany({
    where: {
      OR: [
        { eventId: { in: eventIds } },
        { studentId: { in: userIds } },
        { examId: { in: examIds } },
      ],
    },
  });
  await prisma.eventStaff.deleteMany({
    where: { OR: [{ eventId: { in: eventIds } }, { userId: { in: userIds } }] },
  });
  await prisma.eventAdministrativeGroup.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.eventLevel.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.eventCategory.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.eventBranch.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
  await prisma.examQuestionOption.deleteMany({ where: { question: { examId: { in: examIds } } } });
  await prisma.examQuestion.deleteMany({ where: { examId: { in: examIds } } });
  await prisma.examStaff.deleteMany({ where: { examId: { in: examIds } } });
  await prisma.exam.deleteMany({ where: { id: { in: examIds } } });
  await prisma.storageRetirement.deleteMany({ where: { contentId: { in: contentIds } } });
  await prisma.sessionContent.deleteMany({ where: { contentId: { in: contentIds } } });
  await prisma.educationalContent.deleteMany({ where: { id: { in: contentIds } } });
  await prisma.familyLink.deleteMany({
    where: { OR: [{ parentId: { in: userIds } }, { studentId: { in: userIds } }] },
  });
  await prisma.studentTeachingGroup.deleteMany({
    where: { OR: [{ levelId: { in: levelIds } }, { studentId: { in: userIds } }] },
  });
  await prisma.teachingGroup.deleteMany({ where: { levelId: { in: levelIds } } });
  await prisma.enrollment.deleteMany({
    where: { OR: [{ levelId: { in: levelIds } }, { studentId: { in: userIds } }] },
  });
  await prisma.administrativeGroup.deleteMany({
    where: { OR: [{ levelId: { in: levelIds } }, { branchId: { in: branchIds } }] },
  });
  await prisma.trash.deleteMany({
    where: {
      OR: [
        { deletedById: { in: userIds } },
        { targetId: { in: [...eventIds, ...examIds, ...contentIds, ...yearIds, ...typeIds] } },
      ],
    },
  });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.level.deleteMany({ where: { id: { in: levelIds } } });
  await prisma.subject.deleteMany({ where: { id: { in: subjectIds } } });
  await prisma.category.deleteMany({ where: { id: { in: categoryIds } } });
  await prisma.branch.deleteMany({ where: { id: { in: branchIds } } });
  await prisma.academicYear.deleteMany({ where: { id: { in: yearIds } } });
  await prisma.schedulingType.deleteMany({ where: { id: { in: typeIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

beforeEach(async () => {
  await cleanup();
  actorUserId = (
    await prisma.user.create({
      data: { nameArabic: `${TAG} مشرفة`, sex: 'female', accountStatus: 'active' },
    })
  ).id;
  const role = await prisma.role.findUniqueOrThrow({ where: { name: 'super_admin' } });
  await prisma.userBranchRole.create({
    data: { userId: actorUserId, roleId: role.id, branchId: null },
  });
});

afterEach(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

async function curriculum(): Promise<{
  categoryId: string;
  levelId: string;
  subjectId: string;
  branchId: string;
}> {
  const category = await prisma.category.create({ data: { name: `${TAG} فئة` } });
  const level = await prisma.level.create({
    data: { name: `${TAG} مستوى`, categoryId: category.id },
  });
  const subject = await prisma.subject.create({ data: { name: `${TAG} مادة` } });
  const branch = await prisma.branch.create({ data: { name: `${TAG} فرع` } });
  return { categoryId: category.id, levelId: level.id, subjectId: subject.id, branchId: branch.id };
}

async function student(name: string): Promise<string> {
  return (
    await prisma.user.create({
      data: {
        nameArabic: `${TAG} ${name}`,
        sex: 'female',
        accountStatus: 'active',
        isBeneficiary: true,
      },
    })
  ).id;
}

describe('R191 §1 — an activity (نشاط)', () => {
  it('is purged WITH the notices sent about it, who answered for it and the presence recorded at it', async () => {
    // The Owner's case: `notification_event_id_fkey` refused the purge.
    const event = await prisma.event.create({
      data: {
        title: `${TAG} عطلة`,
        startDate: new Date('2026-09-01'),
        deletedAt: new Date(),
        deletedById: actorUserId,
      },
    });
    const helper = await student('مؤطِّرة النشاط');
    await prisma.notification.create({
      data: { userId: helper, type: 'event_created', eventId: event.id },
    });
    await prisma.eventStaff.create({
      data: { eventId: event.id, userId: helper, position: 'responsible' },
    });
    await prisma.attendance.create({
      data: {
        eventId: event.id,
        occurrenceDate: new Date('2026-09-01'),
        studentId: helper,
        markedById: actorUserId,
      },
    });
    const entry = await bin('Event', event.id, { title: `${TAG} عطلة` });

    const listed = (await listTrash(prisma, superAdmin(), { entity: 'Event' })).data.find(
      (r) => r.targetId === event.id,
    )!;
    expect(listed).toMatchObject({ restorable: true, purgeable: true });

    await purgeEntry(prisma, superAdmin(), entry);
    expect(await prisma.event.count({ where: { id: event.id } })).toBe(0);
    expect(await prisma.notification.count({ where: { eventId: event.id } })).toBe(0);
    expect(await prisma.eventStaff.count({ where: { eventId: event.id } })).toBe(0);
    expect(await prisma.attendance.count({ where: { eventId: event.id } })).toBe(0);
    expect(await prisma.trash.count({ where: { id: entry } })).toBe(0);
  });

  it('is restored WITH its audience, re-created from the snapshot `deleteEvent` wrote', async () => {
    const { categoryId, levelId, branchId } = await curriculum();
    const event = await prisma.event.create({
      data: {
        title: `${TAG} حفل`,
        startDate: new Date('2026-09-01'),
        branchScopes: { create: [{ branchId }] },
        categoryScopes: { create: [{ categoryId }] },
        levelScopes: { create: [{ levelId }] },
      },
    });
    await deleteEvent(prisma, superAdmin(), event.id);
    expect(await prisma.eventLevel.count({ where: { eventId: event.id } })).toBe(0);
    const entry = await prisma.trash.findFirstOrThrow({
      where: { targetEntity: 'Event', targetId: event.id },
    });

    const result = await restoreEntry(prisma, superAdmin(), entry.id);
    expect(result.scope_links_restored).toBe(3);
    expect(result.scope_links_unknown).toBe(false);
    expect(
      (await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).deletedAt,
    ).toBeNull();
    expect(await prisma.eventBranch.count({ where: { eventId: event.id, branchId } })).toBe(1);
    expect(await prisma.eventCategory.count({ where: { eventId: event.id, categoryId } })).toBe(1);
    expect(await prisma.eventLevel.count({ where: { eventId: event.id, levelId } })).toBe(1);
  });

  it('deleted before its audience was recorded, restores and SAYS its audience is unknown', async () => {
    const event = await prisma.event.create({
      data: {
        title: `${TAG} قديم`,
        startDate: new Date('2026-09-01'),
        deletedAt: new Date(),
        deletedById: actorUserId,
      },
    });
    const entry = await bin('Event', event.id, { title: `${TAG} قديم` });
    const result = await restoreEntry(prisma, superAdmin(), entry);
    expect(result.scope_links_unknown).toBe(true);
  });
});

describe('R191 §2 — a group (مجموعة) comes back re-addressed', () => {
  it('records which activities named it, and re-creates the join for the live ones', async () => {
    const { levelId, branchId } = await curriculum();
    const group = await prisma.administrativeGroup.create({
      data: { name: `${TAG} مجموعة`, levelId, branchId },
    });
    const event = await prisma.event.create({
      data: {
        title: `${TAG} نشاط المجموعة`,
        startDate: new Date('2026-09-01'),
        administrativeGroupScopes: { create: [{ administrativeGroupId: group.id }] },
      },
    });
    await deleteAdministrativeGroup(prisma, superAdmin(), group.id);
    const entry = await prisma.trash.findFirstOrThrow({
      where: { targetEntity: 'AdministrativeGroup', targetId: group.id },
    });
    expect((entry.snapshot as { removed_event_ids?: string[] }).removed_event_ids).toEqual([
      event.id,
    ]);
    expect(
      await prisma.eventAdministrativeGroup.count({ where: { administrativeGroupId: group.id } }),
    ).toBe(0);

    const result = await restoreEntry(prisma, superAdmin(), entry.id);
    expect(result.event_links_restored).toBe(1);
    expect(
      await prisma.eventAdministrativeGroup.count({
        where: { administrativeGroupId: group.id, eventId: event.id },
      }),
    ).toBe(1);
  });
});

describe('R191 §3 — an enrolment (تسجيل) and a circle seat', () => {
  it('an enrolment comes back with the seat its ending released, and refuses by name when a live one holds the place', async () => {
    const { levelId, subjectId, branchId } = await curriculum();
    const studentId = await student('مستفيدة');
    const circle = await prisma.teachingGroup.create({
      data: { name: `${TAG} حلقة`, levelId, subjectId, branchId },
    });
    const stamp = new Date();
    const enrollment = await prisma.enrollment.create({
      data: { studentId, levelId, branchId, deletedAt: stamp, deletedById: actorUserId },
    });
    const seat = await prisma.studentTeachingGroup.create({
      data: {
        studentId,
        teachingGroupId: circle.id,
        subjectId,
        levelId,
        deletedAt: stamp,
        deletedById: actorUserId,
      },
    });
    const entry = await bin('Enrollment', enrollment.id, {
      id: enrollment.id,
      teachingGroupSeats: [{ id: seat.id }],
    });

    const result = await restoreEntry(prisma, superAdmin(), entry);
    expect(result).toMatchObject({ seats_restored: 1, seats_not_restored: 0 });
    expect(
      (await prisma.enrollment.findUniqueOrThrow({ where: { id: enrollment.id } })).deletedAt,
    ).toBeNull();
    expect(
      (await prisma.studentTeachingGroup.findUniqueOrThrow({ where: { id: seat.id } })).deletedAt,
    ).toBeNull();

    // A second tombstoned seat of the same student for the Subject at the
    // Level cannot return while the first is live:
    // `student_teaching_group_student_subject_level_unique`.
    const other = await prisma.teachingGroup.create({
      data: { name: `${TAG} حلقة أخرى`, levelId, subjectId, branchId },
    });
    const duplicate = await prisma.studentTeachingGroup.create({
      data: {
        studentId,
        teachingGroupId: other.id,
        subjectId,
        levelId,
        deletedAt: new Date(),
        deletedById: actorUserId,
      },
    });
    const dupEntry = await bin('StudentTeachingGroup', duplicate.id, { id: duplicate.id });
    const refused = await failure(() => restoreEntry(prisma, superAdmin(), dupEntry));
    expect(refused.code).toBe('STATE_CONFLICT');
    expect(refused.details?.['reason']).toBe('DUPLICATE_LIVE');
    expect(refused.details?.['constraint']).toBe(
      'student_teaching_group_student_subject_level_unique',
    );
    expect(
      (await prisma.studentTeachingGroup.findUniqueOrThrow({ where: { id: duplicate.id } }))
        .deletedAt,
    ).not.toBeNull();
  });

  it('a seat returns only to a student still enrolled at the Level', async () => {
    const { levelId, subjectId, branchId } = await curriculum();
    const studentId = await student('مستفيدة غادرت');
    const circle = await prisma.teachingGroup.create({
      data: { name: `${TAG} حلقة`, levelId, subjectId, branchId },
    });
    const seat = await prisma.studentTeachingGroup.create({
      data: {
        studentId,
        teachingGroupId: circle.id,
        subjectId,
        levelId,
        deletedAt: new Date(),
        deletedById: actorUserId,
      },
    });
    const entry = await bin('StudentTeachingGroup', seat.id, { id: seat.id });
    const refused = await failure(() => restoreEntry(prisma, superAdmin(), entry));
    expect(refused.details?.['reason']).toBe('NOT_ENROLLED');

    await prisma.enrollment.create({ data: { studentId, levelId, branchId } });
    await restoreEntry(prisma, superAdmin(), entry);
    expect(
      (await prisma.studentTeachingGroup.findUniqueOrThrow({ where: { id: seat.id } })).deletedAt,
    ).toBeNull();
  });
});

describe('R191 §4 — a library item (مادة تعليمية) comes back with its file', () => {
  it('records the reverse storage obligation in the restoring transaction', async () => {
    const { levelId, subjectId } = await curriculum();
    const year = await prisma.academicYear.findFirstOrThrow({ select: { id: true } });
    const id = randomUUID();
    await prisma.educationalContent.create({
      data: {
        id,
        title: `${TAG} ملف`,
        levelId,
        subjectId,
        academicYearId: year.id,
        storageBucket: 'public',
        storageKey: `content/${id}/aa/bb/file.pdf`,
        originalFilename: 'file.pdf',
        mimeType: 'application/pdf',
        sizeBytes: BigInt(10),
        deletedAt: new Date(),
        deletedById: actorUserId,
      },
    });
    const entry = await bin('EducationalContent', id, { id, title: `${TAG} ملف` });

    const result = await restoreEntry(prisma, superAdmin(), entry);
    expect(result.file_restore_queued).toBe(true);
    expect(
      (await prisma.educationalContent.findUniqueOrThrow({ where: { id } })).deletedAt,
    ).toBeNull();
    expect(
      await prisma.storageRetirement.count({
        where: { contentId: id, operation: 'restore_quarantined_object', completedAt: null },
      }),
    ).toBe(1);
  });
});

describe('R191 §4b — a destroyed recording leaves its occurrence’s recording row, pointing at nothing', () => {
  it('a purge clears `SessionRecording.educational_content_id` rather than being held by it', async () => {
    const { levelId, subjectId, branchId } = await curriculum();
    const year = await prisma.academicYear.findFirstOrThrow({ select: { id: true } });
    const schedule = await prisma.recurringCourseSchedule.create({
      data: {
        title: `${TAG} حصة`,
        levelId,
        subjectId,
        branchId,
        academicYearId: year.id,
        teachingMode: 'entire_level',
        recurrence: 'weekly',
        startTime: new Date('1970-01-01T09:00:00.000Z'),
        endTime: new Date('1970-01-01T10:00:00.000Z'),
      },
    });
    const session = await prisma.session.create({
      data: {
        scheduleId: schedule.id,
        date: new Date('2026-09-07'),
        startTime: new Date('1970-01-01T09:00:00.000Z'),
        endTime: new Date('1970-01-01T10:00:00.000Z'),
      },
    });
    const id = randomUUID();
    await prisma.educationalContent.create({
      data: {
        id,
        title: `${TAG} تسجيل`,
        levelId,
        subjectId,
        academicYearId: year.id,
        origin: 'session_recording',
        visibility: 'private',
        storageBucket: 'private',
        storageKey: `content/${id}/aa/bb/rec.mp4`,
        originalFilename: 'rec.mp4',
        mimeType: 'audio/mp4',
        sizeBytes: BigInt(10),
        deletedAt: new Date(),
        deletedById: actorUserId,
      },
    });
    const recording = await prisma.sessionRecording.create({
      data: {
        sessionId: session.id,
        startedById: actorUserId,
        status: 'completed',
        educationalContentId: id,
      },
    });
    const entry = await bin('EducationalContent', id, { id, title: `${TAG} تسجيل` });
    try {
      await purgeEntry(prisma, superAdmin(), entry);
      expect(await prisma.educationalContent.count({ where: { id } })).toBe(0);
      const row = await prisma.sessionRecording.findUniqueOrThrow({ where: { id: recording.id } });
      expect(row.status).toBe('completed');
      expect(row.educationalContentId).toBeNull();
    } finally {
      // The purge's own storage obligation names a content id no row carries now.
      await prisma.storageRetirement.deleteMany({ where: { contentId: id } });
      await prisma.sessionRecording.deleteMany({ where: { sessionId: session.id } });
      await prisma.session.deleteMany({ where: { scheduleId: schedule.id } });
      await prisma.trash.deleteMany({ where: { targetId: schedule.id } });
      await prisma.recurringCourseSchedule.delete({ where: { id: schedule.id } });
    }
  });
});

describe('R191 §5 — a question (سؤال) keeps its place or takes the last', () => {
  it('comes back with its options; a taken place sends it to the end of the paper', async () => {
    const { levelId, subjectId } = await curriculum();
    const exam = await prisma.exam.create({
      data: {
        title: `${TAG} اختبار`,
        levelId,
        subjectId,
        date: new Date('2026-09-07'),
        maxGrade: 20,
      },
    });
    const stamp = new Date();
    const removed = await prisma.examQuestion.create({
      data: {
        examId: exam.id,
        displayOrder: 1,
        kind: 'single_choice',
        prompt: 'س1',
        deletedAt: stamp,
        deletedById: actorUserId,
      },
    });
    const option = await prisma.examQuestionOption.create({
      data: {
        questionId: removed.id,
        displayOrder: 1,
        label: 'أ',
        deletedAt: stamp,
        deletedById: actorUserId,
      },
    });
    // The paper closed the gap: a live question now holds place 1.
    await prisma.examQuestion.create({
      data: { examId: exam.id, displayOrder: 1, kind: 'short_text', prompt: 'س2' },
    });
    const entry = await bin('ExamQuestion', removed.id, { id: removed.id, prompt: 'س1' });

    await restoreEntry(prisma, superAdmin(), entry);
    const back = await prisma.examQuestion.findUniqueOrThrow({ where: { id: removed.id } });
    expect(back.deletedAt).toBeNull();
    expect(back.displayOrder).toBe(2);
    expect(
      (await prisma.examQuestionOption.findUniqueOrThrow({ where: { id: option.id } })).deletedAt,
    ).toBeNull();
  });
});

describe('R191 §6 — reference rows and a live namesake', () => {
  it('restores a year and a type; a LIVE row with the same label refuses by name', async () => {
    const year = await prisma.academicYear.create({
      data: { label: '2090-2091', deletedAt: new Date() },
    });
    const yearEntry = await bin('AcademicYear', year.id, { label: '2090-2091' });
    await restoreEntry(prisma, superAdmin(), yearEntry);
    expect(
      (await prisma.academicYear.findUniqueOrThrow({ where: { id: year.id } })).deletedAt,
    ).toBeNull();

    const type = await prisma.schedulingType.create({
      data: {
        name: `${TAG} نوع`,
        structuralKind: 'activity',
        attendanceMode: 'disabled',
        displayOrder: 900,
        deletedAt: new Date(),
      },
    });
    await prisma.schedulingType.create({
      data: {
        name: `${TAG} نوع`,
        structuralKind: 'activity',
        attendanceMode: 'disabled',
        displayOrder: 901,
      },
    });
    const typeEntry = await bin('SchedulingType', type.id, { name: `${TAG} نوع` });
    const refused = await failure(() => restoreEntry(prisma, superAdmin(), typeEntry));
    expect(refused.details?.['reason']).toBe('DUPLICATE_LIVE');
    expect(refused.details?.['constraint']).toBe('scheduling_type_name_live_key');
  });
});

describe('R191 §7 — a presence record (سجل حضور)', () => {
  it('is restored into its occurrence and purged as a leaf', async () => {
    const event = await prisma.event.create({
      data: { title: `${TAG} نشاط حضور`, startDate: new Date('2026-09-01') },
    });
    const studentId = await student('حاضرة');
    const row = await prisma.attendance.create({
      data: {
        eventId: event.id,
        occurrenceDate: new Date('2026-09-01'),
        studentId,
        markedById: actorUserId,
        deletedAt: new Date(),
        deletedById: actorUserId,
      },
    });
    const entry = await bin('Attendance', row.id, { id: row.id });
    await restoreEntry(prisma, superAdmin(), entry);
    expect(
      (await prisma.attendance.findUniqueOrThrow({ where: { id: row.id } })).deletedAt,
    ).toBeNull();

    await prisma.attendance.update({
      where: { id: row.id },
      data: { deletedAt: new Date(), deletedById: actorUserId },
    });
    const again = await bin('Attendance', row.id, { id: row.id });
    await purgeEntry(prisma, superAdmin(), again);
    expect(await prisma.attendance.count({ where: { id: row.id } })).toBe(0);
  });
});

describe('R191 §8 — a deleted parent takes its deleted dependents, and names a live one', () => {
  it('a Level purge takes the deleted enrolment under it through that enrolment’s own entry', async () => {
    const { levelId, branchId } = await curriculum();
    const studentId = await student('مسجَّلة سابقًا');
    const enrollment = await prisma.enrollment.create({
      data: { studentId, levelId, branchId, deletedAt: new Date(), deletedById: actorUserId },
    });
    const enrollmentEntry = await bin('Enrollment', enrollment.id, { id: enrollment.id });
    await prisma.level.update({
      where: { id: levelId },
      data: { deletedAt: new Date(), deletedById: actorUserId },
    });
    const levelEntry = await bin('Level', levelId, {
      name: `${TAG} مستوى`,
      cascaded_level_subject_ids: [],
      cascaded_level_surah_ids: [],
      cascaded_administrative_group_ids: [],
    });

    await purgeEntry(prisma, superAdmin(), levelEntry);
    expect(await prisma.level.count({ where: { id: levelId } })).toBe(0);
    expect(await prisma.enrollment.count({ where: { id: enrollment.id } })).toBe(0);
    expect(await prisma.trash.count({ where: { id: { in: [levelEntry, enrollmentEntry] } } })).toBe(
      0,
    );
    const trail = await prisma.auditLog.findFirst({
      where: { actionType: 'trash.permanent_delete', targetId: levelId },
    });
    expect(trail?.detail).toMatchObject({ dependents_purged: { Enrollment: 1 } });
  });

  it('a tombstoned join row that NO entry names (a 2026-08 cascade) goes with the Level, counted apart', async () => {
    const { levelId, subjectId } = await curriculum();
    const orphan = await prisma.levelSubject.create({
      data: { levelId, subjectId, deletedAt: new Date('2026-08-27T13:08:56.000Z') },
    });
    await prisma.level.update({
      where: { id: levelId },
      data: { deletedAt: new Date(), deletedById: actorUserId },
    });
    // The snapshot predates `cascaded_level_subject_ids`: the row is in no list.
    const levelEntry = await bin('Level', levelId, { name: `${TAG} مستوى` });

    await purgeEntry(prisma, superAdmin(), levelEntry);
    expect(await prisma.level.count({ where: { id: levelId } })).toBe(0);
    expect(await prisma.levelSubject.count({ where: { id: orphan.id } })).toBe(0);
    const trail = await prisma.auditLog.findFirst({
      where: { actionType: 'trash.permanent_delete', targetId: levelId },
    });
    expect(trail?.detail).toMatchObject({ orphans_purged: { LevelSubject: 1 } });
  });

  it('a LIVE enrolment keeps the Level, and the refusal names it in domain terms', async () => {
    const { levelId, branchId } = await curriculum();
    const studentId = await student('مسجَّلة حاليًا');
    await prisma.enrollment.create({ data: { studentId, levelId, branchId } });
    await prisma.level.update({
      where: { id: levelId },
      data: { deletedAt: new Date(), deletedById: actorUserId },
    });
    const levelEntry = await bin('Level', levelId, {
      name: `${TAG} مستوى`,
      cascaded_level_subject_ids: [],
      cascaded_level_surah_ids: [],
      cascaded_administrative_group_ids: [],
    });
    const refused = await failure(() => purgeEntry(prisma, superAdmin(), levelEntry));
    expect(refused.details?.['reason']).toBe('DEPENDENTS_EXIST');
    expect(refused.details?.['blocking_entity']).toBe('Enrollment');
    expect(await prisma.level.count({ where: { id: levelId } })).toBe(1);
  });
});
