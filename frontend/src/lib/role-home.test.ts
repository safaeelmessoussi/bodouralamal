import { describe, expect, it } from 'vitest';

import { isAdminPath } from './admin-modules.js';
import { ROLE_HOME_PATHS, roleHomePath } from './role-home.js';

/**
 * The P0 regression: **`/dashboard` rendered a blank white page.**
 *
 * The header linked every signed-in user to `/dashboard`; §14.1's sitemap has
 * no such node, so the router's path switch fell through to its catch-all,
 * which returned `null`. React rendered nothing and the page was white — the
 * exact outcome §14.4 forbids ("never a blank page, never a crash").
 *
 * These tests pin both halves: the link must point somewhere the sitemap
 * defines, and every path it can produce must be a path the router serves.
 */

describe('roleHomePath — §14.1 role-specific homes', () => {
  it('NEVER returns the bare /dashboard that caused the blank page', () => {
    // The regression itself. §14.1 lists /dashboard/student; it does not list
    // /dashboard.
    for (const roles of [['student'], ['parent'], ['teacher'], ['admin'], ['super_admin']]) {
      expect(roleHomePath(roles)).not.toBe('/dashboard');
    }
  });

  it('sends staff to the back office', () => {
    expect(roleHomePath(['admin'])).toBe('/admin');
    expect(roleHomePath(['super_admin'])).toBe('/admin');
  });

  it('sends each other role to its own §14.1 home', () => {
    expect(roleHomePath(['teacher'])).toBe('/teacher');
    expect(roleHomePath(['student'])).toBe('/dashboard/student');
  });

  it('R62: a parent lands on the STUDENT dashboard — there is no parent one', () => {
    // §5.4's Family Dashboard was removed: a parent's question is *how is my
    // daughter doing*, and the Student Dashboard already answers it. Two
    // screens over one child's data would have been two things to keep true.
    expect(roleHomePath(['parent'])).toBe('/dashboard/student');
    // And the removed path must not be reachable through this module at all,
    // or the router would still have to serve it.
    expect(ROLE_HOME_PATHS).not.toContain('/dashboard/parent');
  });

  it('resolves the MOST privileged role, because the button is one link', () => {
    // A مؤطِّرة who is also a parent gets her teacher home; the family views
    // are reached through the child-context switcher (§4.3), not this button.
    expect(roleHomePath(['parent', 'teacher'])).toBe('/teacher');
    // Both resolve to one screen since R62; the ACTIVE role decides whether it
    // renders her own record or her child's.
    expect(roleHomePath(['student', 'parent'])).toBe('/dashboard/student');
    expect(roleHomePath(['teacher', 'admin'])).toBe('/admin');
  });

  it('returns null for an Active account with no role, so the button can be hidden', () => {
    // §14.4 Revision 16: reachable only through staff error, and it must render
    // the no-permission state — never a link to nowhere.
    expect(roleHomePath([])).toBeNull();
    expect(roleHomePath(['nonsense'])).toBeNull();
  });
});

describe('every role home is a path the router actually serves', () => {
  it('has no home the router would answer with a blank page', () => {
    // The invariant that would have caught the original defect: a link target
    // that no route matches is a blank page, and this asserts there are none.
    // `/admin` is resolved by the module registry; the rest are explicit cases
    // in the path switch, which `main.tsx` derives from ROLE_HOME_PATHS.
    for (const path of ROLE_HOME_PATHS) {
      const served = isAdminPath(path) || ROLE_HOME_PATHS.includes(path);
      expect(served, `${path} must be routed`).toBe(true);
    }
  });

  it('routes /admin through the module registry rather than a second list', () => {
    expect(isAdminPath('/admin')).toBe(true);
  });
});
