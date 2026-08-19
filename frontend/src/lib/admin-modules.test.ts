import { describe, expect, it } from 'vitest';

import {
  ADMIN_MODULES,
  ADMIN_SECTIONS,
  canAccess,
  isAdminPath,
  moduleForPath,
  visibleModules,
} from './admin-modules.js';
import { t } from '../i18n/index.js';

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
        // R70.1 — grade entry had NO node: §14.1 listed grading under
        // `/teacher/exams` while R56/R58 put exam scheduling on
        // `/admin/schedules`, so an Admin could reach no sheet at all.
        // R74 — enrolment had no node: R66 made the group optional and gave
        // the service `enrolInLevel`, but only approval ever called it.
        '/admin/enrollments',
        '/admin/exam-grades',
        '/admin/level-subjects',
        // M4c — the Quran-side curriculum join (§4.5, §7, BR-11).
        '/admin/level-surahs',
        '/admin/content',
        '/admin/groups',
        '/admin/levels',
        // R56 — one node for everything on the calendar. `/admin/calendar` is
        // gone: the type is a field on the form, not a navigation decision.
        '/admin/schedules',
        // R55 — §14.1's single "Categories & Subjects" node became two, on the
        // Owner's instruction. One implementation still serves both.
        '/admin/categories',
        '/admin/subjects',
        '/admin/teaching-groups',
        // R88 correction — the teaching side of الشؤون التعليمية, on the Owner's
        // instruction. §14.1 lists التسجيلات (where the people being TAUGHT are
        // placed) but no node for the people DOING the teaching, so the teaching
        // profile lived as a row action on the generic account screen and was
        // offered for guardians, minors and administrators alike.
        // **Applied to §14.1 as Revision 89** (2026-08-19): the sitemap now
        // lists the node, so this expectation and the SRS agree because they
        // were both read, not because they were copied from each other.
        '/admin/teachers',
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

  it('R69: the configuration SCREENS are Super Admin — the data behind them is not', () => {
    // R26 says an Admin READS reference data because operational work depends
    // on it, and that is still true: `GET /admin/levels`, categories and
    // subjects all stay Admin-readable, which is what feeds the scheduling
    // form, the approval queue's placement dialog and the groups screen.
    //
    // What R69 moved is the SCREEN. Gating the data rather than the screen
    // would break an Admin's daily work — the distinction R61 drew for
    // `GET /admin/branches` and this test now records so it is not "tidied"
    // into agreement with the menu.
    for (const path of ['/admin/levels', '/admin/categories', '/admin/subjects', '/admin/level-subjects']) {
      const module = ADMIN_MODULES.find((m) => m.path === path)!;
      expect([...module.roles], path).toEqual(['super_admin']);
      expect(module.section, path).toBe('administration');
    }
  });

  it('R69: the OPERATIONAL screens stay open to an Admin', () => {
    // Subdivision is operational work: an Admin creates Administrative Groups
    // and places students, and places students into circles (R43.3 — a
    // circle's STRUCTURE is Super Admin, and that screen gates it internally).
    for (const path of ['/admin/groups', '/admin/teaching-groups']) {
      const module = ADMIN_MODULES.find((m) => m.path === path)!;
      expect(canAccess(module, ['admin']), path).toBe(true);
      expect(module.section, path).toBe('academic');
    }
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

/**
 * **The `الإدارة` section is Super Admin only, as a section** (SRS R61).
 *
 * Not four separate assertions about four modules: the rule is that *placement
 * in this section is what makes a node Super-Admin-only*, so the guard has to
 * hold for modules that do not exist yet.
 *
 * That distinction is the whole reason it exists. Three of the four nodes were
 * already `SUPER_ONLY` and `/admin/branches` was not — a divergence nothing
 * caught, because every module carried its own independent decision and no rule
 * connected them.
 */
describe('R61 — administration is Super Admin only by placement', () => {
  it('gives every node in the section Super-Admin-only roles', () => {
    const section = ADMIN_MODULES.filter((m) => m.section === 'administration');

    // A guard over an empty set proves nothing.
    expect(section.length).toBeGreaterThanOrEqual(4);
    for (const module of section) {
      expect([...module.roles], module.path).toEqual(['super_admin']);
    }
  });

  it('shows an Admin none of them', () => {
    const forAdmin = visibleModules(['admin']).map((m) => m.path);
    for (const module of ADMIN_MODULES.filter((m) => m.section === 'administration')) {
      expect(forAdmin, module.path).not.toContain(module.path);
    }
    // …including الفروع والقاعات, the node this revision moved.
    expect(forAdmin).not.toContain('/admin/branches');
  });

  it('still shows them all to a Super Admin', () => {
    const forSuper = visibleModules(['super_admin']).map((m) => m.path);
    expect(forSuper).toContain('/admin/branches');
    expect(forSuper).toContain('/admin/trash');
    expect(forSuper).toContain('/superadmin/settings');
  });

  it('leaves the Admin\'s operational sections untouched', () => {
    // R61 withdraws a screen, not an Admin's work. Groups, users, approvals and
    // scheduling all still belong to them — and all still read branches through
    // the selector feed the endpoint keeps serving (R61.2).
    const forAdmin = visibleModules(['admin']).map((m) => m.path);
    expect(forAdmin).toContain('/admin/groups');
    expect(forAdmin).toContain('/admin/users');
    expect(forAdmin).toContain('/admin/approvals');
  });
});


/**
 * Raw translation keys reaching the interface (2026-08-13).
 *
 * `t()` returns its argument when a key is missing, so a typo renders as
 * `admin.nav.schedules` on screen rather than failing anywhere. The grade
 * sheet's breadcrumb shipped exactly that.
 */
describe('every nav label a module declares actually exists', () => {
  it('resolves to Arabic, never to the key itself', () => {
    for (const module of ADMIN_MODULES) {
      expect(t(module.labelKey), module.labelKey).not.toBe(module.labelKey);
    }
  });
});

describe('نقاط الامتحانات sits at the end of الشؤون التعليمية', () => {
  it('is the last academic node', () => {
    const academic = ADMIN_MODULES.filter((m) => m.section === 'academic').map((m) => m.path);
    expect(academic[academic.length - 1]).toBe('/admin/exam-grades');
  });
});

/**
 * **The الإدارة order is a Document Owner decision, so it is pinned** (2026-08-17).
 *
 * §14.1 orders this section along the dependency chain (R69) — الفئات → المستويات
 * → المواد → مواد المستوى — and the Owner extended it with مقرر الحفظ, the Quran
 * syllabus layer that sits on top of the Level↔Subject pairing.
 *
 * It is asserted as a **sequence, not as a set of independent placements**,
 * because the defect it guards against is a reordering: `مقرر الحفظ` shipped
 * between المواد and مواد المستوى, so the menu read the curriculum out of order,
 * and nothing failed. A test over the whole prefix is what makes the order a
 * fact rather than an intention.
 */
describe('الإدارة is ordered along the curriculum dependency chain', () => {
  const CURRICULUM_ORDER = [
    '/admin/categories',
    '/admin/levels',
    '/admin/subjects',
    '/admin/level-subjects',
    '/admin/level-surahs',
  ] as const;

  it('lists the five curriculum nodes in exactly this sequence', () => {
    const administration = ADMIN_MODULES.filter((m) => m.section === 'administration').map(
      (m) => m.path,
    );
    expect(administration.slice(0, CURRICULUM_ORDER.length)).toEqual([...CURRICULUM_ORDER]);
  });

  it('places مواد المستوى before مقرر الحفظ', () => {
    // The specific inversion the Owner corrected, stated on its own so a failure
    // names the decision rather than a whole array.
    const paths = ADMIN_MODULES.map((m) => m.path);
    expect(paths.indexOf('/admin/level-subjects')).toBeLessThan(
      paths.indexOf('/admin/level-surahs'),
    );
  });
});
