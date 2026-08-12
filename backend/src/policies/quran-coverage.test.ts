import { describe, expect, it } from 'vitest';

import { computeCoverage, coveredAyahs, mergeIntervals } from './quran-coverage.js';

/**
 * BR-13, tested against **the specification's own worked example** — which is
 * the point of keeping the merge pure: §4.5 states the case, and this asserts it
 * without a database in the way.
 */
describe('BR-13 — coverage is a union', () => {
  it('merges the example §4.5 gives', () => {
    // "[10–20], [10–30], [30–123] merge to [10–123] = 114 ayahs."
    const merged = mergeIntervals([
      { start: 10, end: 20 },
      { start: 10, end: 30 },
      { start: 30, end: 123 },
    ]);
    expect(merged).toEqual([{ start: 10, end: 123 }]);
    expect(coveredAyahs(merged)).toBe(114);
  });

  it('never inflates coverage when a range is re-logged', () => {
    // The failure BR-13 exists to prevent: revision logs overlap memorization
    // logs constantly, and counting them twice would report a student past 100%.
    const once = coveredAyahs(mergeIntervals([{ start: 1, end: 50 }]));
    const twice = coveredAyahs(
      mergeIntervals([
        { start: 1, end: 50 },
        { start: 1, end: 50 },
        { start: 20, end: 30 },
      ]),
    );
    expect(twice).toBe(once);
  });

  it('joins adjacent runs — ayah 5 and ayah 6 are consecutive', () => {
    expect(mergeIntervals([{ start: 1, end: 5 }, { start: 6, end: 10 }])).toEqual([
      { start: 1, end: 10 },
    ]);
  });

  it('keeps genuine gaps apart', () => {
    expect(mergeIntervals([{ start: 1, end: 5 }, { start: 8, end: 10 }])).toEqual([
      { start: 1, end: 5 },
      { start: 8, end: 10 },
    ]);
  });

  it('counts closed ranges inclusively', () => {
    // `(2, 10, 20)` is eleven ayahs. Every off-by-one in a coverage figure
    // lives in this assertion.
    expect(coveredAyahs([{ start: 10, end: 20 }])).toBe(11);
  });

  it('does not mutate the caller’s array', () => {
    const input = [{ start: 5, end: 9 }, { start: 1, end: 3 }];
    mergeIntervals(input);
    expect(input[0]).toEqual({ start: 5, end: 9 });
  });

  it('is empty for a student with no logs — 0%, not NaN', () => {
    expect(computeCoverage([], 7)).toEqual({
      merged: [],
      mergedAyahCount: 0,
      coveragePercent: 0,
    });
  });
});

describe('coverage percent', () => {
  it('is a percentage of the Surah’s own total', () => {
    // Al-Fatiha: 7 ayahs. Four of them is 57.14%.
    expect(computeCoverage([{ start: 1, end: 4 }], 7).coveragePercent).toBe(57.14);
  });

  it('reaches exactly 100 for a complete Surah', () => {
    // BR-11 reads this number, so the boundary is the one that matters.
    expect(computeCoverage([{ start: 1, end: 286 }], 286).coveragePercent).toBe(100);
  });

  it('rounds to the two decimals the column stores', () => {
    // `Decimal(5,2)` — computing more precision than the column holds would mean
    // the stored value is not the computed one.
    expect(computeCoverage([{ start: 1, end: 1 }], 3).coveragePercent).toBe(33.33);
  });
});
