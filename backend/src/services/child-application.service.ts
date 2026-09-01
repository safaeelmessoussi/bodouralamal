import { randomUUID } from 'node:crypto';

import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { composeArabicName, composeFrenchName } from '../lib/person-name.js';
import { allocateReferenceCode } from '../lib/reference-code.js';
import type { Actor } from '../policies/actor.js';
import { assertFreshActive } from '../policies/freshness.policy.js';
import * as audit from '../repositories/audit.repository.js';
import { enrolAtPlacement, type PlacementInput } from './enrollment.service.js';
import { ensureRoleAssignment } from './user.service.js';
import {
  approvalReviewRecipients,
  notifySubjectUserChange,
} from './notification.service.js';

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
  firstNameFrench?: string;
  lastNameFrench?: string;
  nickname?: string;
  /** R80.1 — required at creation, like every other path into the system. */
  sex: 'female' | 'male';
  schoolingStage?:
    | 'pre_primary'
    | 'primary'
    | 'middle'
    | 'high'
    | 'post_secondary'
    | 'not_in_school';
  requestedCategoryId?: string;
  /** R64 — the branch asked for, per child. A request, never a placement. */
  requestedBranchId?: string;
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
        ...(child.firstNameFrench ? { firstNameFrench: child.firstNameFrench.trim() } : {}),
        ...(child.lastNameFrench ? { lastNameFrench: child.lastNameFrench.trim() } : {}),
        ...(child.nickname ? { nickname: child.nickname.trim() } : {}),
        sex: child.sex,
        ...(child.schoolingStage ? { schoolingStage: child.schoolingStage } : {}),
        ...(child.requestedBranchId ? { requestedBranchId: child.requestedBranchId } : {}),
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

  await notifySubjectUserChange(tx, {
    type: 'registration_review_required',
    subjectUserId: parentId,
    recipientUserIds: await approvalReviewRecipients(tx),
    actorUserId: parentId,
  });

  return { requestId, applicationIds };
}

export interface DecideInput {
  approve: boolean;
  /** On approval: link this existing account instead of creating a child. */
  matchExistingUserId?: string;
  /**
   * The administrator's placement — R62.7 makes this *their* decision, and
   * R66.5 lets them express it either way: a **group** when the Level is
   * subdivided, or a **Level and a branch** when it is not.
   */
  placement?: PlacementInput;
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
      await notifySubjectUserChange(tx, {
        type: 'registration_rejected',
        subjectUserId: application.parentId,
        recipientUserIds: [application.parentId],
        actorUserId: actor.userId,
      });
      return { childUserId: null, parentRoleGranted: false };
    }

    /**
     * **§4.1 (R43) — an approval places the student, or it is refused.**
     *
     * > *"Approval and every resulting `Enrollment` row are written in one
     * > transaction — an approved account with no enrollment is a person the
     * > platform admitted and then lost."*
     *
     * The registration path has enforced this since R43 (`ENROLLMENT_REQUIRED`).
     * R62 narrowed TD-4.2 to one child and, in doing so, made the placement
     * *optional* here — so the family route obeyed §4.1 and the per-child route
     * quietly did not, which is the two-implementations-of-one-rule failure
     * this project keeps paying for. The rule is restored on this path.
     *
     * Linking an EXISTING account is exempt: that student is already placed,
     * and demanding a second enrolment would mean a Level per parent.
     */
    if (!decision.matchExistingUserId && !decision.placement) {
      throw new AppError('VALIDATION_FAILED', 'an approved child must be placed (§4.1)', {
        reason: 'ENROLLMENT_REQUIRED',
      });
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
      /**
       * **R80 — an application with no recorded sex cannot be approved.**
       *
       * The column is nullable for rows written before R80 made it required.
       * Creating the child with a guessed value would be exactly the inference
       * the revision forbids, and a NULL is no longer storable. So the approval
       * refuses and says what to do: the family is asked, and the answer is
       * recorded — by a person, not by this code.
       */
      if (application.sex === null) {
        throw new AppError('VALIDATION_FAILED', 'this application records no sex (R80)', {
          reason: 'SEX_REQUIRED',
          application_id: application.id,
        });
      }

      const child = await tx.user.create({
        data: {
          nameArabic: composeArabicName(application.firstNameArabic, application.lastNameArabic),
          firstNameArabic: application.firstNameArabic,
          lastNameArabic: application.lastNameArabic,
          firstNameFrench: application.firstNameFrench,
          lastNameFrench: application.lastNameFrench,
          nameFrench: composeFrenchName(
            application.firstNameFrench ?? undefined,
            application.lastNameFrench ?? undefined,
          ),
          nickname: application.nickname,
          // R80.1 — the application carried one, so the child it creates does.
          sex: application.sex,
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
            // **A refusal is a decision and carries its stamp** (BR-1, §4.1a).
            // Absence would also mean "no consent", but a decision must leave a
            // record with an actor and a time so the history is auditable — and
            // the time is when the parent decided, not when staff approved.
            ...(granted
              ? {}
              : {
                  revokedAt: application.consentGivenAt,
                  revokedByUserId: application.parentId,
                }),
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

    /**
     * The grant is additive. The shared helper preserves every existing
     * functional role and routes the change through the complete-set
     * implementation; passing only `{ parent }` would revoke a teacher or
     * administrator role the parent already held. `null` is correct here
     * because a parent's reach is her approved children, not a branch.
     */
    const parentRoleGranted = await ensureRoleAssignment(
      tx,
      actor,
      application.parentId,
      { role: 'parent', branchId: null },
    );

    // ── Placement, if the administrator chose one. ──────────────────────────
    //
    // R62.7: schooling stage INFORMS this decision and never makes it. Nothing
    // here reads `schoolingStage` to choose, validate or refuse a group.
    let studentRoleGranted = false;
    if (decision.placement) {
      // The same resolver `decide()` uses, so the two approval paths cannot
      // place students by different rules (R66.5).
      const enrollment = await enrolAtPlacement(
        tx,
        actor,
        decision.placement,
        childUserId,
        'approval',
      );
      if (created) {
        studentRoleGranted = await ensureRoleAssignment(tx, actor, childUserId, {
          role: 'student',
          branchId: enrollment.branchId,
        });
        await tx.user.update({
          where: { id: childUserId },
          data: { isBeneficiary: true },
        });
      }
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
        student_role_granted: studentRoleGranted,
        admitted_as_beneficiary: created,
      },
    });

    await notifySubjectUserChange(tx, {
      type: 'registration_approved',
      // The approved child now has a real User coordinate. Targeting the
      // parent would collapse approvals for several children into one
      // `(recipient, subject, type)` row and make the notice unable to identify
      // which application changed.
      subjectUserId: childUserId,
      recipientUserIds: [application.parentId],
      actorUserId: actor.userId,
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
