import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { LibraryEntry } from '../../adapters/content.js';
import { ar } from '../../i18n/ar.js';
import RESOURCES_SOURCE from '../../pages/resources.tsx?raw';
import { groupBySurah, SurahLibrary } from './surah-library.js';

/** R196 — the library read by Surah. */
const entry = (id: string, surah: number | null, mime: string, shelf = 'L1'): LibraryEntry => ({
  item: {
    id,
    title: `عنوان ${id}`,
    description: null,
    kind: mime === 'application/pdf' ? 'pdf' : mime.startsWith('audio/') ? 'audio' : mime.startsWith('image/') ? 'image' : 'document',
    mime_type: mime,
    size_bytes: 10,
    published_on: '2026-10-01',
    teacher_display_name: null,
    subject_name: 'تفسير القرآن',
    whole_category: false,
  },
  category_id: 'c',
  category_name: 'المرأة',
  shelf_key: shelf,
  shelf_kind: 'level',
  level_id: shelf,
  level_name: 'نور الأمل',
  academic_year_id: 'y',
  academic_year_label: '2026-2027',
  branch_id: null,
  branch_name: null,
  subject_id: 's',
  subject_name: 'تفسير القرآن',
  surah_id: surah,
  surah_name: surah === 1 ? 'الفاتحة' : surah === 2 ? 'البقرة' : surah === 36 ? 'يس' : null,
});

const ENTRIES = [
  entry('a', 36, 'audio/mpeg'),
  entry('b', 2, 'application/pdf'),
  entry('c', 2, 'audio/mpeg'),
  entry('c', 2, 'audio/mpeg', 'L2'), // the same item on a second shelf
  entry('d', null, 'application/pdf'),
  entry('e', 2, 'image/png'),
];

describe('groupBySurah', () => {
  it('keeps only items about a Surah, in Mushaf order, each item once', () => {
    const groups = groupBySurah(ENTRIES);
    expect(groups.map((g) => g.id)).toEqual([2, 36]);
    // Server order is newest first; a Surah reads oldest first.
    expect(groups[0]!.items.map((i) => i.id)).toEqual(['e', 'c', 'b']);
  });
});

describe('SurahLibrary', () => {
  const html = (initialSurah: number | null) =>
    renderToStaticMarkup(
      <SurahLibrary entries={ENTRIES} initialSurah={initialSurah} accessToken={null} activeChildId={null} onOpen={() => undefined} />,
    );
  it('opens on the first Surah in the Mushaf that has content, listing only Surahs with content', () => {
    const out = html(null);
    expect(out).toContain('سورة البقرة');
    expect(out).toContain('يس');
    expect(out).not.toContain('الفاتحة');
    expect(out).toContain('aria-current="true"');
  });
  it('groups the Surah by what each item is: listen in place, read, see', () => {
    const out = html(2);
    expect(out).toContain(ar.content.bySurah.section.listen);
    expect(out).toContain(ar.content.bySurah.section.read);
    expect(out).toContain(ar.content.bySurah.section.see);
    expect(out).not.toContain(ar.content.bySurah.section.watch);
    expect(out).toContain('surah-track__play');
  });
  it('honours a shared ?surah=', () => {
    expect(html(36)).toContain('سورة يس');
  });
  it('says so when nothing is about a Surah yet', () => {
    const out = renderToStaticMarkup(
      <SurahLibrary entries={[entry('d', null, 'application/pdf')]} initialSurah={null} accessToken={null} activeChildId={null} onOpen={() => undefined} />,
    );
    expect(out).toContain(ar.content.bySurah.empty);
  });
});

describe('the page', () => {
  it('opens on «حسب السورة» unless ?view=levels or a Level/Category is named', () => {
    expect(RESOURCES_SOURCE).toContain("if (param === 'levels' || levelId !== null || categoryId !== null) return 'level';");
    expect(RESOURCES_SOURCE).toContain("return 'surah';");
    expect(ar.content.views.bySurah).toBe('حسب السورة');
    expect(ar.content.views.byLevel).toBe('حسب المستوى');
  });
});
