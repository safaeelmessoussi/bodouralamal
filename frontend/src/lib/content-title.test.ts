import { describe, expect, it } from 'vitest';

import { composeTitle, EMPTY_TITLE_NUMBERS, parseTitle } from './content-title.js';

/** R259 — the Owner's two examples, both ways. */
describe('a content title from its parts', () => {
  it('composes «تسجيل صوتي تفسير سورة البقرة الجزء الثاني الحصة 7 الجزء 2 تعريف الحمد»', () => {
    expect(
      composeTitle({
        numbers: { format: 'تسجيل صوتي', page: '', session: '7', part: '2' },
        subject: 'تفسير القرآن',
        surahName: 'البقرة',
        surahPart: 2,
        description: 'تعريف الحمد',
      }),
    ).toBe('تسجيل صوتي تفسير سورة البقرة الجزء الثاني الحصة 7 الجزء 2 تعريف الحمد');
  });

  it('composes «صورة 6 تفسير سورة الفاتحة الحصة 1 الجزء 2 تعريف الحمد»', () => {
    expect(
      composeTitle({
        numbers: { format: 'صورة', page: '6', session: '1', part: '2' },
        subject: 'تفسير القرآن',
        surahName: 'الفاتحة',
        surahPart: null,
        description: 'تعريف الحمد',
      }),
    ).toBe('صورة 6 تفسير سورة الفاتحة الحصة 1 الجزء 2 تعريف الحمد');
  });

  it('leaves out what is empty, and names another Subject whole', () => {
    expect(
      composeTitle({ numbers: { ...EMPTY_TITLE_NUMBERS, format: 'مطبوع' }, subject: 'الفقه', surahName: null, surahPart: null, description: '' }),
    ).toBe('مطبوع الفقه');
  });

  it('reads the numbers back, never the Surah part as the lesson part', () => {
    expect(parseTitle('تسجيل صوتي تفسير سورة البقرة الجزء الثاني الحصة 7 الجزء 2 تعريف الحمد')).toEqual({
      format: 'تسجيل صوتي',
      page: '',
      session: '7',
      part: '2',
    });
    expect(parseTitle('صورة 6 تفسير سورة الفاتحة الحصة 1 الجزء 2 تعريف الحمد')).toEqual({
      format: 'صورة',
      page: '6',
      session: '1',
      part: '2',
    });
  });

  it('reads nothing from a title written another way', () => {
    expect(parseTitle('تفسير القرآن — سورة الفاتحة — الاثنين 19 أكتوبر 2026')).toEqual(EMPTY_TITLE_NUMBERS);
  });
});
