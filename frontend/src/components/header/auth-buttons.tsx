import type { ReactNode } from 'react';

import { t } from '../../i18n/index.js';
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
  return (
    <ButtonLink href="/api/v1/auth/google" variant="primary" block={block}>
      {t('nav.login')}
    </ButtonLink>
  );
}

/** Shown only to an authenticated caller — see `useNavigation`. */
export function DashboardButton({ block = false }: { block?: boolean }): ReactNode {
  return (
    <ButtonLink href="/dashboard" variant="secondary" block={block}>
      {t('nav.dashboard')}
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
