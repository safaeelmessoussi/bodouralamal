import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { PendingGuard } from './components/pending-guard.js';
import { ActiveChildProvider } from './contexts/active-child.js';
import { ActiveRoleProvider } from './contexts/active-role.js';
import { SessionProvider } from './contexts/session.js';
import { resolveRoute } from './lib/route.js';
import { AdminRouter } from './pages/admin/index.js';
import { ClassroomPage } from './pages/classroom.js';
import { SessionPage } from './pages/session.js';
import { TeacherRouter } from './pages/teacher/index.js';
import { CalendarPage } from './pages/calendar.js';
import { StudentGradesPage } from './pages/dashboard/grades.js';
import { StudentQuranPage } from './pages/dashboard/quran.js';
import { StudentAccountPage } from './pages/dashboard/account.js';
import { StudentLibraryPage } from './pages/dashboard/library.js';
import { StudentCalendarPage, StudentDashboard } from './pages/dashboard/student.js';
import { RegisterChildPage } from './pages/profile/register-child.js';
import { ProfilePage } from './pages/profile/index.js';
import { Landing } from './pages/landing.js';
import { Register } from './pages/register.js';
import {
  AccountDeactivated,
  ContentUnavailable,
  Login,
  NotFound,
  ScreenPending,
} from './pages/public.js';
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
  // The decision is a pure function (`lib/route.ts`) so the invariant that
  // matters — **every path resolves to a page, never to nothing** — is
  // testable. This switch only maps a decision to a component.
  switch (resolveRoute(window.location.pathname)) {
    case 'landing':
      return <Landing />;
    case 'login':
      return <Login />;
    case 'register':
      // §4.1b step 4c lands here with the onboarding token in the fragment.
      return <Register />;
    case 'content-unavailable':
      return <ContentUnavailable />;
    case 'calendar':
      return <CalendarPage />;
    // §14.1's single resources node. Both §5.2 views live here — the level list,
    // and one level's contents behind `?level=` — because a second path segment
    // would be a navigation node §14.1 does not list (§20 rule 16).
    case 'resources':
      return <ResourcesPage />;
    case 'session':
      // Public at the caller's tier, exactly like the grid it is opened from.
      return <SessionPage />;
    case 'classroom':
      // R98 — one classroom for every portal. Inside `PendingGuard` like every
      // authenticated screen; the JOIN itself is authorised by the server, which
      // is the only place that knows whether this caller is in the audience or
      // staffs the occurrence.
      return (
        <PendingGuard>
          <ClassroomPage />
        </PendingGuard>
      );
    case 'pending-approval':
      // The guard owns the Pending decision, so it renders the screen itself.
      return <PendingGuard>{null}</PendingGuard>;
    case 'account-deactivated':
      return <AccountDeactivated />;
    case 'admin':
      // Resolved by the module registry rather than enumerated here, so a route
      // cannot exist without a navigation entry and a permission — they are one
      // list (`lib/admin-modules.ts`).
      //
      // Inside `PendingGuard`, so a Pending user never glimpses the application
      // shell (§14.4, Revision 8) — the sidebar and headings are exactly the
      // "empty skeleton layout" that guard exists to prevent.
      return (
        <PendingGuard>
          <AdminRouter />
        </PendingGuard>
      );
    case 'teacher':
      // Its own registry (`lib/teacher-modules.ts`), for the same reason the
      // back office has one: the route, the navigation entry and the permission
      // are one list. Also inside `PendingGuard` — a Pending user must never
      // glimpse the application shell (§14.4, Revision 8).
      return (
        <PendingGuard>
          <TeacherRouter />
        </PendingGuard>
      );
    case 'dashboard-student':
      // §5.3 (R62.10). Inside `PendingGuard` like every authenticated screen:
      // a Pending user must never glimpse the application shell (§14.4, R8).
      return (
        <PendingGuard>
          <StudentDashboard />
        </PendingGuard>
      );
    case 'dashboard-student-calendar':
      // R85 — `/me/calendar` behind the shared calendar components, in her own
      // portal frame. Never the public timetable.
      return (
        <PendingGuard>
          <StudentCalendarPage />
        </PendingGuard>
      );
    case 'dashboard-student-library':
      // R86 — the library scoped to her own enrolments, in her own frame. The
      // ITEMS still come from the server's authorized read.
      return (
        <PendingGuard>
          <StudentLibraryPage />
        </PendingGuard>
      );
    case 'dashboard-student-account':
      return (
        <PendingGuard>
          <StudentAccountPage />
        </PendingGuard>
      );
    case 'dashboard-student-quran':
      // M4b — §14.1's *My Quran Progress*. Read-only (§4.5), and the read it
      // calls carries no student id: the subject comes from the child context
      // or the JWT, so a parent sees the child they act for and nobody else.
      return (
        <PendingGuard>
          <StudentQuranPage />
        </PendingGuard>
      );
    case 'dashboard-student-grades':
      // §5.3's *My Grades & Exams*. PUBLISHED grades only — the draft is the
      // مؤطِّرة's working note (BR-8) and the server's query excludes it, so this
      // screen cannot show one. Same child-context rule as the dashboard above.
      return (
        <PendingGuard>
          <StudentGradesPage />
        </PendingGuard>
      );
    case 'profile':
      // §5.2 *Shared / Cross-Role* (R65) — the personal section. Not role-gated:
      // every account has a person behind it.
      return (
        <PendingGuard>
          <ProfilePage />
        </PendingGuard>
      );
    case 'register-child':
      // §14.1 (R65). Authenticated, and role-independent.
      return (
        <PendingGuard>
          <RegisterChildPage />
        </PendingGuard>
      );
    case 'screen-pending':
      // A §14.1 role home no milestone has delivered. Says which, rather than
      // rendering nothing.
      return (
        <PendingGuard>
          <ScreenPending />
        </PendingGuard>
      );
    case 'not-found':
      // **This branch used to `return null`, and that was a P0 defect:** React
      // rendered nothing and the browser showed a blank white page. §14.4 is
      // explicit — never a blank page, never a crash — and a fallback that
      // renders nothing satisfies neither. It was reachable from the header's
      // own Dashboard button, so it was not a rare typo path.
      return <NotFound />;
  }
}

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <SessionProvider>
        {/* §2.1: which of several held roles the person is currently working
            as. Outside the child provider because a parent's child context is
            meaningful only while the parent role is the active one. */}
        <ActiveRoleProvider>
          {/* §4.3: the active child is per-session client state, and every
              request carries it as a header. It wraps the app because the
              header renders the switcher on every page. */}
          <ActiveChildProvider>
            <App />
          </ActiveChildProvider>
        </ActiveRoleProvider>
      </SessionProvider>
    </StrictMode>,
  );
}
