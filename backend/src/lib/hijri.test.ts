import { describe, expect, it } from 'vitest';

import {
  MAX_HIJRI_YEAR,
  MIN_HIJRI_YEAR,
  baseHijri,
  hijriMonthNameArabic,
  sortMonthStarts,
  type MonthStart,
} from './hijri.js';

/**
 * The Revision-31 resolution seam. Pure computation, so these are unit tests.
 *
 * The dates below are the **officially announced** Moroccan ones: the Ministry
 * of Habous fixed 1 Muharram 1448 to Wednesday 17 June 2026, where Umm al-Qura
 * gives 16 June. That one-day divergence is the whole reason this table exists,
 * so it is what the fixtures encode.
 */
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const start = (year: number, month: number, iso: string): MonthStart => ({
  hijriYear: year,
  hijriMonth: month,
  gregorianStartDate: day(iso),
});

/** Dhu al-Hijja 1447 → Safar 1448, with the officially announced new year. */
const OFFICIAL: MonthStart[] = [
  start(1447, 12, '2026-05-18'),
  start(1448, 1, '2026-06-17'),
  start(1448, 2, '2026-07-16'),
];

describe('baseHijri — resolution from recorded official data', () => {
  it('resolves the first day of a recorded month', () => {
    expect(baseHijri(day('2026-06-17'), OFFICIAL)).toMatchObject({
      year: 1448,
      month: 1,
      day: 1,
      iso: '1448-01-01',
      monthNameArabic: 'محرم',
    });
  });

  it('counts days forward within the month', () => {
    expect(baseHijri(day('2026-06-18'), OFFICIAL)!.day).toBe(2);
    expect(baseHijri(day('2026-07-15'), OFFICIAL)!.iso).toBe('1448-01-29');
  });

  it('rolls to the next month exactly on its official start', () => {
    // The boundary is the whole point: one day earlier is still Muharram.
    expect(baseHijri(day('2026-07-15'), OFFICIAL)!.month).toBe(1);
    expect(baseHijri(day('2026-07-16'), OFFICIAL)!.month).toBe(2);
  });

  it('crosses the Hijri year boundary using the recorded dates', () => {
    expect(baseHijri(day('2026-06-16'), OFFICIAL)).toMatchObject({ year: 1447, month: 12 });
    expect(baseHijri(day('2026-06-17'), OFFICIAL)).toMatchObject({ year: 1448, month: 1 });
  });

  it('reproduces the OFFICIAL date, not the algorithmic one', () => {
    // Umm al-Qura puts 1 Muharram 1448 on 16 June 2026; Morocco announced the
    // 17th. On the 16th the official answer is still Dhu al-Hijja 1447 — if this
    // ever returns 1448-01-01, an algorithm has crept back in.
    expect(baseHijri(day('2026-06-16'), OFFICIAL)!.iso).not.toBe('1448-01-01');
    expect(baseHijri(day('2026-06-16'), OFFICIAL)!.year).toBe(1447);
  });

  it('zero-pads the iso form so it sorts and compares as text', () => {
    expect(baseHijri(day('2026-06-17'), OFFICIAL)!.iso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('baseHijri — silence where the official answer is unknown', () => {
  it('returns null before the earliest recorded month', () => {
    expect(baseHijri(day('2026-05-17'), OFFICIAL)).toBeNull();
  });

  it('returns null when there is no recorded data at all', () => {
    expect(baseHijri(day('2026-06-17'), [])).toBeNull();
  });

  it('resolves days 1–29 of a trailing month, whose length is guaranteed', () => {
    // Every Hijri month is 29 or 30 days, so with no following start recorded
    // the first 29 days are still certain.
    const trailing = [start(1448, 2, '2026-07-16')];
    expect(baseHijri(day('2026-07-16'), trailing)!.day).toBe(1);
    expect(baseHijri(day('2026-08-13'), trailing)!.day).toBe(29);
  });

  it('returns null past day 29 of a trailing month', () => {
    // Day 30 depends on the NEXT sighting, which has not happened. Guessing here
    // is precisely what Revision 31 forbids.
    const trailing = [start(1448, 2, '2026-07-16')];
    expect(baseHijri(day('2026-08-14'), trailing)).toBeNull();
    expect(baseHijri(day('2026-09-20'), trailing)).toBeNull();
  });

  it('resolves day 30 once the FOLLOWING month is recorded', () => {
    // The next start is what proves the month ran 30 days rather than 29.
    const bounded = [start(1448, 2, '2026-07-16'), start(1448, 3, '2026-08-15')];
    expect(baseHijri(day('2026-08-14'), bounded)!.day).toBe(30);
    expect(baseHijri(day('2026-08-15'), bounded)!.month).toBe(3);
  });

  it('will not claim day 30 across a GAP, where 29 may have been the last day', () => {
    // Muharram and Rabi al-Awwal recorded, Safar missing. 29 days into Muharram
    // is either 30 Muharram or 1 Safar, and only the missing month start says
    // which — so the honest answer is nothing.
    const gapped = [start(1448, 1, '2026-06-17'), start(1448, 3, '2026-08-15')];
    expect(baseHijri(day('2026-07-15'), gapped)!.day).toBe(29);
    expect(baseHijri(day('2026-07-16'), gapped)).toBeNull();
  });

  it('claims day 30 only when the next CONSECUTIVE month is recorded', () => {
    const consecutive = [start(1448, 1, '2026-06-17'), start(1448, 2, '2026-07-17')];
    expect(baseHijri(day('2026-07-16'), consecutive)!.day).toBe(30);
  });

  it('treats month 12 → month 1 of the next year as consecutive', () => {
    const across = [start(1447, 12, '2026-05-18'), start(1448, 1, '2026-06-17')];
    expect(baseHijri(day('2026-06-16'), across)!.iso).toBe('1447-12-30');
  });

  it('but NOT month 12 → month 2, which skips a month across the boundary', () => {
    // A year-boundary neighbour is not automatically the consecutive month:
    // Muharram is missing here, so 30 Dhu al-Hijja is unproven.
    const skipped = [start(1447, 12, '2026-05-18'), start(1448, 2, '2026-07-16')];
    expect(baseHijri(day('2026-06-15'), skipped)!.day).toBe(29);
    expect(baseHijri(day('2026-06-16'), skipped)).toBeNull();
  });

  it('leaves a gap unresolved rather than stretching the month before it', () => {
    // Muharram recorded, Safar missing, Rabi al-Awwal recorded: dates inside the
    // gap must not be attributed to Muharram.
    const gapped = [start(1448, 1, '2026-06-17'), start(1448, 3, '2026-08-15')];
    expect(baseHijri(day('2026-07-20'), gapped)).toBeNull();
  });
});

describe('sortMonthStarts and month names', () => {
  it('orders rows by Gregorian start date', () => {
    const shuffled = [OFFICIAL[2]!, OFFICIAL[0]!, OFFICIAL[1]!];
    expect(sortMonthStarts(shuffled).map((s) => s.hijriMonth)).toEqual([12, 1, 2]);
  });

  it('does not mutate its input', () => {
    const shuffled = [OFFICIAL[2]!, OFFICIAL[0]!];
    sortMonthStarts(shuffled);
    expect(shuffled[0]!.hijriMonth).toBe(2);
  });

  it('resolution depends on the sorted order', () => {
    const shuffled = [OFFICIAL[2]!, OFFICIAL[0]!, OFFICIAL[1]!];
    expect(baseHijri(day('2026-06-17'), sortMonthStarts(shuffled))!.iso).toBe('1448-01-01');
  });

  it('names all twelve months in Arabic and nothing outside the range', () => {
    expect(hijriMonthNameArabic(1)).toBe('محرم');
    expect(hijriMonthNameArabic(9)).toBe('رمضان');
    expect(hijriMonthNameArabic(12)).toBe('ذو الحجة');
    expect(hijriMonthNameArabic(0)).toBe('');
    expect(hijriMonthNameArabic(13)).toBe('');
  });

  it('TD-9 pins the Hijri year range', () => {
    expect([MIN_HIJRI_YEAR, MAX_HIJRI_YEAR]).toEqual([1300, 1600]);
  });
});
