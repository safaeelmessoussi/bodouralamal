/**
 * Branch-scoped authorization (SRS §4.2, Revision 24).
 *
 * Branch scoping is the **sole** authorization axis. A user may hold the same
 * role several times, each assignment scoped independently, and
 * `UserBranchRole` is unique on `(user_id, role_id, branch_id)`.
 *
 * Two rules here are load-bearing, and both exist because their absence was a
 * real defect rather than a hypothetical one:
 *
 *   1. **`branches: null` means ALL branches** for that assignment (`branch_id
 *      IS NULL` in the database). It is *not* a Super Admin marker: Super
 *      Admin's bypass follows from its role. Treating null as "no scope" made an
 *      all-branches Admin able to see zero branches.
 *
 *   2. **Scope resolves per role, never as a flat union across roles.** A
 *      capability granted by a role is limited to the branches on *that role's*
 *      assignments. A flat union let a Teacher-in-Casablanca who was also
 *      Admin-in-Marrakesh administer Casablanca.
 *
 * Level-scoped and category-scoped assignments are prohibited (§4.2), teachers
 * derive teaching reach exclusively from `GroupTeacher`, and functional
 * responsibilities (Tajweed, literacy curriculum, Events) are capabilities
 * rather than scopes — so nothing below needs a scope type beyond the branch.
 */

/** One role a user holds, with the branches that assignment reaches. */
import { AppError } from '../lib/errors.js';

export interface RoleScope {
  role: string;
  /** `null` = all branches (§4.2 Revision 24). */
  branches: string[] | null;
}

/** Super Admin is unscoped by role, not by a null branch (§2.1, §4.2). */
export const SUPER_ADMIN = 'super_admin';

/** Collapses rows from `UserBranchRole` into one entry per role. */
export function toRoleScopes(
  assignments: { branchId: string | null; role: { name: string } }[],
): RoleScope[] {
  const byRole = new Map<string, { all: boolean; branches: Set<string> }>();
  for (const a of assignments) {
    const entry = byRole.get(a.role.name) ?? { all: false, branches: new Set<string>() };
    if (a.branchId === null) {
      // An all-branches grant dominates any specific grant of the same role:
      // holding both must not narrow the wider one.
      entry.all = true;
    } else {
      entry.branches.add(a.branchId);
    }
    byRole.set(a.role.name, entry);
  }
  return [...byRole.entries()].map(([role, e]) => ({
    role,
    branches: e.all ? null : [...e.branches],
  }));
}

/**
 * **The Active Role narrowing** (SRS Revision 60).
 *
 * Returns the caller's scopes reduced to the single role they are working as —
 * or `null` when they do not hold it at all, which the caller must treat as a
 * refusal rather than as "no restrictions".
 *
 * ## Why narrowing happens here and not at each decision
 *
 * Every authorization decision in the platform reads `RoleScope[]`: 103
 * references across 28 files, through the helpers below. Narrowing the array
 * once, at the point the token is minted, makes all of them correct with no
 * edits — and, more importantly, makes the wrong thing **unreachable**: a
 * service cannot consult an un-narrowed array because none exists in that
 * request.
 *
 * ## The entry keeps its own branches, and that is what preserves §4.2
 *
 * *"Scope resolves per role, never as a flat union"* is unchanged; the array
 * simply has one entry. A مؤطِّرة scoped to Marrakesh stays scoped to Marrakesh,
 * because her own assignment travels with her.
 *
 * ## What disappears, deliberately
 *
 * `isSuperAdmin` returns false for a narrowed non-admin array, so
 * `branchesForRole`'s Super Admin short-circuit stops applying. **That is the
 * mechanism by which Super Admin authority actually goes away** — not a special
 * case anywhere, just an absent entry.
 */
export function narrowToRole(
  scopes: readonly RoleScope[],
  role: string,
): RoleScope[] | null {
  const entry = scopes.find((s) => s.role === role);
  return entry ? [entry] : null;
}

/** The role names a user holds; `roles[]` is derived so it cannot disagree. */
export function rolesOf(scopes: readonly RoleScope[]): string[] {
  return [...new Set(scopes.map((s) => s.role))];
}

export function hasRole(scopes: readonly RoleScope[], role: string): boolean {
  return scopes.some((s) => s.role === role);
}

export function isSuperAdmin(scopes: readonly RoleScope[]): boolean {
  return hasRole(scopes, SUPER_ADMIN);
}

/**
 * The branches a specific role reaches: `null` means all.
 *
 * Returns `[]` — reaching nothing — when the role is not held at all, so a
 * caller cannot accidentally read "no restrictions" out of a missing role.
 */
export function branchesForRole(scopes: readonly RoleScope[], role: string): string[] | null {
  if (isSuperAdmin(scopes)) return null;
  const entry = scopes.find((s) => s.role === role);
  if (!entry) return [];
  return entry.branches;
}

/**
 * Whether `role` authorizes acting on `branchId`.
 *
 * Deliberately takes the role: asking "is this branch in scope" without naming
 * the capability's role is the flat-union mistake this module exists to prevent.
 */
export function canActOnBranch(
  scopes: readonly RoleScope[],
  role: string,
  branchId: string,
): boolean {
  const branches = branchesForRole(scopes, role);
  return branches === null || branches.includes(branchId);
}

/**
 * The assertion form of `canActOnBranch`, for callers that refuse rather than
 * branch on the answer.
 *
 * **The refusal is `NOT_FOUND`, never `FORBIDDEN`** (§20 rule 17): a `403`
 * confirms that the branch exists, which is an existence leak to someone with
 * no business knowing. Two services had written this check out identically —
 * the kind of duplication where one copy quietly becoming a `403` would be a
 * security regression that still passed every test the other copy had.
 */
export function assertCanActOnBranch(
  scopes: readonly RoleScope[],
  role: string,
  branchId: string,
  /**
   * What the caller was looking for. It varies by surface on purpose: on the
   * roster the caller named a *group*, and answering "branch out of scope"
   * would leak that the group's branch exists. The security decision is shared;
   * only the noun changes.
   */
  notFoundMessage = 'branch out of scope',
): void {
  if (isSuperAdmin(scopes)) return;
  if (!canActOnBranch(scopes, role, branchId)) {
    throw new AppError('NOT_FOUND', notFoundMessage);
  }
}

/**
 * The branch ids the given roles reach, or `null` for unrestricted.
 *
 * Callers apply this to **their own** branch column, which matters: the
 * `Branch` model keys it as `id` while every other model keys it as
 * `branch_id`. Reusing a Branch-shaped filter on `Group` once silently filtered
 * `group.id IN (branchIds)` and matched nothing — a caught defect, and the
 * reason this returns ids rather than a ready-made fragment.
 */
export function reachableBranches(
  scopes: readonly RoleScope[],
  roles: readonly string[],
): string[] | null {
  if (isSuperAdmin(scopes)) return null;
  const reachable = new Set<string>();
  for (const role of roles) {
    const branches = branchesForRole(scopes, role);
    if (branches === null) return null;
    for (const b of branches) reachable.add(b);
  }
  return [...reachable];
}

/**
 * A Prisma `where` fragment limiting **`Branch`** rows — keyed on `id`, so it is
 * for the Branch model only. Other models use `reachableBranches` against their
 * own `branchId`. `{}` means unrestricted.
 */
export function branchFilter(
  scopes: readonly RoleScope[],
  roles: readonly string[],
): Record<string, unknown> {
  const reachable = reachableBranches(scopes, roles);
  return reachable === null ? {} : { id: { in: reachable } };
}
