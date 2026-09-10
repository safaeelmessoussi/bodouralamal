import { useEffect, useRef, useState, type ReactNode } from 'react';

import { keepSidebarPlace } from '../../lib/nav-scroll.js';
import { t } from '../../i18n/index.js';
import { ApplicationHeader } from '../header/application-header.js';
import { Button } from '../ui/button.js';
import { IconButton } from '../ui/icon-button.js';
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
 *
 * **R138 correction #2 (Owner, 2026-09-10) — the toggle lives IN the page
 * header now, not floating over it.** The previous fix (af8dcb9) made the
 * toggle icon-only and `position: fixed` in the bottom corner, to stop it
 * overlapping the drawer it opens. Geometrically that worked — but the
 * Owner's own next screenshot named what it broke: a control disconnected
 * from the layout it operates is easy to overlook, and an icon-only button
 * beside `ApplicationHeader`'s OWN icon-only burger read as **two identical
 * hamburgers**, one for the site and one that just happens to also be on
 * screen, with nothing distinguishing them but position.
 *
 * The correction addresses both at once, structurally rather than by
 * further tuning a floating element's coordinates:
 *
 * 1. **It renders inside `.admin__head`'s own `.admin__actions`** — the SAME
 *    flex row a page's own action button already uses (`admin.css`'s "The
 *    page header"). Two flex siblings cannot overlap by construction, which
 *    is what "structurally reserved space" means here: no coordinate was
 *    chosen to avoid the action button, the layout that already keeps
 *    actions apart does that on its own.
 * 2. **It carries a `sidebar` icon (a panel glyph) plus its OWN visible
 *    Arabic label**, never `menu`/`close` — the exact icons
 *    `ApplicationHeader`'s burger uses — so the two controls cannot be
 *    mistaken for each other even at a glance, and a reader does not have to
 *    infer its purpose from position alone. The label itself names the
 *    portal's OWN section noun (`navLabel`, threaded in below) rather than a
 *    generic "menu," and states show/hide explicitly on desktop, where the
 *    resting default already shows the sidebar with nothing pressed.
 * 3. **The opened drawer gained its own header with a close button** — so
 *    closing it no longer depends on finding the (now in-flow, potentially
 *    scrolled-past or covered) trigger again; Escape, the backdrop and any
 *    nav link still work exactly as before, this is a fourth, always-visible
 *    way to do the same thing from inside the panel itself.
 */
export function PortalShell({
  title,
  lede,
  breadcrumb,
  actions,
  sidebar,
  navLabel,
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
  /**
   * **The portal's own name for its sidebar** — the SAME text each layout
   * already gives the `<nav>` landmark's own `aria-label` (`admin.nav.label`
   * أقسام الإدارة, `teacher.nav.label` أقسام التدريس, `student.nav.label`
   * أقسامي). The toggle and the opened drawer's own header both read it, so
   * "show/hide X" always names the portal it is actually in rather than a
   * fourth invented word for the same three menus.
   */
  navLabel: string;
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

  // **The label states the exact phrasing the Owner specified.** Mobile gets
  // one neutral name regardless of state — the drawer's own header (below)
  // is what a reader actually looks at once it is open, and it starts
  // collapsed there in any case (see the class doc comment). Desktop's
  // resting default already shows the sidebar, so its label states an
  // explicit verb — "show" only once something has been collapsed, "hide"
  // otherwise — because pressing it with nothing yet pressed is the one
  // desktop case that must read as "hide," not "toggle."
  const toggleLabel = !isWide
    ? navLabel
    : navVisible
      ? t('nav.hideSections').replace('{label}', navLabel)
      : t('nav.showSections').replace('{label}', navLabel);

  return (
    <>
      <ApplicationHeader />
      <div
        className={override === null ? 'admin' : `admin admin--nav-${override}`}
        ref={frame}
      >
        {/* The overlay's backdrop — CSS shows it only while `.admin-nav-panel`
            exists below; a tap on it is the same "close" Escape and the
            panel's own close button already offer. */}
        {override === 'overlay' ? (
          <button
            type="button"
            className="admin-nav-backdrop"
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => setOverride('collapsed')}
          />
        ) : null}
        {override === 'overlay' ? (
          // **The opened drawer is now a PANEL with its own header** — see the
          // class doc comment's correction #2. `sidebar` still renders exactly
          // the `<nav id="admin-sidebar">` each layout already builds; this
          // wraps it with a title (the same `navLabel` the toggle uses, so the
          // drawer names itself in the reader's own words) and a close button
          // that does not depend on the trigger being reachable again.
          <div className="admin-nav-panel">
            <div className="admin-nav-panel__head">
              <span className="admin-nav-panel__title">{navLabel}</span>
              {/* The SAME `IconButton` `Dialog`'s own close button renders
                  through — one compact icon-only control, not a second one
                  drawn for this second panel (constitution §2.4/§2.6). */}
              <IconButton
                icon="close"
                label={t('nav.closeMenu')}
                onClick={() => setOverride('collapsed')}
              />
            </div>
            {sidebar}
          </div>
        ) : (
          sidebar
        )}
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
            {/* **Always rendered now** (R138 correction #2) — the sidebar
                toggle lives here unconditionally, and a page's own actions
                join it in the SAME flex row when it has any. This is the
                "structurally reserved space" the correction asked for: two
                flex siblings cannot overlap each other by construction, so
                nothing here chooses coordinates to avoid the other. */}
            <div className="admin__actions">
              <Button
                variant="secondary"
                icon="sidebar"
                className="admin-nav-toggle"
                aria-expanded={navVisible}
                aria-controls="admin-sidebar"
                onClick={toggleNav}
              >
                {toggleLabel}
              </Button>
              {permitted && actions ? actions : null}
            </div>
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
