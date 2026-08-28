import type { Prisma } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import * as users from '../repositories/user.repository.js';

/**
 * Locks and validates every person a staffing mutation is about to name.
 *
 * A User foreign key proves only that the row exists. It does not stop a stale
 * form from assigning a suspended, rejected, soft-deleted or permanently
 * de-identified account. More subtly, validation without the User locks leaves
 * a check/write race with R111 account deletion: staffing and deletion can both
 * pass against the old state, then commit a deleted person as the owner of a
 * future obligation.
 *
 * The locks are global and deterministic by UUID. Account deletion takes the
 * same lock before checking responsibilities. Therefore exactly one operation
 * wins: either staffing commits first and deletion reports what must be
 * reassigned, or deletion commits first and staffing refuses the unavailable
 * account.
 *
 * No Role-name condition belongs here. R71 explicitly allows a staffed person
 * to carry responsibilities without holding the `teacher` Role; staffing is a
 * position, while a Role is a separate capability grant.
 */
export async function assertStaffAccountsAvailable(
  tx: Prisma.TransactionClient,
  userIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(userIds)].sort();
  if (ids.length === 0) return;

  for (const id of ids) {
    if (!(await users.lockUser(tx, id))) {
      throw new AppError('STATE_CONFLICT', 'a staff account is unavailable', {
        reason: 'STAFF_ACCOUNT_UNAVAILABLE',
      });
    }
  }

  const available = await tx.user.findMany({
    where: { id: { in: ids }, deletedAt: null, accountStatus: 'active' },
    select: { id: true },
  });
  if (available.length !== ids.length) {
    throw new AppError('STATE_CONFLICT', 'a staff account is unavailable', {
      reason: 'STAFF_ACCOUNT_UNAVAILABLE',
    });
  }
}
