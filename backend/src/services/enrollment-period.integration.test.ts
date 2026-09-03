import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import type { Actor } from '../policies/actor.js';
import { isCurrentPeriod } from './academic-period.service.js';
import { enrolAtLevel, unenrolById } from './enrollment.service.js';

/**
 * **An enrolment belongs to a semester** (SRS Revision 122).
 *
 * ## The two defects this pins
 *
 * 1. **«Active forever».** `Enrollment` carried `enrolled_at` and `deleted_at`
 *    and nothing else, so a row was current until somebody remembered to
 *    soft-delete it — and a retention rule built on that would call a person
 *    active a decade after they left.
 * 2. **The association's ordinary case was refused by the database.** The old
 *    `(student_id, level_id)` uniqueness permitted ONE live enrolment per
 *    student per Level, so a beneficiary taking Semester 1 of a Level and then
 *    Semester 2 **of the same Level** could not be recorded at all.
 *
 * ## The Owner's own example, which is what the four cases below are
 *
 * > enrol in S2 of the first studies year · then next academic year enrol in S1
 * > of the first studies year AND S1 of the second · then later that same year
 * > enrol in S2 of the second.
 *
 * **Academic year and studies year are different concepts**, and nothing here
 * may assume they correspond: one academic year holds enrolments at two studies
 * years, and a beneficiary enrols in S2 with no S1 row for that year.
 *
 * **`Level` IS the studies year** — each Category holds an ordered progression
 * and `display_order` is the rank, so the fixture's two Levels are studies
 * years 1 and 2.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = '[enrol-period-test]';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

let adminId = '';
let studentId = '';
let branchId = '';
let levelYear1 = '';
let levelYear2 = '';
/** Previous academic year, second semester — the Owner's step 1. */
let prevS2 = '';
/** Current academic year, first and second semesters. */
let curS1 = '';
let curS2 = '';

const admin = (): Actor => ({
  userId: adminId,
  roles: ['super_admin'],
  roleScopes: [{ role: 'super_admin', branches: null }],
  activeRole: 'super_admin',
});

async function clear(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await prisma.enrollment.deleteMany({ where: { studentId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
  // Un-enrolling snapshots the row (TD-5), and `trash.deleted_by` is RESTRICT.
  await prisma.trash.deleteMany({ where: { deletedById: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });

  // Periods before their year; enrolments are already gone above.
  const years = await prisma.academicYear.findMany({
    where: { label: { in: ['2094-2095', '2095-2096'] } },
    select: { id: true },
  });
  const yearIds = years.map((y) => y.id);
  await prisma.academicPeriod.deleteMany({ where: { academicYearId: { in: yearIds } } });
  await prisma.academicYear.deleteMany({ where: { id: { in: yearIds } } });

  await prisma.level.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await clear();
  adminId = (
    await prisma.user.create({
      data: { sex: 'female', nameArabic: `${TAG} مشرفة`, accountStatus: 'active' },
    })
  ).id;
  studentId = (
    await prisma.user.create({
      data: {
        sex: 'female',
        nameArabic: `${TAG} مستفيدة`,
        accountStatus: 'active',
        isBeneficiary: true,
      },
    })
  ).id;
  branchId = (await prisma.branch.create({ data: { name: `${TAG} فرع` } })).id;

  // A Category with TWO ordered Levels: studies year 1 and studies year 2.
  const category = await prisma.category.create({ data: { name: `${TAG} فئة` } });
  levelYear1 = (
    await prisma.level.create({
      data: { name: `${TAG} سنة أولى`, categoryId: category.id, displayOrder: 1 },
    })
  ).id;
  levelYear2 = (
    await prisma.level.create({
      data: { name: `${TAG} سنة ثانية`, categoryId: category.id, displayOrder: 2 },
    })
  ).id;

  // Two academic years, three periods — a remote synthetic timeline, so the
  // suite never depends on what today happens to be.
  const prev = await prisma.academicYear.create({ data: { label: '2094-2095' } });
  const cur = await prisma.academicYear.create({ data: { label: '2095-2096' } });
  prevS2 = (
    await prisma.academicPeriod.create({
      data: {
        academicYearId: prev.id,
        sequence: 2,
        startDate: day('2095-02-01'),
        endDate: day('2095-06-30'),
      },
    })
  ).id;
  curS1 = (
    await prisma.academicPeriod.create({
      data: {
        academicYearId: cur.id,
        sequence: 1,
        startDate: day('2095-09-15'),
        endDate: day('2096-01-31'),
      },
    })
  ).id;
  curS2 = (
    await prisma.academicPeriod.create({
      data: {
        academicYearId: cur.id,
        sequence: 2,
        startDate: day('2096-02-01'),
        endDate: day('2096-06-30'),
      },
    })
  ).id;
}, 120_000);

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

const enrol = (levelId: string, academicPeriodId: string) =>
  enrolAtLevel(prisma, admin(), { studentId, levelId, branchId, academicPeriodId });

/* ── The Owner's four cases ─────────────────────────────────────────────── */

describe("the Owner's enrolment sequence is representable, row by row", () => {
  it('A · Semester 2 of studies year 1, in the FIRST academic year', async () => {
    await expect(enrol(levelYear1, prevS2)).resolves.toMatchObject({
      levelId: levelYear1,
      academicPeriodId: prevS2,
    });
  });

  it('B · Semester 1 of studies year 1 again, in the NEXT academic year', async () => {
    // The old `(student, level)` uniqueness refused this whenever the first row
    // had not been soft-deleted — which is exactly what «history is preserved»
    // requires it not to be.
    await expect(enrol(levelYear1, curS1)).resolves.toMatchObject({
      levelId: levelYear1,
      academicPeriodId: curS1,
    });
  });

  it('C · Semester 1 of studies year 2, in the SAME academic year as B', async () => {
    // One academic year, two studies years, one beneficiary. Nothing may assume
    // the two concepts correspond.
    await expect(enrol(levelYear2, curS1)).resolves.toMatchObject({
      levelId: levelYear2,
      academicPeriodId: curS1,
    });
  });

  it('D · Semester 2 of studies year 2 — the case the OLD index refused', async () => {
    // Same student, same Level as C, different semester. This is the row the
    // pre-R122 database rejected outright.
    await expect(enrol(levelYear2, curS2)).resolves.toMatchObject({
      levelId: levelYear2,
      academicPeriodId: curS2,
    });
  });

  it('still refuses a true duplicate — same student, same Level, same period', async () => {
    // BR-21 is scoped, not withdrawn.
    await expect(enrol(levelYear2, curS2)).rejects.toMatchObject({
      details: { reason: 'ALREADY_ENROLLED_IN_LEVEL' },
    });
  });

  it('records four enrolments and overwrote none of them', async () => {
    const rows = await prisma.enrollment.findMany({
      where: { studentId, deletedAt: null },
      select: { levelId: true, academicPeriodId: true },
    });
    expect(rows).toHaveLength(4);
  });
});

/* ── The lifecycle ──────────────────────────────────────────────────────── */

describe('current is derived from the period, never from deleted_at', () => {
  const activeRows = async (today: Date) => {
    const rows = await prisma.enrollment.findMany({
      where: { studentId, deletedAt: null },
      select: { id: true, academicPeriod: { select: { startDate: true, endDate: true } } },
    });
    return rows.filter((r) => r.academicPeriod && isCurrentPeriod(r.academicPeriod, today));
  };

  it('an old enrolment is NOT current merely because deleted_at is null', async () => {
    // **The defect this revision exists for.** Every row below is live; only
    // the one whose semester is running counts.
    const during = await activeRows(day('2096-03-01')); // inside curS2 only
    expect(during).toHaveLength(1);
  });

  it('a current-period enrolment IS current', async () => {
    expect(await activeRows(day('2095-10-01'))).toHaveLength(2); // both curS1 rows
  });

  it('between semesters nothing is current, with no row deleted', async () => {
    expect(await activeRows(day('2096-07-15'))).toHaveLength(0);
  });

  it('a soft-deleted current-period enrolment is not current', async () => {
    const row = await prisma.enrollment.findFirstOrThrow({
      where: { studentId, academicPeriodId: curS2, deletedAt: null },
      select: { id: true },
    });
    await unenrolById(prisma, admin(), row.id);
    expect(await activeRows(day('2096-03-01'))).toHaveLength(0);

    // And the row is still THERE — removal is not erasure of the history.
    expect(
      await prisma.enrollment.count({ where: { studentId, academicPeriodId: curS2 } }),
    ).toBe(1);
  });
});

/* ── The attestation ────────────────────────────────────────────────────── */

describe('the history a future attestation needs is reconstructible', () => {
  it('answers which years, which semesters, and which levels she reached', async () => {
    // «كنت أدرس عندكم وأريد شهادة تثبت المستوى الذي وصلت إليه» — answered by a
    // join, years later, from rows nothing overwrote. Soft-deleted rows are
    // INCLUDED: a withdrawn placement is still part of what happened.
    const rows = await prisma.enrollment.findMany({
      where: { studentId },
      select: {
        level: { select: { name: true, displayOrder: true } },
        academicPeriod: {
          select: { sequence: true, academicYear: { select: { label: true } } },
        },
      },
    });

    const history = rows
      .map((r) => ({
        year: r.academicPeriod!.academicYear.label,
        semester: r.academicPeriod!.sequence,
        studiesYear: r.level.displayOrder,
      }))
      .sort((a, b) => a.year.localeCompare(b.year) || a.semester - b.semester ||
        (a.studiesYear ?? 0) - (b.studiesYear ?? 0));

    expect(history).toEqual([
      { year: '2094-2095', semester: 2, studiesYear: 1 },
      { year: '2095-2096', semester: 1, studiesYear: 1 },
      { year: '2095-2096', semester: 1, studiesYear: 2 },
      { year: '2095-2096', semester: 2, studiesYear: 2 },
    ]);

    // The progression reached: the highest Level rank she was ever enrolled at.
    expect(Math.max(...history.map((h) => h.studiesYear ?? 0))).toBe(2);
  });
});
