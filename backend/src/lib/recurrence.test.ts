import { describe, expect, it } from 'vitest';

import {
  daysBetween,
  expandSchedule,
  mondayOf,
  timesOverlap,
  type ScheduleRecurrence,
} from './recurrence.js';

/**
 * Recurrence expansion for course schedules (SRS §4.4, TD-11).
 *
 * **The alternating-week pattern is the reason this file is long.** §4.4 and
 * §19.2 both name it as a mandatory explicit test, because it is the case naive
 * implementations get wrong *and* the case that justifies materializing sessions
 * eagerly: a weekly and a biweekly-alternating class in one room collide only on
 * alternate weeks, which comparing recurrence rules cannot see.
 */

const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
const at = (hh: number, mm = 0): Date => new Date(Date.UTC(1970, 0, 1, hh, mm, 0));
const iso = (dates: Date[]): string[] => dates.map((d) => d.toISOString().slice(0, 10));

const rule = (over: Partial<ScheduleRecurrence> = {}): ScheduleRecurrence => ({
  recurrence: 'weekly',
  weekdays: ['tuesday'],
  dayOfMonth: null,
  monthOfYear: null,
  anchorDate: null,
  ...over,
});

describe('weekly', () => {
  it('returns every matching weekday in the range', () => {
    // June 2026: Tuesdays are the 2nd, 9th, 16th, 23rd, 30th.
    expect(iso(expandSchedule(rule(), day('2026-06-01'), day('2026-06-30')))).toEqual([
      '2026-06-02',
      '2026-06-09',
      '2026-06-16',
      '2026-06-23',
      '2026-06-30',
    ]);
  });

  it('includes both endpoints of the range', () => {
    expect(iso(expandSchedule(rule(), day('2026-06-02'), day('2026-06-09')))).toEqual([
      '2026-06-02',
      '2026-06-09',
    ]);
  });

  it('returns nothing when the range is inverted', () => {
    expect(expandSchedule(rule(), day('2026-06-30'), day('2026-06-01'))).toEqual([]);
  });
});

describe('multiple_weekdays', () => {
  it('returns every listed weekday, in date order', () => {
    const r = rule({ recurrence: 'multiple_weekdays', weekdays: ['monday', 'thursday'] });
    expect(iso(expandSchedule(r, day('2026-06-01'), day('2026-06-14')))).toEqual([
      '2026-06-01', // Mon
      '2026-06-04', // Thu
      '2026-06-08',
      '2026-06-11',
    ]);
  });

  it('an empty weekday set produces nothing rather than everything', () => {
    // The failure mode worth pinning: a "match anything not excluded" reading
    // would turn a mis-saved schedule into a daily class.
    const r = rule({ recurrence: 'multiple_weekdays', weekdays: [] });
    expect(expandSchedule(r, day('2026-06-01'), day('2026-06-30'))).toEqual([]);
  });

  it('ignores an unknown weekday name instead of matching it', () => {
    const r = rule({ recurrence: 'multiple_weekdays', weekdays: ['monday', 'noneday'] });
    expect(iso(expandSchedule(r, day('2026-06-01'), day('2026-06-07')))).toEqual(['2026-06-01']);
  });
});

describe('biweekly_alternating — the case §19.2 names explicitly', () => {
  it('takes every OTHER Tuesday, counting from the anchor week', () => {
    const r = rule({
      recurrence: 'biweekly_alternating',
      weekdays: ['tuesday'],
      anchorDate: day('2026-06-02'),
    });
    expect(iso(expandSchedule(r, day('2026-06-01'), day('2026-06-30')))).toEqual([
      '2026-06-02',
      '2026-06-16',
      '2026-06-30',
    ]);
  });

  it('shifting the anchor by one week selects the OPPOSITE weeks', () => {
    // This is what "week on / week off" means, and the assertion that proves
    // the two halves are distinguishable at all.
    const on = rule({
      recurrence: 'biweekly_alternating',
      weekdays: ['tuesday'],
      anchorDate: day('2026-06-02'),
    });
    const off = rule({
      recurrence: 'biweekly_alternating',
      weekdays: ['tuesday'],
      anchorDate: day('2026-06-09'),
    });
    const onDates = iso(expandSchedule(on, day('2026-06-01'), day('2026-06-30')));
    const offDates = iso(expandSchedule(off, day('2026-06-01'), day('2026-06-30')));

    expect(offDates).toEqual(['2026-06-09', '2026-06-23']);
    // Disjoint, and together they are every Tuesday.
    expect(onDates.filter((d) => offDates.includes(d))).toEqual([]);
    expect([...onDates, ...offDates].sort()).toEqual([
      '2026-06-02',
      '2026-06-09',
      '2026-06-16',
      '2026-06-23',
      '2026-06-30',
    ]);
  });

  it('keeps a two-day schedule on the SAME side of the alternation', () => {
    // Parity is measured in whole weeks from the anchor's Monday. Measuring it
    // in days from the anchor would flip a Tuesday+Friday schedule mid-week,
    // so the class would run Tuesday one week and Friday the next.
    // The anchor is deliberately the FRIDAY, not the Tuesday. With a Tuesday
    // anchor, day-parity and week-parity happen to agree and the bug hides;
    // anchoring later in the week is what separates them, because the Tuesday
    // before it is a NEGATIVE day offset and floors to the wrong side.
    const r = rule({
      recurrence: 'biweekly_alternating',
      weekdays: ['tuesday', 'friday'],
      anchorDate: day('2026-06-05'),
    });
    expect(iso(expandSchedule(r, day('2026-06-01'), day('2026-06-21')))).toEqual([
      '2026-06-02', // Tue — same week as the anchor, so it is ON
      '2026-06-05', // Fri — the anchor itself
      '2026-06-16', // Tue, two weeks later
      '2026-06-19', // Fri
    ]);
  });

  it('an anchor mid-week behaves as its Monday', () => {
    const monday = rule({
      recurrence: 'biweekly_alternating',
      weekdays: ['tuesday'],
      anchorDate: day('2026-06-01'),
    });
    const thursday = rule({
      recurrence: 'biweekly_alternating',
      weekdays: ['tuesday'],
      anchorDate: day('2026-06-04'),
    });
    expect(iso(expandSchedule(monday, day('2026-06-01'), day('2026-06-30')))).toEqual(
      iso(expandSchedule(thursday, day('2026-06-01'), day('2026-06-30'))),
    );
  });

  it('produces nothing without an anchor rather than guessing a parity', () => {
    // The database refuses this row; if one ever appears, generating half the
    // occurrences at random is worse than generating none.
    const r = rule({
      recurrence: 'biweekly_alternating',
      weekdays: ['tuesday'],
      anchorDate: null,
    });
    expect(expandSchedule(r, day('2026-06-01'), day('2026-06-30'))).toEqual([]);
  });

  it('works for weeks BEFORE the anchor as well as after', () => {
    const r = rule({
      recurrence: 'biweekly_alternating',
      weekdays: ['tuesday'],
      anchorDate: day('2026-06-16'),
    });
    expect(iso(expandSchedule(r, day('2026-06-01'), day('2026-06-30')))).toEqual([
      '2026-06-02',
      '2026-06-16',
      '2026-06-30',
    ]);
  });
});

describe('monthly and yearly', () => {
  it('monthly returns the same day-of-month each month', () => {
    const r = rule({ recurrence: 'monthly', weekdays: [], dayOfMonth: 15 });
    expect(iso(expandSchedule(r, day('2026-06-01'), day('2026-08-31')))).toEqual([
      '2026-06-15',
      '2026-07-15',
      '2026-08-15',
    ]);
  });

  it('monthly on the 31st simply skips months that have no 31st', () => {
    // Not clamped to the 30th: a class "on the 31st" does not silently become a
    // class on the 30th, which would be a different date nobody chose.
    const r = rule({ recurrence: 'monthly', weekdays: [], dayOfMonth: 31 });
    expect(iso(expandSchedule(r, day('2026-06-01'), day('2026-09-30')))).toEqual([
      '2026-07-31',
      '2026-08-31',
    ]);
  });

  it('yearly returns one date per year', () => {
    const r = rule({ recurrence: 'yearly', weekdays: [], dayOfMonth: 12, monthOfYear: 9 });
    expect(iso(expandSchedule(r, day('2026-01-01'), day('2028-12-31')))).toEqual([
      '2026-09-12',
      '2027-09-12',
      '2028-09-12',
    ]);
  });
});

describe('daily', () => {
  it('returns every day in the range regardless of weekday set', () => {
    const r = rule({ recurrence: 'daily', weekdays: [] });
    expect(expandSchedule(r, day('2026-06-01'), day('2026-06-07'))).toHaveLength(7);
  });
});

describe('none is never expanded on a schedule', () => {
  it('produces nothing — a non-recurring occurrence is an Event (§4.4)', () => {
    const r = rule({ recurrence: 'none' });
    expect(expandSchedule(r, day('2026-06-01'), day('2026-06-30'))).toEqual([]);
  });
});

describe('DST safety (TD-11, §20 rule 14)', () => {
  it('spans both of Morocco’s 2026 clock transitions without shifting a weekday', () => {
    // Morocco suspends DST for Ramadan and restores it afterwards. All
    // arithmetic here is integer days on UTC midnight, so a clock shift cannot
    // move an occurrence to a different day — the trap the SRS names twice.
    const r = rule({ recurrence: 'weekly', weekdays: ['saturday'] });
    const dates = expandSchedule(r, day('2026-01-01'), day('2026-12-31'));
    expect(dates.every((d) => d.getUTCDay() === 6)).toBe(true);
    // 2026 has 52 Saturdays.
    expect(dates).toHaveLength(52);
  });

  it('every produced date is exactly UTC midnight', () => {
    const dates = expandSchedule(rule(), day('2026-06-01'), day('2026-06-30'));
    expect(
      dates.every(
        (d) => d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0,
      ),
    ).toBe(true);
  });
});

describe('helpers', () => {
  it('mondayOf returns the Monday on or before any day, including Sunday', () => {
    expect(mondayOf(day('2026-06-01')).toISOString().slice(0, 10)).toBe('2026-06-01'); // Mon
    expect(mondayOf(day('2026-06-04')).toISOString().slice(0, 10)).toBe('2026-06-01'); // Thu
    // Sunday belongs to the week that STARTED six days earlier (BR-17), not to
    // the one about to start — the classic off-by-one in Sunday-0 arithmetic.
    expect(mondayOf(day('2026-06-07')).toISOString().slice(0, 10)).toBe('2026-06-01');
    expect(mondayOf(day('2026-06-08')).toISOString().slice(0, 10)).toBe('2026-06-08');
  });

  it('daysBetween is exact across a month boundary', () => {
    expect(daysBetween(day('2026-06-28'), day('2026-07-02'))).toBe(4);
    expect(daysBetween(day('2026-07-02'), day('2026-06-28'))).toBe(-4);
  });
});

describe('timesOverlap — half-open, so back-to-back classes are legal', () => {
  it('detects a genuine overlap', () => {
    expect(timesOverlap(at(9), at(10, 30), at(10), at(11))).toBe(true);
  });

  it('treats touching boundaries as NO conflict', () => {
    // A class ending at 10:00 and one starting at 10:00 share a room fine.
    // Treating this as a collision would make consecutive classes impossible,
    // which is how the association actually uses its rooms.
    expect(timesOverlap(at(9), at(10), at(10), at(11))).toBe(false);
    expect(timesOverlap(at(10), at(11), at(9), at(10))).toBe(false);
  });

  it('detects containment in both directions', () => {
    expect(timesOverlap(at(9), at(12), at(10), at(11))).toBe(true);
    expect(timesOverlap(at(10), at(11), at(9), at(12))).toBe(true);
  });

  it('ignores the date part entirely — it compares clock times', () => {
    const a = new Date(Date.UTC(2026, 5, 2, 9, 0, 0));
    const b = new Date(Date.UTC(1970, 0, 1, 9, 30, 0));
    expect(timesOverlap(a, new Date(Date.UTC(2026, 5, 2, 10, 0, 0)), b, at(10, 30))).toBe(true);
  });
});
