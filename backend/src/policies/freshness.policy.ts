import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { narrowToRole, rolesOf, toRoleScopes, type RoleScope } from './branch-scope.js';

/**
 * High-risk endpoint freshness (SRS TD-12).
 *
 * "Statelessness ends where safeguarding begins": an unexpired access token is
 * **not** sufficient authorization for the operations TD-12 lists. Each must
 * assert **against the database, per request**, that the caller is still
 * `Active` and that the invoked role assignment still exists.
 *
 * The point is immediacy. A Teacher or Admin suspended mid-session must lose
 * access to minors' case files, private recordings, and approval powers **at
 * once** — not whenever their ≤1-hour token happens to expire. The stateless
 * window is acceptable for reading one's own schedule; it is not acceptable here.
 *
 * TD-12's list, and where each lands:
 *   presigned GET minting (M6) · `StudentSocialProfile` reads (M2) ·
 *   **approval actions (`/admin/approvals/*`) — this milestone** ·
 *   consent-gate overrides (M6) · staff-assisted consent recording (M2) ·
 *   pass/fail overrides (M5) · user-management mutations (M2)
 *
 * One indexed read on a low-frequency endpoint, so TD-11a targets are unaffected.
 */

export interface FreshActor {
  userId: string;
  /** Narrowed to the active role when there is one (R60). */
  roles: string[];
  roleScopes: RoleScope[];
  activeRole?: string;
}

/**
 * Re-reads the caller from the database and rebuilds their roles and scopes from
 * live rows, ignoring whatever the token claimed.
 *
 * Returning the freshly-loaded roles rather than a boolean is deliberate: a
 * caller that kept using the token's `roles[]` after this check would have
 * verified freshness and then acted on stale authority, which defeats the point.
 */
export async function assertFreshActive(
  prisma: PrismaClient,
  userId: string,
  requiredRoles: readonly string[],
  /**
   * **R60 — the role the caller is working as**, or `undefined` for an
   * un-narrowed session.
   *
   * This parameter is why R60 is not a half-measure. Without it, this function —
   * which deliberately rebuilds from live rows and **ignores the token** —
   * would hand back the caller's FULL authority on exactly the endpoints TD-12
   * protects, while every other endpoint narrowed. The most dangerous surfaces
   * would have been the only ones where switching to مؤطِّرة changed nothing.
   */
  activeRole?: string,
): Promise<FreshActor> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, accountStatus: true },
  });

  // A suspended, rejected or soft-deleted caller is refused here even while
  // holding a perfectly valid token (§4.1b step 4a's condition, applied live).
  if (!user || user.accountStatus !== 'active') {
    throw new AppError('FORBIDDEN', 'account is not active (TD-12 freshness check)');
  }

  const assignments = await prisma.userBranchRole.findMany({
    where: { userId, deletedAt: null },
    include: { role: true },
  });
  const liveScopes = toRoleScopes(assignments);
  const liveRoles = rolesOf(liveScopes);

  // **R60 — the active role must still be assigned**, checked against the same
  // live rows. A role revoked mid-session stops working here on the very next
  // request, which is the whole point of freshness applied to the role actually
  // being exercised rather than to any role the account happens to retain.
  if (activeRole !== undefined && !liveRoles.includes(activeRole)) {
    throw new AppError('FORBIDDEN', 'the active role is no longer assigned', {
      reason: 'ACTIVE_ROLE_REVOKED',
      active_role: activeRole,
    });
  }

  // Narrowed BEFORE the requirement check, so acting as مؤطِّرة fails a
  // Super-Admin-only endpoint even though the account still holds Super Admin.
  // Checking first and narrowing after would let the account's other roles
  // satisfy a requirement the active role does not — the exact hole R60 closes.
  const roleScopes =
    activeRole === undefined ? liveScopes : narrowToRole(liveScopes, activeRole) ?? [];
  const roles = rolesOf(roleScopes);

  // TD-12 requires the invoked role/scope assignment to still EXIST, not merely
  // to have existed when the token was minted — a revoked role takes effect now.
  if (!requiredRoles.some((required) => roles.includes(required))) {
    throw new AppError('FORBIDDEN', 'required role assignment no longer exists');
  }

  return {
    userId: user.id,
    roles,
    roleScopes,
    ...(activeRole !== undefined ? { activeRole } : {}),
  };
}
