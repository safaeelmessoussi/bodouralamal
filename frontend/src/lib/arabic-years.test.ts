import { describe, expect, it } from 'vitest';

import { ageRangeWords, yearsWords } from './arabic-years.js';

/** R197 — «من 5 سنوات», «من 13 سنة»: the counted noun agrees with its number. */
describe('yearsWords', () => {
  it('writes 1 and 2 in words, 3–10 with سنوات, 11 and above with سنة', () => {
    expect(yearsWords(1)).toBe('سنة واحدة');
    expect(yearsWords(2)).toBe('سنتين');
    expect(yearsWords(3)).toBe('3 سنوات');
    expect(yearsWords(5)).toBe('5 سنوات');
    expect(yearsWords(10)).toBe('10 سنوات');
    expect(yearsWords(11)).toBe('11 سنة');
    expect(yearsWords(13)).toBe('13 سنة');
    expect(yearsWords(100)).toBe('100 سنة');
  });
  it('a range agrees with its upper bound', () => {
    expect(ageRangeWords(5, null)).toBe('من 5 سنوات');
    expect(ageRangeWords(13, null)).toBe('من 13 سنة');
    expect(ageRangeWords(3, 6)).toBe('من 3 إلى 6 سنوات');
    expect(ageRangeWords(6, 12)).toBe('من 6 إلى 12 سنة');
    expect(ageRangeWords(null, 10)).toBe('حتى 10 سنوات');
    expect(ageRangeWords(null, null)).toBeNull();
  });
});
