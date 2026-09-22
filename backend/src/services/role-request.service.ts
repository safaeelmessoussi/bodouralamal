import type { PrismaClient } from '../generated/prisma/client.js';
import { ConsentMethod, ConsentType, RefreshRevokedReason } from '../generated/prisma/enums.js';
import { knownBirthDate } from '../lib/birth-date.js';
import { AppError } from '../lib/errors.js';
import type { Actor } from '../policies/actor.js';
import { assertCategoryFitsApplicant } from '../policies/category-login.policy.js';
import { assertFreshActive } from '../policies/freshness.policy.js';
import * as audit from '../repositories/audit.repository.js';
import * as users from '../repositories/user.repository.js';
import type {
  FurtherRoleRequestInput,
  RoleRequestKindInput,
} from '../validators/registration.validators.js';
import { currentAcademicPeriod } from './academic-period.service.js';
import { enrolAtPlacement, type PlacementInput } from './enrollment.service.js';
import { resolvePresentedConsentText } from './legal-consent-text.service.js';
import { approvalReviewRecipients, notifySubjectUserChange } from './notification.service.js';
import { replaceCirclePreferences } from './registration-circle-slots.service.js';
import { revokeAllSessions } from './refresh-token.service.js';
import { ensureRoleAssignment } from './user.service.js';

/**
 * **Each role a person asked for is decided on its own** (SRS Revision 168 §1).
 *
 * A registration used to be one decision: the account was approved — placed and
 * given its role in the same act — or rejected whole. One form can now ask for
 * several roles, and the Owner's rule is that the Super Admin «approves or
 * declines each role separately». This is that act.
 *
 * ## What approving each one does — nothing new, only one at a time
 *
 * | request | approving it | it needs |
 * |---|---|---|
 * | `student` | places her (`enrolAtPlacement` — scope, R27, BR-21, R122 all there), grants `student` for that branch, marks her a beneficiary | `placement` |
 * | `teaching` | grants `teacher` for the chosen scope | `grant.role = teacher` |
 * | `administration` | grants `admin` or `super_admin` — **the approver's choice, never the applicant's** — and only a Super Admin may | `grant.role` |
 * | `guardian` | accepts her as a guardian; each child stays its own decision (R62) | — |
 *
 * Roles are granted through `ensureRoleAssignment`, which ADDS one role and
 * carries the privilege guard, branch liveness and tombstone revival of the one
 * role-management implementation — so approving her teaching request cannot
 * revoke the `student` role an earlier approval gave her.
 *
 * ## The account follows the requests
 *
 * `pending` → `active` with the FIRST approval. `rejected` — sessions revoked in
 * the same transaction (R102) — only when every request has been declined. While
 * some are undecided and none approved, it stays `pending`.
 *
 * Declining `guardian` rejects her pending child applications with it (`not
 * eligible`): a child cannot be admitted under a guardian the association did
 * not accept, and leaving them queued would promise otherwise.
 *
 * Every decision is one audit row and one notification to the applicant.
 */
const APPROVER_ROLES = ['admin', 'super_admin'] as const;

export interface RoleDecision {
  approve: boolean;
  /** Mandatory on a decline (§5.6); operator-facing, never shown raw. */
  reason?: string;
  /**
   * R170 §11 — tell her this reason. **The approver's choice, each time, and
   * never the default**: what is shared is written to its own column, so what
   * she reads is exactly what was chosen to be said.
   */
  shareReason?: boolean;
  /** `teaching` / `administration`: the role granted and its one branch scope
   *  (`null` — every branch). */
  grant?: { role: string; branchId: string | null };
  /** `student`: where she is placed. */
  placement?: PlacementInput;
}

const GRANTABLE: Record<'teaching' | 'administration', readonly string[]> = {
  teaching: ['teacher'],
  administration: ['admin', 'super_admin'],
};

export async function decideRoleRequest(
  prisma: PrismaClient,
  caller: Actor,
  userId: string,
  kind: RoleRequestKindInput,
  decision: RoleDecision,
): Promise<{ status: 'approved' | 'declined'; accountStatus: string }> {
  const actor = await assertFreshActive(prisma, caller.userId, [...APPROVER_ROLES], caller.activeRole);

  if (!decision.approve && !decision.reason?.trim()) {
    throw new AppError('VALIDATION_FAILED', 'a reason is required to decline (§5.6)');
  }
  // WHO may be given authority over the platform is a Super Admin's decision.
  if (kind === 'administration' && !actor.roles.includes('super_admin')) {
    throw new AppError('FORBIDDEN', 'only a Super Admin decides an administration request');
  }

  return prisma.$transaction(async (tx) => {
    // TD-15.3 first-wins: two approvers deciding at once must not both succeed.
    if (!(await users.lockUser(tx, userId))) throw new AppError('NOT_FOUND', 'no such applicant');

    const applicant = await tx.user.findFirst({
      where: { id: userId, deletedAt: null, accountStatus: { in: ['pending', 'active'] } },
      select: { id: true, accountStatus: true },
    });
    if (!applicant) throw new AppError('NOT_FOUND', 'no such applicant');

    const request = await tx.roleRequest.findUnique({
      where: { userId_kind: { userId, kind } },
      select: { id: true, status: true },
    });
    if (!request) throw new AppError('NOT_FOUND', 'she did not ask for this role');
    if (request.status !== 'pending') {
      throw new AppError('STATE_CONFLICT', 'already decided', { reason: 'ALREADY_DECIDED' });
    }

    const decidedAt = new Date();
    const granted: { role: string; branch_id: string | null }[] = [];
    let enrolled: { level_id: string; branch_id: string } | null = null;
    let childrenRejected = 0;

    if (decision.approve) {
      if (kind === 'student') {
        if (!decision.placement) {
          throw new AppError('VALIDATION_FAILED', 'approving a beneficiary places her', {
            reason: 'ENROLLMENT_REQUIRED',
          });
        }
        // One resolver for every path that places somebody (R66.5). R122: the
        // period is the one covering TODAY, and it fails closed when none does.
        const placed = await enrolAtPlacement(
          tx,
          actor,
          decision.placement,
          userId,
          'approval',
          (await currentAcademicPeriod(tx)).id,
        );
        // A beneficiary admitted by this decision is structurally a Student;
        // placement supplies the role's branch, the client never does.
        await ensureRoleAssignment(tx, actor, userId, { role: 'student', branchId: placed.branchId });
        await tx.user.update({ where: { id: userId }, data: { isBeneficiary: true } });
        granted.push({ role: 'student', branch_id: placed.branchId });
        enrolled = { level_id: placed.levelId, branch_id: placed.branchId };
      } else if (kind === 'teaching' || kind === 'administration') {
        const grant = decision.grant;
        if (!grant || !GRANTABLE[kind].includes(grant.role)) {
          throw new AppError('VALIDATION_FAILED', 'this request grants one of its own roles', {
            reason: 'ROLE_NOT_GRANTABLE_HERE',
            allowed: GRANTABLE[kind],
          });
        }
        if (grant.role === 'super_admin' && grant.branchId !== null) {
          throw new AppError('VALIDATION_FAILED', 'a Super Admin is never branch-scoped', {
            reason: 'SUPER_ADMIN_IS_UNSCOPED',
          });
        }
        await ensureRoleAssignment(tx, actor, userId, grant);
        granted.push({ role: grant.role, branch_id: grant.branchId });
      }
      // `guardian`: nothing is granted by accepting her. `parent` is granted the
      // moment a child of hers is approved (R62), which needs her account active
      // — which this approval is about to make it.
    } else if (kind === 'guardian') {
      const pending = await tx.childApplication.findMany({
        where: { parentId: userId, status: 'pending', deletedAt: null },
        select: { id: true },
      });
      for (const application of pending) {
        await tx.childApplication.update({
          where: { id: application.id },
          data: { status: 'rejected', rejectionReason: 'not_eligible', decidedAt, decidedById: actor.userId },
        });
        await audit.write(tx, {
          actorUserId: actor.userId,
          activeRole: caller.activeRole,
          actionType: 'childapplication.reject',
          targetEntity: 'ChildApplication',
          targetId: application.id,
          detail: { parent_id: userId, reason: 'not_eligible', with_guardian_request: true },
        });
      }
      childrenRejected = pending.length;
    }

    await tx.roleRequest.update({
      where: { id: request.id },
      data: {
        status: decision.approve ? 'approved' : 'declined',
        decidedAt,
        decidedById: actor.userId,
        ...(decision.approve
          ? {}
          : {
              declineReason: decision.reason!.trim().slice(0, 500),
              sharedDeclineReason: decision.shareReason ? decision.reason!.trim().slice(0, 500) : null,
            }),
      },
    });

    // The account follows its requests.
    const all = await tx.roleRequest.findMany({ where: { userId }, select: { status: true } });
    let accountStatus = applicant.accountStatus as string;
    if (applicant.accountStatus === 'pending') {
      if (decision.approve) {
        accountStatus = 'active';
      } else if (all.every((row) => row.status === 'declined')) {
        accountStatus = 'rejected';
      }
      if (accountStatus !== 'pending') {
        await tx.user.update({
          where: { id: userId },
          data: { accountStatus: accountStatus as 'active' | 'rejected', accountStatusDecidedAt: decidedAt },
        });
      }
      if (accountStatus === 'rejected') {
        // R102 — status, durable revocation and the audit fact share this
        // transaction, under the User lock already held.
        await revokeAllSessions(tx, {
          userId,
          reason: RefreshRevokedReason.rejection,
          actorUserId: actor.userId,
          activeRole: actor.activeRole,
        });
      }
    }

    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: decision.approve ? 'rolerequest.approve' : 'rolerequest.decline',
      targetEntity: 'User',
      targetId: userId,
      // TD-14: no PII — ids, role names and states only.
      detail: {
        role_request: kind,
        account_status: accountStatus,
        granted,
        ...(enrolled ? { enrolled } : {}),
        ...(childrenRejected > 0 ? { child_applications_rejected: childrenRejected } : {}),
        // R170 §18 — the sentence is on `role_request.decline_reason`, above in
        // this transaction; the audit carries codes: that one was recorded, and
        // whether the applicant was told it (R170 §11).
        ...(decision.approve ? {} : { reason_recorded: true, reason_shared: decision.shareReason === true }),
      },
    });

    await notifySubjectUserChange(tx, {
      type: decision.approve ? 'registration_approved' : 'registration_rejected',
      subjectUserId: userId,
      recipientUserIds: [userId],
      actorUserId: actor.userId,
    });

    return { status: decision.approve ? ('approved' as const) : ('declined' as const), accountStatus };
  });
}

/* ── A further role, asked for by an account that already exists ───────────── */

/** What each requested kind turns into once approved — the roles whose PRESENCE
 *  means there is nothing left to ask for. */
const HELD_BY: Record<RoleRequestKindInput, readonly string[]> = {
  student: ['student'],
  guardian: ['parent'],
  teaching: ['teacher'],
  administration: ['admin', 'super_admin'],
};

export interface MyRoleRequests {
  requests: {
    kind: RoleRequestKindInput;
    status: string;
    decided_at: Date | null;
    /** R170 §11 — the reason the approver chose to tell her; `null` otherwise. */
    shared_reason: string | null;
  }[];
  /** The kinds she may ask for NOW: not held, and not already waiting. */
  askable: RoleRequestKindInput[];
  /** The kinds she HOLDS, from her live role rows — so the screen can say why
   *  nothing is askable instead of showing nothing at all (R170 §1). */
  held: RoleRequestKindInput[];
}

/**
 * `GET /profile/role-requests` — what she asked for and what became of it, and
 * what she may still ask for. `guardian` is never «askable» here: registering a
 * child IS that request (`POST /child-applications`).
 *
 * The operator's decline reason is NOT returned (§5.6, TD-3.8's discipline);
 * she is told THAT it was declined — and, since R170 §11, the reason the
 * approver CHOSE to share, when one was.
 */
export async function myRoleRequests(prisma: PrismaClient, caller: Actor): Promise<MyRoleRequests> {
  const [rows, held] = await Promise.all([
    prisma.roleRequest.findMany({
      where: { userId: caller.userId },
      orderBy: { createdAt: 'asc' },
      select: { kind: true, status: true, decidedAt: true, sharedDeclineReason: true },
    }),
    heldRoles(prisma, caller.userId),
  ]);
  const waiting = new Set(rows.filter((row) => row.status === 'pending').map((row) => row.kind));
  const askable = (['student', 'teaching', 'administration'] as const).filter(
    (kind) => !waiting.has(kind) && !HELD_BY[kind].some((role) => held.has(role)),
  );
  return {
    requests: rows.map((row) => ({
      kind: row.kind,
      status: row.status,
      decided_at: row.decidedAt,
      shared_reason: row.status === 'declined' ? row.sharedDeclineReason : null,
    })),
    askable: [...askable],
    held: (['student', 'guardian', 'teaching', 'administration'] as const).filter((kind) =>
      HELD_BY[kind].some((role) => held.has(role)),
    ),
  };
}

async function heldRoles(
  prisma: PrismaClient | Parameters<Parameters<PrismaClient['$transaction']>[0]>[0],
  userId: string,
): Promise<Set<string>> {
  const rows = await prisma.userBranchRole.findMany({
    where: { userId, deletedAt: null },
    select: { role: { select: { name: true } } },
  });
  return new Set(rows.map((row) => row.role.name));
}

/**
 * `POST /profile/role-requests` — **an account that already exists asks for a
 * further role** (SRS Revision 169 §1; the Owner, 2026-09-21: *yes*, and *a
 * declined role may be asked for again*).
 *
 * The same request the registration form makes, one role at a time, from a
 * person the platform already knows — so there is no `applicant`, and who she is
 * comes from her session alone. **Asking still grants nothing**: it writes (or
 * RE-OPENS) one `RoleRequest` and tells the approvers; the decision is
 * `decideRoleRequest`, unchanged, and an `administration` request is still a
 * Super Admin's alone.
 *
 * One row per person and role, for ever: a declined request — or an approved
 * one whose role was later taken away — is RE-OPENED (`pending`, its decision
 * cleared) rather than joined by a second row, so the history of one person and
 * one role stays one line, and the audit log keeps what each decision was.
 *
 * Refused: a role she already holds (`ROLE_ALREADY_HELD`), a request already
 * waiting (`ALREADY_PENDING`), an account that is not `active`.
 */
export async function requestFurtherRole(
  prisma: PrismaClient,
  caller: Actor,
  input: FurtherRoleRequestInput,
  now: Date = new Date(),
): Promise<{ kind: RoleRequestKindInput; status: 'pending'; reopened: boolean }> {
  // Resolved BEFORE the transaction, exactly as registration does: the wording
  // she agreed to is the one the form showed, and it must still be in force.
  const consentText =
    input.kind === 'student'
      ? await resolvePresentedConsentText(prisma, input.consents.consent_text_id)
      : null;
  if (input.kind === 'student' && !input.consents.data_processing) {
    throw new AppError('VALIDATION_FAILED', 'data-processing consent is required (§4.1)');
  }

  return prisma.$transaction(async (tx) => {
    if (!(await users.lockUser(tx, caller.userId))) throw new AppError('NOT_FOUND', 'no such account');
    const me = await tx.user.findFirst({
      where: { id: caller.userId, deletedAt: null, accountStatus: 'active' },
      select: { id: true, birthDate: true, birthDateIsPlaceholder: true },
    });
    if (!me) throw new AppError('FORBIDDEN', 'only an active account may ask for a further role');
    // A placeholder is «not recorded»: she is asked for the real date, and
    // giving it is completion, not correction (R169 §9).
    const recorded = knownBirthDate(me);

    const held = await heldRoles(tx, me.id);
    if (HELD_BY[input.kind].some((role) => held.has(role))) {
      throw new AppError('STATE_CONFLICT', 'she already holds this role', { reason: 'ROLE_ALREADY_HELD' });
    }
    const existing = await tx.roleRequest.findUnique({
      where: { userId_kind: { userId: me.id, kind: input.kind } },
      select: { id: true, status: true },
    });
    if (existing?.status === 'pending') {
      throw new AppError('STATE_CONFLICT', 'this request is already waiting', { reason: 'ALREADY_PENDING' });
    }

    let ranked = 0;
    if (input.kind === 'student') {
      const [branch, category] = await Promise.all([
        tx.branch.findFirst({ where: { id: input.student.branch_id, deletedAt: null }, select: { id: true } }),
        tx.category.findFirst({ where: { id: input.student.category_id, deletedAt: null }, select: { id: true } }),
      ]);
      if (!branch) throw new AppError('VALIDATION_FAILED', 'branch_id does not name a live branch (§4.1)');
      if (!category) throw new AppError('VALIDATION_FAILED', 'category_id does not name a live category (§4.1)');
      // R170 §6 — she asks for HERSELF.
      await assertCategoryFitsApplicant(tx, input.student.category_id, 'self');

      // R130 — a beneficiary carries a date of birth. COMPLETION, never
      // correction: a recorded date is not hers to replace from a form.
      if (recorded === null && input.birth_date === undefined) {
        throw new AppError('VALIDATION_FAILED', 'birth_date is required for a beneficiary (R130)', {
          reason: 'BIRTH_DATE_REQUIRED',
        });
      }
      if (recorded !== null && input.birth_date !== undefined) {
        throw new AppError('STATE_CONFLICT', 'her date of birth is already recorded', {
          reason: 'BIRTH_DATE_ALREADY_RECORDED',
        });
      }
      await tx.user.update({
        where: { id: me.id },
        data: {
          intendedBranchId: branch.id,
          intendedCategoryId: category.id,
          ...(input.birth_date !== undefined
            ? { birthDate: input.birth_date, birthDateIsPlaceholder: false }
            : {}),
        },
      });
      ranked = await replaceCirclePreferences(
        tx,
        me.id,
        {
          branchId: branch.id,
          categoryId: category.id,
          circlePreferences: input.student.first_time ? (input.student.circle_preferences ?? []) : [],
        },
        now,
      );
      // Her OWN agreement to the wording in force, as at registration — an
      // account that arrived by pre-provisioning has never given one.
      await tx.consentRecord.create({
        data: {
          studentId: me.id,
          consentType: ConsentType.data_processing,
          granted: true,
          method: ConsentMethod.online_form,
          consentTextVersion: consentText!.versionLabel,
          consentTextId: consentText!.id,
          grantedByUserId: me.id,
        },
      });
    }

    if (input.kind === 'teaching') {
      const framing = input.teaching.framing;
      const physical = framing.mode !== 'online' ? framing.willingness : null;
      const branchIds = physical && !physical.all_branches ? physical.branch_ids : [];
      if (branchIds.length > 0) {
        const live = await tx.branch.count({ where: { id: { in: branchIds }, deletedAt: null } });
        if (live !== branchIds.length) {
          throw new AppError('VALIDATION_FAILED', 'framing branch_ids must each name a live branch');
        }
      }
      // What she says NOW replaces what she said before (planning data, R115).
      await tx.framingPreferenceBranch.deleteMany({ where: { userId: me.id } });
      await tx.framingPreference.deleteMany({ where: { userId: me.id } });
      await tx.framingPreference.create({
        data: {
          userId: me.id,
          mode: framing.mode,
          allBranches: physical?.all_branches ?? false,
          ...(branchIds.length > 0 ? { branches: { create: branchIds.map((branchId) => ({ branchId })) } } : {}),
        },
      });
    }

    if (input.kind === 'administration' && input.administration.branch_id !== null) {
      const branch = await tx.branch.findFirst({
        where: { id: input.administration.branch_id, deletedAt: null },
        select: { id: true },
      });
      if (!branch) throw new AppError('VALIDATION_FAILED', 'branch_id does not name a live branch (§4.1)');
      await tx.user.update({ where: { id: me.id }, data: { intendedBranchId: branch.id } });
    }

    const firstTime = input.kind === 'student' ? input.student.first_time : null;
    if (existing) {
      await tx.roleRequest.update({
        where: { id: existing.id },
        data: {
          status: 'pending',
          decidedAt: null,
          decidedById: null,
          declineReason: null,
          sharedDeclineReason: null,
          firstTime,
        },
      });
    } else {
      await tx.roleRequest.create({ data: { userId: me.id, kind: input.kind, firstTime } });
    }

    await audit.write(tx, {
      actorUserId: me.id,
      activeRole: caller.activeRole,
      actionType: existing ? 'rolerequest.reopen' : 'rolerequest.create',
      targetEntity: 'User',
      targetId: me.id,
      // TD-14: no PII — a role name, a state and counts only.
      detail: {
        role_request: input.kind,
        ...(existing ? { previous_status: existing.status } : {}),
        ...(input.kind === 'student' ? { first_time: firstTime, circles_ranked: ranked } : {}),
      },
    });

    await notifySubjectUserChange(tx, {
      type: 'registration_review_required',
      subjectUserId: me.id,
      recipientUserIds: await approvalReviewRecipients(tx),
      actorUserId: me.id,
    });

    return { kind: input.kind, status: 'pending' as const, reopened: existing !== null };
  });
}
