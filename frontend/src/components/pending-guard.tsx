import type { ReactNode } from 'react';

import { useSession } from '../contexts/session.js';
import { t } from '../i18n/index.js';
import { ApplicationHeader } from './header/application-header.js';
import { SiteFooter } from './site-footer.js';
import { LoadingState } from './states.js';

/**
 * Global Pending route guard (SRS §14.4, Revision 8).
 *
 * Intercepts any user whose `account_status` is `Pending` (from `GET /me`) and
 * shows the approval-status screen **before any authenticated route renders** —
 * a Pending user must never glimpse empty skeletons, sidebars, or loading
 * shells of the APPLICATION (the admin/teacher/student portals themselves).
 *
 * **The site header and footer are not that shell** (Owner-reported, 2026-09-14):
 * they were withheld too, leaving the screen a dead end with no way back to
 * anything — not even the public site a signed-out visitor already reaches
 * freely. `ApplicationHeader`'s own navigation is `useNavigation`'s three public
 * links (Home/Calendar/Resources) in every state; a Pending session's "Dashboard"
 * button leads right back to this same screen (every portal route is wrapped in
 * this same guard), and "Sign out" is exactly what an impatient reader needs.
 * Nothing here reaches further than an anonymous visitor already can — the
 * server-side denial (TD-1: no endpoint beyond `GET /me` and logout for a
 * Pending session) is unchanged and is what actually enforces the boundary.
 *
 * This is a **UX layer only**. The server-side denial is the security
 * enforcement, and the two are tested independently (§19.2).
 */
export function PendingGuard({ children }: { children: ReactNode }): ReactNode {
  const { status, me } = useSession();

  if (status === 'loading') return <LoadingState />;

  if (me?.account_status === 'pending') {
    return (
      <>
        <ApplicationHeader />
        <main id="main" className="status-screen" role="status">
          <h1>{t('auth.pendingTitle')}</h1>
          <p>{t('auth.pendingBody')}</p>
        </main>
        <SiteFooter />
      </>
    );
  }

  // Rejected, suspended and soft-deleted accounts never reach a session at all:
  // the callback refuses them at §4.1b step 4a, so there is nothing to guard
  // here — they are redirected to /login?error=account_deactivated.
  return children;
}
