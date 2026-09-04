import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import type { Actor } from '../policies/actor.js';
import { assertFreshActive } from '../policies/freshness.policy.js';
import { isSelfManaged } from '../policies/self-management.js';
import * as audit from '../repositories/audit.repository.js';

/**
 * **OPTION B — a request to delete the educational record itself** (SRS §4.10a,
 * Revision 131).
 *
 * ## The control plane only
 *
 * **Nothing here deletes anything.** Approval records a decision that is waiting
 * to be carried out; destructive execution is a separate step, gated on the
 * cross-domain classifications §4.10a leaves open, and is deliberately not
 * implemented. Every surface says so, because an interface that implied the data
 * were gone would be the one unacceptable outcome.
 *
 * ## Why this is a request and not an action
 *
 * Option A closes the account and keeps the minimal educational archive. Option
 * B asks for the archive to go too, which **may make a future attestation
 * impossible** — so §4.10a makes it Super Admin's decision and forbids a
 * browser-initiated cascade.
 *
 * ## Who may ask, and the rule that needed durable authority first
 *
 * §4.10a gives exactly two bases:
 *
 * * a **self-managed adult** asks for herself;
 * * an adult holding a **live approved `FamilyLink`** asks for a minor.
 *
 * And one prohibition that only became expressible with the durable-authority
 * decision of 2026-09-04: **a FORMER guardian of a self-managed adult has
 * neither basis.** Before that, authority was read from the presence of a login
 * identity — and Option A deletes it, so a closed self-managed adult would have
 * looked like a minor again and her former guardian could have asked for her
 * educational record to be destroyed. That is why this service reads
 * `isSelfManaged`, not `identities`.
 *
 * ## The basis is recorded, not re-derived
 *
 * A relationship can change while a request waits. The reviewer needs to know
 * what was true when it was made, so the basis is written onto the row.
 */

/** TD-2/R112 — deciding a full deletion is Super Admin's, like every account act. */
const DECIDER_ROLES = ['super_admin'] as const;

export interface RequestResult {
  id: string;
  status: string;
}

/**
 * Records a PENDING request. Deletes nothing, and promises nothing about when.
 */
export async function requestFullDeletion(
  prisma: PrismaClient,
  caller: Actor,
  subjectId: string,
): Promise<RequestResult> {
  return prisma.$transaction(async (tx) => {
    const subject = await tx.user.findFirst({
      where: { id: subjectId, deletedAt: null },
      select: { id: true, isBeneficiary: true },
    });
    // §20 rule 17 — an unknown subject and one the caller may not act for
    // answer alike, so this cannot report who exists.
    if (!subject) throw new AppError('NOT_FOUND', 'no such record');

    /**
     * **The basis, established from live rows and never from the request.**
     *
     * `self` is unconditional: a person may always ask about her own data,
     * whether or not she ever completed the R132 transition — the transition
     * governs who may act *for* her, not whether she may act for herself.
     */
    let basis: 'self' | 'guardian';
    if (caller.userId === subjectId) {
      basis = 'self';
    } else {
      /**
       * **A guardian may ask only for somebody the platform still says she is
       * guardian OF.** Two conditions, and the second is the one that needed the
       * durable-authority decision: a live approved link, AND a subject who has
       * not become self-managed. A former guardian of a self-managed adult is
       * refused here even though the link row survives as history — and even
       * after Option A has removed the adult's login identity.
       */
      const link = await tx.familyLink.count({
        where: {
          parentId: caller.userId,
          studentId: subjectId,
          status: 'approved',
          deletedAt: null,
        },
      });
      if (link === 0 || (await isSelfManaged(tx, subjectId))) {
        // Same answer as an unknown subject: whether somebody else is
        // self-managed is not a fact this endpoint may disclose.
        throw new AppError('NOT_FOUND', 'no such record');
      }
      basis = 'guardian';
    }

    /**
     * **One live request per subject.** Asserted here rather than by a partial
     * unique index, because a refusal is soft-deleted precisely so she may ask
     * again — the constraint is about *pending* work, not about history.
     */
    const pending = await tx.fullDeletionRequest.count({
      where: { subjectId, status: 'pending', deletedAt: null },
    });
    if (pending > 0) {
      throw new AppError('STATE_CONFLICT', 'a request is already awaiting review', {
        reason: 'REQUEST_ALREADY_PENDING',
      });
    }

    const row = await tx.fullDeletionRequest.create({
      data: { subjectId, requestedById: caller.userId, basis, status: 'pending' },
      select: { id: true, status: true },
    });

    /**
     * TD-8/TD-14 — WHO asked about WHOM, on what basis. Ids only: no name, no
     * address, no reference code, no birth date, and nothing about the
     * educational record the request concerns.
     */
    await audit.write(tx, {
      actorUserId: caller.userId,
      ...(caller.activeRole ? { activeRole: caller.activeRole } : {}),
      actionType: 'fulldeletion.request',
      targetEntity: 'FullDeletionRequest',
      targetId: row.id,
      detail: { subject_id: subjectId, basis },
    });

    return row;
  });
}

/**
 * Approves a request — **and deletes nothing.**
 *
 * The decision is recorded so the association can act on it; the acting is a
 * separate, unimplemented step. Saying that plainly here matters more than
 * usual: a function called `approve` that silently did nothing would be read as
 * a bug, and one that silently deleted would be far worse.
 */
export async function approveFullDeletion(
  prisma: PrismaClient,
  caller: Actor,
  requestId: string,
): Promise<void> {
  const actor = await assertFreshActive(prisma, caller.userId, DECIDER_ROLES, caller.activeRole);

  await prisma.$transaction(async (tx) => {
    const row = await tx.fullDeletionRequest.findFirst({
      where: { id: requestId, status: 'pending', deletedAt: null },
      select: { id: true, subjectId: true },
    });
    // Decided, withdrawn or nonexistent answer alike (§20 rule 17).
    if (!row) throw new AppError('NOT_FOUND', 'no such pending request');

    /**
     * **A stale request fails closed** (§4.10a). If the subject was deleted
     * meanwhile, the decision would be taken against a state nobody reviewed.
     */
    const subject = await tx.user.count({ where: { id: row.subjectId, deletedAt: null } });
    if (subject === 0) {
      throw new AppError('STATE_CONFLICT', 'this request can no longer be decided', {
        reason: 'SUBJECT_UNAVAILABLE',
      });
    }

    await tx.fullDeletionRequest.update({
      where: { id: row.id },
      data: { status: 'approved', decidedAt: new Date(), decidedById: actor.userId },
    });

    await audit.write(tx, {
      actorUserId: actor.userId,
      ...(actor.activeRole ? { activeRole: actor.activeRole } : {}),
      actionType: 'fulldeletion.approve',
      targetEntity: 'FullDeletionRequest',
      targetId: row.id,
      // Ids only, and one honest fact: approving did not delete anything.
      detail: { subject_id: row.subjectId, executed: false },
    });
  });
}

/**
 * Refuses a request — recorded, then withdrawn from the live set (R128's shape),
 * so it never blocks a later request while its evidence survives.
 */
export async function rejectFullDeletion(
  prisma: PrismaClient,
  caller: Actor,
  requestId: string,
  reason: string,
): Promise<void> {
  const actor = await assertFreshActive(prisma, caller.userId, DECIDER_ROLES, caller.activeRole);
  if (!reason.trim()) {
    throw new AppError('VALIDATION_FAILED', 'a reason is required to refuse a request');
  }

  await prisma.$transaction(async (tx) => {
    const row = await tx.fullDeletionRequest.findFirst({
      where: { id: requestId, status: 'pending', deletedAt: null },
      select: { id: true, subjectId: true },
    });
    if (!row) throw new AppError('NOT_FOUND', 'no such pending request');

    const now = new Date();
    await tx.fullDeletionRequest.update({
      where: { id: row.id },
      data: {
        status: 'rejected',
        decidedAt: now,
        decidedById: actor.userId,
        decisionReason: reason.trim(),
        // Stamped with the SAME instant as the decision: they are one act.
        deletedAt: now,
        deletedById: actor.userId,
      },
    });

    await audit.write(tx, {
      actorUserId: actor.userId,
      ...(actor.activeRole ? { activeRole: actor.activeRole } : {}),
      actionType: 'fulldeletion.reject',
      targetEntity: 'FullDeletionRequest',
      targetId: row.id,
      detail: { subject_id: row.subjectId, reason: reason.trim() },
    });
  });
}

/** The Super Admin's review queue: pending requests, oldest first. */
export async function listPendingFullDeletions(
  prisma: PrismaClient,
  caller: Actor,
): Promise<
  {
    id: string;
    subjectId: string;
    subjectName: string;
    basis: string;
    requestedById: string;
    createdAt: Date;
  }[]
> {
  await assertFreshActive(prisma, caller.userId, DECIDER_ROLES, caller.activeRole);

  const rows = await prisma.fullDeletionRequest.findMany({
    where: { status: 'pending', deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      basis: true,
      createdAt: true,
      requestedById: true,
      subject: { select: { id: true, nameArabic: true } },
    },
  });

  /**
   * **Only what decides the request.** Who is affected, who asked and on what
   * basis. Deliberately absent: the educational record the request concerns —
   * a reviewer deciding whether it may be destroyed has no need to read it, and
   * a queue that displayed it would be one more copy of the thing at issue.
   */
  return rows.map((row) => ({
    id: row.id,
    subjectId: row.subject.id,
    subjectName: row.subject.nameArabic,
    basis: row.basis,
    requestedById: row.requestedById,
    createdAt: row.createdAt,
  }));
}
