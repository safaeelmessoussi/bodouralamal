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
  //
  // **Ordered general → specific, along the dependency chain** (R43's own
  // model): a Category contains Levels, a Level offers Subjects, a Level is
  // divided into Administrative Groups, and a Subject within a Level is
  // divided into Teaching Groups. Reading the menu top to bottom is reading
  // that hierarchy, so a person meets a concept only after the one it hangs
  // off. Nothing about authorization changes — the order is presentation.
  //
  // **The last two rungs are parameterised screens, not menu nodes.** Assigning
  // a Subject to a Level and managing its Teaching Groups live at
  // `/admin/levels/{id}/subjects/{subjectId}`, which cannot be linked without
  // an id; §14.1 lists them under Levels for exactly that reason, and the
  // Levels table's subject count is the way in (§20 rule 16 — no invented
  // navigation).
  {
    // R55: الفئات and المواد are two navigation nodes. They were one screen with
    // two tables; the Owner separated the navigation, and the **implementation
    // stays single** — `taxonomy.tsx` takes the entity as a parameter, so the
    // two cannot drift apart the way duplicated CRUD always has here.
    path: '/admin/categories',
    labelKey: 'admin.nav.categories',
    section: 'academic',
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
    path: '/admin/subjects',
    labelKey: 'admin.nav.subjects',
    section: 'academic',
    roles: STAFF,
    status: 'ready',
  },
  {
    path: '/admin/groups',
    labelKey: 'admin.nav.groups',
    section: 'academic',
    roles: STAFF,
    status: 'ready',
  },
  {
    // **R56 — one node for everything that appears on the calendar.** R51 put
    // Events and Course Schedules in one section; this makes them one screen,
    // with the type as a field on the form rather than a navigation decision.
    // The MODELS are unchanged (§4.4, §20 rule 22) — only what a person is
    // asked, and when.
    path: '/admin/schedules',
    labelKey: 'admin.nav.scheduling',
    section: 'scheduling',
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


  // ── Content ───────────────────────────────────────────────────────────────
  {
    path: '/admin/content',
    labelKey: 'admin.nav.content',
    section: 'content',
    roles: STAFF,
    status: 'ready',
  },

  // ── Administration ────────────────────────────────────────────────────────
  //
  // **Super Admin only, as a SECTION** (R61). Every node here carries
  // `SUPER_ONLY`, and `admin-modules.test.ts` asserts it — written as four
  // independent decisions, the fifth module added here would inherit nothing and
  // the divergence would return silently, which is precisely how
  // `/admin/branches` came to be the odd one out.
  {
    /**
     * R61 — was `STAFF`, because Revision 26 let an Admin *read* this screen.
     *
     * **The endpoint is unchanged.** `GET /admin/branches` stays Admin-readable,
     * branch-scoped, because `use-scope-options.ts` feeds `/admin/groups`,
     * `/admin/schedules`, `/admin/content` and every scope selector from it —
     * withdrawing it would leave a branch Admin unable to create a group or
     * schedule a class, with empty selectors and no error saying why (R61.2).
     *
     * What changes is who may *manage* branches and rooms, and who sees the
     * node. Writes were already Super Admin only.
     */
    path: '/admin/branches',
    labelKey: 'admin.nav.branches',
    section: 'administration',
    roles: SUPER_ONLY,
    status: 'ready',
  },
  {
    // §7/BR-15 (R52) — Super Admin only: the list spans every entity regardless
    // of branch, which no other surface allows.
    path: '/admin/trash',
    labelKey: 'admin.nav.trash',
    section: 'administration',
    roles: SUPER_ONLY,
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
