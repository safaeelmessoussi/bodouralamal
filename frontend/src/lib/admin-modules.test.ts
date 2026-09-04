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
        /**
         * **R124 added `/admin/assessments`**, and it is recorded here for the
         * same reason its neighbours are: the online assessment builder is the
         * half `exam.mode = 'online'` declared in R58 and refused until now.
         * It sits beside «نقاط الامتحانات» because they are two halves of one
         * thing — this writes the paper, that one marks it.
         */
        '/admin/assessments',
        '/admin/exam-grades',
        '/admin/level-subjects',
        // M4c — the Quran-side curriculum join (§4.5, §7, BR-11).
        '/admin/level-surahs',
        /**
         * **Recorded, like `/admin/level-surahs` before it: `/admin/quran` is
         * not in §14.1** (2026-08-20).
         *
         * The CAPABILITY is normative and long-standing — TD-2 as qualified by
         * R73 grants an Admin their branches' beneficiaries and a Super Admin
         * everyone, and `POST /quran-logs` has enforced exactly that since M4a.
         * What §14.1 never gained was a **node**, so the back office could not
         * reach a write it was already authorised for: rule P.
         *
         * Adding the node is therefore not a new permission and not a new
         * requirement, which is why it ships without an SRS revision. **The gap
         * is reported to the Document Owner rather than papered over**, and
         * §20 rule 16 is respected in the direction that matters: nothing here
         * invents a section or reshuffles one.
         */
        '/admin/quran',
        '/admin/content',
        '/admin/groups',
        '/admin/levels',
        // R56 — one node for everything on the calendar. `/admin/calendar` is
        // gone: the type is a field on the form, not a navigation decision.
        '/admin/schedules',
        /**
         * **R110 (NEW H) — أنواع الجدولة is not in §14.1 either**, and is
         * recorded here for the same reason `/admin/quran` and
         * `/admin/level-surahs` are.
         *
         * The CAPABILITY is the Owner's: *«if the platform presents
         * business/reference data to users, there must be a management path»*
         * (addendum, 2026-08-26), and OD-03 makes `attendance_required` a stored
         * column precisely so the form can read it. The five types were a
         * hardcoded frontend constant with no screen at all.
         */
        '/admin/scheduling-types',
        /**
         * **R122 added `/admin/academic-periods`**, and it is recorded here for
         * the same reason: the seed creates **no** periods, so without a screen
         * the required `academic_period_id` would have made approval refuse
         * every applicant with nothing an administrator could do about it.
         */
        '/admin/academic-periods',
        // الشركاء — §14.1 lists it in الإدارة (Revision 113).
        '/admin/partners',
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
        // R132 — طلبات الحساب المستقل, an ACCOUNT decision beside المستخدمون.
        '/admin/self-managed-claims',
        // Owner 2026-09-04 — طلبات استعادة حساب, beside it and not merged into
        // it: reopening a CLOSED account is a heavier decision than
        // transitioning a live one.
        '/admin/account-return-requests',
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
    //
    // **Restated for R105, not weakened.** The property was written as
    // `section === 'academic'`, and R105 deleted that section — but the section
    // was never the point: what matters is that these screens are OUTSIDE
    // الإدارة, because placement there is what makes a node Super-Admin-only
    // (R61). `section: null` says exactly that, and now says it for eleven
    // nodes instead of six.
    for (const path of ['/admin/groups', '/admin/teaching-groups']) {
      const module = ADMIN_MODULES.find((m) => m.path === path)!;
      expect(canAccess(module, ['admin']), path).toBe(true);
      expect(module.section, path).toBeNull();
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
    // R61 withdraws a screen, not an Admin's work. Groups, approvals and
    // scheduling all still belong to them — and all still read branches through
    // the selector feed the endpoint keeps serving (R61.2).
    const forAdmin = visibleModules(['admin']).map((m) => m.path);
    expect(forAdmin).toContain('/admin/groups');
    expect(forAdmin).toContain('/admin/approvals');
    /**
     * **`/admin/users` was here and is deliberately not** (Owner clarification,
     * 2026-08-28).
     *
     * The Owner separated *managing operational data* from *administering
     * accounts*. المستخدمون is the second: every person on the platform, their
     * address, their status, their roles, and the power to delete the account.
     * An Admin who needs to pick a person uses `/admin/directory`, which is a
     * different endpoint with a smaller projection — so this removes a screen,
     * not a capability.
     */
    expect(forAdmin).not.toContain('/admin/users');
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

/**
 * **The whole menu order is a Document Owner decision now** (§4, Revision 105).
 *
 * This replaces `'نقاط الامتحانات sits at the end of الشؤون التعليمية'`, which
 * pinned that node as the last `academic` entry. R105 deleted the section and
 * gave the Owner's own sequence instead, in which نقاط الامتحانات is ninth of
 * eleven and الجدولة and مكتبة المحتوى follow it. **The old assertion was
 * superseded by a later decision on the same question — it did not stop
 * describing a property, so it is restated at full width rather than dropped.**
 *
 * Pinned as a **literal sequence** because the defect is a reshuffle, which no
 * set-comparison can see: §14.1 says "no reshuffling", and the only way a
 * generated menu can honour that is if reordering the registry fails a test.
 */
describe('§14.1 renders exactly the order the Document Owner specified (R105)', () => {
  /** The main list, top to bottom, exactly as §4 states it. */
  const MAIN_NAV_ORDER = [
    '/admin', // لوحة التحكم
    '/admin/approvals', // طلبات الانضمام
    '/admin/users', // المستخدمون
    // R132 — immediately after المستخدمون, because it is the same authority
    // acting on the same thing: who may hold a login for which record.
    '/admin/self-managed-claims', // طلبات الحساب المستقل
    '/admin/account-return-requests', // طلبات استعادة حساب (Owner, 2026-09-04)
    '/admin/teachers', // المؤطِّرات
    '/admin/enrollments', // المستفيدات
    '/admin/groups', // مجموعات المستويات
    '/admin/teaching-groups', // حلقات المواد
    '/admin/quran', // إدخال الحفظ
    '/admin/assessments', // بناء الاختبارات (R124)
    '/admin/exam-grades', // نقاط الامتحانات
    '/admin/schedules', // الجدولة
    '/admin/content', // مكتبة المحتوى
  ] as const;

  /**
   * الإدارة, top to bottom — the dependency chain, then the standalone nodes.
   *
   * **R110 (NEW H) added `/admin/scheduling-types` and R122 added
   * `/admin/academic-periods`; this guard is RESTATED each time rather than
   * relaxed.** R105 fixed the sequence and OD-01 says the menu is
   * not rearranged silently, so the assertion still pins an exact order — it
   * pins the order that now includes a node the Owner asked for. The new entry
   * sits after the reference-data chain and before the platform nodes, because
   * that is what it is: a catalogue.
   */
  const ADMINISTRATION_ORDER = [
    '/admin/categories', // الفئات
    '/admin/levels', // المستويات
    '/admin/subjects', // المواد
    '/admin/level-subjects', // مواد المستوى
    '/admin/level-surahs', // مقرر الحفظ
    '/admin/branches', // الفروع والقاعات
    '/admin/scheduling-types', // أنواع الجدولة (R110)
    '/admin/academic-periods', // الفصول الدراسية (R122)
    /**
     * الشركاء (NEW N) — beside the other catalogue it belongs with, and **before**
     * the platform-operations tail (سلة المحذوفات · التقويم الهجري · الإعدادات).
     * That is this section's own stated logic — the dependency chain, then the
     * standalone nodes — and it is where R110 put أنواع الجدولة for the same
     * reason, so R105's sequence is extended rather than reinterpreted.
     */
    '/admin/partners', // الشركاء (NEW N)
    '/admin/trash', // سلة المحذوفات
    '/superadmin/hijri-calendar', // التقويم الهجري
    '/superadmin/settings', // إعدادات المنصة
  ] as const;

  it('lists the main navigation in the Owner\'s exact sequence', () => {
    const main = ADMIN_MODULES.filter((m) => m.section === null).map((m) => m.path);
    expect(main).toEqual([...MAIN_NAV_ORDER]);
  });

  it('lists الإدارة in the Owner\'s exact sequence', () => {
    const administration = ADMIN_MODULES.filter((m) => m.section === 'administration').map(
      (m) => m.path,
    );
    expect(administration).toEqual([...ADMINISTRATION_ORDER]);
  });

  it('puts الإدارة last, so the section heading is never stranded mid-menu', () => {
    // The sidebar renders the ungrouped list and THEN the sections, so a node
    // that lost its `section` would silently jump above the heading.
    const paths = ADMIN_MODULES.map((m) => m.path);
    expect(paths).toEqual([...MAIN_NAV_ORDER, ...ADMINISTRATION_ORDER]);
  });

  it('has exactly one section, and it is the one that gates', () => {
    // R105's rule: a heading exists only where it states a fact about
    // permission. `academic`, `people`, `scheduling` and `content` gated
    // nothing, and one of the two `Administration` headings held a single node.
    expect([...ADMIN_SECTIONS]).toEqual(['administration']);
    // Compared as a set: `[null, 'administration'].sort()` is not what it
    // looks like, because the default comparator stringifies and `'null'`
    // sorts after `'administration'`.
    const sections = new Set(ADMIN_MODULES.map((m) => m.section));
    expect(sections).toEqual(new Set([null, 'administration']));
  });

  it('gives the dashboard the same order as the sidebar, minus itself', async () => {
    // The launcher and the menu are ONE list by construction (§4). This is the
    // assertion that would have caught the `section !== null` filter R105
    // invalidated — under it a Super Admin saw nine cards and an Admin saw none.
    const { dashboardCards } = await import('../pages/admin/index.js');
    expect(dashboardCards(['super_admin']).map((m) => m.path)).toEqual(
      [...MAIN_NAV_ORDER, ...ADMINISTRATION_ORDER].filter((p) => p !== '/admin'),
    );
    /**
     * **R105's ORDER is unchanged; the Admin's membership is** (Owner,
     * 2026-08-28). المستخدمون keeps its third position for a Super Admin — the
     * Owner fixed that order and this clarification did not revisit it — while
     * an Admin no longer sees the entry at all, because account administration
     * is not operational work.
     */
    expect(dashboardCards(['admin']).map((m) => m.path)).toEqual(
      [...MAIN_NAV_ORDER].filter(
        (p) =>
          p !== '/admin' &&
          p !== '/admin/users' &&
          // R132 — Super-Admin-only for the same reason المستخدمون is: deciding
          // who may hold a login is account administration, not operational work.
          p !== '/admin/self-managed-claims' &&
          // Same reason: reopening a closed account is account administration.
          p !== '/admin/account-return-requests',
      ),
    );
  });
});

/**
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
