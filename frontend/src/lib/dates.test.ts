import { describe, expect, it } from 'vitest';

import {
  addDays,
  addMonthsClamped,
  addYearsClamped,
  parseIsoDate,
  startOfWeek,
  toIsoDate,
} from './dates.js';

/**
 * The date-picker's own arithmetic — pure functions, so they are the part of
 * the picker this project's `renderToStaticMarkup`-only test environment can
 * actually exercise directly (no jsdom, no event simulation; see
 * `date-picker.test.tsx` for what that leaves to be asserted from rendered
 * markup instead).
 */
describe('addDays', () => {
  it('rolls a month boundary over correctly', () => {
    expect(toIsoDate(addDays(new Date(2026, 0, 31), 1))).toBe('2026-02-01');
  });
});

describe('addMonthsClamped — PageUp/PageDown across months of different lengths', () => {
  it('clamps into the shorter month rather than rolling over', () => {
    // 31 May, one month back: April has 30 days, so this must land on the
    // 30th — `new Date(y, 3, 31)` alone would silently roll to 1 May.
    expect(toIsoDate(addMonthsClamped(new Date(2026, 4, 31), -1))).toBe('2026-04-30');
  });

  it('does nothing extra when the day already fits', () => {
    expect(toIsoDate(addMonthsClamped(new Date(2026, 0, 15), 1))).toBe('2026-02-15');
  });
});

describe('addYearsClamped — Shift+PageUp/PageDown across leap years', () => {
  it('clamps 29 February into 28 on a non-leap target year', () => {
    expect(toIsoDate(addYearsClamped(new Date(2028, 1, 29), 1))).toBe('2029-02-28');
  });
});

describe('startOfWeek — Monday-first (BR-17), like every other calendar surface', () => {
  it('a Wednesday steps back to that week’s Monday', () => {
    // 2026-06-17 is a Wednesday.
    expect(toIsoDate(startOfWeek(new Date(2026, 5, 17)))).toBe('2026-06-15');
  });

  it('a Monday stays put', () => {
    expect(toIsoDate(startOfWeek(new Date(2026, 5, 15)))).toBe('2026-06-15');
  });

  it('a Sunday steps back six days, not zero — the Monday-first case that a Sunday-first bug gets wrong', () => {
    // 2026-06-21 is a Sunday; under Monday-first it is the LAST day of its own
    // week, not the first of the next one.
    expect(toIsoDate(startOfWeek(new Date(2026, 5, 21)))).toBe('2026-06-15');
  });
});

describe('parseIsoDate', () => {
  it('parses a real calendar date', () => {
    const parsed = parseIsoDate('2026-06-12');
    expect(parsed).not.toBeNull();
    expect(toIsoDate(parsed!)).toBe('2026-06-12');
  });

  it('rejects a calendar impossibility rather than rolling it over', () => {
    // `new Date(2026, 1, 30)` is silently the 2nd of March; the picker must not
    // show that value in the wrong grid cell.
    expect(parseIsoDate('2026-02-30')).toBeNull();
  });

  it('rejects anything that is not YYYY-MM-DD', () => {
    for (const bad of ['', '12/06/2026', '2026-6-12', 'not a date', '2026-06-12T00:00:00Z']) {
      expect(parseIsoDate(bad), bad).toBeNull();
    }
  });
});
