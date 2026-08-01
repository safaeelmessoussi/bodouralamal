import { isAdminPath } from './admin-modules.js';
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
  | 'resources'
  | 'pending-approval'
  | 'account-deactivated'
  /** A §14.1 role home whose screen belongs to a later milestone. */
  | 'screen-pending'
  /** The back office, resolved by the module registry. */
  | 'admin'
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

  // The back office owns its own sub-paths, so it is checked before the role
  // homes — `/admin` appears in both lists and the registry is the authority.
  if (isAdminPath(path)) return 'admin';

  // §14.1 defines these; no milestone has delivered them. "Not built yet" and
  // "does not exist" are different facts and get different pages.
  if (ROLE_HOME_PATHS.includes(path)) return 'screen-pending';

  return 'not-found';
}
