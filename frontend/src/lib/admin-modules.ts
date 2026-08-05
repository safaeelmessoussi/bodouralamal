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
import {
  canAccess as canAccessModule,
  resolveModule,
  visibleIn,
  type ModuleStatus,
  type PortalModule,
} from './portal-modules.js';

/**
 * A back-office node: a portal module plus §14.1's grouping.
 *
 * `section` is the one thing that is genuinely admin-shaped — §14.1 groups the
 * back office and gives the teacher portal no equivalent — so it lives here
 * rather than in the shared layer.
 */
export interface AdminModule extends PortalModule {
  /** §14.1's grouping. `null` sits above the groups, like the dashboard. */
  section: AdminSection | null;
}

export type { ModuleStatus };

/** §14.1's groups. `scheduling` replaced `calendar` in Revision 51: an
 *  administrator groups Events and Sessions by *things that are scheduled*,
 *  which is the question they are asking, rather than by which model they are. */
export type AdminSection = 'academic' | 'people' | 'scheduling' | 'content' | 'administration';

/** §14.1's group order, which the sidebar renders in exactly this sequence. */
export const ADMIN_SECTIONS: readonly AdminSection[] = [
  'academic',
  'people',
  'scheduling',
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
    status: 'ready',
  },
  {
    // §14.1 Academic → "Course Schedules ... /admin/schedules (staff, R43)".
    // The node was missing from this registry while §14.1 listed it, so the
    // sitemap the registry claims to hold as data was not the sitemap it held.
    path: '/admin/schedules',
    labelKey: 'admin.nav.schedules',
    // R51 — with Events, under Scheduling. The MODELS are unchanged (§4.4,
    // §20 r22); only where a person looks for them.
    section: 'scheduling',
    roles: STAFF,
    status: 'ready',
  },
  {
    path: '/admin/levels',
    labelKey: 'admin.nav.levels',
    section: 'academic',
    roles: STAFF,
    status: 'ready',
  },
  {
    path: '/admin/taxonomy',
    labelKey: 'admin.nav.taxonomy',
    section: 'academic',
    roles: STAFF,
    status: 'ready',
  },

  // ── People ────────────────────────────────────────────────────────────────
  {
    path: '/admin/users',
    labelKey: 'admin.nav.users',
    section: 'people',
    roles: STAFF,
    status: 'ready',
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
    section: 'scheduling',
    roles: STAFF,
    status: 'ready',
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
export const canAccess = canAccessModule;

/** The back-office modules a given session may see, in §14.1's order. */
export function visibleModules(roles: readonly string[]): AdminModule[] {
  return visibleIn(ADMIN_MODULES, roles);
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
  return resolveModule(ADMIN_MODULES, pathname);
}

/** Whether a path belongs to the back office at all. */
export function isAdminPath(pathname: string): boolean {
  return moduleForPath(pathname) !== null;
}
