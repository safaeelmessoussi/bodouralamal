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
   * **A capability this module additionally requires** (R87 §M).
   *
   * Roles say *what kind of person you are*; this says *what you actually do*.
   * «إدخال الحفظ» is the first case: a مؤطرة who teaches only Tafseer holds the
   * teacher role and must not see it. `undefined` — the ordinary case — means
   * the roles alone decide.
   *
   * **It hides a menu entry; it authorises nothing.** The server refuses a
   * Quran write from somebody with no Quran assignment whatever the menu shows
   * (rule O), which is what keeps this a UX rule rather than a permission.
   */
  requiresCapability?: 'teachesQuran';
  /**
   * **This module's subject is the ACTING person, not the account holder**
   * (R96.1, §4.3).
   *
   * The beneficiary portal is read by two kinds of caller: the مستفيدة herself,
   * and a **guardian acting for a linked child**. Every page in it already
   * resolves its subject through the active-child mechanism and sends
   * `X-Active-Child-ID`, so what it renders is *the acting student's* record —
   * hers when she reads it, her child's when a guardian does.
   *
   * **This admits a guardian; it does not give her a student role**, and it
   * broadens nothing for anybody else. The authority is the approved
   * `FamilyLink` the server verifies on every request (§4.3); a `parent` who
   * has selected no child, or who forges an unrelated id, is refused there —
   * exactly as before, because none of that changed.
   *
   * **Required on beneficiary modules rather than optional**, so a new one
   * cannot be added without answering *whose record does this show*. A module
   * that reads the account holder must say `false` and stay closed to a
   * guardian — otherwise it would quietly show her **her own** data while a
   * banner named her child, which is the failure this flag exists to prevent.
   */
  childContext?: boolean;
  /**
   * For a blocked module: what is missing, as an i18n key. Shown on the page so
   * the reader learns the reason rather than meeting an apology.
   */
  blockedReasonKey?: string;
}

/**
 * Whether the session may open this module (TD-2).
 *
 * Two ways in, and the second is not a widening of the first:
 *
 * 1. the session holds one of the module's roles; or
 * 2. the module's subject is the acting person and the session **is actively
 *    acting for a linked child** — a guardian, who holds no student role and
 *    gains none.
 *
 * `actingForChild` defaults to `false`, so every existing caller keeps exactly
 * today's behaviour and nothing is broadened by omission.
 */
export function canAccess(
  module: PortalModule,
  roles: readonly string[],
  context: { actingForChild?: boolean } = {},
): boolean {
  if (module.roles.some((role) => roles.includes(role))) return true;
  /**
   * **The guardian arm names the role it depends on**, rather than trusting
   * every caller to have computed `actingForChild` correctly. A predicate that
   * is only safe because one call site is careful is a predicate that becomes
   * unsafe at the second call site — the lesson rule AE records.
   */
  return (
    module.childContext === true &&
    context.actingForChild === true &&
    roles.includes('parent')
  );
}

/** The modules of one portal a given session may see, in the list's own order. */
export function visibleIn<T extends PortalModule>(
  modules: readonly T[],
  roles: readonly string[],
  /**
   * What this person actually DOES, as the server computed it (R87 §M).
   *
   * Omitted, every capability-gated module is hidden — the safe direction: a
   * caller that has not asked the server sees less rather than a menu entry the
   * server would then refuse.
   */
  capabilities: { teachesQuran?: boolean; actingForChild?: boolean } = {},
): T[] {
  return modules.filter((module) => {
    if (!canAccess(module, roles, capabilities)) return false;
    if (module.requiresCapability === 'teachesQuran') return capabilities.teachesQuran === true;
    return true;
  });
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
