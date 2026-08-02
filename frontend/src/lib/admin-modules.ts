/**
 * The administrative module registry — **the single source for the back-office
 * navigation, its routing and its role gating.**
 *
 * §14.1's sitemap is authoritative: *"AI agents must implement exactly this
 * navigation hierarchy — no invented sections, no reshuffling."* Holding it as
 * data rather than as JSX in three places is what makes that checkable: the
 * sidebar, the router and the role guard all read this list, so a module cannot
 * appear in the menu without a route, or be reachable without its permission.
 *
 * Adding a module is **one entry here**. Forgetting one of the three wirings is
 * no longer possible.
 *
 * **`status` is not decoration.** A module whose endpoints do not exist yet
 * renders an explicit, named "not built" state instead of a blank screen — §14.4
 * forbids the blank page, and naming *what* is missing is what stops the same
 * investigation being repeated. It is also the honest signal to the Document
 * Owner about where the back office actually stands.
 */
export type ModuleStatus =
  /**
   * Endpoints exist **and the screen is implemented**.
   *
   * Both halves matter. Three modules carried `ready` while no screen existed,
   * so the sidebar promised a working section and the page then said *"this
   * section is being prepared"* — two different answers to one question. The
   * test beside this file now asserts that every `ready` module has a route,
   * so the registry cannot make a promise the router does not keep.
   */
  | 'ready'
  /** §14.1 lists the node; the screen or its endpoints do not exist yet. */
  | 'blocked';

export interface AdminModule {
  /** Path exactly as §14.1 writes it. */
  path: string;
  /** i18n key for the sidebar label. */
  labelKey: string;
  /** §14.1's grouping. `null` sits above the groups, like the dashboard. */
  section: AdminSection | null;
  /** Roles that may see and open it (TD-2). Order is irrelevant. */
  roles: readonly string[];
  status: ModuleStatus;
  /**
   * For a blocked module: what is missing, as an i18n key. Shown on the page so
   * the reader learns the reason rather than meeting an apology.
   */
  blockedReasonKey?: string;
}

export type AdminSection = 'academic' | 'people' | 'calendar' | 'content' | 'administration';

/** §14.1's group order, which the sidebar renders in exactly this sequence. */
export const ADMIN_SECTIONS: readonly AdminSection[] = [
  'academic',
  'people',
  'calendar',
  'content',
  'administration',
];

const STAFF = ['admin', 'super_admin'] as const;
const SUPER_ONLY = ['super_admin'] as const;

/**
 * Every back-office node §14.1 defines, in its order.
 *
 * Reference-data modules list **both** roles because §14.1 marks them
 * *"read: Admin · write: Super Admin"* (Revision 26) — an Admin may open them.
 * The write controls inside are gated separately, and the server enforces the
 * matrix regardless: the URL prefix is never the permission boundary.
 */
export const ADMIN_MODULES: readonly AdminModule[] = [
  {
    path: '/admin',
    labelKey: 'admin.nav.dashboard',
    section: null,
    roles: STAFF,
    status: 'ready',
  },

  // ── Academic ──────────────────────────────────────────────────────────────
  {
    path: '/admin/groups',
    labelKey: 'admin.nav.groups',
    section: 'academic',
    roles: STAFF,
    status: 'blocked',
    blockedReasonKey: 'admin.blocked.groups',
  },
  {
    path: '/admin/levels',
    labelKey: 'admin.nav.levels',
    section: 'academic',
    roles: STAFF,
    status: 'blocked',
    blockedReasonKey: 'admin.blocked.levels',
  },
  {
    path: '/admin/taxonomy',
    labelKey: 'admin.nav.taxonomy',
    section: 'academic',
    roles: STAFF,
    status: 'blocked',
    blockedReasonKey: 'admin.blocked.taxonomy',
  },

  // ── People ────────────────────────────────────────────────────────────────
  {
    path: '/admin/users',
    labelKey: 'admin.nav.users',
    section: 'people',
    roles: STAFF,
    status: 'blocked',
    blockedReasonKey: 'admin.blocked.users',
  },
  {
    path: '/admin/approvals',
    labelKey: 'admin.nav.approvals',
    section: 'people',
    roles: STAFF,
    status: 'ready',
  },

  // ── Calendar ──────────────────────────────────────────────────────────────
  {
    path: '/admin/calendar',
    labelKey: 'admin.nav.calendar',
    section: 'calendar',
    roles: STAFF,
    status: 'blocked',
    blockedReasonKey: 'admin.blocked.calendar',
  },

  // ── Content ───────────────────────────────────────────────────────────────
  {
    path: '/admin/content',
    labelKey: 'admin.nav.content',
    section: 'content',
    roles: STAFF,
    status: 'blocked',
    blockedReasonKey: 'admin.blocked.content',
  },

  // ── Administration ────────────────────────────────────────────────────────
  {
    path: '/admin/branches',
    labelKey: 'admin.nav.branches',
    section: 'administration',
    roles: STAFF,
    status: 'ready',
  },
  {
    path: '/superadmin/hijri-calendar',
    labelKey: 'admin.nav.hijri',
    section: 'administration',
    roles: SUPER_ONLY,
    status: 'ready',
  },
  {
    path: '/superadmin/settings',
    labelKey: 'admin.nav.settings',
    section: 'administration',
    roles: SUPER_ONLY,
    // Revision 42 — first iteration carries `legal.consent_text_version`,
    // without which no registration can be accepted at all.
    status: 'ready',
  },
];

/** Whether the session holds any of the roles a module requires (TD-2). */
export function canAccess(module: AdminModule, roles: readonly string[]): boolean {
  return module.roles.some((role) => roles.includes(role));
}

/** The modules a given session may see, in §14.1's order. */
export function visibleModules(roles: readonly string[]): AdminModule[] {
  return ADMIN_MODULES.filter((module) => canAccess(module, roles));
}

/**
 * Resolves a pathname to its module.
 *
 * **Longest match wins**, so `/admin/groups` resolves to the groups module
 * rather than to the dashboard at `/admin`. Sub-paths resolve to their parent —
 * `/admin/groups/{id}/roster` is still the groups module — which is what lets a
 * module own its own internal views without registering each one as a
 * navigation node §14.1 does not list.
 */
export function moduleForPath(pathname: string): AdminModule | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  let best: AdminModule | null = null;
  for (const module of ADMIN_MODULES) {
    if (path === module.path || path.startsWith(`${module.path}/`)) {
      if (!best || module.path.length > best.path.length) best = module;
    }
  }
  return best;
}

/** Whether a path belongs to the back office at all. */
export function isAdminPath(pathname: string): boolean {
  return moduleForPath(pathname) !== null;
}
