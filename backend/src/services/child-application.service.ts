import { randomUUID } from 'node:crypto';

import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { allocateReferenceCode } from '../lib/reference-code.js';
import type { Actor } from '../policies/actor.js';
import { assertFreshActive } from '../policies/freshness.policy.js';
import * as audit from '../repositories/audit.repository.js';
import { enrolInGroup } from './enrollment.service.js';
import { applyRoleAssignments } from './user.service.js';

/**
 * Child applications (SRS Revision 62).
 *
 * A parent submits **one request holding one or more children**; an
 * administrator decides **each child independently**; the `parent` role appears
 * on the first approval.
 *
 * ## Why the child `User` is created here and not at submission
 *
 * Today's registration creates the child immediately, and that is exactly what
 * forces approval to be all-or-nothing — a rejected child would otherwise leave
 * an orphan account. Creating it at approval instead means **a rejected child
 * leaves no `User` row and no `FamilyLink` at all**, so partial approval cannot
 * expose one. The safety property is structural rather than enforced: there is
 * nothing to leak through.
 *
 * ## Consent is captured at submission and materialised here
 *
 * `ConsentRecord.student_id` cannot be written before the student exists, so the
 * decisions travel on the application — including **the consent text version in
 * force at submission**. Materialising with the current version would record
 * that a parent consented to text they never saw (§4.1a), and
 * `legal.consent_text_version` is editable between the two moments.
 */

/** TD-2: deciding an application is an approval action. */
const APPROVER_ROLES = ['admin', 'super_admin'] as const;

export interface ChildApplicationInput {
  firstNameArabic: string;
  lastNameArabic: string;
  sex?: 'female' | 'male';
  schoolingStage?:
    | 'pre_primary'
    | 'primary'
    | 'middle'
    | 'high'
    | 'post_secondary'
    | 'not_in_school';
  requestedCategoryId?: string;
  /** R62.3b — per child: a parent may permit photographs of one and not another. */
  consentMediaRelease: boolean;
}

export interface SubmitInput {
  children: ChildApplicationInput[];
  /** Required for the whole request; a refusal blocks submission (§4.1a). */
  consentDataProcessing: boolean;
  /** The version in force **now**, captured so approval cannot substitute another. */
  consentTextVersion: string;
}

/**
 * Records a request. **One service, two callers** — the registration flow and
 * the student area — because two implementations of one shape would drift, and
 * the drift would be silent until an administrator saw two different queues.
 *
 * The parent may be a `pending` applicant or an already-approved account; this
 * function does not care, and deliberately performs **no role check**. Both
 * callers have already established who is asking: registration by the signed
 * onboarding token, the student area by the session. Adding a role test here
 * would refuse the applicant, who by definition holds no role yet.
 */
export async function submitChildApplications(
  tx: Prisma.TransactionClient,
  parentId: string,
  input: SubmitInput,
): Promise<{ requestId: string; applicationIds: string[] }> {
  if (!input.consentDataProcessing) {
    // BR-1: absence of consent is refusal, and a registration cannot proceed on
    // one. Checked here as well as at the boundary because both callers reach
    // this function and only one of them is a form.
    throw new AppError('VALIDATION_FAILED', 'data-processing consent is required (§4.1a)');
  }
  if (input.children.length === 0) {
    throw new AppError('VALIDATION_FAILED', 'a request must name at least one child');
  }

  const requestId = randomUUID();
  const givenAt = new Date();
  const applicationIds: string[] = [];

  for (const child of input.children) {
    const firstName = child.firstNameArabic.trim();
    const lastName = child.lastNameArabic.trim();
    if (!firstName || !lastName) {
      throw new AppError('VALIDATION_FAILED', 'each child needs a first and last name');
    }

    const row = await tx.childApplication.create({
      data: {
        requestId,
        parentId,
        firstNameArabic: firstName,
        lastNameArabic: lastName,
        ...(child.sex ? { sex: child.sex } : {}),
        ...(child.schoolingStage ? { schoolingStage: child.schoolingStage } : {}),
        ...(child.requestedCategoryId
          ? { requestedCategoryId: child.requestedCategoryId }
          : {}),
        consentDataProcessing: true,
        consentMediaRelease: child.consentMediaRelease,
        // Captured, never re-read at approval (R62.3b).
        consentTextVersion: input.consentTextVersion,
        consentGivenAt: givenAt,
      },
      select: { id: true },
    });
    applicationIds.push(row.id);
  }

  return { requestId, applicationIds };
}

export interface DecideInput {
  approve: boolean;
  /** On approval: link this existing account instead of creating a child. */
  matchExistingUserId?: string;
  /** The administrator's placement — R62.7 makes this *their* decision. */
  administrativeGroupId?: string;
  rejectionReason?:
    | 'duplicate_application'
    | 'insufficient_information'
    | 'not_eligible'
    | 'other';
  /** Staff only. **Never returned to a parent.** */
  internalNote?: string;
}

/**
 * Decides ONE child application (R62.2).
 *
 * TD-4.2's atomicity is narrowed from the bundle to a single child: this
 * creates or links that child, its `FamilyLink`, its consent records and the
 * parent's role — in one transaction — and leaves every sibling untouched.
 *
 * **The parent's own application is decided elsewhere and separately** (R62.2,
 * Owner decision). Nothing here infers it from the children's outcomes.
 */
export async function decideChildApplication(
  prisma: PrismaClient,
  caller: Actor,
  applicationId: string,
  decision: DecideInput,
): Promise<{ childUserId: string | null; parentRoleGranted: boolean }> {
  // TD-12: approvals are high-risk, so the caller's status and role are re-read
  // from live rows rather than trusted from a token — and R60 narrows that to
  // the role they are working as.
  const actor = await assertFreshActive(prisma, caller.userId, APPROVER_ROLES, caller.activeRole);

  return prisma.$transaction(async (tx) => {
    // TD-15.3 first-wins: the row lock is what makes a double decision resolve
    // to one winner rather than two half-applied outcomes.
    await tx.$queryRaw`SELECT id FROM "child_application" WHERE id = ${applicationId}::uuid FOR UPDATE`;

    const application = await tx.childApplication.findFirst({
      where: { id: applicationId, deletedAt: null },
    });
    if (!application) throw new AppError('NOT_FOUND', 'no such child application');
    if (application.status !== 'pending') {
      throw new AppError('STATE_CONFLICT', 'already decided', { reason: 'ALREADY_DECIDED' });
    }

    const decidedAt = new Date();

    // ── Rejection: nothing is created. ──────────────────────────────────────
    if (!decision.approve) {
      if (!decision.rejectionReason) {
        // The CHECK constraint enforces this too; failing here names the field.
        throw new AppError('VALIDATION_FAILED', 'a rejection states a bounded reason (R62.8)');
      }
      await tx.childApplication.update({
        where: { id: applicationId },
        data: {
          status: 'rejected',
          rejectionReason: decision.rejectionReason,
          ...(decision.internalNote ? { internalNote: decision.internalNote } : {}),
          decidedAt,
          decidedById: actor.userId,
        },
      });
      await audit.write(tx, {
        actorUserId: actor.userId,
        activeRole: caller.activeRole,
        actionType: 'childapplication.reject',
        targetEntity: 'ChildApplication',
        targetId: applicationId,
        // The bounded reason is recorded; the internal note is not, because the
        // audit log is read by more people than the queue is.
        detail: { parent_id: application.parentId, reason: decision.rejectionReason },
      });
      return { childUserId: null, parentRoleGranted: false };
    }

    // ── Approval: create or link the child. ─────────────────────────────────
    let childUserId: string;
    let created = false;

    if (decision.matchExistingUserId) {
      // R62.3 — the administrator chose this account. The platform never
      // matches automatically: there is no natural key for a child, and a name
      // match would eventually attach one to the wrong family.
      const existing = await tx.user.findFirst({
        where: { id: decision.matchExistingUserId, deletedAt: null },
        select: { id: true, identities: { where: { isActive: true }, select: { id: true } } },
      });
      if (!existing) throw new AppError('NOT_FOUND', 'no such account to link');
      if (existing.identities.length > 0) {
        // R62.9 — linking is restricted to accounts with no login identity,
        // which is how §4.3 defines a minor. An adult consents for themselves.
        throw new AppError('STATE_CONFLICT', 'that account has its own login', {
          reason: 'ACCOUNT_HAS_LOGIN',
        });
      }
      childUserId = existing.id;
    } else {
      const referenceCode = await allocateReferenceCode(
        async (code) => (await tx.user.count({ where: { referenceCode: code } })) > 0,
      );
      const child = await tx.user.create({
        data: {
          nameArabic: `${application.firstNameArabic} ${application.lastNameArabic}`,
          firstNameArabic: application.firstNameArabic,
          lastNameArabic: application.lastNameArabic,
          ...(application.sex ? { sex: application.sex } : {}),
          ...(application.schoolingStage ? { schoolingStage: application.schoolingStage } : {}),
          // Approved here, so the child is usable immediately (TD-4.2).
          accountStatus: 'active',
          referenceCode,
        },
        select: { id: true },
      });
      childUserId = child.id;
      created = true;
    }

    // ── Consent, materialised with the SUBMISSION's values (R62.3b). ────────
    //
    // `granted_at` is when the parent agreed, not when staff decided; the text
    // version is the one they saw. Using today's version would record a consent
    // to text that never existed for them.
    if (created) {
      for (const [consentType, granted] of [
        ['data_processing', application.consentDataProcessing],
        ['media_release', application.consentMediaRelease],
      ] as const) {
        await tx.consentRecord.create({
          data: {
            studentId: childUserId,
            consentType,
            granted,
            consentTextVersion: application.consentTextVersion,
            // The parent ticked a form; staff merely decided the application.
            method: 'online_form',
            grantedAt: application.consentGivenAt,
            grantedByUserId: application.parentId,
          },
        });
      }
    }

    // ── The link. ───────────────────────────────────────────────────────────
    await tx.familyLink.create({
      data: {
        parentId: application.parentId,
        studentId: childUserId,
        status: 'approved',
        decidedAt,
        decidedById: actor.userId,
      },
    });

    // ── The role, on the FIRST approval only. ───────────────────────────────
    const holdsParent = await tx.userBranchRole.count({
      where: { userId: application.parentId, deletedAt: null, role: { name: 'parent' } },
    });
    const parentRoleGranted = holdsParent === 0;
    if (parentRoleGranted) {
      // Through the one implementation that carries the privilege guard, the
      // branch-liveness check and the last-administrator rule — so approving
      // cannot become a second, weaker way to hand out authority.
      // `branchId: null` is *all branches for this assignment* (R24) — a parent's
      // reach is their children, not a branch, so scoping it would be meaningless.
      await applyRoleAssignments(tx, actor, application.parentId, [
        { role: 'parent', branchId: null },
      ]);
    }

    // ── Placement, if the administrator chose one. ──────────────────────────
    //
    // R62.7: schooling stage INFORMS this decision and never makes it. Nothing
    // here reads `schoolingStage` to choose, validate or refuse a group.
    if (decision.administrativeGroupId) {
      await enrolInGroup(tx, actor, decision.administrativeGroupId, childUserId, 'approval');
    }

    await tx.childApplication.update({
      where: { id: applicationId },
      data: {
        status: 'approved',
        childUserId,
        ...(decision.matchExistingUserId
          ? { matchedExistingUserId: decision.matchExistingUserId }
          : {}),
        ...(decision.internalNote ? { internalNote: decision.internalNote } : {}),
        decidedAt,
        decidedById: actor.userId,
      },
    });

    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: caller.activeRole,
      actionType: 'childapplication.approve',
      targetEntity: 'ChildApplication',
      targetId: applicationId,
      detail: {
        parent_id: application.parentId,
        child_user_id: childUserId,
        created,
        linked_existing: Boolean(decision.matchExistingUserId),
        parent_role_granted: parentRoleGranted,
      },
    });

    return { childUserId, parentRoleGranted };
  });
}

/**
 * Candidate accounts an administrator might link instead of creating a child.
 *
 * **Proposals only.** The platform never merges: with no natural key for a
 * child, an automatic match would eventually attach one to the wrong family —
 * a safeguarding failure no audit row undoes.
 *
 * Each candidate carries **the parent it is already linked to and its reference
 * code**, which is what lets an administrator tell two same-named children apart
 * without the platform holding a birth date for either (R62.3).
 */
export async function proposeMatches(
  prisma: PrismaClient,
  caller: Actor,
  applicationId: string,
): Promise<
  { id: string; nameArabic: string; referenceCode: string | null; parents: string[] }[]
> {
  await assertFreshActive(prisma, caller.userId, APPROVER_ROLES, caller.activeRole);

  const application = await prisma.childApplication.findFirst({
    where: { id: applicationId, deletedAt: null },
    select: { firstNameArabic: true, lastNameArabic: true },
  });
  if (!application) throw new AppError('NOT_FOUND', 'no such child application');

  const candidates = await prisma.user.findMany({
    where: {
      deletedAt: null,
      firstNameArabic: application.firstNameArabic,
      lastNameArabic: application.lastNameArabic,
      // Minors only — a match must be an account with no login of its own.
      // §4.3's structural test for a minor: no ACTIVE login of their own.
      identities: { none: { isActive: true } },
    },
    select: {
      id: true,
      nameArabic: true,
      referenceCode: true,
      childLinks: {
        where: { deletedAt: null, status: 'approved' },
        select: { parent: { select: { nameArabic: true } } },
      },
    },
    take: 20,
  });

  return candidates.map((c) => ({
    id: c.id,
    nameArabic: c.nameArabic,
    referenceCode: c.referenceCode,
    parents: c.childLinks.map((l) => l.parent.nameArabic),
  }));
}

/** A parent's own applications — the only read a non-staff caller may perform. */
export async function listMyApplications(prisma: PrismaClient, actor: Actor) {
  return prisma.childApplication.findMany({
    where: { parentId: actor.userId, deletedAt: null },
    orderBy: [{ createdAt: 'desc' }],
    select: {
      id: true,
      requestId: true,
      firstNameArabic: true,
      lastNameArabic: true,
      status: true,
      rejectionReason: true,
      decidedAt: true,
      createdAt: true,
      childUser: { select: { referenceCode: true } },
      // `internalNote` is deliberately absent: R62.8 makes it staff-only, and a
      // projection is where that rule either holds or quietly stops holding.
    },
  });
}
