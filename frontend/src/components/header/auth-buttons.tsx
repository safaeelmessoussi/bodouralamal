import type { ReactNode } from 'react';

import { useSession } from '../../contexts/session.js';
import { t } from '../../i18n/index.js';
import { roleHomePath } from '../../lib/role-home.js';
import { Button, ButtonLink } from '../ui/button.js';

/**
 * The three authentication affordances, one component each so a screen can
 * place them independently and none of them carries layout assumptions.
 */

/**
 * Sign in. A full page load, not client navigation: §4.1b step 1 is a server
 * redirect to Google, so an SPA route change would never leave the origin.
 */
export function SignInButton({ block = false }: { block?: boolean }): ReactNode {
  /**
   * **R175 §2 — a deployment may not OFFER the way in, while the way in stays
   * open.** The temporary Production tier publishes a public calendar and a
   * public library while registration is not yet announced (the Owner,
   * 2026-09-26), so this shared control renders nowhere: the header, the
   * mobile menu and the landing hero all go through it.
   *
   * Nothing else changes. `/login` keeps its own control (the Owner's choice,
   * and it is where an OAuth failure lands with its retry), `/register` and
   * `POST /registrations` are untouched, and the Owner signs in through
   * `/api/v1/auth/google` directly.
   *
   * `null` is «not answered yet» and renders nothing, so the control cannot
   * flash into view on a deployment that does not offer it.
   */
  const { signInOffered } = useSession();
  if (signInOffered !== true) return null;
  return (
    <ButtonLink href="/api/v1/auth/google" variant="primary" block={block}>
      {t('nav.login')}
    </ButtonLink>
  );
}

/**
 * Shown only to an authenticated caller — see `useNavigation`.
 *
 * **The link resolves the caller's role home** (§14.1, §4.1b step 4a). It used
 * to be a literal `/dashboard`, which the sitemap does not define and the
 * router did not serve, so pressing it produced a **blank white page** for
 * every signed-in user.
 *
 * A caller with no role that has a home renders **nothing at all** rather than
 * a disabled control or a link to nowhere: §14.4 Revision 16 says that account
 * belongs on the no-permission state, and offering a button that cannot work
 * teaches the reader less than not offering it.
 */
export function DashboardButton({
  roles,
  block = false,
  /** `secondary` beside the header's own `UserMenu`, where it is one of
   *  several actions; `primary` where it stands alone as the page's main
   *  call to action — the public landing page's hero replacing «تسجيل
   *  الدخول» for a caller who is already signed in (rule C: a documented
   *  variant, never a second dashboard button). */
  variant = 'secondary',
}: {
  roles: readonly string[];
  block?: boolean;
  variant?: 'primary' | 'secondary';
}): ReactNode {
  const href = roleHomePath(roles);
  if (!href) return null;
  return (
    <ButtonLink href={href} variant={variant} block={block}>
      {t('nav.dashboard')}
    </ButtonLink>
  );
}

/**
 * My account — `/profile` (R65), the same destination the desktop `UserMenu`
 * offers inside its popover. The mobile sheet has no popover to nest one in
 * (§4.1b: a hamburger sheet lists every actual destination flat rather than
 * hiding one behind a second control), so this is its own block link rather
 * than a `UserMenu` reuse.
 */
export function AccountButton({ block = false }: { block?: boolean }): ReactNode {
  return (
    <ButtonLink href="/profile" variant="secondary" block={block}>
      {t('profile.title')}
    </ButtonLink>
  );
}

/**
 * Sign out. `POST /auth/logout` revokes the current session's refresh token
 * server-side (TD-4.14); clearing the in-memory token alone would leave a live
 * 30-day credential in the cookie, so the request is what actually ends the
 * session and the reload is only the consequence.
 */
export function SignOutButton({
  onSignOut,
  block = false,
}: {
  onSignOut: () => void | Promise<void>;
  block?: boolean;
}): ReactNode {
  return (
    <Button variant="ghost" block={block} onClick={() => void onSignOut()}>
      {t('nav.logout')}
    </Button>
  );
}
