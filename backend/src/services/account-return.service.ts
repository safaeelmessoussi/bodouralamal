import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import type { Actor } from '../policies/actor.js';
import { assertFreshActive } from '../policies/freshness.policy.js';
import * as audit from '../repositories/audit.repository.js';
import * as users from '../repositories/user.repository.js';

/**
 * **A former beneficiary who closed her account asks for it back** (Owner
 * decision, 2026-09-04).
 *
 * ```
 * she proves a Google identity  →  names her reference code
 *   →  a Super Admin verifies she is that archived person
 *     →  the SAME User is reactivated and the identity bound to it
 * ```
 *
 * ## The property this exists to protect: one person, one record
 *
 * The whole point is that **no second beneficiary `User` is created**. Her
 * enrolments, grades, Quran progress, attendance and reference code are on an id
 * that already exists; a fresh registration would produce a duplicate person and
 * an archive nobody could reach — the outcome R62.4 already refuses for children
 * and this refuses for returning adults.
 *
 * ## Why not `SelfManagedClaim`
 *
 * It was the first candidate and it cannot carry this without being weakened
 * twice. It resolves a beneficiary `WHERE deleted_at IS NULL` — a closed account
 * is soft-deleted, and a test asserts that a closed account's reference code
 * grants nothing — and it requires a recorded date of birth to check the age of
 * majority, which **Option A now clears**. Relaxing both would make one queue
 * mean two things, one of which restores a closed account. The Owner's brief
 * allowed a tiny dedicated state where one is genuinely safer, and this is that.
 *
 * ## What the reference code is, and is not
 *
 * **It locates a candidate. It never authenticates.** Possession grants nothing:
 * every refusal below is the same uniform `NOT_FOUND`, so quoting a code that
 * does not exist, one belonging to a live account, or one belonging to somebody
 * whose request is already pending are indistinguishable. The proof of identity
 * is the Google flow plus a person's verification.
 *
 * ## Nothing is restored that was erased
 *
 * Option A removed her names, contact details and date of birth. Those are gone
 * and **are not brought back** — she supplies current information, which is
 * acquired anew. Restoring erased values would need them to have been kept,
 * which is precisely what closure means they were not.
 */

interface ReturnRequest {
  identity: { email: string; providerSubjectId: string };
  jti: string;
  expiresAt: Date;
  referenceCode: string;
  firstNameArabic: string;
  lastNameArabic: string;
  phone?: string | undefined;
}

/**
 * **One refusal for every reason the archive is not available.**
 *
 * §20 rule 17: an outsider must learn nothing from the difference between a code
 * that never existed, one belonging to a live account and one somebody else has
 * already asked about.
 */
const returnUnavailable = (): AppError =>
  new AppError('NOT_FOUND', 'no archived record is available for that code', {
    reason: 'RETURN_NOT_AVAILABLE',
  });

/**
 * Records the request. **Binds nothing** — the identity is held until a Super
 * Admin decides, because binding it first would be the reactivation itself.
 */
export async function requestAccountReturn(
  prisma: PrismaClient,
  input: ReturnRequest,
): Promise<{ id: string; status: string }> {
  const email = input.identity.email.trim().toLowerCase();
  const referenceCode = input.referenceCode.trim().toUpperCase();
  if (!referenceCode) throw new AppError('VALIDATION_FAILED', 'a reference code is required');
  const firstNameArabic = input.firstNameArabic.trim();
  const lastNameArabic = input.lastNameArabic.trim();
  if (!firstNameArabic || !lastNameArabic) {
    throw new AppError('VALIDATION_FAILED', 'a current name is required');
  }

  return prisma.$transaction(async (tx) => {
    // Replay first, before any read about a person — §4.1b's ordering, and the
    // reason registration and R132's claim both do the same.
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
     * **Her own account, named plainly.** If this Google identity already signs
     * in here she does not need her archive back — she needs to sign in. Saying
     * so discloses nothing she does not already control.
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

    /**
     * **A CLOSED beneficiary account — the mirror of R132's `deleted_at IS
     * NULL`.** A live account is not returned to anybody: whoever holds it holds
     * it, and this path must never become a way to take one over.
     */
    const subject = await tx.user.findFirst({
      where: { referenceCode, deletedAt: { not: null } },
      select: {
        id: true,
        isBeneficiary: true,
        identities: { select: { id: true } },
      },
    });

    // Every one of these is a fact about somebody else. One answer for all.
    if (!subject || !subject.isBeneficiary || subject.identities.length > 0) {
      throw returnUnavailable();
    }

    // Her own pending request, named: she asked already and is waiting.
    const ownPending = await tx.accountReturnRequest.findFirst({
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
        reason: 'RETURN_ALREADY_PENDING',
      });
    }

    // Somebody else's pending request on this archive is a fact about them.
    const otherPending = await tx.accountReturnRequest.count({
      where: { subjectId: subject.id, status: 'pending', deletedAt: null },
    });
    if (otherPending > 0) throw returnUnavailable();

    const row = await tx.accountReturnRequest.create({
      data: {
        subjectId: subject.id,
        provider: 'google',
        providerSubjectId: input.identity.providerSubjectId,
        email,
        firstNameArabic,
        lastNameArabic,
        ...(input.phone ? { phone: input.phone.trim() } : {}),
      },
      select: { id: true, status: true },
    });

    await audit.write(tx, {
      // She holds no session — issuing one would be the transition she is asking
      // permission for — so there is no actor to name (R60.8).
      actorUserId: null,
      actionType: 'accountreturn.request',
      targetEntity: 'AccountReturnRequest',
      targetId: row.id,
      // Ids only. No address, no name, no reference code.
      detail: { subject_id: subject.id },
    });

    return row;
  });
}

/** The queue a Super Admin decides from. */
export async function listPendingReturns(
  prisma: PrismaClient,
  caller: Actor,
): Promise<
  {
    id: string;
    subjectId: string;
    firstNameArabic: string;
    lastNameArabic: string;
    phone: string | null;
    createdAt: Date;
  }[]
> {
  await assertFreshActive(prisma, caller.userId, ['super_admin'], caller.activeRole);
  const rows = await prisma.accountReturnRequest.findMany({
    where: { status: 'pending', deletedAt: null },
    select: {
      id: true,
      subjectId: true,
      firstNameArabic: true,
      lastNameArabic: true,
      phone: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  /**
   * **The Google subject is deliberately absent**, exactly as it is from R132's
   * queue. It is a credential coordinate, and no decision on this screen needs
   * it — an administrator verifies a person, not a provider identifier.
   */
  return rows;
}

/**
 * **Approving reactivates the SAME account and binds the new identity.**
 *
 * Everything that makes this safe happens inside one transaction, re-read rather
 * than trusted from the request row: the account is still closed, still has no
 * login, and the address and subject still belong to nobody.
 */
export async function approveAccountReturn(
  prisma: PrismaClient,
  caller: Actor,
  requestId: string,
): Promise<{ subjectId: string; identityId: string }> {
  const actor = await assertFreshActive(prisma, caller.userId, ['super_admin'], caller.activeRole);

  return prisma.$transaction(async (tx) => {
    const row = await tx.accountReturnRequest.findFirst({
      where: { id: requestId, status: 'pending', deletedAt: null },
      select: {
        id: true,
        subjectId: true,
        provider: true,
        providerSubjectId: true,
        email: true,
        firstNameArabic: true,
        lastNameArabic: true,
        phone: true,
      },
    });
    // Decided, withdrawn or nonexistent answer alike (§20 rule 17).
    if (!row) throw new AppError('NOT_FOUND', 'no such pending request');

    if (!(await users.lockUser(tx, row.subjectId))) {
      throw new AppError('NOT_FOUND', 'no such pending request');
    }

    /**
     * **Still closed, still login-less** — re-read under the lock rather than
     * taken from the request. If she was restored by some other route while this
     * waited, reactivating again would be acting on a state nobody reviewed.
     */
    const subject = await tx.user.findFirst({
      where: { id: row.subjectId, deletedAt: { not: null } },
      select: { id: true, isBeneficiary: true, identities: { select: { id: true } } },
    });
    if (!subject || !subject.isBeneficiary) {
      throw new AppError('STATE_CONFLICT', 'this account can no longer be returned', {
        reason: 'SUBJECT_INELIGIBLE',
      });
    }
    /**
     * **An existing identity is never overwritten and never reassigned.** If the
     * account acquired a login while this waited, binding a second one would
     * either replace a credential or give one account two — both are the
     * account-takeover outcome the whole path exists to avoid.
     */
    if (subject.identities.length > 0) {
      throw new AppError('STATE_CONFLICT', 'this account already has a login', {
        reason: 'ACCOUNT_HAS_LOGIN',
      });
    }

    // The address must still belong to nobody, across BOTH ownership channels.
    const claimants = await users.emailClaimingUserIds(tx, row.email);
    if (claimants.length > 0) {
      throw new AppError('DUPLICATE', 'that email now belongs to an account', {
        reason: 'EMAIL_ALREADY_CLAIMED',
      });
    }
    // And so must the subject: `(provider, provider_subject_id)` is unique, and
    // meeting that constraint as an exception rather than a check would report a
    // database error to an administrator.
    const subjectTaken = await tx.userIdentity.count({
      where: { provider: row.provider, providerSubjectId: row.providerSubjectId },
    });
    if (subjectTaken > 0) {
      throw new AppError('DUPLICATE', 'that Google account already signs in here', {
        reason: 'IDENTITY_ALREADY_BOUND',
      });
    }

    /**
     * **The reactivation — on the EXISTING row.** No user is created here, and
     * that absence is the point.
     *
     * The names are the ones she supplied now; `name_arabic` is composed from
     * them exactly as §1.1 composes it everywhere else. **The birth date stays
     * null**: Option A erased it, it is not restored, and asking her to
     * re-enter it here would be collecting a fact this flow does not need.
     */
    await tx.user.update({
      where: { id: subject.id },
      data: {
        deletedAt: null,
        deletedById: null,
        firstNameArabic: row.firstNameArabic,
        lastNameArabic: row.lastNameArabic,
        nameArabic: `${row.firstNameArabic} ${row.lastNameArabic}`,
        ...(row.phone ? { phone: row.phone } : {}),
        accountStatus: 'active',
      },
    });

    const identity = await tx.userIdentity.create({
      data: {
        userId: subject.id,
        provider: row.provider,
        providerSubjectId: row.providerSubjectId,
        email: row.email,
        isActive: true,
      },
      select: { id: true },
    });

    /**
     * **Durable self-management is recorded, so guardian authority is not
     * restored by the back door** (Owner: *«reactivation must NOT restore former
     * guardian authority»*).
     *
     * Option A never deleted `FamilyLink` rows, so an account that closes and
     * reopens still carries whatever links it had — and without this, reopening
     * would hand a former guardian authority over an adult who returned to
     * manage her own account. The durable fact the platform already uses for
     * exactly this is an approved `SelfManagedClaim`, so that is what is written
     * rather than a second mechanism meaning the same thing.
     *
     * **This is an inference, and it is flagged as one.** The Owner stated the
     * requirement and not the mechanism; if the intended answer is instead that
     * a returning beneficiary's old links stand, this is the single place to
     * change.
     */
    const alreadySelfManaged = await tx.selfManagedClaim.count({
      where: { beneficiaryId: subject.id, status: 'approved' },
    });
    if (alreadySelfManaged === 0) {
      // `SelfManagedClaim` carries no unique key on the identity, so this is a
      // guarded insert rather than an upsert — and the guard is the durable fact
      // itself, which is the right thing to test: she is self-managed already,
      // or she is not.
      await tx.selfManagedClaim.create({
        data: {
          beneficiaryId: subject.id,
          provider: row.provider,
          providerSubjectId: row.providerSubjectId,
          email: row.email,
          status: 'approved',
          decidedAt: new Date(),
          decidedById: actor.userId,
        },
      });
    }

    await tx.accountReturnRequest.update({
      where: { id: row.id },
      data: { status: 'approved', decidedAt: new Date(), decidedById: actor.userId },
    });

    await audit.write(tx, {
      actorUserId: actor.userId,
      ...(actor.activeRole ? { activeRole: actor.activeRole } : {}),
      actionType: 'accountreturn.approve',
      targetEntity: 'AccountReturnRequest',
      targetId: row.id,
      // Ids only. No subject coordinate, no address, no name.
      detail: { subject_id: subject.id, identity_id: identity.id },
    });

    return { subjectId: subject.id, identityId: identity.id };
  });
}

/**
 * Refuses a request — recorded, then withdrawn from the live set.
 *
 * R128's shape for R128's reason: a refusal that stays live blocks the corrected
 * request for ever. The decision and its reason survive on the row and in the
 * trail; only the pending slot is released, so she may ask again as a NEW
 * request with its own history, never by reopening this one.
 */
export async function rejectAccountReturn(
  prisma: PrismaClient,
  caller: Actor,
  requestId: string,
  reason: string,
): Promise<void> {
  const actor = await assertFreshActive(prisma, caller.userId, ['super_admin'], caller.activeRole);

  await prisma.$transaction(async (tx) => {
    const row = await tx.accountReturnRequest.findFirst({
      where: { id: requestId, status: 'pending', deletedAt: null },
      select: { id: true, subjectId: true },
    });
    if (!row) throw new AppError('NOT_FOUND', 'no such pending request');

    await tx.accountReturnRequest.update({
      where: { id: row.id },
      data: {
        status: 'rejected',
        decidedAt: new Date(),
        decidedById: actor.userId,
        decisionReason: reason,
        deletedAt: new Date(),
        deletedById: actor.userId,
      },
    });

    await audit.write(tx, {
      actorUserId: actor.userId,
      ...(actor.activeRole ? { activeRole: actor.activeRole } : {}),
      actionType: 'accountreturn.reject',
      targetEntity: 'AccountReturnRequest',
      targetId: row.id,
      detail: { subject_id: row.subjectId },
    });
  });
}
