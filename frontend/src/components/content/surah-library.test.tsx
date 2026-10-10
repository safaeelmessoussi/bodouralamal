import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { LibraryEntry } from '../../adapters/content.js';
import { ar } from '../../i18n/ar.js';
import RESOURCES_SOURCE from '../../pages/resources.tsx?raw';
import { byTitle, groupBySurah, SurahLibrary, withDiagramSurahs } from './surah-library.js';
import { isSlides } from './surah-page.js';

/** R196 — the library read by Surah. */
const entry = (id: string, surah: number | null, mime: string, shelf = 'L1', title = `عنوان ${id}`): LibraryEntry => ({
  item: {
    id,
    title,
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
  entry('f', 2, 'application/pdf', 'L1', 'شرائح حصة تفسير سورة البقرة'),
];

describe('groupBySurah', () => {
  it('keeps only items about a Surah, in Mushaf order, each item once', () => {
    const groups = groupBySurah(ENTRIES);
    expect(groups.map((g) => g.id)).toEqual([2, 36]);
    // R199 §3 — a Surah's items in their titles' order.
    const titles = groups[0]!.items.map((i) => i.title);
    expect(titles).toEqual([...titles].sort((a, b) => byTitle({ title: a }, { title: b })));
  });

  it('R199 §3 — orders by title, numbers read as numbers, whatever the upload order', () => {
    const lesson = (n: number) => ({ title: `تسجيل تفسير سورة الفاتحة — الحصة ${n}  — 2025 - 2026` });
    const shuffled = [10, 2, 1, 11, 3].map(lesson);
    expect(shuffled.sort(byTitle).map((x) => x.title.match(/الحصة (\d+)/)![1])).toEqual(['1', '2', '3', '10', '11']);
  });
});

describe('SurahLibrary', () => {
  const html = (initialSurah: number | null) =>
    renderToStaticMarkup(
      <SurahLibrary entries={ENTRIES} initialSurah={initialSurah} accessToken={null} activeChildId={null} onOpen={() => undefined} />,
    );
  it('R210 — opens on the first Surah in the Mushaf, with content or with diagrams', () => {
    const out = html(null);
    // الفاتحة has no content here, but «نظرة شاملة» draws it: it is listed, and first.
    expect(out).toContain('سورة الفاتحة');
    expect(out).toContain('البقرة');
    expect(out).toContain('يس');
    expect(out).toContain('aria-current="true"');
    expect(out).toContain('<figure class="hdiagram');
  });

  it('R212 — a Surah reads: its name, its traits, its diagrams (closed), then its shelves in the Owner\'s order', () => {
    const out = html(2);
    const order = [
      'class="surah-library__head"',
      'نوع السورة',
      ar.content.bySurah.section.diagrams,
      ar.content.bySurah.section.listen,
      ar.content.bySurah.section.slides,
      ar.content.bySurah.section.read,
      ar.content.bySurah.section.see,
    ].map((text) => out.indexOf(text));
    expect(order.every((at) => at > -1)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    expect(out).not.toContain('aria-expanded="true"');
    // Nothing that repeats a section or pushes the Surah down.
    expect(out).not.toContain('surah-library__chip');
    expect(out).not.toContain('surah-library__lede');
    expect(out).not.toContain('surah-library__sectionHint');
    expect(out).not.toContain('surah-library__more');
  });

  it('R212 — slides are what their title calls «شرائح», or a presentation file', () => {
    expect(isSlides({ title: 'شرائح حصة تفسير سورة مريم', mime_type: 'application/pdf' })).toBe(true);
    expect(isSlides({ title: 'درس', mime_type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })).toBe(true);
    expect(isSlides({ title: 'ملخص سورة مريم', mime_type: 'application/pdf' })).toBe(false);
    const merged = withDiagramSurahs(
      [{ id: 36, name: 'يس', items: [] }],
      new Map([[1, { surah: 1, name: 'الفاتحة' }], [36, { surah: 36, name: 'x' }]]),
    );
    expect(merged.map((g) => [g.id, g.name])).toEqual([[1, 'الفاتحة'], [36, 'يس']]);
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
  it('R210 — with no content about a Surah yet, the diagrammed Surahs are still offered', () => {
    const out = renderToStaticMarkup(
      <SurahLibrary entries={[entry('d', null, 'application/pdf')]} initialSurah={null} accessToken={null} activeChildId={null} onOpen={() => undefined} />,
    );
    expect(out).not.toContain(ar.content.bySurah.empty);
    expect(out).toContain('سورة الفاتحة');
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
