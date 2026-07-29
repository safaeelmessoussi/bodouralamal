import type { PrismaClient } from '../generated/prisma/client.js';
import { baseHijri, sortMonthStarts, type MonthStart } from '../lib/hijri.js';

/**
 * The calendar screen's reference data, in one read (SRS Revision 36, TD-3.10).
 *
 * **Reference data only.** Events, enrolments, progress and grades are not
 * admissible here whatever a future screen would find convenient — that limit
 * is what keeps a bootstrap from becoming a dumping ground, and it is why this
 * lives beside `calendar.service` rather than inside it.
 *
 * Hijri values come from `baseHijri` against recorded, **published** month
 * starts — the same single seam every other consumer uses (Revision 31). A day
 * whose month the Ministry has not announced simply carries no Hijri fields.
 */
export interface HijriDay {
  date: string;
  hijriDate: string | null;
  hijriDay: number | null;
  hijriMonth: number | null;
  hijriMonthArabic: string | null;
  hijriYear: number | null;
}

export interface HijriMonthRef {
  hijriMonth: number;
  hijriMonthArabic: string;
  hijriYear: number;
}

export interface GregorianMonthRef {
  month: number;
  monthArabic: string;
  year: number;
}

export interface CalendarBootstrap {
  hijri: { days: HijriDay[]; months: HijriMonthRef[] };
  gregorianMonths: GregorianMonthRef[];
  categories: { id: string; name: string; displayOrder: number | null }[];
  levels: { id: string; name: string; categoryId: string; displayOrder: number | null }[];
  branches: { id: string; name: string; displayOrder: number | null }[];
}

/** Moroccan month names, matching how the interface reads (§6, Arabic-first). */
const GREGORIAN_MONTHS_AR = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'ماي', 'يونيو',
  'يوليوز', 'غشت', 'شتنبر', 'أكتوبر', 'نونبر', 'دجنبر',
];

const MS_PER_DAY = 86_400_000;
/** The same ceiling §4.4 puts on a calendar read — an unbounded range would
 *  expand a day list forever. */
export const MAX_RANGE_DAYS = 366;

export async function calendarBootstrap(
  prisma: PrismaClient,
  from: Date,
  to: Date,
): Promise<CalendarBootstrap> {
  // Widened by a month on each side for the same reason the calendar read is:
  // resolution walks BACK to the month containing a date, so a day early in
  // `from`'s month belongs to a month that began before it.
  const margin = 40 * MS_PER_DAY;
  const [monthStartRows, categories, levels, branches] = await Promise.all([
    prisma.hijriMonthStart.findMany({
      where: {
        deletedAt: null,
        status: 'published',
        gregorianStartDate: {
          gte: new Date(from.getTime() - margin),
          lte: new Date(to.getTime() + margin),
        },
      },
      select: { hijriYear: true, hijriMonth: true, gregorianStartDate: true },
    }),
    prisma.category.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, displayOrder: true },
      orderBy: [{ displayOrder: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }, { id: 'asc' }],
    }),
    prisma.level.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, categoryId: true, displayOrder: true },
      orderBy: [{ displayOrder: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }, { id: 'asc' }],
    }),
    prisma.branch.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, displayOrder: true },
      orderBy: [{ displayOrder: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }, { id: 'asc' }],
    }),
  ]);

  const starts: MonthStart[] = sortMonthStarts(monthStartRows);

  const days: HijriDay[] = [];
  const monthSeen = new Map<string, HijriMonthRef>();
  const gregorianSeen = new Map<string, GregorianMonthRef>();

  for (let cursor = new Date(from); cursor <= to; cursor = new Date(cursor.getTime() + MS_PER_DAY)) {
    const iso = cursor.toISOString().slice(0, 10);
    const gregorianKey = `${cursor.getUTCFullYear()}-${cursor.getUTCMonth()}`;
    if (!gregorianSeen.has(gregorianKey)) {
      gregorianSeen.set(gregorianKey, {
        month: cursor.getUTCMonth() + 1,
        monthArabic: GREGORIAN_MONTHS_AR[cursor.getUTCMonth()] ?? '',
        year: cursor.getUTCFullYear(),
      });
    }

    const hijri = baseHijri(cursor, starts);
    days.push({
      date: iso,
      hijriDate: hijri?.iso ?? null,
      hijriDay: hijri?.day ?? null,
      hijriMonth: hijri?.month ?? null,
      hijriMonthArabic: hijri?.monthNameArabic ?? null,
      hijriYear: hijri?.year ?? null,
    });

    // The distinct Hijri months the range touches, in the order encountered —
    // which is exactly what the dual title renders, so the client performs no
    // month-transition logic of its own.
    if (hijri) {
      const key = `${hijri.year}-${hijri.month}`;
      if (!monthSeen.has(key)) {
        monthSeen.set(key, {
          hijriMonth: hijri.month,
          hijriMonthArabic: hijri.monthNameArabic,
          hijriYear: hijri.year,
        });
      }
    }
  }

  return {
    hijri: { days, months: [...monthSeen.values()] },
    gregorianMonths: [...gregorianSeen.values()],
    categories,
    levels,
    branches,
  };
}
