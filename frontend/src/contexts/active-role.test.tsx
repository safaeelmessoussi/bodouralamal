import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';

import { ActiveRoleProvider, orderedRoles, resolveActiveRole, useActiveRole } from './active-role.js';
import { visibleModules } from '../lib/admin-modules.js';
import { SessionContext, type Me } from './session.js';
import { homeForRole, roleHomePath } from '../lib/role-home.js';

/**
 * Multi-role switching (§2.1).
 *
 * ## The defect these tests exist for
 *
 * The switcher held its selection in its own `useState` and did nothing with
 * it. Selecting a role re-labelled the trigger; the page did not move, the
 * navigation did not change, and every screen went on reading the **full** role
 * set — so a Super Admin who chose *مؤطِّرة* still saw the Super Admin back
 * office. Nothing failed, because nothing was asserted: the old tests checked
 * that the control *appeared*, which it did.
 *
 * So these assert what the control is FOR: that the active role is a real
 * selection, that it survives the navigation the switch causes, that it cannot
 * be set to a role the person does not hold, and that a revoked role is
 * dropped rather than honoured.
 */
const person = (roles: string[]): Me => ({
  id: 'u1',
  account_status: 'active',
  roles,
  role_scopes: roles.map((role) => ({ role, branches: null })),
  active_role: null,
  approved_child_links: [],
    teaches_quran: false,
});

/** Renders a probe inside the provider and returns what it observed. */
function observe(
  me: Me,
  act?: (state: ReturnType<typeof useActiveRole>) => void,
): { active: string | null; roles: string[]; activeRoles: string[] } {
  let seen: { active: string | null; roles: string[]; activeRoles: string[] } = {
    active: null,
    roles: [],
    activeRoles: [],
  };

  function Probe(): null {
    const state = useActiveRole();
    seen = { active: state.activeRole, roles: state.roles, activeRoles: state.activeRoles };
    act?.(state);
    return null;
  }

  renderToStaticMarkup(
    <SessionContext.Provider
      value={{ status: 'authenticated', me, accessToken: null, setAccessToken: () => undefined }}
    >
      <ActiveRoleProvider>
        <Probe />
      </ActiveRoleProvider>
    </SessionContext.Provider>,
  );
  return seen;
}

/**
 * A three-line `sessionStorage`, because the alternative is a DOM dependency.
 *
 * The suite renders with `react-dom/server` and needs no browser; adding jsdom
 * for one storage call would be a dependency bought for a test, which §3.1a's
 * pinning discipline exists to avoid. The provider reaches for
 * `window.sessionStorage` inside a `try`, so this stub is the only thing
 * standing between the rule and a real browser.
 */
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { window?: unknown }).window = {
    sessionStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
  };
});

describe('which role is active by default', () => {
  it('starts on the most privileged role held', () => {
    // Matching `roleHomePath`'s precedence, so the switcher and the Dashboard
    // button cannot disagree about which role is "first".
    expect(observe(person(['teacher', 'super_admin'])).active).toBe('super_admin');
    expect(observe(person(['student', 'parent'])).active).toBe('parent');
  });

  it('orders the choices the same way, whatever order the server sent', () => {
    expect(orderedRoles(['student', 'admin', 'teacher'])).toEqual(['admin', 'teacher', 'student']);
  });

  it('keeps a role the client does not know about rather than hiding it', () => {
    // A role added server-side must be visible. Dropping it would make the
    // person unable to select a role they hold.
    expect(orderedRoles(['admin', 'auditor'])).toEqual(['admin', 'auditor']);
  });

  it('is null for an account with no role at all (§14.4)', () => {
    expect(observe(person([])).active).toBeNull();
  });
});

describe('switching', () => {
  it('changes the active role and REMEMBERS it across the navigation it causes', () => {
    // The switch navigates, and this application navigates by full page load.
    // Without persistence the selection would be destroyed by its own effect —
    // which is exactly the "nothing happens" the reader reported.
    observe(person(['super_admin', 'teacher']), (state) => state.setActiveRole('teacher'));
    expect(store.get('bodour.activeRole')).toBe('teacher');

    // A fresh render, as a page load produces.
    expect(observe(person(['super_admin', 'teacher'])).active).toBe('teacher');
  });

  it('REFUSES a role the person does not hold', () => {
    observe(person(['teacher']), (state) => state.setActiveRole('super_admin'));

    // Neither honoured nor stored: a crafted selection cannot promote anybody.
    expect(store.has('bodour.activeRole')).toBe(false);
    expect(observe(person(['teacher'])).active).toBe('teacher');
  });

  it('drops a stored role that has since been revoked', () => {
    store.set('bodour.activeRole', 'super_admin');

    // The token no longer carries it, so the interface must not keep acting as
    // it — it falls back to the most privileged role still held.
    expect(observe(person(['teacher', 'parent'])).active).toBe('teacher');
  });

  it('ignores a stored value that was never a role', () => {
    store.set('bodour.activeRole', 'wizard');
    expect(observe(person(['parent'])).active).toBe('parent');
  });
});

describe('the resolution rule itself', () => {
  it('honours a stored role only while it is still held', () => {
    expect(resolveActiveRole('teacher', ['super_admin', 'teacher'])).toBe('teacher');
    // Revoked since: the interface must not go on acting as it.
    expect(resolveActiveRole('super_admin', ['teacher'])).toBe('teacher');
    expect(resolveActiveRole(null, ['admin', 'parent'])).toBe('admin');
    expect(resolveActiveRole('admin', [])).toBeNull();
  });
});

describe('where each role lands', () => {
  it('gives every role §14.1 declares its own home', () => {
    expect(homeForRole('super_admin')).toBe('/admin');
    expect(homeForRole('admin')).toBe('/admin');
    expect(homeForRole('teacher')).toBe('/teacher');
    // R62 — a parent's home is their child's dashboard; §5.4's Family
    // Dashboard is removed.
    expect(homeForRole('parent')).toBe('/dashboard/student');
    expect(homeForRole('student')).toBe('/dashboard/student');
  });

  it('returns null for a role with no declared home, rather than a wrong one', () => {
    // The switcher stays put in that case instead of navigating nowhere.
    expect(homeForRole('auditor')).toBeNull();
  });

  it('differs from the whole-account home, which is the point', () => {
    const roles = ['super_admin', 'teacher'];
    // One button, most privileged first…
    expect(roleHomePath(roles)).toBe('/admin');
    // …but the switch must be able to reach the other portal.
    expect(homeForRole('teacher')).toBe('/teacher');
  });
});

/**
 * **The two defects R60 shipped, pinned.**
 *
 * R60 narrowed the *server* and left the client reading `me.roles` — the full
 * list `/me` deliberately keeps so the switcher can offer a way back. Every
 * presentation decision that read it was therefore answering *"what could this
 * account do"* where the question was *"what is it doing now"*.
 *
 * It produced two visible failures, and neither was a routing bug:
 *
 *   * `لوحة التحكم` resolved most-privileged-first from the full list, so a
 *     Super Admin working as مؤطِّرة was sent to `/admin` — a portal her active
 *     role does not own — and met the wrong-role screen instead of her dashboard.
 *   * The back-office sidebar listed Super Admin modules to someone acting as
 *     Admin: a menu of things the server would refuse.
 *
 * `activeRoles` is the single thing the interface reads now, and these assert it
 * behaves as those helpers expect.
 */
describe('activeRoles — what the interface reads (R60)', () => {
  it('is the active role alone, never the account\'s full set', () => {
    const seen = observe(person(['super_admin', 'admin', 'teacher']));
    // The menu keeps every role, so switching back stays possible…
    expect(seen.roles).toEqual(['super_admin', 'admin', 'teacher']);
    // …while the interface is driven by exactly one.
    expect(seen.activeRoles).toEqual(['super_admin']);
  });

  it('follows a switch', () => {
    observe(person(['super_admin', 'teacher']), (s) => s.setActiveRole('teacher'));
    const after = observe(person(['super_admin', 'teacher']));
    expect(after.activeRoles).toEqual(['teacher']);
    expect(after.roles).toContain('super_admin');
  });

  it('is empty for an account with no role (§14.4), not a stale one', () => {
    expect(observe(person([])).activeRoles).toEqual([]);
  });
});

describe('the dashboard button opens the ACTIVE role\'s home', () => {
  it('sends a Super Admin working as مؤطِّرة to /teacher, not /admin', () => {
    // The reported defect, at its source: the button resolves from whatever list
    // it is handed, so handing it the full set is what sent her to /admin.
    expect(roleHomePath(['super_admin', 'admin', 'teacher'])).toBe('/admin');
    expect(roleHomePath(['teacher'])).toBe('/teacher');
    expect(roleHomePath(['admin'])).toBe('/admin');
  });
});

describe('the menu contains only the active role\'s modules', () => {
  it('does not offer Super Admin screens to somebody acting as Admin', () => {
    const asAdmin = visibleModules(['admin']).map((m) => m.path);
    const asSuper = visibleModules(['super_admin']).map((m) => m.path);

    // Super-Admin-only nodes (§14.1) must be absent from the Admin menu.
    expect(asSuper).toContain('/superadmin/settings');
    expect(asAdmin).not.toContain('/superadmin/settings');
    expect(asAdmin).not.toContain('/admin/trash');
  });

  it('gives a teacher no back-office menu at all', () => {
    // The back office is not the teacher's portal; `/teacher` is.
    expect(visibleModules(['teacher']).map((m) => m.path)).not.toContain('/admin/users');
  });
});
