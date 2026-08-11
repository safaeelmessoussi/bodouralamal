import { useSession } from '../contexts/session.js';

/**
 * The navigation model — data only, no markup.
 *
 * The menu is derived from session state in one place so every surface that
 * renders it (desktop bar, mobile sheet, future layouts) shows the same thing.
 * Keeping it here rather than inside a component is what lets the two renderers
 * share a definition instead of drifting apart.
 *
 * §14.1 owns the route list; this owns the *visibility* rules.
 *
 * **The three public links are the whole navigation, in both states.**
 * Dashboard is deliberately **not** among them: it is an *account control*,
 * belonging beside Sign out, not a site section beside Home. Putting it in the
 * navigation also gave an authenticated user the same destination twice — once
 * as a link and once as a button.
 */
export interface NavLink {
  key: string;
  href: string;
  labelKey: string;
}

/**
 * **`hasMultipleRoles` and `hasLinkedChildren` used to live here and are gone
 * (R62.9).** They gated the two header switchers, and both rules moved into
 * `RoleSwitcher` when the two menus became one — because the rule stopped being
 * "how many roles" the moment a parent-only account needed the switcher too.
 *
 * Removed rather than left: a flag nothing reads is a rule with no enforcement,
 * and the next person to need one would have found two answers to the same
 * question in two files.
 */
export interface Navigation {
  links: NavLink[];
  isAuthenticated: boolean;
}

/** Public routes, in the order the existing site presents them. */
export const PUBLIC_LINKS: NavLink[] = [
  { key: 'home', href: '/', labelKey: 'nav.home' },
  { key: 'calendar', href: '/calendar', labelKey: 'nav.calendar' },
  { key: 'resources', href: '/resources', labelKey: 'nav.resources' },
];

/**
 * The decision, as a pure function of session state — no React, so it can be
 * tested directly rather than through a rendered tree.
 */
export function buildNavigation(
  status: 'loading' | 'anonymous' | 'authenticated',
  me: { roles: string[] } | null,
): Navigation {
  const isAuthenticated = status === 'authenticated' && me !== null;

  return {
    // Identical in both states. Dashboard is an account control, rendered by
    // the header's actions area only when `isAuthenticated` — never a nav link.
    links: PUBLIC_LINKS,
    isAuthenticated,
  };
}

export function useNavigation(): Navigation {
  const { status, me } = useSession();
  return buildNavigation(status, me);
}

/** Marks the current route so the bar can render `aria-current="page"`. */
export function isCurrent(href: string, pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  return href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`);
}
