import { describe, expect, it } from 'vitest';

import { MAX_OFFSET, MIN_OFFSET, toHijri } from './hijri.js';

/**
 * Hijri overlay (§4.4, §5.7, TD-9).
 *
 * Pure computation, so these are unit tests. The properties that matter are
 * that the offset shifts whole days **across month and year boundaries**, and
 * that a bad offset cannot take the public calendar down.
 */
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('toHijri — the algorithmic base', () => {
  it('converts a Gregorian date to a Hijri date with an Arabic month name', () => {
    const h = toHijri(day('2026-02-18'));

    expect(h.year).toBe(1447);
    expect(h.month).toBe(9);
    expect(h.day).toBe(1);
    expect(h.monthNameArabic).toBe('رمضان');
    expect(h.iso).toBe('1447-09-01');
  });

  it('zero-pads the iso form so it sorts and compares as text', () => {
    expect(toHijri(day('2026-02-18')).iso).toBe('1447-09-01');
    expect(toHijri(day('2026-02-18')).iso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('advances by one Hijri day for each Gregorian day', () => {
    expect(toHijri(day('2026-02-19')).day).toBe(2);
    expect(toHijri(day('2026-02-20')).day).toBe(3);
  });
});

describe('the admin day-offset (§4.4 Morocco tuning)', () => {
  it('shifts the result by whole days in both directions', () => {
    // Morocco fixes months by local sighting and regularly starts Ramadan a day
    // after Umm al-Qura — which is precisely what the offset exists to express.
    expect(toHijri(day('2026-02-19'), -1).iso).toBe('1447-09-01');
    expect(toHijri(day('2026-02-17'), 1).iso).toBe('1447-09-01');
  });

  it('crosses a Hijri MONTH boundary correctly', () => {
    // The reason the offset is applied to the Gregorian input: stepping back
    // from 1 Ramadan must land on the last day of Sha'ban, whose length differs
    // month to month. Shifting the Hijri day number would have to know it.
    const back = toHijri(day('2026-02-18'), -1);

    expect(back.month).toBe(8);
    expect(back.monthNameArabic).toBe('شعبان');
    expect(back.day).toBeGreaterThanOrEqual(29);
  });

  it('crosses a Hijri YEAR boundary correctly', () => {
    // 2026-06-16 is 1 Muharram 1448. Stepping back a day must land in Dhu
    // al-Hijja **1447** — not on day 0 of the same year.
    expect(toHijri(day('2026-06-16')).iso).toBe('1448-01-01');

    const back = toHijri(day('2026-06-16'), -1);
    expect(back.year).toBe(1447);
    expect(back.month).toBe(12);
    expect(back.monthNameArabic).toBe('ذو الحجة');

    // And forward across it from the other side.
    expect(toHijri(day('2026-06-15'), 1).iso).toBe('1448-01-01');
  });

  it('offset 0 is the untuned base', () => {
    expect(toHijri(day('2026-02-18'), 0).iso).toBe(toHijri(day('2026-02-18')).iso);
  });
});

describe('a bad offset cannot break the public calendar', () => {
  it('clamps beyond TD-9 range rather than throwing', () => {
    // /calendar is anonymous-reachable; a corrupt settings row must degrade to
    // the nearest legal offset, not a 500 on a decorative label.
    expect(toHijri(day('2026-02-18'), 99).iso).toBe(toHijri(day('2026-02-18'), MAX_OFFSET).iso);
    expect(toHijri(day('2026-02-18'), -99).iso).toBe(toHijri(day('2026-02-18'), MIN_OFFSET).iso);
  });

  it('treats a non-finite offset as NO offset, not as a clamp', () => {
    // NaN and Infinity carry no direction to clamp toward, so the safe reading
    // is "untuned" rather than a guess at ±2.
    expect(toHijri(day('2026-02-18'), Number.NaN).iso).toBe('1447-09-01');
    expect(toHijri(day('2026-02-18'), Number.POSITIVE_INFINITY).iso).toBe('1447-09-01');
    expect(toHijri(day('2026-02-18'), Number.NEGATIVE_INFINITY).iso).toBe('1447-09-01');
  });

  it('truncates a fractional offset to whole days', () => {
    expect(toHijri(day('2026-02-18'), 1.9).iso).toBe(toHijri(day('2026-02-18'), 1).iso);
  });

  it('TD-9 pins the range at −2…+2', () => {
    expect([MIN_OFFSET, MAX_OFFSET]).toEqual([-2, 2]);
  });
});
