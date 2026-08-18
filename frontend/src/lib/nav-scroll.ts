/**
 * **The sidebar keeps its place across a navigation** (2026-08-18).
 *
 * Every portal navigation here is a full document load — there is no client
 * router, and adding one to solve a scroll position would be the wrong size of
 * answer. So the sidebar's own scroll container (`.admin-nav`, which scrolls
 * itself once it outgrows the viewport — see `admin.css`) starts every page at
 * `scrollTop: 0`, and a menu long enough to scroll then hides the very entry the
 * reader just clicked. They land on the page they asked for with the navigation
 * showing a different part of itself.
 *
 * Two facts have to hold together after a load, and they are not the same fact:
 *
 *  1. **The position is preserved** — the menu looks as it was left, so nothing
 *     appears to jump.
 *  2. **The active entry is visible** — because the answer to *where am I* must
 *     be on screen, and after a jump to a distant section the preserved position
 *     is the wrong one.
 *
 * (1) is restored first and (2) corrects it **only when it must**, by the
 * smallest movement that brings the entry inside the box. Centring the entry on
 * every load would satisfy (2) while destroying (1): the menu would lurch on
 * every single navigation, which is the complaint, not the fix.
 *
 * **The page never moves.** `scrollIntoView` was the obvious tool and is the
 * wrong one: it scrolls every scrollable ancestor, so revealing a menu entry
 * would also scroll the article beside it. Writing `scrollTop` on the container
 * moves that container and nothing else.
 */

/** The gap kept between a revealed entry and the edge it was revealed from. */
const MARGIN = 16;

/**
 * The `scrollTop` that brings `[itemTop, itemTop + itemHeight)` inside the
 * visible window, or `null` when it is already inside and nothing should move.
 *
 * Split out from the DOM so it can be tested at all: the frontend suite renders
 * with `renderToStaticMarkup` and has no layout engine, so a rule expressed only
 * as element measurements is a rule no test can reach.
 */
export function revealOffset(box: {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
  itemTop: number;
  itemHeight: number;
}): number | null {
  const { scrollTop, clientHeight, scrollHeight, itemTop, itemHeight } = box;
  // A container that does not scroll can hide nothing.
  if (scrollHeight <= clientHeight) return null;

  const max = scrollHeight - clientHeight;
  const clamp = (v: number): number => Math.max(0, Math.min(max, v));

  if (itemTop < scrollTop) return clamp(itemTop - MARGIN);
  if (itemTop + itemHeight > scrollTop + clientHeight) {
    return clamp(itemTop + itemHeight - clientHeight + MARGIN);
  }
  return null;
}

/** One key per portal, so the back office and the teacher menu do not share. */
function storageKey(): string {
  return `nav-scroll:${window.location.pathname.split('/')[1] ?? ''}`;
}

function readStored(): number {
  try {
    const raw = window.sessionStorage.getItem(storageKey());
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    // Private modes and blocked storage: preserving the position is a comfort,
    // never a requirement, so failing to read one must not break navigation.
    return 0;
  }
}

/**
 * Restores the sidebar's position, then reveals the active entry if that
 * position hides it, and keeps the position current as the reader scrolls.
 *
 * Returns the teardown, so a caller in a React effect can hand it straight back.
 */
export function keepSidebarPlace(nav: HTMLElement): () => void {
  // The restore is only meaningful while the sidebar is genuinely its own
  // scroll container — below 60rem it is not, and writing `scrollTop` there is
  // a silent no-op rather than a bug.
  nav.scrollTop = readStored();

  const active = nav.querySelector<HTMLElement>('[aria-current="page"]');
  if (active) {
    // **Rects, not `offsetTop`** — measured in Chrome 2026-08-18, where the
    // first version put the menu at `scrollTop: 70` with the active entry still
    // out of sight. `offsetTop` is measured against the nearest POSITIONED
    // ancestor, and the sidebar is `position: sticky`, so the entry's offset was
    // already relative to the nav and subtracting the nav's own offset removed a
    // distance that was never in it. Rects have no such dependency: the
    // difference between two viewport positions is the same number wherever the
    // offset parents happen to be.
    const navTop = nav.getBoundingClientRect().top;
    const item = active.getBoundingClientRect();
    const next = revealOffset({
      scrollTop: nav.scrollTop,
      clientHeight: nav.clientHeight,
      scrollHeight: nav.scrollHeight,
      itemTop: item.top - navTop + nav.scrollTop,
      itemHeight: item.height,
    });
    if (next !== null) nav.scrollTop = next;
  }

  const remember = (): void => {
    try {
      window.sessionStorage.setItem(storageKey(), String(nav.scrollTop));
    } catch {
      /* see readStored */
    }
  };
  // `scroll` rather than `pagehide`: a link click can commit the navigation
  // before an unload handler runs, and the position is cheap to write.
  nav.addEventListener('scroll', remember, { passive: true });
  return () => nav.removeEventListener('scroll', remember);
}
