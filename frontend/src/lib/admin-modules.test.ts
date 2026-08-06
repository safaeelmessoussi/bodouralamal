import { describe, expect, it } from 'vitest';

import {
  ADMIN_MODULES,
  ADMIN_SECTIONS,
  canAccess,
  isAdminPath,
  moduleForPath,
  visibleModules,
} from './admin-modules.js';

/**
 * The module registry is the single source for the back office's navigation,
 * routing and role gating — so these assert the properties that would otherwise
 * fail silently: a menu entry with no route, a route with no permission, or a
 * module visible to a role TD-2 excludes.
 */
describe('the registry matches §14.1', () => {
  it('lists every node the sitemap defines, and no others', () => {
    // §14.1: "no invented sections, no reshuffling". A path added here that the
    // sitemap does not list is exactly what §20 rule 16 forbids.
    //
    // The rule cuts both ways, and this list proved it: `/admin/schedules` is
    // named in §14.1's Academic group ("Course Schedules ... /admin/schedules
    // (staff, R43)") and was missing from BOTH the registry and this
    // expectation, so the two agreed with each other and neither agreed with
    // the sitemap. A test that pins one copy against another copy cannot catch
    // that — only re-reading §14.1 could.
    expect(ADMIN_MODULES.map((m) => m.path).sort()).toEqual(
      [
        '/admin',
        '/admin/approvals',
        '/admin/branches',
        '/admin/calendar',
        '/admin/content',
        '/admin/groups',
        '/admin/levels',
        '/admin/schedules',
        // R55 — §14.1's single "Categories & Subjects" node became two, on the
        // Owner's instruction. One implementation still serves both.
        '/admin/categories',
        '/admin/subjects',
        // R52 — §14.1's Administration group gained the Trash node when the
        // Revision 6 deferral was superseded.
        '/admin/trash',
        '/admin/users',
        '/superadmin/hijri-calendar',
        '/superadmin/settings',
      ].sort(),
    );
  });

  it('places every module in a known section, or deliberately above them', () => {
    for (const module of ADMIN_MODULES) {
      if (module.section === null) continue;
      expect(ADMIN_SECTIONS).toContain(module.section);
    }
  });

  it('gives every module at least one role — an unreachable module is a defect', () => {
    for (const module of ADMIN_MODULES) {
      expect(module.roles.length).toBeGreaterThan(0);
    }
  });

  it('names the reason for every blocked module', () => {
    // "Coming soon" tells nobody whether the wait is a day or a milestone.
    for (const module of ADMIN_MODULES) {
      if (module.status === 'blocked') expect(module.blockedReasonKey).toBeTruthy();
    }
  });
});

describe('role gating (TD-2)', () => {
  it('keeps the Super-Admin-only modules out of an Admin session', () => {
    const forAdmin = visibleModules(['admin']).map((m) => m.path);
    expect(forAdmin).not.toContain('/superadmin/settings');
    expect(forAdmin).not.toContain('/superadmin/hijri-calendar');
  });

  it('gives a Super Admin everything', () => {
    expect(visibleModules(['super_admin'])).toHaveLength(ADMIN_MODULES.length);
  });

  it('gives a role with no back-office grant nothing at all', () => {
    // A Teacher, Parent or Student holds no module here — and an Active account
    // with no role at all renders the §14.4 no-permission state.
    expect(visibleModules(['teacher'])).toHaveLength(0);
    expect(visibleModules([])).toHaveLength(0);
  });

  it('admits a session holding several roles on the strength of any one', () => {
    const paths = visibleModules(['teacher', 'super_admin']).map((m) => m.path);
    expect(paths).toContain('/superadmin/hijri-calendar');
  });

  it('lets reference-data modules open for an Admin, who may read them (R26)', () => {
    const levels = ADMIN_MODULES.find((m) => m.path === '/admin/levels')!;
    expect(canAccess(levels, ['admin'])).toBe(true);
  });
});

describe('path resolution', () => {
  it('resolves an exact path to its module', () => {
    expect(moduleForPath('/admin/groups')?.path).toBe('/admin/groups');
  });

  it('prefers the LONGEST match, so /admin does not swallow its children', () => {
    expect(moduleForPath('/admin/users')?.path).toBe('/admin/users');
    expect(moduleForPath('/admin')?.path).toBe('/admin');
  });

  it('resolves a sub-path to its parent module', () => {
    // A module owns its internal views without registering each as a navigation
    // node §14.1 does not list.
    expect(moduleForPath('/admin/groups/abc/roster')?.path).toBe('/admin/groups');
  });

  it('tolerates a trailing slash', () => {
    expect(moduleForPath('/admin/groups/')?.path).toBe('/admin/groups');
  });

  it('does not claim a path outside the back office', () => {
    for (const path of ['/', '/calendar', '/resources', '/login', '/administrivia']) {
      expect(moduleForPath(path)).toBeNull();
      expect(isAdminPath(path)).toBe(false);
    }
  });

  it('does not match a path that merely SHARES a prefix', () => {
    // `/admin/groupsomething` is not `/admin/groups` — without the separator
    // check it would resolve to it.
    expect(moduleForPath('/admin/groupsomething')?.path).not.toBe('/admin/groups');
  });
});

describe('the sidebar promises exactly what the router delivers', () => {
  it('every `ready` module has a screen, and every screen is `ready`', async () => {
    // The inconsistency this pins: `الحلقات`, `المستخدمون` and
    // `الجدول والأنشطة` carried `ready` while no screen existed, so the sidebar
    // showed them as available and the page then said "this section is being
    // prepared". Two answers to one question, with nothing forcing agreement.
    const { IMPLEMENTED_ADMIN_PATHS } = await import('../pages/admin/index.js');
    const ready = ADMIN_MODULES.filter((m) => m.status === 'ready').map((m) => m.path).sort();
    expect(ready).toEqual([...IMPLEMENTED_ADMIN_PATHS].sort());
  });

  it('every blocked module NAMES what is missing', () => {
    // "Coming soon" tells nobody whether the wait is a day or a milestone, so
    // a blocked module without a reason is itself a defect.
    for (const module of ADMIN_MODULES.filter((m) => m.status === 'blocked')) {
      expect(module.blockedReasonKey, `${module.path} must name its reason`).toBeTruthy();
    }
  });
});
