import type { ReactNode } from 'react';

import { useSession } from '../contexts/session.js';
import { t } from '../i18n/index.js';
import { LoadingState } from './states.js';

/**
 * Global Pending route guard (SRS §14.4, Revision 8).
 *
 * Intercepts any user whose `account_status` is `Pending` (from `GET /me`) and
 * shows the approval-status screen **before any authenticated route renders** —
 * a Pending user must never glimpse empty skeletons, sidebars, or loading
 * shells of the application.
 *
 * This is a **UX layer only**. The server-side denial is the security
 * enforcement (TD-1: no endpoint beyond `GET /me` and logout returns data to a
 * Pending session), and the two are tested independently (§19.2).
 */
export function PendingGuard({ children }: { children: ReactNode }): ReactNode {
  const { status, me } = useSession();

  if (status === 'loading') return <LoadingState />;

  if (me?.account_status === 'pending') {
    return (
      <main className="status-screen" role="status">
        <h1>{t('auth.pendingTitle')}</h1>
        <p>{t('auth.pendingBody')}</p>
      </main>
    );
  }

  // Rejected, suspended and soft-deleted accounts never reach a session at all:
  // the callback refuses them at §4.1b step 4a, so there is nothing to guard
  // here — they are redirected to /login?error=account_deactivated.
  return children;
}
