import type { User } from '../generated/prisma/client.js';

import type { Db } from './audit.repository.js';

/**
 * User and identity lookups for the §4.1b login flow (§16.2 — the sole
 * data-access layer for these tables).
 */

export interface ResolvedAccount {
  user: User;
  roles: string[];
  branchScopes: string[];
}

async function loadRoles(db: Db, userId: string): Promise<Omit<ResolvedAccount, 'user'>> {
  const assignments = await db.userBranchRole.findMany({
    where: { userId, deletedAt: null },
    include: { role: true },
  });
  return {
    roles: [...new Set(assignments.map((a) => a.role.name))],
    // A null branch means unscoped (Super Admin, §2.1) and contributes no scope.
    branchScopes: [...new Set(assignments.flatMap((a) => (a.branchId ? [a.branchId] : [])))],
  };
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
