import type { PrismaClient } from '../generated/prisma/client.js';
import { narrowToRole, toRoleScopes } from '../policies/branch-scope.js';
import type { Actor } from '../policies/actor.js';

/**
 * The `Actor` a real session would carry for this user — **read from the
 * database, never fabricated**.
 *
 * R60 moved six services from a bare `actorUserId: string` to the whole
 * `Actor`, because the active role must reach `assertFreshActive` and the audit
 * row. The first version of this helper invented `{ role, branches: null }`
 * instead of querying, and that quietly broke every branch-scoping test: an
 * Admin the fixture had scoped to Marrakesh arrived as an Admin of **all**
 * branches, so *"an Admin outside the student's branch is refused"* stopped
 * being refused.
 *
 * Reading the rows and folding them with `toRoleScopes` is what the login and
 * refresh paths do, so a test actor and a real one differ in nothing.
 */
export async function actorFor(prisma: PrismaClient, userId: string): Promise<Actor> {
  const assignments = await prisma.userBranchRole.findMany({
    where: { userId, deletedAt: null },
    include: { role: true },
  });
  const roleScopes = toRoleScopes(assignments);
  return { userId, roles: roleScopes.map((s) => s.role), roleScopes };
}

/**
 * The same account **working as one role** (R60), narrowed exactly as
 * `issueAccessToken` narrows it — so a service under test sees precisely what a
 * switched session sends, including that role's own branches.
 */
export async function actingAs(
  prisma: PrismaClient,
  userId: string,
  role: string,
): Promise<Actor> {
  const full = await actorFor(prisma, userId);
  const narrowed = narrowToRole(full.roleScopes, role);
  return {
    userId,
    roles: narrowed ? [role] : [],
    roleScopes: narrowed ?? [],
    activeRole: role,
  };
}
