import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import type { Actor } from '../policies/actor.js';
import {
  quranSubjectId,
  teachesQuran,
} from '../policies/roster-resolution.js';
import { logProgress } from './quran.service.js';
import { createSubject } from './taxonomy.service.js';

/**
 * R107–R108 Production-seed proof. The wrapper gives this file a migrated, empty,
 * disposable PostgreSQL database and explicitly opts in. Running the actual
 * seed entry point twice is important: a local reconstruction of its writes
 * could pass while the deployment command remained wrong.
 */
const enabled = process.env.PRODUCTION_SEED_DESTRUCTIVE_FIXTURE === '1';
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const run = promisify(execFile);
const TAG = '[production-seed-r108]';

const EXPECTED_SUBJECTS = [
  { name: 'أحكام القرآن', displayOrder: 1, tracksQuranProgress: false },
  { name: 'حفظ القرآن', displayOrder: 2, tracksQuranProgress: true },
  { name: 'ترتيل وتجويد القرآن', displayOrder: 3, tracksQuranProgress: false },
  { name: 'تفسير القرآن', displayOrder: 4, tracksQuranProgress: false },
  { name: 'فقه', displayOrder: 5, tracksQuranProgress: false },
  { name: 'السيرة النبوية', displayOrder: 6, tracksQuranProgress: false },
  { name: 'العقيدة', displayOrder: 7, tracksQuranProgress: false },
  { name: 'الأذكار', displayOrder: 8, tracksQuranProgress: false },
] as const;

type SubjectSnapshot = Awaited<ReturnType<typeof subjectSnapshot>>;

async function runProductionSeed(): Promise<void> {
  const executable = join(process.cwd(), 'node_modules', '.bin', 'tsx');
  await run(executable, ['prisma/seed/production.ts'], {
    cwd: process.cwd(),
    env: process.env,
  });
}

async function subjectSnapshot() {
  return prisma.subject.findMany({
    where: { deletedAt: null },
    orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      name: true,
      displayOrder: true,
      tracksQuranProgress: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

const teacher = (userId: string, branchId: string): Actor => ({
  userId,
  roles: ['teacher'],
  roleScopes: [{ role: 'teacher', branches: [branchId] }],
});

const superAdmin = (userId: string): Actor => ({
  userId,
  roles: ['super_admin'],
  roleScopes: [{ role: 'super_admin', branches: null }],
});

async function person(name: string): Promise<string> {
  return (
    await prisma.user.create({
      data: {
        nameArabic: `${TAG} ${name}`,
        sex: 'female',
        accountStatus: 'active',
      },
    })
  ).id;
}

async function staffedSchedule(
  subjectId: string,
  branchId: string,
  groupId: string,
  userId: string,
): Promise<void> {
  const year = await prisma.academicYear.findFirstOrThrow({
    where: { isCurrent: true },
    select: { id: true },
  });
  const schedule = await prisma.recurringCourseSchedule.create({
    data: {
      title: `${TAG} حصة`,
      subjectId,
      teachingMode: 'administrative_group',
      administrativeGroupId: groupId,
      branchId,
      startTime: new Date('1970-01-01T09:00:00Z'),
      endTime: new Date('1970-01-01T10:00:00Z'),
      recurrence: 'weekly',
      weekdays: ['monday'],
      academicYearId: year.id,
    },
  });
  await prisma.courseScheduleStaff.create({
    data: { scheduleId: schedule.id, userId, position: 'teacher' },
  });
}

describe.skipIf(!enabled)('R107/R108 Production Subject seed on fresh PostgreSQL', () => {
  let firstRun: SubjectSnapshot;

  beforeAll(async () => {
    await runProductionSeed();
    firstRun = await subjectSnapshot();
  });

  it('seeds the exact eight-Subject baseline and marks only حفظ القرآن', async () => {
    expect(
      firstRun.map(({ name, displayOrder, tracksQuranProgress }) => ({
        name,
        displayOrder,
        tracksQuranProgress,
      })),
    ).toEqual(EXPECTED_SUBJECTS);
    expect(firstRun).toHaveLength(EXPECTED_SUBJECTS.length);
    expect(
      await prisma.subject.count({
        where: { deletedAt: null, tracksQuranProgress: true },
      }),
    ).toBe(1);
    expect(
      await prisma.subject.count({
        where: {
          deletedAt: null,
          name: {
            in: [
              'القرآن الكريم',
              'تفسير',
              'ترتيل القرآن',
              'تجويد',
              'تجويد القرآن',
              'محو الأمية',
            ],
          },
        },
      }),
    ).toBe(0);
  });

  it('is a true no-op for Subjects when the Production seed is run again', async () => {
    await runProductionSeed();
    expect(await subjectSnapshot()).toEqual(firstRun);
  });

  it('preserves Super-Admin additions, extra Quran curriculum, and historical rows', async () => {
    const actorId = await person('مديرة التوسعة');
    const additions = await Promise.all([
      createSubject(prisma, superAdmin(actorId), {
        name: `${TAG} اللغة العربية`,
        displayOrder: 90,
      }),
      createSubject(prisma, superAdmin(actorId), {
        name: `${TAG} علوم القرآن`,
        displayOrder: 91,
      }),
      createSubject(prisma, superAdmin(actorId), {
        name: 'ترتيل القرآن',
        displayOrder: 92,
      }),
      createSubject(prisma, superAdmin(actorId), {
        name: 'محو الأمية',
        displayOrder: 93,
      }),
    ]);
    const before = await subjectSnapshot();

    await runProductionSeed();

    const after = await subjectSnapshot();
    expect(after).toEqual(before);
    expect(
      after
        .filter((subject) => additions.some((addition) => addition.id === subject.id))
        .map((subject) => subject.tracksQuranProgress),
    ).toEqual([false, false, false, false]);
  });

  it('authorises only حفظ staffing, never an unmarked Quran-domain Subject', async () => {
    const memorisation = firstRun.find((subject) => subject.name === 'حفظ القرآن');
    const ahkam = firstRun.find((subject) => subject.name === 'أحكام القرآن');
    const tartil = firstRun.find(
      (subject) => subject.name === 'ترتيل وتجويد القرآن',
    );
    const tafsir = firstRun.find((subject) => subject.name === 'تفسير القرآن');
    const additionalQuranAdminId = await person('مديرة مادة قرآنية إضافية');
    const additionalQuran = await createSubject(
      prisma,
      superAdmin(additionalQuranAdminId),
      {
        name: `${TAG} القراءات`,
        displayOrder: 94,
      },
    );
    if (!memorisation || !ahkam || !tartil || !tafsir) {
      throw new Error('R107/R108 Quran Subjects missing after seed');
    }
    const unmarkedQuranSubjects = [ahkam, tartil, tafsir, additionalQuran];

    const level = await prisma.level.findFirstOrThrow({
      where: { deletedAt: null },
      orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    const branch = await prisma.branch.create({
      data: {
        name: `${TAG} فرع`,
        operationalStartDate: new Date('2020-01-01'),
      },
    });
    const group = await prisma.administrativeGroup.create({
      data: { name: `${TAG} مجموعة`, levelId: level.id, branchId: branch.id },
    });
    await prisma.levelSubject.createMany({
      data: [memorisation, ...unmarkedQuranSubjects].map((subject) => ({
        levelId: level.id,
        subjectId: subject.id,
      })),
      skipDuplicates: true,
    });
    await prisma.levelSurah.create({ data: { levelId: level.id, surahId: 1 } });

    const studentId = await person('مستفيدة');
    const memorisationTeacherId = await person('مؤطرة الحفظ');
    const unmarkedTeachers = await Promise.all(
      unmarkedQuranSubjects.map(async (subject) => ({
        subject,
        userId: await person(`مؤطرة ${subject.name}`),
      })),
    );
    await prisma.enrollment.create({
      data: {
        studentId,
        levelId: level.id,
        branchId: branch.id,
        administrativeGroupId: group.id,
      },
    });
    await staffedSchedule(
      memorisation.id,
      branch.id,
      group.id,
      memorisationTeacherId,
    );
    for (const { subject, userId } of unmarkedTeachers) {
      await staffedSchedule(subject.id, branch.id, group.id, userId);
    }

    expect(await quranSubjectId(prisma)).toBe(memorisation.id);
    expect(await teachesQuran(prisma, memorisationTeacherId)).toBe(true);
    for (const { userId } of unmarkedTeachers) {
      expect(await teachesQuran(prisma, userId)).toBe(false);
    }

    await expect(
      logProgress(prisma, teacher(memorisationTeacherId, branch.id), {
        studentId,
        levelId: level.id,
        surahId: 1,
        startAyah: 1,
        endAyah: 2,
        category: 'new_memorization',
      }),
    ).resolves.toMatchObject({ merged_ayah_count: 2 });

    for (const { userId } of unmarkedTeachers) {
      await expect(
        logProgress(prisma, teacher(userId, branch.id), {
          studentId,
          levelId: level.id,
          surahId: 1,
          startAyah: 3,
          endAyah: 3,
          category: 'new_memorization',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
  });

  it('fails before seed mutation when duplicate live حفظ القرآن rows exist', async () => {
    const duplicate = await prisma.subject.create({
      data: {
        name: 'حفظ القرآن',
        displayOrder: 99,
        tracksQuranProgress: false,
      },
    });
    const before = await subjectSnapshot();

    try {
      await expect(runProductionSeed()).rejects.toThrow(
        'requires exactly one live حفظ القرآن Subject; found 2',
      );
      expect(await subjectSnapshot()).toEqual(before);
    } finally {
      await prisma.subject.delete({ where: { id: duplicate.id } });
    }
  });

  it('fails before any seed write when a different live Subject owns the marker', async () => {
    const memorisation = await prisma.subject.findFirstOrThrow({
      where: { name: 'حفظ القرآن', deletedAt: null },
      select: { id: true },
    });
    await prisma.$transaction([
      prisma.subject.update({
        where: { id: memorisation.id },
        data: { tracksQuranProgress: false },
      }),
      prisma.subject.create({
        data: { name: `${TAG} conflicting marker`, tracksQuranProgress: true },
      }),
      // seedRoles runs after seedSubjects. Removing an otherwise unused role
      // proves the conflicting marker stops the invocation before unrelated
      // bootstrap writes, rather than merely failing later.
      prisma.role.delete({ where: { name: 'parent' } }),
    ]);
    const before = await subjectSnapshot();

    await expect(runProductionSeed()).rejects.toThrow(
      'Owner reconciliation is required',
    );
    expect(await subjectSnapshot()).toEqual(before);
    expect(await prisma.role.findUnique({ where: { name: 'parent' } })).toBeNull();
  });
});

afterAll(async () => {
  // Leave the disposable database in the valid seeded state so the wrapper can
  // run the established Quran integration suites against the same real schema.
  if (enabled) {
    await prisma.$transaction(async (tx) => {
      await tx.subject.deleteMany({
        where: { name: `${TAG} conflicting marker` },
      });
      await tx.subject.updateMany({
        where: { name: 'حفظ القرآن', deletedAt: null },
        data: { tracksQuranProgress: true },
      });
      await tx.role.upsert({
        where: { name: 'parent' },
        update: {},
        create: { name: 'parent' },
      });
    });
  }
  await prisma.$disconnect();
});
