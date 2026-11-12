import { describe, expect, it } from 'vitest';

import { composeTitle, EMPTY_TITLE_NUMBERS, parseFileName, parseTitle, trailingDate, withSessionDate } from './content-title.js';

/** R259 — the Owner's two examples, both ways. */
describe('a content title from its parts', () => {
  it('composes «تسجيل صوتي تفسير سورة البقرة الجزء الثاني (من الحزب الثالث الى آخر السورة) الحصة 7 الجزء 2 تعريف الحمد»', () => {
    expect(
      composeTitle({
        numbers: { format: 'تسجيل صوتي', page: '', session: '7', part: '2' },
        subject: 'تفسير القرآن',
        surahName: 'البقرة',
        surahPartLabel: 'الجزء الثاني (من الحزب الثالث الى آخر السورة)',
        description: 'تعريف الحمد',
      }),
    ).toBe('تسجيل صوتي تفسير سورة البقرة الجزء الثاني (من الحزب الثالث الى آخر السورة) الحصة 7 الجزء 2 تعريف الحمد');
  });

  it('composes «صورة 6 تفسير سورة الفاتحة الحصة 1 الجزء 2 تعريف الحمد»', () => {
    expect(
      composeTitle({
        numbers: { format: 'صورة', page: '6', session: '1', part: '2' },
        subject: 'تفسير القرآن',
        surahName: 'الفاتحة',
        surahPartLabel: '',
        description: 'تعريف الحمد',
      }),
    ).toBe('صورة 6 تفسير سورة الفاتحة الحصة 1 الجزء 2 تعريف الحمد');
  });

  it('leaves out what is empty, and names another Subject whole', () => {
    expect(
      composeTitle({ numbers: { ...EMPTY_TITLE_NUMBERS, format: 'مطبوع' }, subject: 'الفقه', surahName: null, surahPartLabel: '', description: '' }),
    ).toBe('مطبوع الفقه');
  });

  it('reads the numbers back, never the Surah part as the lesson part', () => {
    expect(parseTitle('تسجيل صوتي تفسير سورة البقرة الجزء الثاني (من الحزب الثالث الى آخر السورة) الحصة 7 الجزء 2 تعريف الحمد')).toEqual({
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

/** R260 — the Owner's three file names. */
describe('the numbers a file name says', () => {
  it('reads «Z0000121الحصة الأولى من تفسير سورة البقرة ج 1.mp3»', () => {
    expect(parseFileName('Z0000121الحصة الأولى من تفسير سورة البقرة ج 1.mp3', 'audio')).toEqual({
      format: 'تسجيل صوتي',
      page: '',
      session: '1',
      part: '1',
    });
  });

  it('reads «ح 7 ج 2 من تفسير سورة ال عمران.mp3»', () => {
    expect(parseFileName('ح 7 ج 2 من تفسير سورة ال عمران.mp3', 'audio')).toEqual({
      format: 'تسجيل صوتي',
      page: '',
      session: '7',
      part: '2',
    });
  });

  it('reads «الحصة_الثالثة_تفسير_سورة_البقرة_ج2.mp3»', () => {
    expect(parseFileName('الحصة_الثالثة_تفسير_سورة_البقرة_ج2.mp3', 'audio')).toEqual({
      format: 'تسجيل صوتي',
      page: '',
      session: '3',
      part: '2',
    });
  });

  it('reads a teen ordinal, a page, and Arabic-Indic digits', () => {
    expect(parseFileName('الحصة الحادية عشرة ص ٦.png', 'image')).toEqual({ format: 'صورة', page: '6', session: '11', part: '' });
  });

  it('says nothing the name does not say', () => {
    expect(parseFileName('recording-0042.m4a', 'audio')).toEqual({ format: 'تسجيل صوتي', page: '', session: '', part: '' });
  });
});

/** R265 — a title ends with its session's date. */
describe('the session date at a title\'s end', () => {
  it('is the last piece of a built title', () => {
    expect(
      composeTitle({
        numbers: { format: 'تسجيل صوتي', page: '', session: '4', part: '1' },
        subject: 'تفسير القرآن',
        surahName: 'المائدة',
        surahPartLabel: '',
        description: '',
        sessionDate: 'الاثنين 9 نونبر 2026',
      }),
    ).toBe('تسجيل صوتي تفسير سورة المائدة الحصة 4 الجزء 1 الاثنين 9 نونبر 2026');
  });

  it('replaces a date already there, never doubles it, and reads it back', () => {
    const typed = 'تسجيل صوتي تفسير سورة المائدة الحصة 4 الجزء 1 الاثنين 2 نونبر 2026';
    expect(withSessionDate(typed, 'الاثنين 9 نونبر 2026')).toBe(
      'تسجيل صوتي تفسير سورة المائدة الحصة 4 الجزء 1 الاثنين 9 نونبر 2026',
    );
    expect(withSessionDate('صفحة 3 مطبوع', 'الخميس 12 نونبر 2026')).toBe('صفحة 3 مطبوع الخميس 12 نونبر 2026');
    expect(trailingDate(typed)).toBe('الاثنين 2 نونبر 2026');
    expect(trailingDate('صفحة 3 مطبوع')).toBe('');
  });
});
