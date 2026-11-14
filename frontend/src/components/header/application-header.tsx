import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

import { useSession } from '../../contexts/session.js';
import { useNavigation } from '../../hooks/use-navigation.js';
import { t } from '../../i18n/index.js';
import { api } from '../../lib/api.js';
import { Container } from '../ui/container.js';
import { Icon } from '../ui/icon.js';
import { Logo } from '../ui/logo.js';
import { DashboardButton, SignInButton } from './auth-buttons.js';
import { MobileMenu } from './mobile-menu.js';
import { NavigationMenu } from './navigation-menu.js';
import { useActiveRole } from '../../contexts/active-role.js';
import { InstallAppButton } from '../install/install-app-button.js';
import { LanguageMenu } from './language-menu.js';
import { NotificationBell } from '../notifications/notification-bell.js';
import { RoleSwitcher } from './role-switcher.js';
import { UserMenu } from './user-menu.js';

/**
 * The application header — **the** header, used by every page from here on.
 *
 * It composes the parts and owns nothing else: what the menu contains comes
 * from `useNavigation`, who the caller is comes from the session, and the
 * switchers own their own state. That is what lets a future page mount it
 * without passing anything.
 *
 * Anonymous callers see the public links and Sign in. Authenticated callers see
 * Dashboard and Sign out instead, plus a role switcher when they hold more than
 * one role (§2.1) and a child switcher when they have approved links (§4.3).
 */
export function ApplicationHeader(): ReactNode {
  const { accessToken, setAccessToken } = useSession();
  const navigation = useNavigation();
  const [open, setOpen] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  const fit = useBarFit(bar);
  const pathname = typeof window === 'undefined' ? '/' : window.location.pathname;

  // A sheet left open across a resize would sit behind the desktop bar with no
  // way to close it, so it closes when the layout changes under it.
  useEffect(() => {
    if (!open) return;
    const wide = window.matchMedia('(min-width: 60rem)');
    const close = (): void => setOpen(false);
    wide.addEventListener('change', close);
    return () => wide.removeEventListener('change', close);
  }, [open]);
  // …and when the bar regains room for everything (R268).
  useEffect(() => {
    if (fit !== 'crowded') setOpen(false);
  }, [fit]);

  async function signOut(): Promise<void> {
    // TD-4.14: the server revokes this session's refresh token. Clearing the
    // in-memory access token alone would leave a live 30-day credential behind.
    try {
      await api('/auth/logout', { method: 'POST', refreshCookieAuth: true });
    } finally {
      setAccessToken(null);
      window.location.assign('/');
    }
  }

  // **`لوحة التحكم` opens the home of the role being worked as** (R60). It read
  // `me.roles` and resolved most-privileged-first, so a Super Admin acting as
  // مؤطِّرة was sent to `/admin` — a portal her active role does not own, which
  // is why she met the wrong-role screen instead of her own dashboard.
  const { activeRoles: roles } = useActiveRole();

  return (
    <>
      <a className="skip-link" href="#main">
        {t('nav.skipToContent')}
      </a>

      <header className="app-header">
        <Container>
          <div ref={bar} className={`app-header__bar${fit === 'full' ? '' : ` is-${fit}`}`}>
            <Logo href="/" />

            <nav className="app-header__nav" aria-label={t('nav.primaryLabel')}>
              <NavigationMenu links={navigation.links} pathname={pathname} />
            </nav>

            <div className="app-header__actions app-header__actions--desktop">
              {/* R209 — the language, on the public pages only. */}
              <LanguageMenu />
              {/* R167 §4 — for everybody, signed in or not; renders nothing
                  where the device has nothing to offer or it is installed. */}
              <InstallAppButton />
              {navigation.isAuthenticated ? (
                <>
                  {/* R62.9 — ONE switcher. The child list is a group inside
                      it, because selecting a child sets the role and the child
                      in a single action; two menus made that two. `hasLinkedChildren`
                      no longer gates anything here: a parent with no approved
                      children still needs the group's «＋ تسجيل طفل» action. */}
                  {/* **The bell, on every authenticated screen** (§4.8). The
                      list was mounted on ONE page, so a مؤطرة marking grades
                      had no way to learn a class had moved without navigating
                      home first — a notice nobody encounters is one that was
                      not delivered. */}
                  <NotificationBell token={accessToken} />
                  <RoleSwitcher />
                  <DashboardButton roles={roles} />
                  <UserMenu onSignOut={signOut} />
                </>
              ) : (
                <SignInButton />
              )}
            </div>

            {/* The bell rides beside the burger on a phone (the Owner,
                2026-09-25): a notice she cannot see on the device she uses
                is one that was not delivered. One component, two slots. */}
            <div className="app-header__actions app-header__actions--mobile">
              {/* R209 — beside the burger on a phone for a visitor; a
                  signed-in reader's bar holds the bell, and the sheet
                  offers the language (as it does below 360 px). */}
              {navigation.isAuthenticated ? null : <LanguageMenu compact />}
              {navigation.isAuthenticated ? <NotificationBell token={accessToken} /> : null}
            </div>
            <button
              type="button"
              className="app-header__burger"
              aria-expanded={open}
              aria-controls="mobile-menu"
              onClick={() => setOpen((was) => !was)}
            >
              <span className="visually-hidden">
                {open ? t('nav.closeMenu') : t('nav.openMenu')}
              </span>
              <Icon name={open ? 'close' : 'menu'} size={22} />
            </button>
          </div>
        </Container>

        {open ? (
          <MobileMenu
            navigation={navigation}
            pathname={pathname}
            roles={roles}
            onSignOut={signOut}
            onNavigate={() => setOpen(false)}
          />
        ) : null}
      </header>
    </>
  );
}

/**
 * **R268 — the bar keeps its parts on the screen**, at any width (the Owner,
 * 2026-11-13: a Super Admin's bar at 1366 px pushed «الحساب» off the screen and
 * the page scrolled sideways).
 *
 * The 60rem breakpoint is a floor, not a guarantee: what the bar holds depends
 * on the role and the page (a role switcher, «تثبيت التطبيق», the bell, the
 * language on a public page). So the bar measures its own parts — their laid-out
 * widths summed, never its `scrollWidth`, which an open popover inflates — and
 * takes the first that fits: `full`; `compact` («تثبيت التطبيق» as its icon);
 * `crowded` (the burger). A folded part cannot be measured, so the width each
 * stage needed is remembered and the bar unfolds once it has that much room.
 */
export type BarFit = 'full' | 'compact' | 'crowded';

function useBarFit(ref: RefObject<HTMLDivElement | null>): BarFit {
  const [fit, setFit] = useState<BarFit>('full');
  const needs = useRef({ full: 0, compact: 0 });

  useLayoutEffect(() => {
    const bar = ref.current;
    if (!bar || typeof ResizeObserver === 'undefined') return;

    const partsWidth = (): number | null => {
      const nav = bar.querySelector<HTMLElement>('.app-header__nav');
      const actions = bar.querySelector<HTMLElement>('.app-header__actions--desktop');
      // Folded (or below 60rem, where the stylesheet shows the burger).
      if (!nav || !actions || getComputedStyle(nav).display === 'none') return null;
      const gap = parseFloat(getComputedStyle(bar).columnGap) || 0;
      let total = 0;
      let shown = 0;
      for (const child of Array.from(bar.children) as HTMLElement[]) {
        const style = getComputedStyle(child);
        if (style.display === 'none') continue;
        // The actions' `margin-inline-start: auto` is free space, not need.
        const margins =
          child === actions
            ? 0
            : (parseFloat(style.marginInlineStart) || 0) + (parseFloat(style.marginInlineEnd) || 0);
        // The navigation may be squeezed narrower than its links: count the links.
        const width = Math.max(child.getBoundingClientRect().width, child === nav ? nav.scrollWidth : 0);
        total += width + margins;
        shown += 1;
      }
      return Math.ceil(total + gap * Math.max(0, shown - 1));
    };

    const measure = (): void => {
      const room = bar.clientWidth + 1;
      const stage: BarFit = bar.classList.contains('is-crowded')
        ? 'crowded'
        : bar.classList.contains('is-compact')
          ? 'compact'
          : 'full';
      const total = partsWidth();
      if (stage === 'full' && total !== null) {
        needs.current.full = total;
        if (total <= room) return;
        const label = bar.querySelector<HTMLElement>('.app-header__actions--desktop .install-app__label');
        const saving = label ? label.getBoundingClientRect().width : 0;
        needs.current.compact = saving > 0 ? total - saving : Number.POSITIVE_INFINITY;
        setFit(needs.current.compact <= room ? 'compact' : 'crowded');
        return;
      }
      if (stage === 'compact' && total !== null) {
        needs.current.compact = total;
        if (room >= needs.current.full) setFit('full');
        else if (total > room) setFit('crowded');
        return;
      }
      if (stage === 'crowded') {
        if (needs.current.full > 0 && room >= needs.current.full) setFit('full');
        else if (room >= needs.current.compact) setFit('compact');
      }
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    for (const child of Array.from(bar.children)) observer.observe(child);
    // The links themselves (web fonts arriving widen them inside a squeezed nav).
    const links = bar.querySelector('.app-header__nav')?.firstElementChild;
    if (links) observer.observe(links);
    return () => observer.disconnect();
  }, [ref]);

  return fit;
}
