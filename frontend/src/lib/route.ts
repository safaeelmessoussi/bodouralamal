import { isAdminPath } from './admin-modules.js';
import { isTeacherPath } from './teacher-modules.js';
import { ROLE_HOME_PATHS } from './role-home.js';

/**
 * Which page a path resolves to (§14.1).
 *
 * **The decision is a pure function so it can be tested exhaustively.** It used
 * to live inline in `main.tsx`'s path switch, where the `default` branch
 * returned `null` — and a router that can return "nothing" produces a **blank
 * white page**, which §14.4 forbids outright. That defect shipped and was
 * reachable from the header's own Dashboard button.
 *
 * Extracting it means the invariant *"every path resolves to something"* is
 * one assertion rather than a property nobody can check.
 */
export type Route =
  | 'landing'
  | 'login'
  | 'register'
  | 'content-unavailable'
  | 'calendar'
  /** §5.2's Session page. A parameterised public path, so it is matched by
   *  pattern rather than by the literal switch above. */
  | 'session'
  | 'resources'
  | 'pending-approval'
  | 'account-deactivated'
  /** A §14.1 role home whose screen belongs to a later milestone. */
  | 'screen-pending'
  /** §5.3's Student Dashboard — one route, two contexts (R62.10, R63). */
  | 'dashboard-student'
  /** M4b — §14.1's *My Quran Progress*, read-only (§4.5). */
  | 'dashboard-student-calendar'
  | 'dashboard-student-library'
  | 'dashboard-student-account'
  | 'dashboard-student-quran'
  /** §5.3's *My Grades & Exams* — PUBLISHED grades, read-only (2026-08-17). */
  | 'dashboard-student-grades'
  /** §14.1, §5.2 (R65) — the PERSONAL section: role-independent, every account. */
  | 'profile'
  /** §14.1 (R65) — any account registers a child, from the personal section. */
  | 'register-child'
  /** The back office, resolved by its module registry. */
  | 'admin'
  /** The teacher portal, resolved by its own registry — a separate application
   *  branch of §14.1, not a section of the back office. */
  | 'teacher'
  /** A path §14.1 does not define. A real page — never nothing. */
  | 'not-found';

/** Trailing slashes are not a different page. */
export function normalisePath(pathname: string): string {
  return pathname.replace(/\/+$/, '') || '/';
}

export function resolveRoute(pathname: string): Route {
  const path = normalisePath(pathname);

  switch (path) {
    case '/':
      return 'landing';
    case '/login':
      return 'login';
    case '/register':
      return 'register';
    case '/content-unavailable':
      return 'content-unavailable';
    case '/calendar':
      return 'calendar';
    case '/resources':
      return 'resources';
    case '/pending-approval':
      return 'pending-approval';
    case '/account-deactivated':
      return 'account-deactivated';
  }

  // §5.2's Session page: `/calendar/sessions/{id}`. Checked before the admin
  // registry because it is public and parameterised, and the literal switch
  // above cannot express an id.
  if (/^\/calendar\/sessions\/[^/]+$/.test(path)) return 'session';

  // The back office owns its own sub-paths, so it is checked before the role
  // homes — `/admin` appears in both lists and the registry is the authority.
  if (isAdminPath(path)) return 'admin';

  // The teacher portal owns its sub-paths the same way, and for the same
  // reason: `/teacher` is in both this registry and ROLE_HOME_PATHS, and the
  // registry is the authority.
  if (isTeacherPath(path)) return 'teacher';

  // R62.10 delivered this one. A parent reaches it through the account
  // switcher with a child selected; a student reaches it as themselves.
  // Before the bare dashboard, so the longer path is not swallowed by it.
  // R85 — her own calendar as its own node, so the menu can reach it and the
  // dashboard can stay minimal.
  if (path === '/dashboard/student/calendar') return 'dashboard-student-calendar';
  // R86 — her library and her account, INSIDE the portal. `/resources` and
  // `/profile` remain what they are for every other context.
  if (path === '/dashboard/student/library') return 'dashboard-student-library';
  if (path === '/dashboard/student/account') return 'dashboard-student-account';
  if (path === '/dashboard/student/quran') return 'dashboard-student-quran';
  // §5.3 has listed this node since R62 and nothing rendered it; the grades were
  // publishable and unreachable by the مستفيدة they were about.
  if (path === '/dashboard/student/grades') return 'dashboard-student-grades';
  if (path === '/dashboard/student') return 'dashboard-student';
  // R65 — the personal section, and the child-registration page under it.
  // Registering is an act of a PERSON, so neither is under a role's area: R64
  // put the page at `/dashboard/student/register-child`, which left a مؤطِّرة
  // who is nobody's student with no way to register her own child.
  if (path === '/profile') return 'profile';
  if (path === '/profile/register-child') return 'register-child';

  // §14.1 defines these; no milestone has delivered them. "Not built yet" and
  // "does not exist" are different facts and get different pages.
  if (ROLE_HOME_PATHS.includes(path)) return 'screen-pending';

  return 'not-found';
}
