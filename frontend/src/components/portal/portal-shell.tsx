import { useEffect, useRef, useState, type ReactNode } from 'react';

import { keepSidebarPlace } from '../../lib/nav-scroll.js';
import { t } from '../../i18n/index.js';
import { ApplicationHeader } from '../header/application-header.js';
import { Icon } from '../ui/icon.js';
import { Breadcrumb, type Crumb } from './breadcrumb.js';
import { NoPermissionState } from '../states.js';

/** `60rem` — the SAME breakpoint `ApplicationHeader`'s own burger uses (§14's
 *  "one coherent responsive navigation system" rather than a second number
 *  that drifts from it). */
const WIDE_QUERY = '(min-width: 60rem)';

/**
 * The frame every portal shares: header, sidebar, titled main region.
 *
 * **Role gating happens here, once**, for whichever portal renders it. A module
 * a session's roles do not admit renders the §14.4 no-permission state instead
 * of its content — never a blank page and never a crash. This is a **UX layer**:
 * the server enforces the TD-2 matrix on every endpoint regardless, and the URL
 * prefix is not the permission boundary.
 *
 * The sidebar is passed in rather than derived, because that is the one part
 * that genuinely differs: the back office groups its entries into §14.1's five
 * sections, and the teacher portal is a flat list.
 *
 * **Its scroll position survives a navigation** from here rather than from each
 * portal: both have the same long menu and the same full-page loads, and a
 * behaviour each portal had to opt into is a behaviour that would be missing
 * from the next one (rule AE). See `lib/nav-scroll.ts`.
 *
 * **R138 item 8 — the sidebar collapses on mobile, without a second nav
 * system.** Below `WIDE_QUERY` a reader had to scroll past however long
 * الإدارة's menu is before reaching the page she came for; a fixed-length menu
 * ahead of variable-length content is the complaint whatever the exact count.
 *
 * The default is **pure CSS** (`admin.css`), on purpose: a JS-computed
 * default would be wrong for one frame on first paint — there is no way to
 * know the viewport before mount — and every navigation here is a full
 * document load (see `nav-scroll.ts`), so that wrong frame would repeat on
 * EVERY click, not show once. `override` therefore starts at `null`, meaning
 * *follow the media query*, and only ever holds an explicit answer once the
 * toggle button has been pressed. `isWide` is tracked separately and drives
 * nothing visual — it exists only so the button's own `aria-expanded` and its
 * next click read the right state before that first press.
 *
 * **R138 item 8 correction (Owner, desktop screenshot) — "opening" is ALWAYS
 * an overlay, never a layout column.** The first cut let a desktop toggle
 * restore the sidebar as the ordinary `16rem` GRID COLUMN it already is by
 * default — which reads as *correct* only until the reader notices that
 * "opening" a column that already had a resting width means the grid itself
 * changed shape under her, exactly the "pushes the page sideways" complaint.
 * `override` therefore has exactly two explicit states, `'collapsed'` and
 * `'overlay'`, and **neither ever touches `grid-template-columns` toward
 * showing content** — collapsing reclaims the column (`1fr`, checked against
 * the resting default so a genuine "more room" request stays that), and
 * `'overlay'` NEVER restores the column: it renders `.admin-nav` as a
 * `position: fixed` panel stacked on top of the page, at both widths, with
 * only its bounded inline-size differing per breakpoint (`admin.css`). The
 * resting, unclicked default is untouched — desktop still shows the column
 * with nothing pressed, exactly as the Owner asked to keep — so the only
 * behaviour this correction changes is what happens once a reader has
 * actually pressed the button.
 *
 * **One toggle, one rule, both widths**: if the sidebar is visible in ANY
 * form right now (the resting default, or a previously opened overlay),
 * pressing it hides that form; if it is not visible, pressing it opens the
 * OVERLAY — never the column. Mobile's own resting default is already
 * "hidden," so this reduces to exactly its previous, Owner-confirmed-good
 * behaviour there (Escape and a tap on the backdrop close it, and the
 * destination is on screen the instant a link is followed, per the full-page
 * navigation above); only desktop's second click — the one that used to
 * restore the column — changes.
 */
export function PortalShell({
  title,
  lede,
  breadcrumb,
  actions,
  sidebar,
  permitted,
  children,
}: {
  title: string;
  lede?: string | null;
  /** The trail from the portal's hierarchy to this screen (R69 — see `Breadcrumb`). */
  breadcrumb?: readonly Crumb[];
  /** Page-level controls — a "create" button belongs here, beside the heading. */
  actions?: ReactNode;
  sidebar: ReactNode;
  /** Whether this session may open the current module (TD-2, UX layer). */
  permitted: boolean;
  children: ReactNode;
}): ReactNode {
  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // The sidebar arrives as a node, so it is found in the DOM rather than held
    // by a ref each portal would have to remember to attach.
    const nav = frame.current?.querySelector<HTMLElement>('nav');
    return nav ? keepSidebarPlace(nav) : undefined;
  }, []);

  // R138 item 8 — see the class doc comment for why this starts at `null`
  // rather than a guessed viewport, and why `isWide` drives no CSS.
  const [override, setOverride] = useState<'overlay' | 'collapsed' | null>(null);
  const [isWide, setIsWide] = useState(true);
  // Visible in ANY form right now: the resting default (desktop only) or an
  // explicitly opened overlay. Never true for `'collapsed'`, and the overlay
  // is never "the column" — see the class doc comment.
  const navVisible = override === 'overlay' ? true : override === 'collapsed' ? false : isWide;

  useEffect(() => {
    const mq = window.matchMedia(WIDE_QUERY);
    setIsWide(mq.matches);
    const onChange = (e: MediaQueryListEvent): void => setIsWide(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    // Escape closes the overlay, at either width — there is nothing else
    // `'collapsed'` needs Escape to do, since it has no overlay to dismiss.
    if (override !== 'overlay') return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOverride('collapsed');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [override]);

  function toggleNav(): void {
    setOverride(navVisible ? 'collapsed' : 'overlay');
  }

  return (
    <>
      <ApplicationHeader />
      <div
        className={override === null ? 'admin' : `admin admin--nav-${override}`}
        ref={frame}
      >
        <button
          type="button"
          className="admin-nav-toggle"
          aria-expanded={navVisible}
          aria-controls="admin-sidebar"
          onClick={toggleNav}
        >
          <span className="visually-hidden">
            {navVisible ? t('nav.closeMenu') : t('nav.openMenu')}
          </span>
          <Icon name={navVisible ? 'close' : 'menu'} size={18} />
          <span aria-hidden="true">{t('admin.nav.toggle')}</span>
        </button>
        {/* The overlay's backdrop — CSS shows it only while `.admin-nav` is
            the fixed panel (`.admin--nav-overlay`, both widths); a tap on it
            is the same "close" Escape already offers. */}
        {override === 'overlay' ? (
          <button
            type="button"
            className="admin-nav-backdrop"
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => setOverride('collapsed')}
          />
        ) : null}
        {sidebar}
        <main id="main" className="admin__main">
          <div className="admin__head">
            {/* **The heading block is a named element now** (2026-08-17), because
                the header's layout depends on it: it grows to take the width the
                action block does not need, so a one-line description stops
                wrapping its last word with empty space beside it. An anonymous
                `<div>` could not be targeted, which is why every page appeared to
                need its own width. See `admin.css` under *The page header*. */}
            <div className="admin__heading">
              {/* Above the heading, and only for a session that may open the
                  module: a trail names a Level, which is not something the
                  no-permission state should disclose. */}
              {permitted && breadcrumb ? <Breadcrumb trail={breadcrumb} /> : null}
              <h1 className="admin__title">{title}</h1>
              {lede ? <p className="lede">{lede}</p> : null}
            </div>
            {permitted && actions ? <div className="admin__actions">{actions}</div> : null}
          </div>

          {/* An `Active` account holding no role at all is reachable only through
              staff error, and §14.4 says it renders this rather than a dashboard
              — no endpoint would authorise one anyway. */}
          {permitted ? children : <NoPermissionState />}
        </main>
      </div>
    </>
  );
}
