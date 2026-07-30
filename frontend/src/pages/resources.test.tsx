import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { ContentItem, LevelContent, LevelSummary } from '../adapters/content.js';
import { ContentCard } from '../components/content/content-card.js';
import {
  applyFilters,
  EMPTY_FILTERS,
  GLOBAL,
  hasActiveFilters,
} from '../components/content/content-filters.js';
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
  ...over,
});

const level = (over: Partial<LevelSummary> = {}): LevelSummary => ({
  level_id: 'l1',
  level_name: 'المستوى الأول',
  category_id: 'c1',
  category_name: 'الكبار',
  description: null,
  content_count: 3,
  academic_year_count: 2,
  ...over,
});

const content: LevelContent = {
  level_id: 'l1',
  level_name: 'المستوى الأول',
  category_name: 'الكبار',
  description: null,
  years: [
    {
      academic_year_id: 'y26',
      label: '2026-2027',
      is_current: true,
      branches: [
        { branch_id: null, branch_name: null, items: [item({ id: 'g1', title: 'دليل عام', kind: 'pdf' })] },
        {
          branch_id: 'b1',
          branch_name: 'مقر أمرشيش',
          items: [
            item({ id: 'a1', title: 'تسجيل الحلقة', kind: 'audio' }),
            item({ id: 'a2', title: 'أَحْكام التجويد', kind: 'video' }),
          ],
        },
      ],
    },
    {
      academic_year_id: 'y25',
      label: '2025-2026',
      is_current: false,
      branches: [
        { branch_id: 'b2', branch_name: 'مقر تاركة', items: [item({ id: 'o1', title: 'مذكّرة', kind: 'pdf' })] },
      ],
    },
  ],
};

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

describe('filtering one level', () => {
  it('does nothing when no filter is set', () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(applyFilters(content, EMPTY_FILTERS).years).toHaveLength(2);
  });

  it('narrows by year, dropping the years that no longer match', () => {
    const out = applyFilters(content, { ...EMPTY_FILTERS, yearId: 'y26' });
    expect(out.years.map((y) => y.label)).toEqual(['2026-2027']);
  });

  it('treats the Global scope as a real branch choice', () => {
    const out = applyFilters(content, { ...EMPTY_FILTERS, branchId: GLOBAL });
    expect(out.years).toHaveLength(1);
    expect(out.years[0]!.branches[0]!.branch_id).toBeNull();
  });

  it('narrows by type', () => {
    const out = applyFilters(content, { ...EMPTY_FILTERS, kind: 'audio' });
    const titles = out.years.flatMap((y) => y.branches.flatMap((b) => b.items.map((i) => i.title)));
    expect(titles).toEqual(['تسجيل الحلقة']);
  });

  it('DROPS groups a filter emptied rather than rendering a bare heading', () => {
    // A year heading above no content states that the year exists and is empty,
    // which is not what a filter means.
    const out = applyFilters(content, { ...EMPTY_FILTERS, kind: 'audio' });
    expect(out.years).toHaveLength(1);
    expect(out.years[0]!.branches).toHaveLength(1);
  });

  it('folds Arabic variants in search, as TD-10 normalisation does', () => {
    // `احكام` must find `أَحْكام` — diacritics stripped and alef folded.
    const out = applyFilters(content, { ...EMPTY_FILTERS, query: 'احكام' });
    const titles = out.years.flatMap((y) => y.branches.flatMap((b) => b.items.map((i) => i.title)));
    expect(titles).toEqual(['أَحْكام التجويد']);
  });

  it('returns nothing when a search matches nothing, so the page can say so', () => {
    const out = applyFilters(content, { ...EMPTY_FILTERS, query: 'لا-يوجد-شيء' });
    expect(out.years).toHaveLength(0);
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
