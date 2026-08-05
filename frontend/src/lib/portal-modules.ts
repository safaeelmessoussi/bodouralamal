/**
 * The shared mechanics of a **portal navigation registry**.
 *
 * The platform is becoming four applications rather than one — Admin, Teacher,
 * Student/Parent and Public — and §14.1 gives each its own branch of the
 * sitemap. Each portal therefore owns its **own list of nodes**, and this module
 * owns the **behaviour** every such list needs: role gating, path resolution and
 * the status vocabulary.
 *
 * **Why separate registries rather than one list with a `portal` field.** A
 * single mixed list would make *"the back office is exactly §14.1's Academic,
 * People, Calendar, Content and Administration groups"* a property you have to
 * filter for rather than one you can read, and every consumer would carry the
 * same filter. The lists differ in kind, not merely in rows: the back office is
 * grouped into §14.1's five sections, while the teacher portal is a short flat
 * list of workflow entries. Separate lists, one set of helpers.
 *
 * **What is NOT here:** the section vocabulary. Sections are §14.1's grouping of
 * the *back office*; a teacher portal has none, and hoisting an admin-shaped
 * concept into the shared layer is how a "generic" abstraction quietly becomes
 * the first caller's shape.
 */

export type ModuleStatus =
  /**
   * Endpoints exist **and the screen is implemented**.
   *
   * Both halves matter. Modules have carried `ready` with no screen, so the
   * navigation promised a working section and the page then said *"this section
   * is being prepared"* — two different answers to one question.
   */
  | 'ready'
  /** §14.1 lists the node; the screen or its endpoints do not exist yet. */
  | 'blocked';

/** Everything a navigable node needs, whichever portal it belongs to. */
export interface PortalModule {
  /** Path exactly as §14.1 writes it. */
  path: string;
  /** i18n key for the navigation label. */
  labelKey: string;
  /** Roles that may see and open it (TD-2). Order is irrelevant. */
  roles: readonly string[];
  status: ModuleStatus;
  /**
   * For a blocked module: what is missing, as an i18n key. Shown on the page so
   * the reader learns the reason rather than meeting an apology.
   */
  blockedReasonKey?: string;
}

/** Whether the session holds any of the roles a module requires (TD-2). */
export function canAccess(module: PortalModule, roles: readonly string[]): boolean {
  return module.roles.some((role) => roles.includes(role));
}

/** The modules of one portal a given session may see, in the list's own order. */
export function visibleIn<T extends PortalModule>(
  modules: readonly T[],
  roles: readonly string[],
): T[] {
  return modules.filter((module) => canAccess(module, roles));
}

/**
 * Resolves a pathname within one portal's list.
 *
 * **Longest match wins**, so `/admin/groups` resolves to the groups module
 * rather than to the dashboard at `/admin`. Sub-paths resolve to their parent —
 * `/admin/groups/{id}/roster` is still the groups module — which is what lets a
 * module own its internal views without registering each one as a navigation
 * node §14.1 does not list.
 */
export function resolveModule<T extends PortalModule>(
  modules: readonly T[],
  pathname: string,
): T | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  let best: T | null = null;
  for (const module of modules) {
    if (path === module.path || path.startsWith(`${module.path}/`)) {
      if (!best || module.path.length > best.path.length) best = module;
    }
  }
  return best;
}
