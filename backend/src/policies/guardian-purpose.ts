import type { Prisma } from '../generated/prisma/client.js';

/**
 * **Does this account still have a reason to exist?** (SRS §4.3, Revision 131.)
 *
 * A guardian-only account exists because it has a child-management purpose. When
 * the last such relationship is deliberately and permanently removed and the
 * adult has no other platform purpose, §4.3 says the account is closed through
 * the established machinery — **never by a foreign-key cascade**.
 *
 * ## This module answers the question and performs nothing
 *
 * It is the **guard** any future closure must call, written and tested on its
 * own because it is the safety-critical half: closing somebody's account is
 * severe, and the failure mode is closing one that still had a purpose.
 *
 * **No trigger is wired**, deliberately. §4.3 says the decision belongs to *the
 * deliberate deletion operation*, and which operation that is remains an Owner
 * decision — revoking the last approved link, purging it from Trash, and fully
 * deleting the last child are materially different events. Guessing would attach
 * an irreversible consequence to whichever one somebody happened to pick.
 *
 * ## Every reason counts, and absence of all of them is the only closure case
 *
 * The predicate is deliberately **inclusive**: any purpose at all preserves the
 * account. That asymmetry is the point — a missed purpose closes an account that
 * should have lived, while a spurious one merely leaves an account alive.
 */

/** One reason an account must be kept, in the terms §4.3 states them. */
export type AccountPurpose =
  | 'beneficiary'
  | 'staff_role'
  | 'live_family_link'
  | 'pending_family_link'
  | 'pending_child_application'
  | 'self_managed'
  | 'pending_full_deletion_request';

export interface PurposeReport {
  /** Every reason found. Empty means the account has no remaining purpose. */
  purposes: AccountPurpose[];
  /** Convenience: `purposes.length === 0`. */
  closable: boolean;
}

/**
 * Reports every current purpose an account still has.
 *
 * Takes a transaction client so a caller closing an account sees the same rows
 * its own transaction does — a purpose created concurrently must either be
 * visible here or be blocked by the caller's locks, never neither.
 */
export async function accountPurposes(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<PurposeReport> {
  const purposes: AccountPurpose[] = [];

  const user = await tx.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, isBeneficiary: true },
  });
  // A row that is already gone has no purposes and is not a closure candidate
  // either; the caller decides what an absent account means.
  if (!user) return { purposes, closable: false };

  // **R79.3's durable fact**: what this record WAS. A former beneficiary's
  // educational archive is exactly what §4.10a retains, so she is never a
  // guardian-only account whatever her links say.
  if (user.isBeneficiary) purposes.push('beneficiary');

  // Any live role assignment at all — مؤطِّرة, Admin, Super Admin, or student.
  const roles = await tx.userBranchRole.count({ where: { userId, deletedAt: null } });
  if (roles > 0) purposes.push('staff_role');

  // A live approved link is the guardian purpose itself.
  const live = await tx.familyLink.count({
    where: { parentId: userId, status: 'approved', deletedAt: null },
  });
  if (live > 0) purposes.push('live_family_link');

  /**
   * **A PENDING link still owes somebody an answer**, so it is a purpose even
   * though it grants nothing. A rejected one is not: R128 records it and
   * withdraws it from the live set precisely so it stops being a live fact.
   */
  const pendingLink = await tx.familyLink.count({
    where: { parentId: userId, status: 'pending', deletedAt: null },
  });
  if (pendingLink > 0) purposes.push('pending_family_link');

  // A child application awaiting a decision needs the account it was made from.
  const pendingApplication = await tx.childApplication.count({
    where: { parentId: userId, status: 'pending', deletedAt: null },
  });
  if (pendingApplication > 0) purposes.push('pending_child_application');

  /**
   * **A self-managed adult is never a guardian-only account** (R132, and the
   * durable-authority decision of 2026-09-04). She took her account over
   * deliberately; that it may now hold no links is not a reason to close it.
   */
  const selfManaged = await tx.selfManagedClaim.count({
    where: { beneficiaryId: userId, status: 'approved' },
  });
  if (selfManaged > 0) purposes.push('self_managed');

  /**
   * **An undecided full-deletion request needs its subject and its requester**
   * (R131 §4.10a). Closing either while a Super Admin still owes a decision
   * would decide it by removal.
   */
  const pendingRequest = await tx.fullDeletionRequest.count({
    where: {
      status: 'pending',
      deletedAt: null,
      OR: [{ subjectId: userId }, { requestedById: userId }],
    },
  });
  if (pendingRequest > 0) purposes.push('pending_full_deletion_request');

  return { purposes, closable: purposes.length === 0 };
}
