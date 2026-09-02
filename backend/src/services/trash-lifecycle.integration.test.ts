import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import type { Actor } from '../policies/actor.js';
import { deleteLevel } from './level.service.js';
import { deletePartner } from './partner.service.js';
import {
  assignSubjectToLevel,
  assignSurahToLevel,
  unassignSubjectFromLevel,
  unassignSurahFromLevel,
} from './reference-data.service.js';
import { createSchedulingType, deleteSchedulingType } from './scheduling-type.service.js';
import { deleteSubject } from './taxonomy.service.js';
import { listTrash, purgeEntry, restoreEntry } from './trash.service.js';

/**
 * Lifecycle closure for owned curriculum/reference rows (R59).
 *
 * These are real PostgreSQL assertions because the safety boundary is the FK
 * graph and transaction rollback. Mocks cannot prove that a parent purge
 * removes only the consequence rows named by its deletion snapshot, nor that
 * an independently deleted child still blocks the parent.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = '[trash-lifecycle-test]';

let actorUserId = '';

const superAdmin = (): Actor => ({
  userId: actorUserId,
  roles: ['super_admin'],
  roleScopes: [{ role: 'super_admin', branches: null }],
  activeRole: 'super_admin',
});

async function cleanup(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const userIds = users.map((row) => row.id);
  const categories = await prisma.category.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  const categoryIds = categories.map((row) => row.id);
  const levels = await prisma.level.findMany({
    where: { categoryId: { in: categoryIds } },
    select: { id: true },
  });
  const levelIds = levels.map((row) => row.id);
  const subjects = await prisma.subject.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  const subjectIds = subjects.map((row) => row.id);
  const branches = await prisma.branch.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  const branchIds = branches.map((row) => row.id);
  const groups = await prisma.administrativeGroup.findMany({
    where: { OR: [{ levelId: { in: levelIds } }, { branchId: { in: branchIds } }] },
    select: { id: true },
  });
  const groupIds = groups.map((row) => row.id);
  const events = await prisma.event.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true },
  });
  const eventIds = events.map((row) => row.id);
  const schedulingTypes = await prisma.schedulingType.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  const schedulingTypeIds = schedulingTypes.map((row) => row.id);
  const partners = await prisma.partner.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  const partnerIds = partners.map((row) => row.id);

  await prisma.eventAdministrativeGroup.deleteMany({
    where: { OR: [{ eventId: { in: eventIds } }, { administrativeGroupId: { in: groupIds } }] },
  });
  await prisma.eventLevel.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.eventCategory.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.eventBranch.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
  await prisma.studentSurahProgress.deleteMany({ where: { studentId: { in: userIds } } });
  await prisma.quranProgressLog.deleteMany({
    where: { OR: [{ studentId: { in: userIds } }, { loggedById: { in: userIds } }] },
  });
  await prisma.levelSubject.deleteMany({
    where: { OR: [{ levelId: { in: levelIds } }, { subjectId: { in: subjectIds } }] },
  });
  await prisma.levelSurah.deleteMany({ where: { levelId: { in: levelIds } } });
  await prisma.administrativeGroup.deleteMany({ where: { id: { in: groupIds } } });
  await prisma.trash.deleteMany({ where: { deletedById: { in: userIds } } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.level.deleteMany({ where: { id: { in: levelIds } } });
  await prisma.subject.deleteMany({ where: { id: { in: subjectIds } } });
  await prisma.category.deleteMany({ where: { id: { in: categoryIds } } });
  await prisma.branch.deleteMany({ where: { id: { in: branchIds } } });
  await prisma.schedulingType.deleteMany({ where: { id: { in: schedulingTypeIds } } });
  await prisma.partner.deleteMany({ where: { id: { in: partnerIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function curriculum(): Promise<{
  categoryId: string;
  levelId: string;
  subjectId: string;
}> {
  const category = await prisma.category.create({ data: { name: `${TAG} فئة` } });
  const level = await prisma.level.create({
    data: { name: `${TAG} مستوى`, categoryId: category.id },
  });
  const subject = await prisma.subject.create({ data: { name: `${TAG} مادة` } });
  return { categoryId: category.id, levelId: level.id, subjectId: subject.id };
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

afterEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('exact owned-child lifecycle plans', () => {
  it('restores and purges a Subject with exactly the LevelSubject deleted with it', async () => {
    const { levelId, subjectId } = await curriculum();
    await assignSubjectToLevel(prisma, superAdmin(), levelId, subjectId);
    const link = await prisma.levelSubject.findFirstOrThrow({ where: { levelId, subjectId } });

    await deleteSubject(prisma, superAdmin(), subjectId);
    let entry = await prisma.trash.findFirstOrThrow({
      where: { targetEntity: 'Subject', targetId: subjectId },
    });
    expect(entry.snapshot).toMatchObject({ cascaded_level_subject_ids: [link.id] });
    expect(
      (await listTrash(prisma, superAdmin(), { entity: 'Subject' })).data.find(
        (row) => row.targetId === subjectId,
      ),
    ).toMatchObject({ restorable: true, restoreBlockedReason: null });

    await restoreEntry(prisma, superAdmin(), entry.id);
    expect(await prisma.subject.findUniqueOrThrow({ where: { id: subjectId } })).toMatchObject({
      deletedAt: null,
    });
    expect(await prisma.levelSubject.findUniqueOrThrow({ where: { id: link.id } })).toMatchObject({
      deletedAt: null,
    });

    await deleteSubject(prisma, superAdmin(), subjectId);
    entry = await prisma.trash.findFirstOrThrow({
      where: { targetEntity: 'Subject', targetId: subjectId },
    });
    await purgeEntry(prisma, superAdmin(), entry.id);
    expect(await prisma.subject.count({ where: { id: subjectId } })).toBe(0);
    expect(await prisma.levelSubject.count({ where: { id: link.id } })).toBe(0);
  });

  it('purges only the exact Level-owned rows and leaves the independent Event intact', async () => {
    const { levelId, subjectId } = await curriculum();
    const branch = await prisma.branch.create({ data: { name: `${TAG} فرع` } });
    const link = await prisma.levelSubject.create({ data: { levelId, subjectId } });
    const surah = await prisma.levelSurah.create({ data: { levelId, surahId: 1 } });
    const group = await prisma.administrativeGroup.create({
      data: { name: `${TAG} مجموعة`, levelId, branchId: branch.id },
    });
    const event = await prisma.event.create({
      data: { title: `${TAG} نشاط`, startDate: new Date('2099-01-01') },
    });
    await prisma.eventAdministrativeGroup.create({
      data: { eventId: event.id, administrativeGroupId: group.id },
    });

    await deleteLevel(prisma, superAdmin(), levelId);
    const entry = await prisma.trash.findFirstOrThrow({
      where: { targetEntity: 'Level', targetId: levelId },
    });
    expect(entry.snapshot).toMatchObject({
      cascaded_level_subject_ids: [link.id],
      cascaded_level_surah_ids: [surah.id],
      cascaded_administrative_group_ids: [group.id],
    });
    expect(await prisma.eventAdministrativeGroup.count({ where: { eventId: event.id } })).toBe(0);

    await purgeEntry(prisma, superAdmin(), entry.id);
    expect(await prisma.level.count({ where: { id: levelId } })).toBe(0);
    expect(await prisma.levelSubject.count({ where: { id: link.id } })).toBe(0);
    expect(await prisma.levelSurah.count({ where: { id: surah.id } })).toBe(0);
    expect(await prisma.administrativeGroup.count({ where: { id: group.id } })).toBe(0);
    expect(await prisma.event.count({ where: { id: event.id } })).toBe(1);
  });

  it('does not sweep a LevelSubject deleted in an earlier independent act', async () => {
    const { levelId, subjectId } = await curriculum();
    const branch = await prisma.branch.create({ data: { name: `${TAG} فرع` } });
    await prisma.administrativeGroup.create({
      data: { name: `${TAG} مجموعة`, levelId, branchId: branch.id },
    });
    await assignSubjectToLevel(prisma, superAdmin(), levelId, subjectId);
    const link = await prisma.levelSubject.findFirstOrThrow({ where: { levelId, subjectId } });
    await unassignSubjectFromLevel(prisma, superAdmin(), levelId, subjectId);
    const linkTrash = await prisma.trash.findFirstOrThrow({
      where: { targetEntity: 'LevelSubject', targetId: link.id },
    });

    await deleteLevel(prisma, superAdmin(), levelId);
    const levelTrash = await prisma.trash.findFirstOrThrow({
      where: { targetEntity: 'Level', targetId: levelId },
    });
    await expect(purgeEntry(prisma, superAdmin(), levelTrash.id)).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
      details: { reason: 'DEPENDENTS_EXIST', constraint: 'level_subject_level_id_fkey' },
    });
    expect(await prisma.levelSubject.count({ where: { id: link.id } })).toBe(1);
    expect(await prisma.trash.count({ where: { id: linkTrash.id } })).toBe(1);
    expect(await prisma.level.count({ where: { id: levelId } })).toBe(1);
  });
});

describe('a blocked purge names what still depends on the record', () => {
  /**
   * **The refusal was true and unactionable** (UAT, 2026-09-02).
   *
   * Permanent deletion answered *«something still references this record»* and
   * nothing else, so an administrator's only move was to try the same purge
   * again. The record is correctly protected — nothing here bypasses a foreign
   * key — but she now learns WHICH kind of record holds it, and therefore what
   * to remove first.
   *
   * The translation is consulted only after PostgreSQL has actually refused, so
   * it predicts nothing and cannot disagree with the schema.
   */
  it('reports the blocking entity for a Level held by a Subject assignment', async () => {
    const { levelId, subjectId } = await curriculum();
    await assignSubjectToLevel(prisma, superAdmin(), levelId, subjectId);
    // Delete the Level while its assignment row is still live: the assignment
    // is a record in its own right and the FK is RESTRICT.
    await prisma.level.update({ where: { id: levelId }, data: { deletedAt: new Date() } });
    await prisma.trash.create({
      data: {
        targetEntity: 'Level',
        targetId: levelId,
        snapshot: { name: `${TAG} مستوى` },
        deletedById: actorUserId,
        purgeAfter: new Date(Date.now() + 86_400_000),
      },
    });

    const entry = (await listTrash(prisma, superAdmin(), { entity: 'Level' })).data.find(
      (row) => row.targetId === levelId,
    )!;
    await expect(purgeEntry(prisma, superAdmin(), entry.id)).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
      details: expect.objectContaining({
        reason: 'DEPENDENTS_EXIST',
        blocking_entity: 'LevelSubject',
      }),
    });

    // And the record is still there — a named refusal is still a refusal.
    expect(await prisma.level.count({ where: { id: levelId } })).toBe(1);
  });

  it('degrades to no blocker rather than a wrong one for an unmapped constraint', async () => {
    // The property that makes the table safe: it is a translation of an answer
    // already given, so an entry it lacks costs helpfulness, never correctness.
    const { categoryId } = await curriculum();
    await prisma.category.update({ where: { id: categoryId }, data: { deletedAt: new Date() } });
    await prisma.trash.create({
      data: {
        targetEntity: 'Category',
        targetId: categoryId,
        snapshot: { name: `${TAG} فئة` },
        deletedById: actorUserId,
        purgeAfter: new Date(Date.now() + 86_400_000),
      },
    });
    const entry = (await listTrash(prisma, superAdmin(), { entity: 'Category' })).data.find(
      (row) => row.targetId === categoryId,
    )!;
    // Its Level still references it, so this refuses with a MAPPED blocker.
    await expect(purgeEntry(prisma, superAdmin(), entry.id)).rejects.toMatchObject({
      details: expect.objectContaining({ blocking_entity: 'Level' }),
    });
  });
});

describe('leaf lifecycle coverage', () => {
  it('removes stale Trash when a unique curriculum pair is assigned again', async () => {
    const { levelId, subjectId } = await curriculum();
    await assignSubjectToLevel(prisma, superAdmin(), levelId, subjectId);
    await unassignSubjectFromLevel(prisma, superAdmin(), levelId, subjectId);
    const subjectLink = await prisma.levelSubject.findFirstOrThrow({ where: { levelId, subjectId } });
    expect(await prisma.trash.count({ where: { targetId: subjectLink.id } })).toBe(1);
    await assignSubjectToLevel(prisma, superAdmin(), levelId, subjectId);
    expect(await prisma.trash.count({ where: { targetId: subjectLink.id } })).toBe(0);

    await assignSurahToLevel(prisma, superAdmin(), levelId, 1);
    await unassignSurahFromLevel(prisma, superAdmin(), levelId, 1);
    const surahLink = await prisma.levelSurah.findFirstOrThrow({ where: { levelId, surahId: 1 } });
    const surahTrash = await prisma.trash.findFirstOrThrow({ where: { targetId: surahLink.id } });
    await purgeEntry(prisma, superAdmin(), surahTrash.id);
    expect(await prisma.levelSurah.count({ where: { id: surahLink.id } })).toBe(0);

    await assignSurahToLevel(prisma, superAdmin(), levelId, 2);
    await unassignSurahFromLevel(prisma, superAdmin(), levelId, 2);
    const revived = await prisma.levelSurah.findFirstOrThrow({ where: { levelId, surahId: 2 } });
    await assignSurahToLevel(prisma, superAdmin(), levelId, 2);
    expect(await prisma.trash.count({ where: { targetId: revived.id } })).toBe(0);
  });

  it('permanently removes a corrected QuranProgressLog while retaining its audit', async () => {
    const log = await prisma.quranProgressLog.create({
      data: {
        studentId: actorUserId,
        loggedById: actorUserId,
        surahId: 1,
        startAyah: 1,
        endAyah: 1,
        category: 'new_memorization',
        deletedAt: new Date(),
        deletedById: actorUserId,
      },
    });
    const entry = await prisma.trash.create({
      data: {
        targetEntity: 'QuranProgressLog',
        targetId: log.id,
        snapshot: JSON.parse(JSON.stringify(log)) as object,
        deletedById: actorUserId,
        purgeAfter: new Date('2099-01-01'),
      },
    });
    await purgeEntry(prisma, superAdmin(), entry.id);
    expect(await prisma.quranProgressLog.count({ where: { id: log.id } })).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { actionType: 'trash.permanent_delete', targetId: log.id },
      }),
    ).toBe(1);
  });

  it('permanently removes an unused deleted SchedulingType', async () => {
    const row = await createSchedulingType(prisma, superAdmin(), {
      name: `${TAG} نوع`,
      structuralKind: 'activity',
      attendanceRequired: false,
    });
    await deleteSchedulingType(prisma, superAdmin(), row.id);
    const entry = await prisma.trash.findFirstOrThrow({
      where: { targetEntity: 'SchedulingType', targetId: row.id },
    });
    await purgeEntry(prisma, superAdmin(), entry.id);
    expect(await prisma.schedulingType.count({ where: { id: row.id } })).toBe(0);
  });

  it('restores and permanently removes a Partner through the same leaf lifecycle', async () => {
    const partner = await prisma.partner.create({ data: { name: `${TAG} شريك` } });
    await deletePartner(prisma, superAdmin(), partner.id);
    let entry = await prisma.trash.findFirstOrThrow({
      where: { targetEntity: 'Partner', targetId: partner.id },
    });
    await restoreEntry(prisma, superAdmin(), entry.id);
    expect(await prisma.partner.findUniqueOrThrow({ where: { id: partner.id } })).toMatchObject({
      deletedAt: null,
    });

    await deletePartner(prisma, superAdmin(), partner.id);
    entry = await prisma.trash.findFirstOrThrow({
      where: { targetEntity: 'Partner', targetId: partner.id },
    });
    await purgeEntry(prisma, superAdmin(), entry.id);
    expect(await prisma.partner.count({ where: { id: partner.id } })).toBe(0);
  });
});
