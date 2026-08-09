/**
 * Where a signed-in person's "dashboard" actually is.
 *
 * §14.1's sitemap has **no bare `/dashboard` node**. It lists *role-specific
 * homes*: `/dashboard/student`, `/dashboard/parent`, `/teacher` and `/admin`.
 * §4.1b step 4a calls the post-login landing a "role-based dashboard redirect"
 * for the same reason — which home you get depends on who you are.
 *
 * The header used to link every signed-in user to `/dashboard`, a path the
 * sitemap does not define and the router did not serve, so the button rendered
 * a **blank white page** for everyone who pressed it.
 *
 * Resolution order is **most privileged first**, because a person can hold
 * several roles (§4.2) and the button is one link. A مؤطِّرة who is also a
 * parent lands on her teacher home; her family views are reachable from the
 * child-context switcher, not from this button.
 */
export const ROLE_HOMES: { role: string; path: string }[] = [
  { role: 'super_admin', path: '/admin' },
  { role: 'admin', path: '/admin' },
  { role: 'teacher', path: '/teacher' },
  { role: 'parent', path: '/dashboard/parent' },
  { role: 'student', path: '/dashboard/student' },
];

/**
 * The home for these roles, or `null` when the caller holds none that has one.
 *
 * `null` is a real answer, not a failure: §14.4's *no-role landing* (Revision
 * 16) says an Active account with no role assignment renders the no-permission
 * state. Returning `null` lets the caller hide the button rather than offer a
 * link to nowhere — which is exactly the defect this module exists to prevent.
 */
export function roleHomePath(roles: readonly string[]): string | null {
  for (const { role, path } of ROLE_HOMES) {
    if (roles.includes(role)) return path;
  }
  return null;
}

/**
 * Where **one** role's portal lives.
 *
 * `roleHomePath` answers *"where does this person go"* from their whole role
 * set; this answers *"where does this ROLE go"*, which is what a switch needs.
 * `null` for a role with no home declared — the caller decides what to do about
 * it rather than being sent somewhere that does not exist.
 */
export function homeForRole(role: string): string | null {
  return ROLE_HOMES.find((entry) => entry.role === role)?.path ?? null;
}

/** Every path `roleHomePath` can return — the set the router must serve. */
export const ROLE_HOME_PATHS: readonly string[] = [...new Set(ROLE_HOMES.map((r) => r.path))];
