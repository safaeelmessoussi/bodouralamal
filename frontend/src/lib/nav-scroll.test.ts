import { describe, expect, it } from 'vitest';

import { revealOffset } from './nav-scroll.js';

/**
 * The sidebar's two facts, asserted separately because they conflict: the
 * position is *preserved*, and the active entry is *visible*. A fix that
 * satisfies only the second — centring the entry on every load — is the lurch
 * the Owner reported, and it would pass any test that only asked *is it visible*.
 *
 * `revealOffset` is pure for exactly this reason: this suite renders with
 * `renderToStaticMarkup` and has no layout engine, so a rule expressed only as
 * element measurements would be a rule no test could reach.
 */
describe('the sidebar keeps its place', () => {
  const box = { scrollTop: 200, clientHeight: 400, scrollHeight: 1200 };

  it('does not move when the active entry is already visible', () => {
    // The preservation half. This is the common case — most navigations are
    // between neighbours — and a non-null answer here is the lurch.
    expect(revealOffset({ ...box, itemTop: 300, itemHeight: 40 })).toBeNull();
  });

  it('does not move a container that cannot scroll', () => {
    // Below 60rem the sidebar is not its own scroll container; nothing there can
    // be hidden, so nothing should be scrolled.
    expect(
      revealOffset({ scrollTop: 0, clientHeight: 800, scrollHeight: 800, itemTop: 700, itemHeight: 40 }),
    ).toBeNull();
  });

  it('scrolls up by the least that reveals an entry above the view', () => {
    // 120 is above `scrollTop: 200`; the answer puts it at the top with the
    // margin, and NOT at the centre — the smallest movement that works.
    expect(revealOffset({ ...box, itemTop: 120, itemHeight: 40 })).toBe(104);
  });

  it('scrolls down by the least that reveals an entry below the view', () => {
    // 700 + 40 is past `200 + 400`; the entry ends at the bottom edge, again by
    // the minimum: 700 + 40 - 400 + 16.
    expect(revealOffset({ ...box, itemTop: 700, itemHeight: 40 })).toBe(356);
  });

  it('never scrolls past either end', () => {
    // The margin must not push the answer out of range at the extremes, which is
    // where an off-by-one produces a visibly stuck scrollbar.
    expect(revealOffset({ ...box, itemTop: 0, itemHeight: 40 })).toBe(0);
    expect(revealOffset({ ...box, itemTop: 1160, itemHeight: 40 })).toBe(800);
  });
});
