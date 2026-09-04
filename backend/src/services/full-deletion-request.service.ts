import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import type { Actor } from '../policies/actor.js';
import { assertFreshActive } from '../policies/freshness.policy.js';
import { isSelfManaged } from '../policies/self-management.js';
import * as audit from '../repositories/audit.repository.js';
import { purgeUserAccount } from './account-deletion.service.js';
import { destroyEducationalRecord } from './erasure.js';

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
    /**
     * **An already-approved but unexecuted request is accepted here, not
     * refused** (Owner, 2026-09-04). Approving and destroying are two commits,
     * so a crash between them leaves exactly that state — and the repair must be
     * *do it again*, not a second route nobody would think to call. The decision
     * fields are only written when there was a decision to take.
     */
    const row = await tx.fullDeletionRequest.findFirst({
      where: {
        id: requestId,
        deletedAt: null,
        OR: [{ status: 'pending' }, { status: 'approved' }],
      },
      select: { id: true, subjectId: true, status: true },
    });
    // Rejected, withdrawn or nonexistent answer alike (§20 rule 17 — one
    // refusal, so nothing is learned from the difference).
    if (!row) throw new AppError('NOT_FOUND', 'no such pending request');
    // Already decided: nothing to record. Execution below is idempotent, so a
    // double-click and a retry after a crash both land somewhere harmless.
    if (row.status === 'approved') return;

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
      // The decision, on its own. What the destruction did is `fulldeletion.execute`.
      detail: { subject_id: row.subjectId, executed: false },
    });
  });

  /**
   * **Approval is followed immediately by execution**, in the same call.
   *
   * One action rather than two, deliberately: a request left approved-but-alive
   * is a state in which the person has been told her data is gone while it is
   * not, and nobody is watching a queue for it. They remain two COMMITS, because
   * the closure primitives own their own transactions — which is precisely why
   * `executed_at` exists and why this function is safe to call again.
   */
  await executeFullDeletion(prisma, caller, requestId);
}

/**
 * Refuses a request — recorded, then withdrawn from the live set (R128's shape),
 * so it never blocks a later request while its evidence survives.
 */
/**
 * **Option B's destruction** (SRS §4.10a, Revision 131; Owner decisions
 * 2026-09-04).
 *
 * §4.10a names exactly what goes: *"enrolment history, grades, Quran
 * progression, attendance, assessment submissions and answers, the
 * `reference_code` and the retained identity"*. This deletes that and nothing
 * beyond it — the list is the specification's, not this function's.
 *
 * ## Only an approved request, and only once
 *
 * Execution is gated on `status = 'approved'` and is **idempotent**: a second
 * run finds no educational rows, meets an already-de-identified account, and
 * stamps nothing new. `executed_at` records the work rather than the decision,
 * so a crash between approving and destroying is visible as
 * *approved with no execution* and is repaired by running it again — never
 * silently reported as complete.
 *
 * ## Order, and why the stamp is last
 *
 * Educational rows and their tombstones first, in foreign-key order, then the
 * closure, then the reference code, then the stamp. **Nothing marks the request
 * executed until everything before it has committed**, which is the whole
 * defence against a partial deletion reported as a finished one.
 *
 * ## What deliberately SURVIVES, and why each one
 *
 * * **The `User` row**, de-identified. Twenty-two relationships point at it, and
 *   §4.10a's own promise is that no "zero rows anywhere" is claimed.
 * * **Consent evidence.** `ConsentRecord` holds a type, a decision, an actor, a
 *   wording version and timestamps — **no name, no birth date, no contact
 *   detail** — so it is already the minimum Section 8 asks for. It is not a
 *   hidden copy of a profile and there is nothing in it left to strip.
 * * **The deletion request and the audit trail**, which is how the association
 *   can show what was asked and what was done.
 * * **`FamilyLink`**, because §4.10a does not list it and it is two people's
 *   record, not one's. It points at a row that no longer identifies anybody.
 * * **`Exam` rows targeted at her.** A teacher-authored assessment is not in
 *   §4.10a's list and R126 gives exams their own deletion-evidence guard. Her
 *   grades and submissions for them go; the exam does not.
 *
 * ## What it must never do
 *
 * Touch another person's row. Every delete below is keyed on `student_id`, on an
 * id belonging to this subject, or on a `Trash` entry naming one of them.
 */
export async function executeFullDeletion(
  prisma: PrismaClient,
  caller: Actor,
  requestId: string,
): Promise<{ executed: boolean }> {
  const actor = await assertFreshActive(prisma, caller.userId, DECIDER_ROLES, caller.activeRole);

  const row = await prisma.fullDeletionRequest.findFirst({
    where: { id: requestId, status: 'approved', deletedAt: null },
    select: { id: true, subjectId: true, executedAt: true },
  });
  if (!row) throw new AppError('NOT_FOUND', 'no such approved request');
  // Already done. Answering successfully is correct — the caller asked for a
  // state that holds — and re-running the deletes would be work with no subject.
  if (row.executedAt !== null) return { executed: false };

  const subjectId = row.subjectId;

  /**
   * **The educational record, in foreign-key order**, with each row's tombstone
   * removed beside it. A `Trash` snapshot is a JSON copy written so a row can
   * come back, so leaving one behind would keep the deleted grade in JSONB and
   * offer to restore it — the erasure would be cosmetic. This is the same trap
   * `deIdentifyAccount` documents for `User` and the application purge documents
   * for `ChildApplication`.
   */
  /**
   * **The educational record, through the shared erasure primitive.**
   *
   * The ten-year retention boundary destroys exactly the same rows for a
   * different reason, so both call one function: the data treatment is
   * identical even though the policies are not. What differs — who authorised
   * it, what is stamped afterwards, what the audit says — stays here.
   */
  await prisma.$transaction(async (tx) => {
    await destroyEducationalRecord(tx, subjectId);
  });

  /**
   * **The closure, through the existing machinery.** Option B is Option A plus
   * the educational record, so it runs Option A rather than reimplementing it —
   * identity, credentials, satellites, search shadows and the account's own
   * tombstone all handled by the code that already owns them.
   */
  await purgeUserAccount(prisma, actor, subjectId);

  await prisma.$transaction(async (tx) => {
    /**
     * **The reference code, which Option A keeps and Option B removes.**
     *
     * It is the locator that reconnects a former beneficiary with her history —
     * and there is no longer a history to reconnect to. §4.10a is explicit that
     * it must never become a hidden back door into what Option B deleted.
     */
    await tx.user.update({ where: { id: subjectId }, data: { referenceCode: null } });

    await tx.fullDeletionRequest.update({
      where: { id: row.id },
      data: { executedAt: new Date() },
    });

    await audit.write(tx, {
      actorUserId: actor.userId,
      ...(actor.activeRole ? { activeRole: actor.activeRole } : {}),
      actionType: 'fulldeletion.execute',
      targetEntity: 'FullDeletionRequest',
      targetId: row.id,
      /**
       * **Ids and categories, never values** (TD-8, TD-14). The row recording an
       * erasure must not become the last copy of what was erased — no name, no
       * birth date, no reference code, and no per-table counts either, since a
       * count of grades is a fact about her education.
       */
      detail: {
        subject_id: subjectId,
        removed: ['educational_record', 'application_identity', 'reference_code', 'account'],
      },
    });
  });

  return { executed: true };
}

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
