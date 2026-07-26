import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError, uniqueViolationFields } from '../lib/errors.js';
import { assertFreshActive } from '../policies/freshness.policy.js';
import * as audit from '../repositories/audit.repository.js';

/**
 * Staff pre-provisioning (SRS §3.1, §4.1b step 4b, §5.6 `/admin/users`, §7 R15).
 *
 * Under Google-only authentication there is no password to issue, so staff
 * "create an account" by recording the beneficiary's details together with the
 * **Google address authorized to claim it**. Nothing is bound yet: the account
 * has no `UserIdentity` at all, because §7 prohibits placeholder identity rows —
 * a half-populated identity would break the "has an identity ⇒ has
 * authenticated" predicate that the whole §4.1b login routing rests on.
 *
 * The binding happens on that address's first successful Google login (§4.1b
 * step 4b, TD-4.10), which is already implemented in the auth flow. This service
 * is the other half: creating the claimable account.
 *
 * `pre_provisioned_email` is stored lowercase (TD-12, with a database `CHECK`
 * backstop) and is unique among non-null values via a TD-6 partial unique index,
 * so one address can never be made claimable twice.
 */

/** TD-2 (§14.2 row "Create/edit users; assign roles & branch scopes"). */
const USER_ADMIN_ROLES = ['admin', 'super_admin'] as const;

/**
 * Roles staff may assign here. `super_admin` is deliberately absent: §15.1
 * bootstraps it and Revision 22 makes the database authoritative for
 * administrators thereafter, so it is never handed out through this endpoint.
 */
export type AssignableRole = 'admin' | 'teacher' | 'student' | 'parent';

export interface PreProvisionInput {
  nameArabic: string;
  email: string;
  /** Optional: TD-2 grants creating users and assigning roles to the same actors. */
  role?: AssignableRole;
  /** Branch scope for the assignment; omitted means unscoped. */
  branchId?: string;
  /**
   * §4.1b step 4b: a pre-provisioned account routes by its own status on first
   * login — "typically `Pending` → status screen, or `Active` if staff
   * pre-approved". Default is `Pending`, matching §4.1's rule for new accounts.
   */
  preApproved?: boolean;
}

export async function preProvision(
  prisma: PrismaClient,
  actorUserId: string,
  input: PreProvisionInput,
): Promise<{ id: string; accountStatus: string; preProvisionedEmail: string | null }> {
  // TD-12: user-management mutations are a high-risk surface, so the caller's
  // status and role are re-read from live rows rather than trusted from a token.
  const actor = await assertFreshActive(prisma, actorUserId, USER_ADMIN_ROLES);

  const email = input.email.trim().toLowerCase();
  const nameArabic = input.nameArabic.trim();
  if (!nameArabic) throw new AppError('VALIDATION_FAILED', 'name_arabic is required');

  if (input.role === 'admin' && !actor.roles.includes('super_admin')) {
    // An Admin creating another Admin is privilege propagation. TD-2 grants
    // "create/edit users" to both, but §2.1 makes Super Admin the unscoped
    // authority, so widening the administrator set stays with Super Admin.
    throw new AppError('FORBIDDEN', 'only a Super Admin may create another Admin');
  }

  return prisma.$transaction(async (tx) => {
    // Branch scope must exist and be live: an assignment pointing at a deleted
    // branch would be a scope that silently matches nothing.
    if (input.branchId) {
      const branch = await tx.branch.findFirst({
        where: { id: input.branchId, deletedAt: null },
        select: { id: true },
      });
      if (!branch) throw new AppError('NOT_FOUND', 'branch not found');
    }

    let user;
    try {
      user = await tx.user.create({
        data: {
          nameArabic,
          preProvisionedEmail: email,
          accountStatus: input.preApproved ? 'active' : 'pending',
        },
        select: { id: true, accountStatus: true, preProvisionedEmail: true },
      });
    } catch (error) {
      // The TD-6 partial unique index covers non-null values across ALL users,
      // deleted ones included, so this also catches an address that belonged to
      // a soft-deleted account — which must not be silently reclaimed (§4.1).
      if (uniqueViolationFields(error).some((f) => f.includes('pre_provisioned_email'))) {
        throw new AppError('DUPLICATE', 'that email is already authorized to claim an account');
      }
      throw error;
    }

    if (input.role) {
      const roleRow = await tx.role.findUnique({ where: { name: input.role } });
      if (!roleRow) throw new AppError('VALIDATION_FAILED', `unknown role ${input.role}`);
      await tx.userBranchRole.create({
        data: {
          userId: user.id,
          roleId: roleRow.id,
          branchId: input.branchId ?? null,
        },
      });
    }

    // TD-8's grid is a minimum and permits added coverage. Creating an account
    // that a named Google address may claim must be attributable to its creator.
    await audit.write(tx, {
      actorUserId: actor.userId,
      actionType: 'user.create',
      targetEntity: 'User',
      targetId: user.id,
      detail: {
        pre_provisioned_email: email,
        role: input.role ?? null,
        branch_id: input.branchId ?? null,
        account_status: user.accountStatus,
      },
    });

    return user;
  });
}
