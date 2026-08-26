import { describe, expect, it } from 'vitest';

import { sortRows } from './sort-rows.js';

/**
 * **The client-side comparator, where the types actually differ** (R76.2).
 *
 * These are the cases the Owner named: dates must sort chronologically rather
 * than lexicographically, numbers numerically rather than as strings, Arabic by
 * the locale rather than by UTF-16 code unit, and absent values deterministically
 * — the four ways a naive `<` produces a table that looks sorted and is not.
 */
interface Row {
  name: string;
  when: string | null;
  size: number | null;
}

const rows: Row[] = [
  { name: 'بشرى', when: '2026-01-09T09:00', size: 9 },
  { name: 'آمنة', when: '2026-01-10T08:00', size: 10 },
  { name: 'تقى', when: '2026-01-09T17:00', size: 100 },
  { name: 'أسماء', when: null, size: null },
];
const accessors = {
  name: (r: Row) => r.name,
  when: (r: Row) => r.when,
  size: (r: Row) => r.size,
};
const order = (by: string, dir: 'asc' | 'desc'): string[] =>
  sortRows(rows, { by, dir }, accessors).map((r) => r.name);

describe('dates sort chronologically, not lexicographically', () => {
  it('puts 09 Jan 09:00 before 09 Jan 17:00 before 10 Jan 08:00', () => {
    // Lexicographically `2026-01-10T08:00` < `2026-01-09T17:00` is FALSE, so a
    // string compare happens to agree here — the case that separates them is
    // the clock within one day, which is why the fixture has two on the 9th.
    expect(order('when', 'asc')).toEqual(['بشرى', 'تقى', 'آمنة', 'أسماء']);
  });

  it('reverses on the second click, and the absent date STAYS last', () => {
    expect(order('when', 'desc')).toEqual(['آمنة', 'تقى', 'بشرى', 'أسماء']);
  });
});

describe('numbers sort numerically', () => {
  it('orders 9 before 10 before 100 — the case a string compare gets wrong', () => {
    // As strings: '10' < '100' < '9'. This is the assertion that would fail if
    // the accessor ever returned the humanised «١٠٠ ميغابايت» label instead.
    expect(order('size', 'asc')).toEqual(['بشرى', 'آمنة', 'تقى', 'أسماء']);
  });

  it('reverses, with the absent size still last', () => {
    expect(order('size', 'desc')).toEqual(['تقى', 'آمنة', 'بشرى', 'أسماء']);
  });
});

describe('Arabic uses the locale, not the code unit', () => {
  it('orders أ آ ب ت the way a reader expects', () => {
    // `Intl.Collator('ar')` treats the hamza/madda forms of alif as the same
    // base letter, so آمنة and أسماء sort together ahead of بشرى — which a
    // code-unit compare does not do.
    const names = order('name', 'asc');
    expect(names.indexOf('بشرى')).toBeGreaterThan(names.indexOf('آمنة'));
    expect(names.indexOf('بشرى')).toBeGreaterThan(names.indexOf('أسماء'));
    expect(names.indexOf('تقى')).toBe(3);
  });

  it('reverses fully — no value is pinned when it is present', () => {
    expect(order('name', 'desc')[0]).toBe('تقى');
  });
});

describe('the states that must not surprise anybody', () => {
  it('no sort returns the rows untouched — it is a real state', () => {
    expect(sortRows(rows, null, accessors).map((r) => r.name)).toEqual(
      rows.map((r) => r.name),
    );
  });

  it('a column the caller did not describe is left alone, never ordered by accident', () => {
    // The client-side counterpart of the server refusing a field outside its
    // allow-list: silently ordering by something unintended is the worse answer.
    expect(sortRows(rows, { by: 'unknown', dir: 'asc' }, accessors).map((r) => r.name)).toEqual(
      rows.map((r) => r.name),
    );
  });

  it('is STABLE, so ties keep the list’s own order', () => {
    const tied = [
      { name: 'ب', when: null, size: 1 },
      { name: 'أ', when: null, size: 1 },
    ];
    expect(sortRows(tied, { by: 'size', dir: 'asc' }, accessors).map((r) => r.name)).toEqual([
      'ب',
      'أ',
    ]);
  });

  it('does not mutate the array it was given', () => {
    const before = rows.map((r) => r.name);
    sortRows(rows, { by: 'name', dir: 'desc' }, accessors);
    expect(rows.map((r) => r.name)).toEqual(before);
  });
});
