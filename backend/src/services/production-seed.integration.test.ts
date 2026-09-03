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
/** The one Subject R107 marks; named once so the restore cannot drift from it. */
const MEMORISATION_NAME = 'حفظ القرآن';

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

  it('bootstraps the one approved Platform Owner without fabricating identity or weekly hours', async () => {
    const owner = await prisma.platformOwner.findUniqueOrThrow({
      where: { singletonKey: 'platform' },
      include: {
        ownerUser: {
          include: {
            identities: true,
            availability: true,
            framingPreference: { include: { branches: true } },
            branchRoles: { where: { deletedAt: null }, include: { role: true } },
          },
        },
      },
    });
    expect(await prisma.platformOwner.count()).toBe(1);
    expect(owner.ownerUser).toMatchObject({
      preProvisionedEmail: 'safae.elmessoussi@gmail.com',
      firstNameArabic: 'صفاء',
      lastNameArabic: 'المسوسي',
      nameArabic: 'صفاء المسوسي',
      sex: 'female',
      accountStatus: 'active',
      deletedAt: null,
    });
    expect(owner.ownerUser.identities).toEqual([]);
    expect(owner.ownerUser.availability).toEqual([]);
    expect(owner.ownerUser.framingPreference).toMatchObject({ mode: 'both', allBranches: true });
    expect(owner.ownerUser.framingPreference?.branches).toEqual([]);
    expect(
      owner.ownerUser.branchRoles.filter(
        (assignment) =>
          assignment.role.name === 'super_admin' &&
          assignment.branchId === null &&
          assignment.userStatus === 'active',
      ),
    ).toHaveLength(1);
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

  it('an INITIALIZED healthy catalogue exits normally and rewrites nothing', async () => {
    /**
     * The other half of moving the preflight ahead of the guard: running a
     * read-only ambiguity check on every invocation must not disturb the
     * *«database authoritative after initialization»* rule it now precedes.
     *
     * The marker is present by this point (the suite has already seeded), so a
     * healthy catalogue must still exit 0 and leave every row byte-identical —
     * including `updatedAt`, which any write would move.
     */
    const before = await subjectSnapshot();
    await runProductionSeed();
    expect(await subjectSnapshot()).toEqual(before);
  });

  it('fails before seed mutation when duplicate live حفظ القرآن rows exist', async () => {
    /**
     * **The database is already initialized here**, which is the whole point:
     * R107(3)'s *"fail loudly"* is not conditional on how many times the
     * platform has been deployed, and the `seed.initialized.subjects` marker
     * must not buy silence. This assertion failed for exactly that reason until
     * the preflight moved ahead of the initialization guard.
     */
    expect(
      await prisma.systemSetting.findFirst({
        where: { key: { contains: 'subjects' } },
        select: { key: true },
      }),
    ).not.toBeNull();

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

    try {
      await expect(runProductionSeed()).rejects.toThrow(
        'Owner reconciliation is required',
      );
      expect(await subjectSnapshot()).toEqual(before);
      expect(await prisma.role.findUnique({ where: { name: 'parent' } })).toBeNull();
    } finally {
      /**
       * **This test restores its own state** (P1.2), and since the R107(3)
       * preflight moved ahead of the initialization guard it has to.
       *
       * The ambiguity it creates is exactly what the seed now refuses on EVERY
       * invocation — so leaving it for `afterAll` made every later test in this
       * file fail on a state this one had introduced. A test that depends on
       * its neighbours' cleanup order is a test that fails for reasons unrelated
       * to its own property.
       */
      await prisma.$transaction([
        prisma.subject.deleteMany({ where: { name: `${TAG} conflicting marker` } }),
        prisma.subject.updateMany({
          where: { name: MEMORISATION_NAME, deletedAt: null },
          data: { tracksQuranProgress: true },
        }),
        prisma.role.upsert({
          where: { name: 'parent' },
          update: {},
          create: { name: 'parent' },
        }),
      ]);
    }
  });
});

/**
 * **The scheduling-type catalogue on a FRESH installation** (R110.1–110.2, as
 * amended by 110.9).
 *
 * The defect these pin, measured rather than theorised: migration
 * `20260828190100_holiday_catalogue` inserts **نشاط** unconditionally, and its
 * two corrective `UPDATE`s match nothing on an empty table. So a brand-new
 * database reaches the seed with exactly one row — and the seed's old
 * `count > 0` guard read that as *the catalogue is there*, marked it
 * initialized, and skipped the other five. A launch-ready platform ended up
 * offering **one** scheduling type, with no `class` among them, so no class
 * could be scheduled at all and nothing anywhere reported a problem.
 *
 * `count > 0` is therefore no longer proof of initialization. The **marker** is,
 * and a pre-marker install is adopted only when every canonical name is already
 * accounted for.
 */
// **R123 restated the attendance column rather than relaxing the assertion.**
// The boolean became three states, so the pin moved from *does it take
// attendance* to *what does attendance mean here* — and the two rows the Owner
// excluded, عطلة and حفل, are pinned as `disabled` because that exclusion is
// the requirement, not an incidental default.
const CANONICAL_TYPES = [
  { name: 'حصة دراسية', structuralKind: 'class', attendanceMode: 'required' },
  { name: 'اختبار', structuralKind: 'exam', attendanceMode: 'required' },
  { name: 'محاضرة', structuralKind: 'class', attendanceMode: 'optional' },
  { name: 'حفل', structuralKind: 'activity', attendanceMode: 'disabled' },
  { name: 'عطلة', structuralKind: 'holiday', attendanceMode: 'disabled' },
  { name: 'نشاط', structuralKind: 'activity', attendanceMode: 'optional' },
] as const;

async function typeSnapshot() {
  return prisma.schedulingType.findMany({
    orderBy: [{ name: 'asc' }],
    select: {
      id: true,
      name: true,
      structuralKind: true,
      attendanceMode: true,
      displayOrder: true,
      deletedAt: true,
    },
  });
}

/**
 * Puts the catalogue back the way the wrapper's later suites expect.
 *
 * **Scoped to the canonical names, never a bare `deleteMany({})`.** P1.2's
 * ownership guard refuses an unbounded mass delete, and it is right to: these
 * rows are the ones this suite creates through the seed, and a row somebody
 * else put here is not mine to remove — even in a disposable database, where
 * the habit is what carries over.
 */
async function resetCatalogue(): Promise<void> {
  await prisma.systemSetting.deleteMany({
    where: { key: { contains: 'scheduling_types' } },
  });
  await prisma.schedulingType.deleteMany({
    where: { name: { in: CANONICAL_TYPES.map((t) => t.name) } },
  });
}

describe.skipIf(!enabled)('R110 scheduling-type catalogue survives every install shape', () => {
  it('a COMPLETELY FRESH database receives the whole ratified catalogue', async () => {
    await resetCatalogue();
    await runProductionSeed();

    const rows = await typeSnapshot();
    expect(rows).toHaveLength(CANONICAL_TYPES.length);
    for (const expected of CANONICAL_TYPES) {
      const row = rows.find((r) => r.name === expected.name);
      expect(row, `missing canonical type ${expected.name}`).toBeDefined();
      expect(row!.structuralKind).toBe(expected.structuralKind);
      expect(row!.attendanceMode).toBe(expected.attendanceMode);
      expect(row!.deletedAt).toBeNull();
    }
    // All four structural kinds reachable — the postcondition the seed asserts,
    // restated here against the rows rather than against its own error path.
    expect(new Set(rows.map((r) => r.structuralKind))).toEqual(
      new Set(['class', 'exam', 'activity', 'holiday']),
    );
  });

  it('the PARTIAL fresh-install state — only نشاط, as the migration leaves it', async () => {
    // **This is the exact defect.** One row present, five missing, no marker.
    await resetCatalogue();
    await prisma.schedulingType.create({
      data: {
        name: 'نشاط',
        structuralKind: 'activity',
        attendanceMode: 'optional',
        displayOrder: 1,
      },
    });

    await runProductionSeed();

    const rows = await typeSnapshot();
    expect(rows).toHaveLength(CANONICAL_TYPES.length);
    expect(rows.map((r) => r.name).sort()).toEqual(
      CANONICAL_TYPES.map((t) => t.name).sort(),
    );
    // A class can be scheduled, which is what the defect took away.
    expect(rows.some((r) => r.structuralKind === 'class' && r.deletedAt === null)).toBe(true);
  });

  it('an ALREADY-INITIALIZED database keeps an edited canonical row untouched', async () => {
    await resetCatalogue();
    await runProductionSeed();

    // The Owner renames nothing but re-flags and reorders — both hers once the
    // row exists, which is the whole point of their being columns.
    const before = await prisma.schedulingType.findFirstOrThrow({
      where: { name: 'حفل', deletedAt: null },
    });
    await prisma.schedulingType.update({
      where: { id: before.id },
      data: { attendanceMode: 'required', displayOrder: 99 },
    });

    await runProductionSeed();

    const after = await prisma.schedulingType.findFirstOrThrow({
      where: { name: 'حفل', deletedAt: null },
    });
    expect(after.id).toBe(before.id);
    expect(after.attendanceMode).toBe('required');
    expect(after.displayOrder).toBe(99);
    // And no second حفل was created beside it.
    expect(await prisma.schedulingType.count({ where: { name: 'حفل' } })).toBe(1);
  });

  it('a SOFT-DELETED canonical type is NOT resurrected', async () => {
    /**
     * *Seeded does not mean immutable*, read in the direction that costs
     * something: a type an administrator retired must not reappear on the next
     * deploy. The name is not free — it is spoken for by a decision.
     */
    await resetCatalogue();
    await runProductionSeed();
    const target = await prisma.schedulingType.findFirstOrThrow({
      where: { name: 'محاضرة', deletedAt: null },
    });
    await prisma.schedulingType.update({
      where: { id: target.id },
      data: { deletedAt: new Date() },
    });
    // Clear the marker so the reconciliation genuinely runs again.
    await prisma.systemSetting.deleteMany({
      where: { key: { contains: 'scheduling_types' } },
    });

    await runProductionSeed();

    const rows = await prisma.schedulingType.findMany({ where: { name: 'محاضرة' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(target.id);
    expect(rows[0]!.deletedAt).not.toBeNull();
  });

  it('leaves the catalogue seeded for the suites that run after this file', async () => {
    await resetCatalogue();
    await runProductionSeed();
    expect(await prisma.schedulingType.count({ where: { deletedAt: null } })).toBe(
      CANONICAL_TYPES.length,
    );
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
