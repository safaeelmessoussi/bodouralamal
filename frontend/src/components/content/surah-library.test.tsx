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
    // R239 — several diagrams: «خطاطة السورة» is offered closed, the recordings in view.
    expect(out).toContain(ar.content.bySurah.section.diagrams);
    expect(out).toMatch(/aria-expanded="false" aria-controls="surah-diagrams-body"/);
    expect(out).not.toContain('<figure class="hdiagram');
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
    ].map((text) => out.indexOf(text));
    expect(order.every((at) => at > -1)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    // Every tree opens closed (R212); R239 — every section is open but the diagrams, when several.
    expect(out).not.toContain('is-branch is-open');
    // R239 — no subtitle under the name, no title on a diagram card.
    expect(out).not.toContain('surah-library__subtitle');
    expect(out).not.toContain('hdiagram__title');
    // Nothing that repeats a section or pushes the Surah down.
    expect(out).not.toContain('surah-library__chip');
    expect(out).not.toContain('surah-library__lede');
    expect(out).not.toContain('surah-library__sectionHint');
    expect(out).not.toContain('surah-library__more');
  });

  it('R212/R239 — a handout is what its title calls «مطبوع» (or «شرائح»), or a presentation file', () => {
    expect(isSlides({ title: 'مطبوع تفسير سورة البقرة', mime_type: 'application/pdf' })).toBe(true);
    expect(isSlides({ title: 'شرائح حصة تفسير سورة مريم', mime_type: 'application/pdf' })).toBe(true);
    expect(isSlides({ title: 'درس', mime_type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })).toBe(true);
    expect(isSlides({ title: 'ملخص سورة مريم', mime_type: 'application/pdf' })).toBe(false);
    const merged = withDiagramSurahs(
      [{ id: 36, name: 'يس', items: [] }],
      new Map([[1, { surah: 1, name: 'الفاتحة' }], [36, { surah: 36, name: 'x' }]]),
    );
    expect(merged.map((g) => [g.id, g.name])).toEqual([[1, 'الفاتحة'], [36, 'يس']]);
  });
  it('R240 — arrives with every section closed («طيّ الكل»)', () => {
    const out = html(2);
    expect(out).toContain('aria-expanded="false" aria-controls="surah-listen-body"');
    expect(out).not.toContain('aria-expanded="true" aria-controls="surah-');
    expect(out).not.toContain('surah-player');
  });

  it('R242 — three shelves: recordings, «مطبوعات», and «ملخصات ومذكرات» holding the rest (drawings as pictures)', async () => {
    const { SurahPage } = await import('./surah-page.js');
    const out = renderToStaticMarkup(
      <SurahPage surah={2} title="البقرة" items={groupBySurah(ENTRIES).find((g) => g.id === 2)!.items} accessToken={null} activeChildId={null} onOpen={() => undefined} startOpen />,
    );
    expect(out).toContain(ar.content.bySurah.section.listen);
    expect(out).toContain(ar.content.bySurah.section.read);
    expect(out).not.toContain('surah-library__section--see');
    expect(out).not.toContain('surah-library__section--watch');
    // The drawings sit inside «ملخصات ومذكرات», shown as themselves.
    const read = out.slice(out.indexOf('surah-library__section--read'));
    expect(read).toContain('surah-library__gallery');
    expect(out).toContain('surah-player__button--play');
    // R242 — the play sign is drawn: a phone's font made «▶» an emoji.
    expect(out).toContain('class="surah-player__glyph"');
    expect(out).not.toContain('▶');
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

describe('R223 — a public lesson plays in one click', async () => {
  const { SurahPage } = await import('./surah-page.js');
  const lesson = (over: Record<string, unknown>) => ({
    id: 'a1',
    title: 'الحصة 1',
    description: null,
    kind: 'audio' as const,
    mime_type: 'audio/mpeg',
    size_bytes: 1,
    published_on: '2026-10-16',
    teacher_display_name: null,
    subject_name: null,
    whole_category: false,
    subjectName: null,
    ...over,
  });
  const render = (item: ReturnType<typeof lesson>) =>
    renderToStaticMarkup(
      <SurahPage surah={2} title="البقرة" items={[item]} accessToken={null} activeChildId={null} onOpen={() => undefined} startOpen />,
    );

  it('shows its player at once, fetching nothing until play, with no «استماع» step', () => {
    const html = render(lesson({ stream_url: '/storage/public/content/a1/x/lesson.mp3' }));
    expect(html).toContain('<audio');
    expect(html).toContain('preload="none"');
    expect(html).toContain('src="/storage/public/content/a1/x/lesson.mp3"');
    expect(html).not.toMatch(/surah-track__play[" ]/);
  });

  it('keeps «استماع» for a lesson with no stable address (a private one)', () => {
    const html = render(lesson({ stream_url: null }));
    // R239 — the same player; the URL is minted on its first play.
    expect(html).not.toContain('<audio');
    expect(html).toContain('surah-player__button--play');
  });
});

describe('R239 — the lesson player', async () => {
  const { clock } = await import('./surah-page.js');
  it('says the time as a reader reads a clock', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(754)).toBe('12:34');
    expect(clock(3754)).toBe('1:02:34');
  });
});
