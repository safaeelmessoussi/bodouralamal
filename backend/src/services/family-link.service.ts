import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import type { Actor } from '../policies/actor.js';
import { assertFreshActive } from '../policies/freshness.policy.js';
import * as audit from '../repositories/audit.repository.js';
import * as trash from '../repositories/trash.repository.js';
import { notifySubjectUserChange } from './notification.service.js';

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

/** TD-2: creating and revoking links are Admin or Super Admin actions. */
const REVOKER_ROLES = ['admin', 'super_admin'] as const;
const LINKER_ROLES = REVOKER_ROLES;

/**
 * Links an EXISTING child to a parent — staff-mediated (§4.3, Revision 23).
 *
 * The MVP gives parents no search over existing children, so this is not a
 * parent-facing route: both parties are identified from the §14.2 User Management
 * screen, where staff are already authorized to browse users. That is exactly why
 * accepting raw ids here raises no enumeration concern, while a parent-facing
 * version of the same endpoint would have.
 *
 * The link is created `Pending` **even though staff created it** (§4.3 retains
 * that rule without exception) and is decided in the §5.6 approval queue — which
 * is also what keeps that queue's standalone family-link item type reachable.
 *
 * Parent self-service remains registering a NEW child through §4.1b, unchanged.
 */
export async function createLink(
  prisma: PrismaClient,
  /**
   * R60 — the full caller, not a bare id. The **active role** has to reach
   * `assertFreshActive` (which rebuilds from live rows and would otherwise hand
   * back this account's full authority) and the audit row (§60.8). Threading the
   * `Actor` rather than a second `activeRole` parameter keeps the two from
   * drifting apart, which is why the id alone is no longer enough.
   */
  caller: Actor,
  parentId: string,
  studentId: string,
): Promise<{ id: string; status: string }> {
  const actor = await assertFreshActive(prisma, caller.userId, LINKER_ROLES, caller.activeRole);

  if (parentId === studentId) {
    throw new AppError('VALIDATION_FAILED', 'a user cannot be their own parent');
  }

  return prisma.$transaction(async (tx) => {
    // Both parties must exist and not be soft-deleted. Statuses are deliberately
    // NOT constrained to Active: the §4.1 registration flow itself creates a
    // Pending parent, a Pending child and a Pending link together, so demanding
    // Active here would contradict TD-4.1.
    const [parent, student] = await Promise.all([
      tx.user.findFirst({ where: { id: parentId, deletedAt: null }, select: { id: true } }),
      tx.user.findFirst({ where: { id: studentId, deletedAt: null }, select: { id: true } }),
    ]);
    if (!parent || !student) {
      // One 404 for either missing party: staff can already see who exists via
      // §14.2, so there is nothing to disclose, but there is also no reason to
      // report which half of the pair was wrong through this channel.
      throw new AppError('NOT_FOUND', 'parent or student not found');
    }

    // TD-6's partial unique index covers non-deleted rows only, so a previously
    // revoked link does not block a fresh request — but a live one does.
    const existing = await tx.familyLink.findFirst({
      where: { parentId, studentId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (existing) {
      // DUPLICATE, not FAMILY_LINK_PENDING: TD-3.8 restricts that code to
      // own-resource contexts, and this caller is staff acting on someone else's
      // relationship (§4.3 Revision 23).
      throw new AppError('DUPLICATE', 'a live link already exists for this pair');
    }

    const link = await tx.familyLink.create({
      data: { parentId, studentId, status: 'pending' },
      select: { id: true, status: true },
    });

    // TD-8's grid is a minimum and explicitly permits added coverage. A staff
    // member creating a route into a minor's record must be attributable.
    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'familylink.create',
      targetEntity: 'FamilyLink',
      targetId: link.id,
      detail: { parent_id: parentId, student_id: studentId, created_by: 'staff' },
    });
    await notifySubjectUserChange(tx, {
      type: 'family_link_requested',
      subjectUserId: studentId,
      recipientUserIds: [parentId],
      actorUserId: actor.userId,
    });

    return link;
  });
}

/**
 * Soft-deletes an approved link (§4.3 Revision 16).
 *
 * Runs the TD-12 freshness assertion: severing a parent's access to a child's
 * record is a user-management mutation on the safeguarding boundary, so an admin
 * suspended mid-session must not be able to perform it on a still-valid token.
 * One indexed read on a low-frequency endpoint (TD-11a unaffected).
 */
/**
 * **A terminal rejection may be removed, and the audit proves it happened**
 * (Owner decision, 2026-09-02).
 *
 * A `rejected` FamilyLink grants no authority over any child and is not a Trash
 * item: it records a decision that was taken and then went nowhere. Until now
 * no transition removed it, so it stayed live forever for want of a verb rather
 * than for a reason — the state the lifecycle audit flagged as class C with no
 * retention horizon.
 *
 * ## What survives, and what does not
 *
 * The **operational row** is destroyed: it is not history, it is a request that
 * was refused, and the platform keeps no queue of refusals. The **audit trail
 * is untouched and gains one row**, so *who asked, who refused, and who later
 * removed the record* is reconstructable from `AuditLog` alone — §7's
 * attribution invariant, which is precisely why the row itself need not be kept.
 *
 * ## Only a terminal rejection
 *
 * `pending` is a live decision somebody still owes an answer to, and `approved`
 * is authority — that one is revoked (soft, with a Trash snapshot), never
 * removed. Both are refused here by name rather than silently ignored.
 *
 * ## Authorization
 *
 * The same fresh-role check the revoke path takes (TD-12), and the same roles:
 * removing the evidence-bearing operational row is an administrative act about
 * a child's relationships, not a tidy-up.
 */
export async function purgeRejectedLink(
  prisma: PrismaClient,
  caller: Actor,
  linkId: string,
): Promise<{ parentId: string; studentId: string }> {
  const actor = await assertFreshActive(prisma, caller.userId, REVOKER_ROLES, caller.activeRole);

  return prisma.$transaction(async (tx) => {
    const link = await tx.familyLink.findFirst({
      // **`deletedAt: null`, like every read of a soft-deletable model.** A
      // withdrawn link is already absent from every surface; destroying one is
      // the Trash path's business, not this verb's, and the coverage guard is
      // right to insist the constraint is written rather than assumed.
      where: { id: linkId, deletedAt: null },
      select: {
        id: true,
        parentId: true,
        studentId: true,
        status: true,
        decidedAt: true,
        decidedById: true,
        createdAt: true,
      },
    });
    // §20 rule 17 — a link the caller may not reach and one that is gone answer
    // alike.
    if (!link) throw new AppError('NOT_FOUND', 'no such family link');
    if (link.status !== 'rejected') {
      throw new AppError('STATE_CONFLICT', 'only a rejected link may be removed (§4.3)', {
        reason: 'NOT_TERMINAL_REJECTED',
      });
    }

    /**
     * **The audit row is written BEFORE the delete**, inside the same
     * transaction, and carries the whole decision. `AuditLog.target_id` is not a
     * foreign key, so the record survives the row it describes — which is the
     * property that makes removing the operational row acceptable at all.
     */
    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'familylink.purge_rejected',
      targetEntity: 'FamilyLink',
      targetId: link.id,
      detail: {
        parent_id: link.parentId,
        student_id: link.studentId,
        rejected_at: link.decidedAt,
        rejected_by: link.decidedById,
        requested_at: link.createdAt,
      },
    });

    await tx.familyLink.delete({ where: { id: link.id } });

    return { parentId: link.parentId, studentId: link.studentId };
  });
}

export async function revokeLink(
  prisma: PrismaClient,
  caller: Actor,
  linkId: string,
  reason: string,
): Promise<{ parentId: string; studentId: string }> {
  const actor = await assertFreshActive(prisma, caller.userId, REVOKER_ROLES, caller.activeRole);

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
    await trash.snapshot(tx, {
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
    });
    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'familylink.revoke',
      targetEntity: 'FamilyLink',
      targetId: link.id,
      // TD-8: link parties, actor, reason. The actor is `actor_user_id`; §7's
      // attribution invariant requires who/when/why to be reconstructable from
      // the audit row alone, without reading the (now soft-deleted) link.
      detail: { parent_id: link.parentId, student_id: link.studentId, reason },
    });
    await notifySubjectUserChange(tx, {
      type: 'family_link_revoked',
      subjectUserId: link.studentId,
      recipientUserIds: [link.parentId],
      actorUserId: actor.userId,
    });

    return { parentId: link.parentId, studentId: link.studentId };
  });
}
