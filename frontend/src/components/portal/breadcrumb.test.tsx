import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Breadcrumb } from './breadcrumb.js';

/**
 * The trail that makes Revision 69's two hierarchies visible.
 *
 * What is asserted here is the part a reader relies on and a refactor can
 * silently break: that the trail's links point at nodes §14.1 actually lists,
 * that the current screen is marked rather than linked, and that a screen which
 * is not inside anything shows nothing.
 */

describe('Breadcrumb', () => {
  it('links every ancestor and marks the last as the current page', () => {
    const html = renderToStaticMarkup(
      <Breadcrumb
        trail={[
          { label: 'المستويات', href: '/admin/levels' },
          { label: 'مواد مستوى «الثاني»', href: '/admin/level-subjects?level=L1' },
          { label: 'حلقات مادة «الفقه»' },
        ]}
      />,
    );

    expect(html).toContain('href="/admin/levels"');
    expect(html).toContain('/admin/level-subjects?level=L1');
    // The destination is named but not a link to itself — and `aria-current` is
    // what tells a screen reader which of the three it is standing on.
    expect(html).toContain('aria-current="page"');
    expect(html).not.toContain('href="/admin/teaching-groups');
  });

  it('never links the last crumb, even when the caller supplies an href', () => {
    // The trap: a page building its trail in a loop attaches an href to every
    // step. A self-link reads as navigation and goes nowhere.
    const html = renderToStaticMarkup(
      <Breadcrumb
        trail={[
          { label: 'المستويات', href: '/admin/levels' },
          { label: 'مواد مستوى «الثاني»', href: '/admin/level-subjects?level=L1' },
        ]}
      />,
    );

    expect(html).not.toContain('href="/admin/level-subjects?level=L1"');
    expect(html).toContain('href="/admin/levels"');
  });

  it('renders nothing when there is no trail to trace', () => {
    // مواد المستوى before a Level is chosen is not *inside* anything. A
    // one-item breadcrumb naming only the current screen is decoration.
    expect(renderToStaticMarkup(<Breadcrumb trail={[]} />)).toBe('');
    expect(renderToStaticMarkup(<Breadcrumb trail={[{ label: 'المستويات' }]} />)).toBe('');
  });
});
