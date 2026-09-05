import { describe, expect, it } from 'vitest';

import { ar } from '../i18n/ar.js';
import { leadingBlanks, monthGrid, MONDAY_FIRST_DAY_INDEX } from './dates.js';

/**
 * **The week starts on Monday, everywhere the platform draws a calendar**
 * (Owner, 2026-09-02).
 *
 * It already did — one constant, one computation, one grid — and these pin it
 * so it cannot drift back. The value of the guard is that week-start is the
 * kind of thing a later "fix" flips locally on one screen: `getDay()` returns
 * 0 for Sunday, so the *absence* of the offset is what a Sunday-first bug
 * looks like, and it looks like ordinary code.
 *
 * **The scope note this carried is now moot, not merely out of date.** It used
 * to read *"a native `<input type=\"date\">` renders its popup from the
 * BROWSER's locale, which no page-level attribute can override"* — true while
 * the native control was kept deliberately (`DateField`'s old docstring gave
 * the trade-off), false since 2026-09-05: `date-picker.tsx` replaced every one
 * of them with the platform's own Monday-first grid, so this file's
 * `leadingBlanks`/`monthGrid` now genuinely cover **every** calendar surface,
 * with no exception left to state.
 */
describe('the platform calendar starts on Monday', () => {
  it('offsets from Monday, not from Sunday', () => {
    expect(MONDAY_FIRST_DAY_INDEX).toBe(1);
  });

  it('names الاثنين as the first weekday column', () => {
    expect(ar.calendar.weekdaysShort[0]).toBe('الاثنين');
    expect(ar.calendar.weekdaysShort[6]).toBe('الأحد');
    expect(ar.calendar.weekdaysShort).toHaveLength(7);
  });

  it('puts a month beginning on Monday in column one, with no blanks', () => {
    // 2026-06-01 is a Monday.
    expect(leadingBlanks(new Date(2026, 5, 1))).toBe(0);
  });

  it('pushes a month beginning on Sunday to the LAST column', () => {
    // 2026-03-01 is a Sunday — the case that is 0 under a Sunday-first grid and
    // 6 under a Monday-first one, so it fails loudly if the offset is dropped.
    expect(leadingBlanks(new Date(2026, 2, 1))).toBe(6);
  });

  it('places the 1st under its true weekday across a whole year', () => {
    for (let month = 0; month < 12; month += 1) {
      const first = new Date(2026, month, 1);
      const cells = monthGrid(first);
      const index = cells.findIndex((d) => d !== null);
      // Monday-first column index of the 1st: Monday→0 … Sunday→6.
      expect(index).toBe((first.getDay() + 6) % 7);
      // Whole weeks only, so the header row keeps meaning down every column.
      expect(cells.length % 7).toBe(0);
    }
  });
});
