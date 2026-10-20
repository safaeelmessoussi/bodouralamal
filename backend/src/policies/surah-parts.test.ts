import { describe, expect, it } from 'vitest';

import { coverageWithin, partRange, surahSplits, syllabusName } from './surah-parts.js';

describe('R232 — Al-Baqara in two parts (Warsh)', () => {
  it('splits at verse 141, «سيقول السفهاء», and only Al-Baqara splits', () => {
    expect(partRange(2, 1, 285)).toEqual({ start: 1, end: 140 });
    expect(partRange(2, 2, 285)).toEqual({ start: 141, end: 285 });
    expect(partRange(2, null, 285)).toEqual({ start: 1, end: 285 });
    expect(surahSplits(2)).toBe(true);
    expect(surahSplits(3)).toBe(false);
    expect(partRange(3, 1, 200)).toEqual({ start: 1, end: 200 });
  });

  it('names the part as the Owner wrote it', () => {
    expect(syllabusName('البقرة', 2, 1)).toBe('البقرة الجزء الأول (الحزب الأول و الثاني)');
    expect(syllabusName('البقرة', 2, 2)).toBe('البقرة الجزء الثاني (الحزب الثالث و الرابع و الخامس)');
    expect(syllabusName('البقرة', 2, null)).toBe('البقرة');
  });

  it('reads memorisation against the part alone', () => {
    const merged = [
      { start: 1, end: 150 },
      { start: 200, end: 285 },
    ];
    expect(coverageWithin(merged, partRange(2, 1, 285))).toEqual({
      merged: [{ start: 1, end: 140 }],
      mergedAyahCount: 140,
      coveragePercent: 100,
      totalAyahs: 140,
    });
    const second = coverageWithin(merged, partRange(2, 2, 285));
    expect(second.merged).toEqual([
      { start: 141, end: 150 },
      { start: 200, end: 285 },
    ]);
    expect(second.mergedAyahCount).toBe(96);
    expect(second.totalAyahs).toBe(145);
    expect(second.coveragePercent).toBe(66.21);
  });
});
