import { useEffect, useState, type ReactNode } from 'react';

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
          <div className="app-header__bar">
            <Logo href="/" />

            <nav className="app-header__nav" aria-label={t('nav.primaryLabel')}>
              <NavigationMenu links={navigation.links} pathname={pathname} />
            </nav>

            <div className="app-header__actions app-header__actions--desktop">
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
