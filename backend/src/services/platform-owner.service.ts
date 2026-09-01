import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { assertFreshActive } from '../policies/freshness.policy.js';
import type { Actor } from '../policies/actor.js';
import * as audit from '../repositories/audit.repository.js';
import * as owners from '../repositories/platform-owner.repository.js';
import * as users from '../repositories/user.repository.js';
import { notifySubjectUserChange } from './notification.service.js';

const OWNER_ADMIN_ROLES = ['super_admin'] as const;

/**
 * Locks the singleton before a lifecycle mutation and refuses the current
 * owner. Callers then take User and (if needed) Role locks in that order.
 */
export async function lockAndAssertNotPlatformOwner(
  tx: Prisma.TransactionClient,
  targetUserId: string,
): Promise<owners.PlatformOwnerRow | null> {
  const owner = await owners.lockPlatformOwner(tx);
  if (owner?.ownerUserId === targetUserId) {
    throw new AppError(
      'STATE_CONFLICT',
      'Platform Owner status must be transferred before this account can change lifecycle',
      { reason: 'PLATFORM_OWNER_PROTECTED' },
    );
  }
  return owner;
}

/**
 * Locks the singleton before a role-set replacement and preserves the one role
 * the current Owner must always hold. Ownership protects the global Super Admin
 * assignment, not every unrelated operational role on the account.
 */
export async function lockAndAssertOwnerRoleInvariant(
  tx: Prisma.TransactionClient,
  targetUserId: string,
  assignments: readonly { role: string; branchId: string | null }[],
): Promise<owners.PlatformOwnerRow | null> {
  const owner = await owners.lockPlatformOwner(tx);
  if (
    owner?.ownerUserId === targetUserId &&
    !assignments.some(
      (assignment) => assignment.role === 'super_admin' && assignment.branchId === null,
    )
  ) {
    throw new AppError(
      'STATE_CONFLICT',
      'Platform Owner must retain the globally scoped Super Admin role',
      { reason: 'PLATFORM_OWNER_GLOBAL_SUPER_ADMIN_REQUIRED' },
    );
  }
  return owner;
}

export interface PlatformOwnerTransferResult {
  ownerUserId: string;
  previousOwnerUserId: string;
  version: number;
}

/**
 * Transfers the singleton relationship. The current owner alone may perform
 * this action; the target must already be an Active, undeleted, globally scoped
 * Super Admin. No role is created or removed here.
 */
export async function transferPlatformOwnership(
  prisma: PrismaClient,
  caller: Actor,
  targetUserId: string,
): Promise<PlatformOwnerTransferResult> {
  const actor = await assertFreshActive(
    prisma,
    caller.userId,
    OWNER_ADMIN_ROLES,
    caller.activeRole,
  );

  return prisma.$transaction(async (tx) => {
    const current = await owners.lockPlatformOwner(tx);
    if (!current) {
      throw new AppError('STATE_CONFLICT', 'Platform Owner has not been bootstrapped', {
        reason: 'PLATFORM_OWNER_NOT_INITIALIZED',
      });
    }
    if (current.ownerUserId !== actor.userId) {
      throw new AppError('FORBIDDEN', 'only the current Platform Owner may transfer ownership');
    }
    if (targetUserId === current.ownerUserId) {
      throw new AppError('STATE_CONFLICT', 'ownership is already assigned to this account', {
        reason: 'PLATFORM_OWNER_TRANSFER_TO_SELF',
      });
    }

    // Deterministic global order: PlatformOwner -> Users by id. The current
    // owner and target are both stable while eligibility is checked and the
    // singleton is rewritten.
    for (const userId of [current.ownerUserId, targetUserId].sort()) {
      if (!(await users.lockUser(tx, userId))) {
        throw new AppError('NOT_FOUND', 'target account not found');
      }
    }

    const target = await tx.user.findFirst({
      where: {
        id: targetUserId,
        accountStatus: 'active',
        deletedAt: null,
        branchRoles: {
          some: {
            branchId: null,
            userStatus: 'active',
            deletedAt: null,
            role: { name: 'super_admin' },
          },
        },
      },
      select: { id: true },
    });
    if (!target) {
      throw new AppError(
        'STATE_CONFLICT',
        'target must be an active, undeleted Global Super Admin',
        { reason: 'PLATFORM_OWNER_TARGET_INELIGIBLE' },
      );
    }

    const updated = await tx.platformOwner.update({
      where: { singletonKey: owners.PLATFORM_OWNER_KEY },
      data: { ownerUserId: target.id, version: { increment: 1 } },
      select: { ownerUserId: true, version: true },
    });

    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'platform_owner.transfer',
      targetEntity: 'PlatformOwner',
      targetId: updated.ownerUserId,
      detail: {
        previous_owner_user_id: current.ownerUserId,
        new_owner_user_id: updated.ownerUserId,
      },
    });
    await notifySubjectUserChange(tx, {
      type: 'platform_ownership_received',
      subjectUserId: updated.ownerUserId,
      recipientUserIds: [updated.ownerUserId],
      actorUserId: actor.userId,
    });

    return {
      ownerUserId: updated.ownerUserId,
      previousOwnerUserId: current.ownerUserId,
      version: updated.version,
    };
  });
}
