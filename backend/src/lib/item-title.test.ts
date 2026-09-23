import { describe, expect, it } from 'vitest';

import { composeItemTitle, TEACHER_HONORIFIC } from './item-title.js';
import { moroccoWallClockToInstant } from './morocco-clock.js';
import { RECORDING_TITLE_LIMIT, sessionRecordingBaseName } from './recording-name.js';

/**
 * SRS Revision 166 §3 — a class, an occurrence, a bare exam and a recording are
 * CALLED what they are; nobody types it. One composer, so they cannot disagree.
 */
const parts = {
  typeName: 'حصة دراسية',
  subjectName: 'تفسير القرآن',
  surahNames: ['الفاتحة', 'البقرة'],
  leadName: 'صفاء',
  date: '2026-09-22',
  time: '15:00',
};

describe('what an item is called', () => {
  it('type — Subject — Surah(s) — main teacher — when', () => {
    // R172 §12 (the Owner) — the word before the teacher's name, defined once
    // (`TEACHER_HONORIFIC`) on this composer: every title carries it.
    expect(composeItemTitle(parts)).toBe(
      'حصة دراسية — تفسير القرآن — الفاتحة، البقرة — الأستاذة صفاء — 2026-09-22 15:00',
    );
    expect(composeItemTitle(parts)).toContain(`${TEACHER_HONORIFIC} صفاء`);
  });

  it('a repeating class’s own row spans dates, so it carries its time alone', () => {
    expect(composeItemTitle({ ...parts, date: null })).toBe(
      'حصة دراسية — تفسير القرآن — الفاتحة، البقرة — الأستاذة صفاء — 15:00',
    );
  });

  it('omits what the item does not have rather than leaving empty separators', () => {
    expect(
      composeItemTitle({
        typeName: null,
        subjectName: 'فقه',
        surahNames: [],
        leadName: null,
        date: '2026-09-22',
        time: null,
      }),
    ).toBe('فقه — 2026-09-22');
  });
});

describe('where the text is stored in VARCHAR(120)', () => {
  const many = Array.from({ length: 30 }, (_, i) => `سورة رقم ${i + 1}`);

  it('never exceeds the limit — an overflow would REFUSE the row, not shorten it', () => {
    const title = composeItemTitle({ ...parts, surahNames: many }, 120);
    expect(title.length).toBeLessThanOrEqual(120);
    // Surahs give way first, visibly, and «when» is kept whole.
    expect(title).toContain('سورة رقم 1');
    expect(title).toContain('…');
    expect(title.endsWith('2026-09-22 15:00')).toBe(true);
  });

  it('gives up the main teacher before it gives up «when»', () => {
    const title = composeItemTitle(
      { ...parts, surahNames: [], leadName: 'اسم طويل جدا '.repeat(12) },
      80,
    );
    expect(title.length).toBeLessThanOrEqual(80);
    expect(title).not.toContain('اسم طويل');
    expect(title.endsWith('2026-09-22 15:00')).toBe(true);
  });

  it('a recording’s title always fits its column, with room left for « 999»', () => {
    const title = sessionRecordingBaseName({
      typeName: 'حصة دراسية',
      subjectName: 'تفسير القرآن',
      surahNames: many,
      teacherName: 'الأستاذة صفاء المسوسي',
      // Morocco's wall clock, from the one authority that also reads it (R167 §2).
      at: moroccoWallClockToInstant(2026, 9, 21, 6, 10, 0),
    });
    expect(title.length).toBeLessThanOrEqual(RECORDING_TITLE_LIMIT);
    expect(`${title} 999`.length).toBeLessThanOrEqual(120);
    expect(title.endsWith('2026-09-21 06:10')).toBe(true);
  });
});
