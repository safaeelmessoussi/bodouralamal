import { afterEach, describe, expect, it } from 'vitest';

import { setDataDictionary, translateDeep, translateText } from './data-translation.js';

/** SRS Revision 224 §4 — the stored texts in the reader's language. */
const DICTIONARY = {
  'وميض الأمل': 'Glimmer of Hope',
  'النساء': 'Women',
  'surah:النساء': "Al-Nisa'",
  'surah:آل عمران': 'Al Imran',
  'حفظ القرآن': 'Qur’an memorisation',
  'سورة {surah}': 'Surat {surah}',
  'السور: {list}': 'Surahs: {list}',
  'الحلقة {n}': 'Circle {n}',
  'الأستاذة {name}': 'Ustadha {name}',
  'word:الجمعة': 'Friday',
  'word:شتنبر': 'September',
  'word:السبت': 'Saturday',
  'word:التوقيت الإداري العادي': 'Regular office hours',
  'surah:البقرة': 'Al-Baqara',
  '{surah} الجزء الثاني (الحزب الثالث و الرابع و الخامس)': '{surah}, part two (third, fourth and fifth hizbs)',
};

afterEach(() => setDataDictionary(null));

describe('R224 §4 — stored texts translated, names never', () => {
  it('translates a whole text, a pattern and a composed title', () => {
    setDataDictionary(DICTIONARY);
    expect(translateText('وميض الأمل')).toBe('Glimmer of Hope');
    expect(translateText('سورة النساء')).toBe("Surat Al-Nisa'");
    expect(translateText('حفظ القرآن — السور: آل عمران، النساء — الحلقة 1')).toBe(
      "Qur’an memorisation — Surahs: Al Imran, Al-Nisa' — Circle 1",
    );
    expect(translateText('الجمعة 18 شتنبر 2026')).toBe('Friday 18 September 2026');
  });

  it('reads «النساء» as the Category, and as the Surah where the field is a Surah', () => {
    setDataDictionary(DICTIONARY);
    expect(translateDeep({ category_name: 'النساء', surah_name: 'النساء' })).toEqual({
      category_name: 'Women',
      surah_name: "Al-Nisa'",
    });
  });

  it('leaves a person\'s name, ids, URLs and Latin text untouched', () => {
    setDataDictionary(DICTIONARY);
    expect(translateText('الأستاذة منى حريكي')).toBe('Ustadha منى حريكي');
    const row = { id: 'وميض الأمل', stream_url: 'وميض الأمل', level_name: 'وميض الأمل', title: 'Lesson 1' };
    expect(translateDeep(row)).toEqual({ ...row, level_name: 'Glimmer of Hope' });
  });

  it('reads a listed phrase as one, inside a longer text, in the reader\'s order (R231)', () => {
    setDataDictionary(DICTIONARY);
    expect(translateText('التوقيت الإداري العادي:\nالجمعة - السبت\n09:00 - 12:30')).toBe(
      'Regular office hours:\nFriday - Saturday\n09:00 - 12:30',
    );
    // Only at a word's edge: a longer word that holds the phrase stays.
    expect(translateText('بالتوقيت الإداري العادي')).toBe('بالتوقيت الإداري العادي');
  });

  it('names a part of Al-Baqara by its pattern, the Surah by its own key (R232)', () => {
    setDataDictionary(DICTIONARY);
    expect(translateDeep({ name: 'البقرة الجزء الثاني (الحزب الثالث و الرابع و الخامس)' })).toEqual({
      name: 'Al-Baqara, part two (third, fourth and fifth hizbs)',
    });
  });

  it('changes nothing without a dictionary (Arabic)', () => {
    expect(translateDeep({ level_name: 'وميض الأمل' })).toEqual({ level_name: 'وميض الأمل' });
  });
});
