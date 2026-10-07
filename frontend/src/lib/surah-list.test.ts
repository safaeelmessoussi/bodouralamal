import { describe, expect, it } from 'vitest';

import { chipText } from '../components/calendar/chip-parts.js';
import type { Occurrence } from '../adapters/calendar.js';
import { occurrenceSurahs, shortSurahList } from './surah-list.js';

describe('R208 — the Surahs an occurrence is about, said shortly', () => {
  const juzAmma = ['النبأ', 'النازعات', 'عبس', 'التكوير', 'الانفطار', 'الناس'];

  it('names up to four in full, more as «الأولى … الأخيرة»', () => {
    expect(shortSurahList([])).toBe('');
    expect(shortSurahList(['الفاتحة'])).toBe('الفاتحة');
    expect(shortSurahList(['النبأ', 'النازعات', 'عبس', 'التكوير'])).toBe('النبأ، النازعات، عبس، التكوير');
    expect(shortSurahList(juzAmma)).toBe('النبأ … الناس');
  });

  it('prefers the occurrence’s own Surahs, else its Level’s', () => {
    expect(occurrenceSurahs({ surah_names: ['الملك'], level_surah_names: juzAmma })).toEqual(['الملك']);
    expect(occurrenceSurahs({ surah_names: [], level_surah_names: juzAmma })).toEqual(juzAmma);
    expect(occurrenceSurahs({})).toEqual([]);
  });

  it('a chip of a حفظ class with no Surah of its own says its Level’s, shortened', () => {
    const occurrence = {
      kind: 'session',
      title: 'حفظ القرآن',
      subject_name: 'حفظ القرآن',
      surah_names: [],
      level_surah_names: juzAmma,
      level_ids: ['l'],
      level_names: ['المستوى 0'],
      category_ids: [],
      category_names: [],
      branch_names: [],
    } as unknown as Occurrence;
    const text = chipText(occurrence, new Set());
    expect(text.head).toBe('حفظ القرآن');
    expect(text.details.map((d) => d.text)).toEqual(['السور: النبأ … الناس', 'المستوى 0']);
  });
});
