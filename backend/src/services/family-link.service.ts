import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
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
 * **Records a decision on a pending link — and a rejection leaves no live row**
 * (Owner decision, 2026-09-03).
 *
 * ## Why a rejection soft-deletes
 *
 * A `rejected` link granted no authority and was never soft-deleted, so it
 * stayed **live** — and the TD-6 partial unique index on
 * `(student_id, parent_id) WHERE deleted_at IS NULL` therefore made it a
 * permanent block: the same adult could never make a corrected request for the
 * same child. A **revoked** link, which is the stronger outcome, freed the pair
 * immediately because revocation soft-deletes. The weaker outcome was the more
 * permanent one, which is the inversion this fixes.
 *
 * The two outcomes now have **one shape**: a decided, recorded, soft-deleted row
 * that grants nothing and blocks nothing. The decision and its reason survive in
 * the row itself, in the Trash snapshot and in the audit trail; only the *live*
 * pair is released.
 *
 * ## What this deliberately is NOT
 *
 * * **Not a `rejected → pending` reopen.** The decision stands. A corrected
 *   request is a **new** row with its own history, so the old refusal is never
 *   overwritten or reused.
 * * **Not a weakening of authorization.** A rejected link never granted
 *   anything, and a soft-deleted one is already a `404` condition for the
 *   `X-Active-Child-ID` middleware — so it is refused twice over.
 * * **Not a second deletion lifecycle.** The row enters Trash exactly as a
 *   revoked one does, under BR-15's seven days, and `PURGEABLE` already carries
 *   `FamilyLink`.
 *
 * ## Why it lives here and not at the call sites
 *
 * Two paths decide a link — the registration bundle and the standalone queue
 * item — and both previously wrote the same four-field update inline. A rule
 * stated twice drifts, and this one now has a **destructive** half that §20 rule
 * 11 requires to write Trash and AuditLog every time. One implementation, so a
 * future third caller inherits the evidence rather than having to remember it.
 *
 * Runs inside the caller's transaction: the decision, the tombstone, the
 * snapshot and the audit row are one atomic fact (TD-4.8).
 */
export async function decideLink(
  tx: Prisma.TransactionClient,
  link: { id: string; parentId: string; studentId: string; createdAt: Date },
  opts: { approve: boolean; actor: Actor; reason?: string | undefined },
): Promise<void> {
  const { approve, actor, reason } = opts;
  const now = new Date();

  await tx.familyLink.update({
    where: { id: link.id },
    data: {
      status: approve ? 'approved' : 'rejected',
      decidedAt: now,
      decidedById: actor.userId,
      ...(reason ? { decisionReason: reason } : {}),
      // The rejection's own tombstone, stamped with the SAME instant as the
      // decision: the two are one act, and a restore identifies the rows a
      // deletion removed by comparing tombstones (the R59 defect).
      ...(approve ? {} : { deletedAt: now, deletedById: actor.userId }),
    },
  });

  if (!approve) {
    // TD-5/BR-15: a soft delete without a snapshot is a row nobody can find and
    // nobody can restore. The snapshot carries the decision itself, because that
    // is the half a future reader needs — the pair alone says nothing about why.
    await trash.snapshot(tx, {
      targetEntity: 'FamilyLink',
      targetId: link.id,
      snapshot: JSON.parse(
        JSON.stringify({
          id: link.id,
          parentId: link.parentId,
          studentId: link.studentId,
          status: 'rejected',
          decidedAt: now,
          decidedById: actor.userId,
          ...(reason ? { decisionReason: reason } : {}),
          createdAt: link.createdAt,
        }),
      ) as object,
      deletedById: actor.userId,
    });
  }

  // §7's attribution invariant: who asked, who decided and why must be
  // reconstructable from the audit row alone, without reading a row that is now
  // soft-deleted. Ids and a reason only — never a name (TD-14).
  await audit.write(tx, {
    actorUserId: actor.userId,
    activeRole: actor.activeRole,
    actionType: approve ? 'familylink.approve' : 'familylink.reject',
    targetEntity: 'FamilyLink',
    targetId: link.id,
    detail: {
      parent_id: link.parentId,
      student_id: link.studentId,
      ...(reason ? { reason } : {}),
    },
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
