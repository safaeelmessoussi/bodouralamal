import type { PrismaClient } from '../generated/prisma/client.js';
import { RefreshRevokedReason } from '../generated/prisma/enums.js';
import { AppError } from '../lib/errors.js';
import type { Actor } from '../policies/actor.js';
import { assertFreshActive } from '../policies/freshness.policy.js';
import * as audit from '../repositories/audit.repository.js';
import * as users from '../repositories/user.repository.js';
import type { RoleRequestKindInput } from '../validators/registration.validators.js';
import { currentAcademicPeriod } from './academic-period.service.js';
import { enrolAtPlacement, type PlacementInput } from './enrollment.service.js';
import { notifySubjectUserChange } from './notification.service.js';
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
        ...(decision.approve ? {} : { declineReason: decision.reason!.trim().slice(0, 500) }),
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
        ...(decision.approve ? {} : { reason: decision.reason!.trim().slice(0, 500) }),
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
