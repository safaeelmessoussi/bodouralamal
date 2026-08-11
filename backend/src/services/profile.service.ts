import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import * as audit from '../repositories/audit.repository.js';

/**
 * The caller's own record (SRS §5.2, Revision 65).
 *
 * **The personal section is role-independent, and so is this.** Nothing here
 * reads a role: §5.2 places `/profile` under *Shared / Cross-Role*, and every
 * account has a person behind it. `assertFreshActive` is deliberately absent —
 * it exists to re-check a *capacity* on a high-risk surface, and reading or
 * editing your own phone number is neither.
 *
 * **There is no id parameter anywhere in this file.** The subject is always the
 * authenticated caller, so there is nowhere for a request to name someone else
 * — the same argument R63 made for `GET /students/me`, and the reason this
 * needs no scope check at all.
 */
export interface OwnProfile {
  id: string;
  nameArabic: string;
  nameFrench: string | null;
  nickname: string | null;
  phone: string | null;
  /** The bound Google identity, or the pre-provisioned address awaiting one. */
  email: string | null;
  sex: string | null;
  accountStatus: string;
  /** R62.6 — present for an account created through a child application. */
  referenceCode: string | null;
  /** TD-15: sent back on edit; a stale one is a `409`. */
  version: number;
}

export async function getOwnProfile(
  prisma: PrismaClient,
  userId: string,
): Promise<OwnProfile> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: {
      id: true,
      nameArabic: true,
      nameFrench: true,
      nickname: true,
      phone: true,
      sex: true,
      accountStatus: true,
      referenceCode: true,
      version: true,
      preProvisionedEmail: true,
      identities: { where: { isActive: true }, select: { email: true }, take: 1 },
    },
  });
  // Reachable when an account is soft-deleted mid-session; the guarded router
  // has already established that a token was presented.
  if (!user) throw new AppError('AUTH_REQUIRED', 'account unavailable');

  return {
    id: user.id,
    nameArabic: user.nameArabic,
    nameFrench: user.nameFrench,
    nickname: user.nickname,
    phone: user.phone,
    // The bound identity first, falling back to the address the account was
    // pre-provisioned against — the same resolution `listUsers` uses, so one
    // person does not read as two different addresses on two screens.
    email: user.identities[0]?.email ?? user.preProvisionedEmail,
    sex: user.sex,
    accountStatus: user.accountStatus,
    referenceCode: user.referenceCode,
    version: user.version,
  };
}

/**
 * **Two fields, and the exclusions are the specification** (§5.2, R65).
 *
 * §5.2 says *"basic contact info"*, and everything else on the row is something
 * else: names are **identity** (§1.1 composes them server-side from parts
 * collected once, and a rename is a staff act on the §14.2 screen where it is
 * reviewable); `sex` feeds §4.4b's `gender_restriction`, so self-editing it
 * would let a person move themselves past an admission rule; `email` is the
 * Google identity the account is keyed to; `account_status` is an approver's
 * decision (TD-1); and §4.10/BR-16's safeguarding data never reaches this
 * surface at all.
 *
 * The narrow input type is what enforces that — not a check that could be
 * forgotten, and not a filter applied after a wider object was accepted.
 */
export interface OwnProfileInput {
  phone?: string | null | undefined;
  nickname?: string | null | undefined;
}

export async function updateOwnProfile(
  prisma: PrismaClient,
  caller: { userId: string; activeRole?: string | null },
  expectedVersion: number,
  input: OwnProfileInput,
): Promise<OwnProfile> {
  // TD-15.1: a conditional UPDATE on `version`. `updateMany` is what makes the
  // condition part of the write rather than a check preceding it.
  const written = await prisma.user.updateMany({
    where: { id: caller.userId, version: expectedVersion, deletedAt: null },
    data: {
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.nickname !== undefined ? { nickname: input.nickname } : {}),
      version: { increment: 1 },
    },
  });
  if (written.count === 0) {
    // Either the row moved under the caller or the account is gone. Both are
    // answered as the conflict, because the caller's next act is the same:
    // reload and look again.
    throw new AppError('VERSION_CONFLICT', 'this record changed since you loaded it');
  }

  await audit.write(prisma, {
    actorUserId: caller.userId,
    ...(caller.activeRole ? { activeRole: caller.activeRole } : {}),
    // **The EXISTING action, not a new one.** This is the same act as a staff
    // edit performed by a different actor; a second name would split *"who
    // changed this person's details"* across two rows (TD-8).
    actionType: 'user.update',
    targetEntity: 'User',
    targetId: caller.userId,
    // TD-14 / §14: the FIELDS changed, never their values — a phone number in
    // an audit row is personal data in a log.
    detail: { self_service: true, fields: Object.keys(input) },
  });

  return getOwnProfile(prisma, caller.userId);
}
