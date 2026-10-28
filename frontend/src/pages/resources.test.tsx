import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { kindOf } from '../adapters/content.js';
import type { ContentItem, LevelSummary } from '../adapters/content.js';
import { authorLine, ContentCard } from '../components/content/content-card.js';
import { normalizeArabic } from '../components/content/content-filters.js';
import { ContentPreviewDialog } from '../components/content/content-preview-dialog.js';
import { LevelCard } from '../components/content/level-card.js';

/**
 * The educational library's structure and its ordering rules.
 *
 * The pages fetch, so these cover what a visitor actually sees: the hierarchy's
 * order, the download-only boundary (§14.6), that a field the backend did not
 * send is absent rather than blank, and that the teacher name is rendered
 * verbatim (§20 rule 21).
 */
const item = (over: Partial<ContentItem> & Pick<ContentItem, 'id' | 'title' | 'kind'>): ContentItem => ({
  description: null,
  mime_type: 'application/pdf',
  size_bytes: 1024,
  published_on: '2026-06-12',
  teacher_display_name: null,
  subject_name: null,
  whole_category: false,
  ...over,
});

const level = (over: Partial<LevelSummary> = {}): LevelSummary => ({
  kind: 'level',
  level_id: 'l1',
  level_name: 'المستوى الأول',
  category_id: 'c1',
  category_name: 'الكبار',
  description: null,
  content_count: 3,
  academic_year_count: 2,
  ...over,
});

describe('a level card', () => {
  it('is a link, not a button — it navigates', () => {
    const html = renderToStaticMarkup(<LevelCard level={level()} />);
    expect(html).toContain('<a');
    expect(html).not.toContain('<button');
    // Both views live on one navigation node (§14.1), so the drill-down is a
    // parameter rather than an invented path segment.
    expect(html).toContain('href="/resources?level=l1"');
  });

  it('shows both counts, which are the reason the card exists', () => {
    const html = renderToStaticMarkup(<LevelCard level={level({ content_count: 3, academic_year_count: 2 })} />);
    expect(html).toContain('3');
    expect(html).toContain('2');
  });

  it('agrees in number rather than rendering "1 مواد"', () => {
    const one = renderToStaticMarkup(<LevelCard level={level({ content_count: 1, academic_year_count: 1 })} />);
    expect(one).toContain('مادة');
    expect(one).toContain('سنة دراسية');

    const two = renderToStaticMarkup(<LevelCard level={level({ content_count: 2, academic_year_count: 2 })} />);
    expect(two).toContain('مادتان');

    const many = renderToStaticMarkup(<LevelCard level={level({ content_count: 6, academic_year_count: 3 })} />);
    expect(many).toContain('مواد');
  });

  it('omits the description when there is none', () => {
    const html = renderToStaticMarkup(<LevelCard level={level({ description: null })} />);
    expect(html).not.toContain('level-card__description');
  });
});

describe('R167 §5 — «كل مستويات الفئة»', () => {
  it('is the CATEGORY’s shelf: addressed by the Category, named by the page, never by the Level it is filed under', () => {
    const html = renderToStaticMarkup(
      <LevelCard
        level={level({ kind: 'whole_category', level_id: 'c1', level_name: '', category_name: 'المرأة' })}
      />,
    );
    expect(html).toContain('href="/resources?category=c1"');
    expect(html).not.toContain('?level=');
    expect(html).toContain('كل مستويات الفئة');
    expect(html).toContain('جميع مستويات المرأة');
  });

  it('an item made for every Level says so wherever it is listed', () => {
    const open = (): void => {};
    const marked = renderToStaticMarkup(
      <ContentCard item={item({ id: 'a', title: 'تسجيل', kind: 'audio', whole_category: true })} onOpen={open} />,
    );
    const plain = renderToStaticMarkup(
      <ContentCard item={item({ id: 'b', title: 'ملف', kind: 'pdf' })} onOpen={open} />,
    );
    expect(marked).toContain('لكل مستويات الفئة');
    expect(plain).not.toContain('لكل مستويات الفئة');
  });
});

describe('a content card', () => {
  it('states the type in WORDS as well as by icon', () => {
    // Colour and shape must never carry meaning alone.
    const html = renderToStaticMarkup(
      <ContentCard item={item({ id: 'x', title: 'ت', kind: 'video' })} onOpen={() => undefined} />,
    );
    expect(html).toContain('فيديو');
    expect(html).toContain('content-card--video');
  });

  it('renders the teacher display name VERBATIM (§20 rule 21)', () => {
    // The type carries no other name field, so there is nothing to choose
    // between — the backend already decided which name is public.
    const html = renderToStaticMarkup(
      <ContentCard
        item={item({ id: 'x', title: 'ت', kind: 'pdf', teacher_display_name: 'أم عبد الله' })}
        onOpen={() => undefined}
      />,
    );
    expect(html).toContain('أم عبد الله');
  });

  it('omits absent fields rather than rendering them empty', () => {
    const html = renderToStaticMarkup(
      <ContentCard
        item={item({ id: 'x', title: 'ت', kind: 'pdf', size_bytes: null, teacher_display_name: null })}
        onOpen={() => undefined}
      />,
    );
    expect(html).not.toContain('content-card__teacher');
    expect(html).not.toContain('content-card__description');
  });

  it('formats size in Arabic units, so no direction override is needed', () => {
    const html = renderToStaticMarkup(
      <ContentCard item={item({ id: 'x', title: 'ت', kind: 'pdf', size_bytes: 2_600_000 })} onOpen={() => undefined} />,
    );
    expect(html).toContain('ميغابايت');
    expect(html).not.toContain('dir="ltr"');
  });

  it('formats the date with the same month names the calendar uses', () => {
    const html = renderToStaticMarkup(
      <ContentCard item={item({ id: 'x', title: 'ت', kind: 'pdf', published_on: '2026-06-12' })} onOpen={() => undefined} />,
    );
    expect(html).toContain('يونيو');
    // Case-insensitive: React emits the JSX prop name verbatim on `<time>`, and
    // HTML attribute names are ASCII case-insensitive, so `dateTime` parses as
    // `datetime`. Asserting the exact casing would pin a React rendering detail
    // rather than the machine-readable date this test is about.
    expect(html.toLowerCase()).toContain('datetime="2026-06-12"');
  });
});

describe('library search', () => {
  it('folds Arabic variants, as TD-10 normalisation does', () => {
    // `احكام` must find `أَحْكام` — diacritics stripped and alef folded.
    expect(normalizeArabic('أَحْكام التجويد')).toContain(normalizeArabic('احكام'));
  });
});

describe('the preview dialog (§14.6)', () => {
  it('renders nothing until an item is chosen', () => {
    const html = renderToStaticMarkup(<ContentPreviewDialog item={null} onClose={() => undefined} />);
    // The native dialog must be in the DOM to be openable, but carries no item.
    expect(html).not.toContain('preview__stage');
  });

  it('says an office document is download-only rather than showing an empty frame', () => {
    const html = renderToStaticMarkup(
      <ContentPreviewDialog
        item={item({ id: 'd', title: 'ورقة', kind: 'document' })}
        onClose={() => undefined}
      />,
    );
    expect(html).toContain('يُنزَّل ولا يُعرض');
  });

  it('never renders a media element for a download-only kind', () => {
    const html = renderToStaticMarkup(
      <ContentPreviewDialog item={item({ id: 'd', title: 'ورقة', kind: 'document' })} onClose={() => undefined} />,
    );
    expect(html).not.toContain('<video');
    expect(html).not.toContain('<audio');
    expect(html).not.toContain('<iframe');
  });
});

describe('§14.6 presentation class is derived from the MIME type', () => {
  it('maps each class the interface behaves differently for', () => {
    // §14.6 defines behaviour per class — PDFs inline, audio and video in
    // place, images in a lightbox — so the mapping has to exist somewhere. It
    // lives on the client because presentation is the client's job (§1.1 gives
    // the server authority over decisions, not over rendering).
    expect(kindOf('application/pdf')).toBe('pdf');
    expect(kindOf('audio/mpeg')).toBe('audio');
    expect(kindOf('video/mp4')).toBe('video');
    expect(kindOf('image/jpeg')).toBe('image');
  });

  it('falls back to the DOWNLOAD-ONLY class for anything unrecognised', () => {
    // The safe end of the range: a new accepted MIME type renders as a download
    // rather than as a broken inline player. Office files are download-only in
    // the MVP anyway (§14.6).
    expect(kindOf('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(
      'document',
    );
    expect(kindOf('application/octet-stream')).toBe('document');
  });
});

/**
 * R177 §7 (Owner, 2026-09-29) — the library groups and filters by Surah where
 * an item names one. Source-pinned like the page's other wiring: the grouping
 * runs over fetched entries a static render cannot supply.
 */
describe('the library groups and filters by Surah (R177 §7)', () => {
  it('offers a «السورة» filter, in Mushaf order, and groups a Subject’s items under their Surah', async () => {
    const source = (await import('./resources.tsx?raw')).default.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(source).toContain("select('surahId', t('content.upload.surah'), options.surahs)");
    expect(source).toContain('surahs: [...surahs].sort((a, b) => Number(a[0]) - Number(b[0]))');
    expect(source).toContain("(!on('surahId') || String(e.surah_id ?? '') === filter.surahId)");
    expect(source).toContain("t('content.surahGroupLabel')");
    // An item about no Surah stays under the Subject itself, never invented into a group.
    expect(source).toContain('if (e.surah_id === null) subject.items.push(e.item);');
  });
});

describe('R235 — a teaching author by the honorific, never «· تأطير»', () => {
  it('uses the server’s title for a مؤطِّرة, and name · role for anyone else', () => {
    expect(
      authorLine({ teacher_display_name: 'فاطمة بوخبزى', author_role: 'teacher', author_title: 'الأستاذة فاطمة بوخبزى' }),
    ).toBe('الأستاذة فاطمة بوخبزى');
    expect(authorLine({ teacher_display_name: 'سعاد', author_role: 'admin', author_title: null })).toContain('سعاد · ');
  });
});
