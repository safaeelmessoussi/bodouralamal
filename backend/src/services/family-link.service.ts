import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { assertFreshActive } from '../policies/freshness.policy.js';
import * as audit from '../repositories/audit.repository.js';

/**
 * FamilyLink lifecycle beyond approval (SRS §4.3, Revision 16).
 *
 * **Revocation is a soft-delete, and that is the whole mechanism.** TD-1 keeps
 * `Approved` terminal — there is no `Approved → Revoked` transition and none may
 * be added — because enforcement already exists: the `X-Active-Child-ID`
 * middleware re-checks the row on every request, and a soft-deleted link is
 * already one of its `404` conditions. Revocation therefore takes effect on the
 * very next request, which is exactly what TD-12 promises.
 *
 * The TD-6 partial unique index on `(student_id, parent_id)` covers non-deleted
 * rows only, so a revoked link can be requested again later as a fresh `Pending`
 * record rather than colliding with the revoked one.
 */

/** TD-2: revoking a link is an Admin or Super Admin action. */
const REVOKER_ROLES = ['admin', 'super_admin'] as const;

/**
 * Soft-deletes an approved link (§4.3 Revision 16).
 *
 * Runs the TD-12 freshness assertion: severing a parent's access to a child's
 * record is a user-management mutation on the safeguarding boundary, so an admin
 * suspended mid-session must not be able to perform it on a still-valid token.
 * One indexed read on a low-frequency endpoint (TD-11a unaffected).
 */
export async function revokeLink(
  prisma: PrismaClient,
  actorUserId: string,
  linkId: string,
  reason: string,
): Promise<{ parentId: string; studentId: string }> {
  const actor = await assertFreshActive(prisma, actorUserId, REVOKER_ROLES);

  if (!reason.trim()) {
    // TD-8 requires the reason on `familylink.revoke`: cutting a parent off from
    // their child's record without recording why is not an auditable decision.
    throw new AppError('VALIDATION_FAILED', 'a reason is required to revoke a family link (§4.3)');
  }

  return prisma.$transaction(async (tx) => {
    const link = await tx.familyLink.findFirst({
      where: { id: linkId, deletedAt: null },
      include: { parent: true, student: true },
    });

    if (!link) {
      // Already revoked, or never existed. Both are NOT_FOUND: an admin acting
      // on a stale queue row learns nothing it should not know.
      throw new AppError('NOT_FOUND', 'no such family link');
    }
    if (link.status !== 'approved') {
      // A pending or rejected link is decided through the approval queue, not
      // revoked — routing it here would produce a decision with no decider.
      throw new AppError('STATE_CONFLICT', 'only an approved link can be revoked (§4.3)');
    }

    // TD-4.8: soft delete + Trash snapshot + audit, all in one transaction.
    await tx.familyLink.update({
      where: { id: link.id },
      data: { deletedAt: new Date(), deletedById: actor.userId },
    });
    await tx.trash.create({
      data: {
        targetEntity: 'FamilyLink',
        targetId: link.id,
        snapshot: JSON.parse(
          JSON.stringify({
            id: link.id,
            parentId: link.parentId,
            studentId: link.studentId,
            status: link.status,
            decidedAt: link.decidedAt,
            decidedById: link.decidedById,
            createdAt: link.createdAt,
          }),
        ) as object,
        deletedById: actor.userId,
        // BR-15: the 90-day permanent-delete window.
        purgeAfter: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      },
    });
    await audit.write(tx, {
      actorUserId: actor.userId,
      actionType: 'familylink.revoke',
      targetEntity: 'FamilyLink',
      targetId: link.id,
      // TD-8: link parties, actor, reason. The actor is `actor_user_id`; §7's
      // attribution invariant requires who/when/why to be reconstructable from
      // the audit row alone, without reading the (now soft-deleted) link.
      detail: { parent_id: link.parentId, student_id: link.studentId, reason },
    });

    return { parentId: link.parentId, studentId: link.studentId };
  });
}
