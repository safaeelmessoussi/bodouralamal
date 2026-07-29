import { useSession } from '../contexts/session.js';

/**
 * The navigation model — data only, no markup.
 *
 * The menu is derived from session state in one place so every surface that
 * renders it (desktop bar, mobile sheet, future layouts) shows the same thing.
 * Keeping it here rather than inside a component is what lets the two renderers
 * share a definition instead of drifting apart.
 *
 * §14.1 owns the route list; this adds only the *visibility* rule:
 * **Dashboard is never offered to an anonymous visitor.**
 */
export interface NavLink {
  key: string;
  href: string;
  labelKey: string;
}

export interface Navigation {
  links: NavLink[];
  isAuthenticated: boolean;
  /** More than one role means the caller can act in several capacities (§4.2). */
  hasMultipleRoles: boolean;
  /** A parent with at least one approved link needs the child switcher (§4.3). */
  hasLinkedChildren: boolean;
}

/** Public routes, in the order the existing site presents them. */
const PUBLIC_LINKS: NavLink[] = [
  { key: 'home', href: '/', labelKey: 'nav.home' },
  { key: 'calendar', href: '/calendar', labelKey: 'nav.calendar' },
  { key: 'resources', href: '/resources', labelKey: 'nav.resources' },
];

export function useNavigation(): Navigation {
  const { status, me } = useSession();
  const isAuthenticated = status === 'authenticated' && me !== null;

  return {
    // Dashboard is an authenticated destination and is appended only then —
    // offering it to a visitor would advertise a route that answers 401.
    links: isAuthenticated
      ? [...PUBLIC_LINKS, { key: 'dashboard', href: '/dashboard', labelKey: 'nav.dashboard' }]
      : PUBLIC_LINKS,
    isAuthenticated,
    hasMultipleRoles: (me?.roles.length ?? 0) > 1,
    hasLinkedChildren: (me?.approved_child_links.length ?? 0) > 0,
  };
}

/** Marks the current route so the bar can render `aria-current="page"`. */
export function isCurrent(href: string, pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  return href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`);
}
