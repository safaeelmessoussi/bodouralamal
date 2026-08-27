import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { qrMatrixFor, type QrMatrix } from '../lib/qr-identity.js';
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
  /**
   * **R96 — this ACCOUNT HOLDER's QR identity**, never a child's.
   *
   * The subject here is the JWT `sub` (§5.2, R65), so a parent reading her own
   * profile gets **her own**. The child's is served under child context by
   * `getStudentIdentity`, and the two are deliberately never interchangeable:
   * silently swapping one for the other would print the wrong person's card.
   */
  qr: QrMatrix;
  /**
   * **NEW G — where she is placed**, which this screen could not previously
   * say. She could read her name and not her Level: the recurring shape rule P
   * names, on the one screen that is entirely about her.
   *
   * Empty is a **fact, not a gap** — a parent holds no enrolments of her own,
   * and an applicant awaiting approval holds none yet.
   */
  enrolments: OwnEnrolment[];
  /** §4.4c — the Subject circles she is a member of, with the Level they sit in. */
  circles: OwnCircle[];
  /**
   * **NEW G — the guardian LINK, and deliberately almost nothing about the
   * guardian.**
   *
   * The binding constraint is explicit: guardian email, guardian phone and any
   * unrelated guardian field are **never shown by default**, and a guardian
   * field a business rule requires is *reported, not assumed*. So this carries
   * the relationship and the guardian's name — a relationship with an unnamed
   * party tells her nothing — and no contact detail at all.
   */
  guardians: OwnGuardianLink[];
  /** TD-15: sent back on edit; a stale one is a `409`. */
  version: number;
}

export interface OwnEnrolment {
  id: string;
  categoryName: string;
  levelName: string;
  branchName: string;
  /** `null` when she is enrolled in the Level itself rather than a group. */
  groupName: string | null;
}

export interface OwnCircle {
  id: string;
  name: string;
  subjectName: string;
  levelName: string;
}

export interface OwnGuardianLink {
  id: string;
  name: string;
  /** `pending | active | revoked` — the relationship's own state (§4.3). */
  status: string;
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
      qrRef: true,
      version: true,
      preProvisionedEmail: true,
      identities: { where: { isActive: true }, select: { email: true }, take: 1 },
      // **Her own placement.** Loaded in the same read rather than through
      // three more endpoints: this is one screen answering one question, and
      // the authorization is the simplest there is — the subject is the JWT
      // `sub`, so no scope rule applies and none is invented.
      levelEnrollments: {
        where: { deletedAt: null },
        select: {
          id: true,
          level: { select: { name: true, category: { select: { name: true } } } },
          branch: { select: { name: true } },
          administrativeGroup: { select: { name: true } },
        },
      },
      teachingGroupSeats: {
        where: { deletedAt: null },
        select: {
          teachingGroup: {
            select: {
              id: true,
              name: true,
              subject: { select: { name: true } },
              level: { select: { name: true } },
            },
          },
        },
      },
      /**
       * §4.3 — **who is responsible for HER**, which is `childLinks`: the links
       * on which she is the student. `parentLinks` is the opposite direction —
       * the children SHE is guardian of — and the page already lists those
       * separately. Reading the wrong one would show a parent her own children
       * under a heading saying they are her guardians.
       */
      childLinks: {
        where: { deletedAt: null },
        select: { id: true, status: true, parent: { select: { nameArabic: true } } },
      },
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
    qr: await qrMatrixFor(user.qrRef),
    enrolments: user.levelEnrollments.map((e) => ({
      id: e.id,
      categoryName: e.level.category.name,
      levelName: e.level.name,
      branchName: e.branch.name,
      groupName: e.administrativeGroup?.name ?? null,
    })),
    circles: user.teachingGroupSeats.map((m) => ({
      id: m.teachingGroup.id,
      name: m.teachingGroup.name,
      subjectName: m.teachingGroup.subject.name,
      levelName: m.teachingGroup.level.name,
    })),
    // The name and the status. **No email and no phone** — NEW G's constraint,
    // enforced by the projection rather than by a filter applied afterwards.
    guardians: user.childLinks.map((l) => ({
      id: l.id,
      name: l.parent.nameArabic,
      status: l.status,
    })),
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
