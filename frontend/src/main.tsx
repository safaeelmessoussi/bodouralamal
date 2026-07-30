import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { PendingGuard } from './components/pending-guard.js';
import { ActiveChildProvider } from './contexts/active-child.js';
import { SessionProvider } from './contexts/session.js';
import { CalendarPage } from './pages/calendar.js';
import { Landing } from './pages/landing.js';
import { AccountDeactivated, ContentUnavailable, Login } from './pages/public.js';
import { ResourcesPage } from './pages/resources.js';
import './styles.css';

/**
 * Client entry (SRS §14.1, §16.1).
 *
 * Routing is a minimal path switch rather than a router dependency: §3.1a
 * Phase 1 permits patch updates, not new components, and the §14.1 sitemap is a
 * short fixed list. A router joins the stack when nested authenticated layouts
 * arrive (M2) — as an approved dependency, not a drive-by addition.
 */
function App(): React.ReactNode {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';

  switch (path) {
    case '/':
      return <Landing />;
    case '/login':
      return <Login />;
    case '/register':
      // §4.1b step 4c lands here with the onboarding token in the fragment; the
      // unified registration form itself is M2.
      return <Login />;
    case '/content-unavailable':
      return <ContentUnavailable />;
    case '/calendar':
      return <CalendarPage />;
    // §14.1's single resources node. Both §5.2 views live here — the level list,
    // and one level's contents behind `?level=` — because a second path segment
    // would be a navigation node §14.1 does not list (§20 rule 16).
    case '/resources':
      return <ResourcesPage />;
    case '/pending-approval':
      // Rendered by the guard, which owns the Pending decision.
      return <PendingGuard>{null}</PendingGuard>;
    case '/account-deactivated':
      return <AccountDeactivated />;
    default:
      // Authenticated areas mount here from M2, all behind the guard so a
      // Pending user never sees an application shell (§14.4).
      return <PendingGuard>{null}</PendingGuard>;
  }
}

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <SessionProvider>
        {/* §4.3: the active child is per-session client state, and every
            request carries it as a header. It wraps the app because the header
            renders the switcher on every page. */}
        <ActiveChildProvider>
          <App />
        </ActiveChildProvider>
      </SessionProvider>
    </StrictMode>,
  );
}
