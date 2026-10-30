import { describe, expect, it } from 'vitest';

import type { LibraryEntry } from '../../adapters/content.js';
import { groupBySubject, isGeneralEntry } from './subject-library.js';

/** R256/R258 — «محتوى عام», by Subject. */
const entry = (
  id: string,
  title: string,
  subject: { id: string; name: string },
  over: { order?: number | null; seasonal?: boolean; surah?: number | null } = {},
): LibraryEntry => ({
  item: {
    id,
    title,
    description: null,
    kind: 'audio',
    mime_type: 'audio/mpeg',
    size_bytes: 1,
    published_on: '2026-10-30',
    teacher_display_name: null,
    subject_name: subject.name,
    whole_category: false,
    display_order: over.order ?? null,
  },
  category_id: 'C',
  category_name: 'النساء',
  shelf_key: 'L',
  shelf_kind: 'level',
  level_id: 'L',
  level_name: 'ضياء الأمل',
  academic_year_id: 'Y',
  academic_year_label: '2026-2027',
  branch_id: null,
  branch_name: null,
  subject_id: subject.id,
  subject_name: subject.name,
  surah_id: over.surah ?? null,
  surah_name: null,
  subject_seasonal: over.seasonal ?? true,
  subject_shared: false,
});

const ghazawat = { id: 'G', name: 'دورة الغزوات' };
const quranSciences = { id: 'Q', name: 'دورة علوم القرآن' };
const sunnah = { id: 'S', name: 'دورة تثبيت حجية السنة' };

describe('«محتوى عام»', () => {
  it('holds what is seasonal or shared, never an item about a Surah', () => {
    expect(isGeneralEntry(entry('a', 'x', ghazawat))).toBe(true);
    expect(isGeneralEntry(entry('b', 'x', ghazawat, { surah: 2 }))).toBe(false);
    expect(isGeneralEntry(entry('c', 'x', ghazawat, { seasonal: false }))).toBe(false);
  });

  it('R258 — lists the Subjects in the «المواد» order, an unplaced one last', () => {
    const rank = new Map([
      ['Q', 0],
      ['S', 1],
    ]);
    const groups = groupBySubject(
      [entry('1', 'a', ghazawat), entry('2', 'b', sunnah), entry('3', 'c', quranSciences)],
      rank,
    );
    expect(groups.map((g) => g.name)).toEqual(['دورة علوم القرآن', 'دورة تثبيت حجية السنة', 'دورة الغزوات']);
  });

  it('R258 — a placed recording takes its place; the rest follow in title order', () => {
    const groups = groupBySubject([
      entry('hunayn', 'تسجيل دورة الغزوات — غزوة حنين', ghazawat, { order: 4 }),
      entry('badr2', 'تسجيل دورة الغزوات — غزوة بدر الجزء 2', ghazawat, { order: 2 }),
      entry('uhud', 'تسجيل دورة الغزوات — غزوة أحد وغزوة حمراء الأسد', ghazawat, { order: 3 }),
      entry('badr1', 'تسجيل دورة الغزوات — غزوة بدر الجزء 1', ghazawat, { order: 1 }),
      entry('tabuk', 'تسجيل دورة الغزوات — غزوتي تبوك ومؤتة', ghazawat, { order: 5 }),
      entry('extra', 'تسجيل دورة الغزوات — أ', ghazawat),
    ]);
    expect(groups[0]!.items.map((i) => i.id)).toEqual(['badr1', 'badr2', 'uhud', 'hunayn', 'tabuk', 'extra']);
  });
});
