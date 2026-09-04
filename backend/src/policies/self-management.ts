import type { Prisma } from '../generated/prisma/client.js';

/**
 * **SELF-MANAGED AUTHORITY IS DURABLE, AND IS NOT AUTHENTICATION** (Owner
 * decision, 2026-09-04; SRS §4.3, Revisions 130–132).
 *
 * ## The defect this closes
 *
 * R132 expressed *"she manages her own account"* as **an account with no active
 * login identity** — §4.3's structural test for a minor, reused so there would
 * be one definition rather than two. That reasoning was right and the fact it
 * read was wrong, and Option A proved it: **account closure deliberately deletes
 * `UserIdentity`**, so a self-managed adult who closes her account satisfies
 * *"no active login identity"* again, and a former guardian's historical
 * `FamilyLink` would come back to life.
 *
 * It did not, but only because a second clause happened to hold — the resolver
 * also requires a live student, and a closed account is soft-deleted. Authority
 * surviving by an unrelated coincidence is authority that will not survive the
 * next change.
 *
 * ## The model
 *
 * ```
 * DOB ≥ 18                → ELIGIBILITY only. Never authority, never a trigger.
 * approved R132 claim     → DURABLE self-managed authority.
 * UserIdentity            → an authentication MECHANISM. Nothing else.
 * Option A closure        → removes authentication. Removes NO authority.
 * ```
 *
 * ## Why this is DERIVED and not a new column
 *
 * An approved `SelfManagedClaim` **is** the durable fact: the row exists exactly
 * when a Super Admin approved the transition for that beneficiary, it is never
 * soft-deleted (only a *rejected* claim is), and it carries the decider and the
 * instant. A `User.self_managed_at` column beside it would be a second answer to
 * one question — the failure R79.3 and R128 each name — and the two could
 * disagree after a restore, a backfill or a hand-written fix.
 *
 * **Legacy accounts are correct by construction.** No approved claim exists for
 * anybody who never transitioned, so nothing marks them independent; and no age,
 * role or identity is consulted, so nothing can.
 */

/**
 * The Prisma predicate for *this account manages itself*, as a nested `User`
 * filter — so a caller can compose it into the single query it already runs
 * rather than paying for a second round trip on a hot path.
 */
export const SELF_MANAGED: Prisma.UserWhereInput = {
  selfManagedClaims: { some: { status: 'approved' } },
};

/**
 * The negation: *this account is still managed by a guardian.*
 *
 * **Not the same as "has no login".** A beneficiary who transitioned and then
 * closed her account has no login and is emphatically not this.
 */
export const NOT_SELF_MANAGED: Prisma.UserWhereInput = {
  selfManagedClaims: { none: { status: 'approved' } },
};

/**
 * Whether a specific account has completed the transition.
 *
 * Takes any client with a `selfManagedClaim` delegate so a caller inside a
 * transaction gets the transaction's view, which is what makes an approval and
 * a concurrent authority check agree.
 */
export async function isSelfManaged(
  db: Pick<Prisma.TransactionClient, 'selfManagedClaim'>,
  userId: string,
): Promise<boolean> {
  const approved = await db.selfManagedClaim.count({
    where: { beneficiaryId: userId, status: 'approved' },
  });
  return approved > 0;
}
