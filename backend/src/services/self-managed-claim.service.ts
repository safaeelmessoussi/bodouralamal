import type { PrismaClient } from '../generated/prisma/client.js';
import { isSelfManagementEligible } from '../lib/birth-date.js';
import { AppError } from '../lib/errors.js';
import type { VerifiedIdentity } from '../lib/oauth.js';
import type { Actor } from '../policies/actor.js';
import { assertFreshActive } from '../policies/freshness.policy.js';
import * as audit from '../repositories/audit.repository.js';
import * as users from '../repositories/user.repository.js';

/**
 * **A beneficiary claims her own account** (SRS Revision 132, Owner decision
 * 2026-09-03).
 *
 * ## The blocker this closes, and the refusal it does NOT weaken
 *
 * A former minor is a login-less `User` (R62.9) holding her whole educational
 * history, and nothing could ever give her a login. The recorded blocker was
 * exact: no operation points an EXISTING account at an address, and
 * `PATCH /admin/users/{id}` refuses `pre_provisioned_email` **because it
 * authorises claiming an account**. That refusal is correct and is untouched —
 * this is the controlled path whose absence it was protecting, not a general
 * capability to point any account at any address.
 *
 * ## Three facts, and none of them binds anything alone
 *
 * 1. **Google proves control of a Google identity.** It does not prove that the
 *    person controlling it is this beneficiary — which is the whole reason a
 *    human decision follows.
 * 2. **The reference code names WHICH beneficiary is claimed.** It grants
 *    nothing on its own (R62.5); that is precisely why it is safe for her to
 *    quote down a telephone, and why quoting it cannot take anybody's account.
 * 3. **A Super Admin performs the association-side identity match** — the
 *    recognition the association already does for the people it teaches. No CIN,
 *    no identity-document scan, and deliberately **no invented automated
 *    identity proofing** to eliminate the human step.
 *
 * Only the third binds. Until then the claim is a row and nothing else.
 *
 * ## Age is eligibility and never a trigger
 *
 * R130's date of birth decides whether she *may ask*. Nothing happens on a
 * birthday: no job, no binding, no authority change, no account creation. The
 * whole transition is something a person starts and another person approves.
 *
 * ## Why the refusals are mostly uniform
 *
 * A reference code is a value somebody could guess at (31^5). If an unknown code
 * and a real-but-ineligible one answered differently, this endpoint would report
 * whether `BA-XXXXX` exists and whether that person is under 18 — facts about a
 * **child**, which §20 rule 17 exists to keep unobservable. So every condition
 * about the CLAIMED PERSON collapses into one refusal, and only conditions about
 * the **caller's own Google identity** are named, because telling her about her
 * own account discloses nothing.
 */

/** TD-2: deciding who may hold a login is Super Admin's, like every account act (R112). */
const CLAIM_DECIDER_ROLES = ['super_admin'] as const;

/**
 * One refusal for every condition about the claimed person: unknown code, not a
 * beneficiary, no recorded birth date, under 18, already holds a login,
 * suspended, deleted, or already claimed by somebody else. The interface
 * explains the eligibility rule; the server does not confirm facts about a
 * person the caller may not know exists.
 */
function claimUnavailable(): AppError {
  return new AppError('NOT_FOUND', 'that record cannot be claimed', {
    reason: 'CLAIM_NOT_AVAILABLE',
  });
}

export interface ClaimRequest {
  /** The VERIFIED identity from the OAuth callback — never a client-supplied one. */
  identity: VerifiedIdentity;
  /** The onboarding token's single-use id, consumed here (TD-12 replay). */
  jti: string;
  /** That token's expiry, so `ConsumedToken` can be purged on its own clock. */
  expiresAt: Date;
  referenceCode: string;
}

/**
 * Records a PENDING claim. Binds nothing.
 *
 * The token is consumed **first**, inside the transaction, exactly as
 * registration consumes it: that makes the `jti` authoritative for replay and
 * fails a replayed callback before anything is read about a beneficiary.
 */
export async function requestSelfManagedClaim(
  prisma: PrismaClient,
  input: ClaimRequest,
): Promise<{ id: string; status: string }> {
  const email = input.identity.email.trim().toLowerCase();
  const referenceCode = input.referenceCode.trim().toUpperCase();
  if (!referenceCode) throw new AppError('VALIDATION_FAILED', 'a reference code is required');

  return prisma.$transaction(async (tx) => {
    // Replay first — before any read about a person (§4.1b's ordering, and the
    // reason registration does the same).
    try {
      await tx.consumedToken.create({
        data: { jti: input.jti, purpose: 'onboarding', expiresAt: input.expiresAt },
      });
    } catch {
      throw new AppError('STATE_CONFLICT', 'this verification has already been used', {
        reason: 'TOKEN_ALREADY_USED',
      });
    }

    /**
     * **Her own account, named plainly.** If this Google identity is already a
     * login, she does not need a transition — she needs to sign in. Saying so
     * discloses nothing she does not already control.
     */
    const alreadyBound = await tx.userIdentity.findFirst({
      where: { provider: 'google', providerSubjectId: input.identity.providerSubjectId },
      select: { id: true },
    });
    if (alreadyBound) {
      throw new AppError('STATE_CONFLICT', 'this Google account already signs in here', {
        reason: 'IDENTITY_ALREADY_BOUND',
      });
    }

    const beneficiary = await tx.user.findFirst({
      where: { referenceCode, deletedAt: null },
      select: {
        id: true,
        accountStatus: true,
        isBeneficiary: true,
        birthDate: true,
        identities: { where: { isActive: true }, select: { id: true } },
      },
    });

    // Every one of these is a fact about somebody else. One answer for all.
    if (
      !beneficiary ||
      beneficiary.accountStatus !== 'active' ||
      !beneficiary.isBeneficiary ||
      beneficiary.identities.length > 0 ||
      beneficiary.birthDate === null ||
      !isSelfManagementEligible(beneficiary.birthDate)
    ) {
      throw claimUnavailable();
    }

    // Her own pending claim, named: she asked already and is waiting.
    const ownPending = await tx.selfManagedClaim.findFirst({
      where: {
        provider: 'google',
        providerSubjectId: input.identity.providerSubjectId,
        status: 'pending',
        deletedAt: null,
      },
      select: { id: true },
    });
    if (ownPending) {
      throw new AppError('STATE_CONFLICT', 'a request from this account is already awaiting review', {
        reason: 'CLAIM_ALREADY_PENDING',
      });
    }

    // Somebody else's pending claim on this record is a fact about them.
    const otherPending = await tx.selfManagedClaim.count({
      where: { beneficiaryId: beneficiary.id, status: 'pending', deletedAt: null },
    });
    if (otherPending > 0) throw claimUnavailable();

    const claim = await tx.selfManagedClaim.create({
      data: {
        beneficiaryId: beneficiary.id,
        provider: 'google',
        providerSubjectId: input.identity.providerSubjectId,
        email,
        status: 'pending',
      },
      select: { id: true, status: true },
    });

    /**
     * TD-8/TD-14 — WHICH record was claimed and WHEN, by ids. Deliberately
     * absent: the Google subject, the birth date, and the reference code. The
     * subject is a credential coordinate, the date is personal data the decision
     * does not turn on, and the code is the thing a reader must not be able to
     * harvest from an audit trail.
     */
    await audit.write(tx, {
      // No actor: she is not signed in — proving control of a Google identity is
      // not a session, and creating one here would BE the transition. The
      // repository documents this exact case, alongside replay detection.
      actorUserId: null,
      actionType: 'selfmanaged.request',
      targetEntity: 'SelfManagedClaim',
      targetId: claim.id,
      detail: { beneficiary_id: beneficiary.id },
    });

    return claim;
  });
}

/**
 * **The binding.** Super Admin only, and every precondition is re-read INSIDE
 * the transaction under the same locks the login path takes — because a claim
 * may have sat in a queue for days while the account, the address or another
 * claim moved underneath it.
 */
export async function approveSelfManagedClaim(
  prisma: PrismaClient,
  caller: Actor,
  claimId: string,
): Promise<{ beneficiaryId: string; identityId: string }> {
  const actor = await assertFreshActive(prisma, caller.userId, CLAIM_DECIDER_ROLES, caller.activeRole);

  return prisma.$transaction(async (tx) => {
    const claim = await tx.selfManagedClaim.findFirst({
      where: { id: claimId, status: 'pending', deletedAt: null },
      select: {
        id: true,
        beneficiaryId: true,
        provider: true,
        providerSubjectId: true,
        email: true,
      },
    });
    // Already decided, withdrawn, or never existed — one answer (§20 rule 17).
    if (!claim) throw new AppError('NOT_FOUND', 'no such pending claim');

    // The global ownership hierarchy is Email → User, exactly as registration,
    // provisioning and binding take it. Skipping it here would let a concurrent
    // registration claim this address between the check and the write.
    await users.lockNormalizedEmail(tx, claim.email);
    if (!(await users.lockUser(tx, claim.beneficiaryId))) {
      throw new AppError('NOT_FOUND', 'no such pending claim');
    }

    const beneficiary = await tx.user.findFirst({
      where: { id: claim.beneficiaryId, deletedAt: null },
      select: {
        id: true,
        accountStatus: true,
        isBeneficiary: true,
        birthDate: true,
        identities: { where: { isActive: true }, select: { id: true } },
      },
    });
    if (
      !beneficiary ||
      beneficiary.accountStatus !== 'active' ||
      !beneficiary.isBeneficiary ||
      beneficiary.birthDate === null ||
      !isSelfManagementEligible(beneficiary.birthDate)
    ) {
      // Fail CLOSED and say which side moved: an administrator seeing this needs
      // to know the claim is stale rather than that the button is broken.
      throw new AppError('STATE_CONFLICT', 'this beneficiary can no longer be transitioned', {
        reason: 'BENEFICIARY_INELIGIBLE',
      });
    }

    /**
     * **An existing identity is never overwritten, and never reassigned.**
     * If she acquired a login while the claim waited, binding a second one would
     * either replace her credential or give one account two — both are the
     * account-takeover outcome this whole path exists to avoid.
     */
    if (beneficiary.identities.length > 0) {
      throw new AppError('STATE_CONFLICT', 'this account already has a login', {
        reason: 'ACCOUNT_HAS_LOGIN',
      });
    }

    // The address must still belong to nobody, across BOTH ownership channels.
    const claimants = await users.emailClaimingUserIds(tx, claim.email);
    if (claimants.length > 0) {
      throw new AppError('DUPLICATE', 'that email now belongs to an account', {
        reason: 'EMAIL_ALREADY_CLAIMED',
      });
    }
    // And so must the subject: `(provider, provider_subject_id)` is unique, and
    // meeting that constraint as an exception rather than a check would report
    // a database error to an administrator.
    const subjectTaken = await tx.userIdentity.count({
      where: { provider: claim.provider, providerSubjectId: claim.providerSubjectId },
    });
    if (subjectTaken > 0) {
      throw new AppError('DUPLICATE', 'that Google account already signs in here', {
        reason: 'IDENTITY_ALREADY_BOUND',
      });
    }

    // **The binding — onto the EXISTING row.** No user is created here, and
    // that absence is the point: her enrolments, grades, Quran progress,
    // attendance, submissions and reference code are already on this id.
    const identity = await tx.userIdentity.create({
      data: {
        userId: beneficiary.id,
        provider: claim.provider,
        providerSubjectId: claim.providerSubjectId,
        email: claim.email,
        isActive: true,
      },
      select: { id: true },
    });

    await tx.selfManagedClaim.update({
      where: { id: claim.id },
      data: { status: 'approved', decidedAt: new Date(), decidedById: actor.userId },
    });

    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'selfmanaged.approve',
      targetEntity: 'SelfManagedClaim',
      targetId: claim.id,
      // Ids only. No subject, no address, no birth date.
      detail: { beneficiary_id: beneficiary.id, identity_id: identity.id },
    });

    return { beneficiaryId: beneficiary.id, identityId: identity.id };
  });
}

/**
 * Refuses a claim — recorded, then withdrawn from the live set.
 *
 * R128's shape, for R128's reason: a refusal that stays live is a refusal that
 * blocks the corrected request for ever. The decision and its reason survive on
 * the row and in the audit trail; only the pending slot is released, so she may
 * ask again — as a NEW claim with its own history, never by reopening this one.
 */
export async function rejectSelfManagedClaim(
  prisma: PrismaClient,
  caller: Actor,
  claimId: string,
  reason: string,
): Promise<void> {
  const actor = await assertFreshActive(prisma, caller.userId, CLAIM_DECIDER_ROLES, caller.activeRole);
  if (!reason.trim()) {
    throw new AppError('VALIDATION_FAILED', 'a reason is required to refuse a claim');
  }

  await prisma.$transaction(async (tx) => {
    const claim = await tx.selfManagedClaim.findFirst({
      where: { id: claimId, status: 'pending', deletedAt: null },
      select: { id: true, beneficiaryId: true },
    });
    if (!claim) throw new AppError('NOT_FOUND', 'no such pending claim');

    const now = new Date();
    await tx.selfManagedClaim.update({
      where: { id: claim.id },
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
      activeRole: actor.activeRole,
      actionType: 'selfmanaged.reject',
      targetEntity: 'SelfManagedClaim',
      targetId: claim.id,
      detail: { beneficiary_id: claim.beneficiaryId, reason: reason.trim() },
    });
  });
}

/** The Super Admin's review list: pending claims, oldest first. */
export async function listPendingClaims(
  prisma: PrismaClient,
  caller: Actor,
): Promise<
  { id: string; beneficiaryId: string; beneficiaryName: string; referenceCode: string | null; email: string; createdAt: Date }[]
> {
  await assertFreshActive(prisma, caller.userId, CLAIM_DECIDER_ROLES, caller.activeRole);

  const rows = await prisma.selfManagedClaim.findMany({
    where: { status: 'pending', deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      email: true,
      createdAt: true,
      beneficiary: { select: { id: true, nameArabic: true, referenceCode: true } },
    },
  });

  /**
   * **Only what decides the claim.** The reviewer needs to know WHO is claimed,
   * WHICH record, and WHICH address will become the login. The Google subject is
   * a credential coordinate and is never published; the birth date decided
   * eligibility before the row existed and is not re-litigated here.
   */
  return rows.map((row) => ({
    id: row.id,
    beneficiaryId: row.beneficiary.id,
    beneficiaryName: row.beneficiary.nameArabic,
    referenceCode: row.beneficiary.referenceCode,
    email: row.email,
    createdAt: row.createdAt,
  }));
}
