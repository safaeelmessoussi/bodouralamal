import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import type { RoleScope } from '../policies/branch-scope.js';
import type { Actor } from './group.service.js';
import {
  clearImportSources,
  importYear,
  listYear,
  publishYear,
  registerImportSource,
  setMonthStart,
  yearHistory,
} from './hijri-calendar.service.js';

/**
 * Official Moroccan Hijri calendar management — SRS Revision 31, §5.7, TD-2,
 * TD-9, TD-15.
 *
 * The dates are the officially announced Moroccan ones: 1 Muharram 1448 fell on
 * Wednesday 17 June 2026, where Umm al-Qura gives 16 June.
 *
 * A Hijri year far outside any real one is used throughout so these rows cannot
 * collide with a calendar suite running against the same database.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = '[hijri-test]';

/** Inside TD-9's 1300–1600 range, but no real date resolves against it. */
const YEAR = 1590;

let actorUserId: string;

const actorOf = (scopes: RoleScope[]): Actor => ({
  userId: actorUserId,
  roles: scopes.map((s) => s.role),
  roleScopes: scopes,
});
const superAdmin = () => actorOf([{ role: 'super_admin', branches: null }]);
const admin = () => actorOf([{ role: 'admin', branches: null }]);
const teacher = () => actorOf([{ role: 'teacher', branches: null }]);

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

async function clear(): Promise<void> {
  await prisma.hijriMonthStart.deleteMany({
    where: { hijriYear: { in: [YEAR - 1, YEAR, YEAR + 1] } },
  });
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

beforeEach(async () => {
  await clear();
  clearImportSources();
  const u = await prisma.user.create({
    data: { nameArabic: `${TAG} مشرف عام`, accountStatus: 'active' },
  });
  actorUserId = u.id;
});

afterAll(async () => {
  await clear();
  clearImportSources();
  await prisma.$disconnect();
});

describe('TD-2 / Revision 26 — the official calendar is Super Admin only', () => {
  it('refuses an Admin and a Teacher on every action', async () => {
    for (const actor of [admin(), teacher()]) {
      await expect(listYear(prisma, actor, YEAR)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        setMonthStart(prisma, actor, { year: YEAR, month: 1, gregorianStartDate: day('2026-06-17') }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(publishYear(prisma, actor, YEAR)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(yearHistory(prisma, actor, YEAR)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(importYear(prisma, actor, YEAR, 'x')).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    }
  });

  it('a refused write leaves no row behind', async () => {
    await expect(
      setMonthStart(prisma, admin(), { year: YEAR, month: 1, gregorianStartDate: day('2026-06-17') }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(await prisma.hijriMonthStart.count({ where: { hijriYear: YEAR } })).toBe(0);
  });
});

describe('§5.7 — the year grid', () => {
  it('always returns twelve months, recorded or not', async () => {
    await setMonthStart(prisma, superAdmin(), {
      year: YEAR,
      month: 1,
      gregorianStartDate: day('2026-06-17'),
    });

    const rows = await listYear(prisma, superAdmin(), YEAR);
    expect(rows).toHaveLength(12);
    // A month the Ministry has not announced is a blank to fill, not an absence.
    expect(rows[0]).toMatchObject({ hijriMonth: 1, monthNameArabic: 'محرم', status: 'draft' });
    expect(rows[1]).toMatchObject({ hijriMonth: 2, gregorianStartDate: null, status: null });
  });

  it('rejects a year outside TD-9 range', async () => {
    await expect(listYear(prisma, superAdmin(), 2026)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(listYear(prisma, superAdmin(), 1299)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('rejects a month outside 1–12', async () => {
    await expect(
      setMonthStart(prisma, superAdmin(), {
        year: YEAR,
        month: 13,
        gregorianStartDate: day('2026-06-17'),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('TD-9 — months must start in calendar order', () => {
  async function record(month: number, iso: string) {
    return setMonthStart(prisma, superAdmin(), {
      year: YEAR,
      month,
      gregorianStartDate: day(iso),
    });
  }

  it('refuses a month starting before the one before it', async () => {
    await record(1, '2026-06-17');

    // Safar cannot begin before Muharram did — resolution would be ambiguous,
    // and resolution is what every Hijri label depends on.
    await expect(record(2, '2026-06-01')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { reason: 'MONTH_ORDER' },
    });
  });

  it('refuses two months sharing a start date', async () => {
    await record(1, '2026-06-17');
    await expect(record(2, '2026-06-17')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('refuses a month starting after the one AFTER it', async () => {
    await record(3, '2026-08-15');
    await expect(record(2, '2026-09-01')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('checks across the year boundary in both directions', async () => {
    // Month 12 of the previous year and month 1 of the next are real neighbours.
    await setMonthStart(prisma, superAdmin(), {
      year: YEAR - 1,
      month: 12,
      gregorianStartDate: day('2026-05-18'),
    });
    await expect(record(1, '2026-05-01')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { conflicting_year: YEAR - 1, conflicting_month: 12 },
    });

    await expect(record(1, '2026-06-17')).resolves.toMatchObject({ hijriMonth: 1 });
  });

  it('accepts an ordered year', async () => {
    await record(1, '2026-06-17');
    await record(2, '2026-07-16');
    await record(3, '2026-08-15');
    expect(await prisma.hijriMonthStart.count({ where: { hijriYear: YEAR } })).toBe(3);
  });
});

describe('TD-15 — corrections do not clobber each other', () => {
  it('requires a version to correct an existing month', async () => {
    await setMonthStart(prisma, superAdmin(), {
      year: YEAR,
      month: 1,
      gregorianStartDate: day('2026-06-17'),
    });

    await expect(
      setMonthStart(prisma, superAdmin(), {
        year: YEAR,
        month: 1,
        gregorianStartDate: day('2026-06-18'),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('a stale version is VERSION_CONFLICT and the first writer survives', async () => {
    const row = await setMonthStart(prisma, superAdmin(), {
      year: YEAR,
      month: 1,
      gregorianStartDate: day('2026-06-17'),
    });
    const stale = row.version;

    await setMonthStart(prisma, superAdmin(), {
      year: YEAR,
      month: 1,
      gregorianStartDate: day('2026-06-18'),
      expectedVersion: stale,
    });

    await expect(
      setMonthStart(prisma, superAdmin(), {
        year: YEAR,
        month: 1,
        gregorianStartDate: day('2026-06-19'),
        expectedVersion: stale,
      }),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });

    const current = await prisma.hijriMonthStart.findFirst({
      where: { hijriYear: YEAR, hijriMonth: 1 },
    });
    expect(current!.gregorianStartDate.toISOString().slice(0, 10)).toBe('2026-06-18');
  });

  it('a correction returns the month to draft so it must be republished', async () => {
    const row = await setMonthStart(prisma, superAdmin(), {
      year: YEAR,
      month: 1,
      gregorianStartDate: day('2026-06-17'),
    });
    await publishYear(prisma, superAdmin(), YEAR);

    const published = await prisma.hijriMonthStart.findFirst({
      where: { hijriYear: YEAR, hijriMonth: 1 },
    });
    expect(published!.status).toBe('published');

    await setMonthStart(prisma, superAdmin(), {
      year: YEAR,
      month: 1,
      gregorianStartDate: day('2026-06-18'),
      expectedVersion: published!.version,
    });

    const corrected = await prisma.hijriMonthStart.findFirst({
      where: { hijriYear: YEAR, hijriMonth: 1 },
    });
    // A silent correction to live data is exactly what this prevents.
    expect(corrected!.status).toBe('draft');
    expect(row.version).toBeLessThan(corrected!.version);
  });
});

describe('§5.7 — publishing is what makes a month visible', () => {
  it('publishes a year’s drafts and reports the count', async () => {
    await setMonthStart(prisma, superAdmin(), {
      year: YEAR,
      month: 1,
      gregorianStartDate: day('2026-06-17'),
    });
    await setMonthStart(prisma, superAdmin(), {
      year: YEAR,
      month: 2,
      gregorianStartDate: day('2026-07-16'),
    });

    expect(await publishYear(prisma, superAdmin(), YEAR)).toEqual({ published: 2 });
    expect(
      await prisma.hijriMonthStart.count({ where: { hijriYear: YEAR, status: 'published' } }),
    ).toBe(2);
  });

  it('publishing again with nothing to publish is a coded conflict, not a silent no-op', async () => {
    await setMonthStart(prisma, superAdmin(), {
      year: YEAR,
      month: 1,
      gregorianStartDate: day('2026-06-17'),
    });
    await publishYear(prisma, superAdmin(), YEAR);

    await expect(publishYear(prisma, superAdmin(), YEAR)).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
      details: { reason: 'NOTHING_TO_PUBLISH' },
    });
  });

  it('does not publish another year’s drafts', async () => {
    await setMonthStart(prisma, superAdmin(), {
      year: YEAR,
      month: 1,
      gregorianStartDate: day('2026-06-17'),
    });
    await setMonthStart(prisma, superAdmin(), {
      year: YEAR + 1,
      month: 1,
      gregorianStartDate: day('2027-06-06'),
    });

    await publishYear(prisma, superAdmin(), YEAR);
    const other = await prisma.hijriMonthStart.findFirst({ where: { hijriYear: YEAR + 1 } });
    expect(other!.status).toBe('draft');
  });
});

describe('TD-8 — history is the audit trail', () => {
  it('records both the previous and the new start date on a correction', async () => {
    const row = await setMonthStart(prisma, superAdmin(), {
      year: YEAR,
      month: 1,
      gregorianStartDate: day('2026-06-17'),
    });
    await setMonthStart(prisma, superAdmin(), {
      year: YEAR,
      month: 1,
      gregorianStartDate: day('2026-06-18'),
      expectedVersion: row.version,
    });

    const history = await yearHistory(prisma, superAdmin(), YEAR);
    const latest = history[0]!.detail as Record<string, unknown>;

    // The correction is the interesting event: a wrong start silently mislabels
    // every date in its month, so both values are on the record.
    expect(latest['previous_start_date']).toBe('2026-06-17');
    expect(latest['new_start_date']).toBe('2026-06-18');
    // First entry has no previous value, and says so rather than omitting it.
    const first = history[history.length - 1]!.detail as Record<string, unknown>;
    expect(first['previous_start_date']).toBeNull();
  });

  it('records publishing as its own event', async () => {
    await setMonthStart(prisma, superAdmin(), {
      year: YEAR,
      month: 1,
      gregorianStartDate: day('2026-06-17'),
    });
    await publishYear(prisma, superAdmin(), YEAR);

    const history = await yearHistory(prisma, superAdmin(), YEAR);
    expect(history[0]!.actionType).toBe('hijri.year.publish');
    expect((history[0]!.detail as Record<string, unknown>)['months_published']).toBe(1);
  });

  it('scopes history to the requested year', async () => {
    await setMonthStart(prisma, superAdmin(), {
      year: YEAR + 1,
      month: 1,
      gregorianStartDate: day('2027-06-06'),
    });
    expect(await yearHistory(prisma, superAdmin(), YEAR)).toHaveLength(0);
    expect((await yearHistory(prisma, superAdmin(), YEAR + 1)).length).toBeGreaterThan(0);
  });
});

describe('Revision 31 — the import integration point', () => {
  it('reports NOT_CONFIGURED while no official source is wired', async () => {
    await expect(importYear(prisma, superAdmin(), YEAR, 'habous')).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      details: { reason: 'NOT_CONFIGURED' },
    });
  });

  it('audits a refused import, so the attempt is never invisible', async () => {
    await expect(importYear(prisma, superAdmin(), YEAR, 'habous')).rejects.toThrow();

    const history = await yearHistory(prisma, superAdmin(), YEAR);
    expect(history[0]!.actionType).toBe('hijri.import');
    expect((history[0]!.detail as Record<string, unknown>)['outcome']).toBe('NOT_CONFIGURED');
  });

  it('an adapter writes through the SAME path as a manual edit', async () => {
    // The architectural requirement of Revision 31: imported rows land in
    // HijriMonthStart via setMonthStart, so they cannot bypass the ordering
    // rule, the audit trail, or the draft state.
    registerImportSource({
      id: 'test-ministry',
      fetchMonthStarts: async () => [
        { month: 1, gregorianStartDate: day('2026-06-17') },
        { month: 2, gregorianStartDate: day('2026-07-16') },
      ],
    });

    expect(await importYear(prisma, superAdmin(), YEAR, 'test-ministry')).toEqual({
      imported: 2,
      source: 'test-ministry',
    });

    const rows = await prisma.hijriMonthStart.findMany({
      where: { hijriYear: YEAR },
      orderBy: { hijriMonth: 'asc' },
    });
    expect(rows.map((r) => r.hijriMonth)).toEqual([1, 2]);
    // Imported data is NOT live until published — same as manual entry.
    expect(rows.every((r) => r.status === 'draft')).toBe(true);
    // Provenance is recorded on the row itself.
    expect(rows.every((r) => r.source === 'test-ministry')).toBe(true);

    const history = await yearHistory(prisma, superAdmin(), YEAR);
    expect(history.filter((h) => h.actionType === 'hijri.month_start.set')).toHaveLength(2);
  });

  it('an import obeys the ordering rule exactly as manual entry does', async () => {
    registerImportSource({
      id: 'bad-source',
      fetchMonthStarts: async () => [
        { month: 1, gregorianStartDate: day('2026-06-17') },
        { month: 2, gregorianStartDate: day('2026-06-01') },
      ],
    });

    await expect(importYear(prisma, superAdmin(), YEAR, 'bad-source')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { reason: 'MONTH_ORDER' },
    });
  });

  it('re-importing corrects existing rows rather than failing on version', async () => {
    await setMonthStart(prisma, superAdmin(), {
      year: YEAR,
      month: 1,
      gregorianStartDate: day('2026-06-17'),
    });
    registerImportSource({
      id: 'test-ministry',
      fetchMonthStarts: async () => [{ month: 1, gregorianStartDate: day('2026-06-18') }],
    });

    expect((await importYear(prisma, superAdmin(), YEAR, 'test-ministry')).imported).toBe(1);
    const row = await prisma.hijriMonthStart.findFirst({ where: { hijriYear: YEAR, hijriMonth: 1 } });
    expect(row!.gregorianStartDate.toISOString().slice(0, 10)).toBe('2026-06-18');
  });
});
