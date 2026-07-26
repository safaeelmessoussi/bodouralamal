import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';

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
  roles: string[];
  branchScopes: string[];
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
  const roles = [...new Set(assignments.map((a) => a.role.name))];

  // TD-12 requires the invoked role/scope assignment to still EXIST, not merely
  // to have existed when the token was minted — a revoked role takes effect now.
  if (!requiredRoles.some((required) => roles.includes(required))) {
    throw new AppError('FORBIDDEN', 'required role assignment no longer exists');
  }

  return {
    userId: user.id,
    roles,
    branchScopes: [...new Set(assignments.flatMap((a) => (a.branchId ? [a.branchId] : [])))],
  };
}
