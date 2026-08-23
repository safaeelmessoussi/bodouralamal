import type { Prisma, User } from '../generated/prisma/client.js';

import { rolesOf, toRoleScopes, type RoleScope } from '../policies/branch-scope.js';
import type { Db } from './audit.repository.js';

/**
 * User and identity lookups for the §4.1b login flow (§16.2 — the sole
 * data-access layer for these tables).
 */

export interface ResolvedAccount {
  user: User;
  roles: string[];
  roleScopes: RoleScope[];
}

/**
 * Serializes user-wide authentication state transitions.
 *
 * A refresh-session row can serialize one browser session, but it cannot stop
 * a new session anchor from being inserted after revoke-all has enumerated the
 * existing anchors. The stable User row is therefore the governing lock for
 * successful login/session creation, identity/role credential decisions and
 * user-wide revocation. Callers that also need session locks take this first.
 *
 * `FOR NO KEY UPDATE` is deliberate. Every protected application mutation
 * changes non-key account state; User.id is immutable. This mode still
 * conflicts with itself, `FOR UPDATE`, UPDATE and DELETE, so those governing
 * operations serialize exactly as before. It is compatible with the implicit
 * `KEY SHARE` PostgreSQL takes while refresh/logout insert child FK rows after
 * locking a RefreshSession. A stronger `FOR UPDATE` creates the cycle
 * Session -> implicit User KEY SHARE vs User -> Session.
 */
export async function lockUser(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "user"
    WHERE "id" = ${userId}::uuid
    FOR NO KEY UPDATE`;
  return rows.length === 1;
}

async function loadRoles(db: Db, userId: string): Promise<Omit<ResolvedAccount, 'user'>> {
  const assignments = await db.userBranchRole.findMany({
    where: { userId, deletedAt: null },
    include: { role: true },
  });
  // §4.2 Revision 24: one entry per role, with `branches: null` meaning ALL
  // branches. Never a flat union across roles.
  const roleScopes = toRoleScopes(assignments);
  return { roles: rolesOf(roleScopes), roleScopes };
}

/** Authoritative account and role rows used while finalizing a refresh. The
 * caller supplies the session-locked transaction, so access-token claims are
 * derived before that session can be revoked by a racing logout. */
export async function findAccountById(db: Db, userId: string): Promise<ResolvedAccount | null> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return null;
  return { user, ...(await loadRoles(db, user.id)) };
}

/**
 * §4.1b step 3.1 — the provider identity. **Every login after the first takes
 * this path**, which is why it is consulted first.
 *
 * **Deactivated identities are still returned**, flagged rather than hidden. A
 * User soft-delete deactivates them (TD-5), and hiding them would make the
 * account invisible to the whole resolution order — the caller would fall
 * through to onboarding and invite the person to **silently re-register**,
 * which §4.1 forbids in as many words. Deactivation must mean "this identity
 * can no longer open a session", not "this person is a stranger again".
 */
export async function findByProviderIdentity(
  db: Db,
  provider: 'google',
  providerSubjectId: string,
): Promise<(ResolvedAccount & { identityActive: boolean }) | null> {
  const identity = await db.userIdentity.findUnique({
    where: { provider_providerSubjectId: { provider, providerSubjectId } },
    include: { user: true },
  });
  if (!identity) return null;
  return {
    user: identity.user,
    identityActive: identity.isActive,
    ...(await loadRoles(db, identity.userId)),
  };
}

/**
 * §4.1b step 3.2 — the pre-provisioned fallback. **Not filtered by
 * `deleted_at`** (§7, Revision 20): the lookup's job is to FIND the account,
 * and refusing it is step 4a's job. Filtering here would hide a soft-deleted
 * person from the whole resolution order and send them to the registration
 * form, which §4.1 forbids.
 *
 * `UserIdentity` is never consulted here, because an unbound account has no
 * identity row at all. The caller must pass an already-lowercased email (TD-12).
 */
export async function findByPreProvisionedEmail(
  db: Db,
  email: string,
): Promise<ResolvedAccount | null> {
  const user = await db.user.findFirst({
    where: { preProvisionedEmail: email },
  });
  if (!user) return null;
  return { user, ...(await loadRoles(db, user.id)) };
}

/** §4.1b step 4b — creates the COMPLETED binding. Placeholder identity rows are
 *  prohibited (§7), so this is the only place a `UserIdentity` is born on login. */
export async function bindIdentity(
  db: Db,
  params: { userId: string; provider: 'google'; providerSubjectId: string; email: string },
): Promise<void> {
  await db.userIdentity.create({
    data: {
      userId: params.userId,
      provider: params.provider,
      providerSubjectId: params.providerSubjectId,
      email: params.email,
    },
  });
}
