import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { pageWindow, type Page } from '../lib/pagination.js';
import { assertFreshActive } from '../policies/freshness.policy.js';
import * as audit from '../repositories/audit.repository.js';

/**
 * Approval queue (SRS §5.6, §14.2, TD-3.2, TD-4.2, TD-12).
 *
 * Two item types share one queue: **registrations** (a pending applicant, plus
 * their pending child and link when they arrived as a §4.1 bundle) and
 * standalone **family-link** requests (§4.3 "Link a Child").
 *
 * Approving a bundle is atomic by rule (TD-4.2): parent activation + child
 * activation + link approval + audit row. §4.3 is explicit — "approval activates
 * all three atomically" — because a half-approved bundle is a parent who can see
 * a child whose own record is still pending.
 */

/** TD-2: approving is Admin or Super Admin, and nobody else. */
const APPROVER_ROLES = ['admin', 'super_admin'] as const;

export type ApprovalType = 'registration' | 'family-link';

export interface ApprovalItem {
  id: string;
  type: ApprovalType;
  /** §14.2 column: Applicant(s). */
  applicants: { id: string; nameArabic: string; role: 'applicant' | 'child' | 'parent' }[];
  submittedAt: Date;
  /** §14.2 column: Bundle contents — what approving this will actually change. */
  bundle: { childCount: number; linkCount: number };
}

export async function listApprovals(
  prisma: PrismaClient,
  actorUserId: string,
  options: { type?: ApprovalType; page?: number; pageSize?: number } = {},
): Promise<Page<ApprovalItem>> {
  // TD-12: approvals are a high-risk surface, so even listing re-asserts the
  // caller's live status rather than trusting the token.
  await assertFreshActive(prisma, actorUserId, APPROVER_ROLES);

  const { skip, take, page, pageSize } = pageWindow({ page: options.page, pageSize: options.pageSize });
  const type = options.type;

  const items: ApprovalItem[] = [];
  let total = 0;

  if (!type || type === 'registration') {
    // A registration item is a pending applicant who is NOT merely someone
    // else's pending child — the child is shown as part of its parent's bundle,
    // not as a separate queue entry, so an admin approves one thing once.
    const where = {
      accountStatus: 'pending' as const,
      deletedAt: null,
      childLinks: { none: {} },
    };
    total += await prisma.user.count({ where });
    const applicants = await prisma.user.findMany({
      where,
      include: {
        parentLinks: { where: { deletedAt: null }, include: { student: true } },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      skip,
      take,
    });
    for (const applicant of applicants) {
      const pendingLinks = applicant.parentLinks.filter((l) => l.status === 'pending');
      items.push({
        id: applicant.id,
        type: 'registration',
        applicants: [
          { id: applicant.id, nameArabic: applicant.nameArabic, role: 'applicant' },
          ...pendingLinks.map((l) => ({
            id: l.student.id,
            nameArabic: l.student.nameArabic,
            role: 'child' as const,
          })),
        ],
        submittedAt: applicant.createdAt,
        bundle: { childCount: pendingLinks.length, linkCount: pendingLinks.length },
      });
    }
  }

  if (!type || type === 'family-link') {
    // Standalone link requests: the parent already has an account (§4.3), so
    // only the link itself is pending.
    const where = { status: 'pending' as const, deletedAt: null, parent: { accountStatus: 'active' as const } };
    total += await prisma.familyLink.count({ where });
    const links = await prisma.familyLink.findMany({
      where,
      include: { parent: true, student: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      skip,
      take,
    });
    for (const link of links) {
      items.push({
        id: link.id,
        type: 'family-link',
        applicants: [
          { id: link.parent.id, nameArabic: link.parent.nameArabic, role: 'parent' },
          { id: link.student.id, nameArabic: link.student.nameArabic, role: 'child' },
        ],
        submittedAt: link.createdAt,
        bundle: { childCount: 0, linkCount: 1 },
      });
    }
  }

  return { data: items, meta: { page, page_size: pageSize, total } };
}

interface Decision {
  approve: boolean;
  /** TD-9: max 500 chars. Mandatory on rejection (§5.6, §14.2). */
  reason?: string;
}

/**
 * TD-4.2 — the whole bundle in one transaction.
 *
 * The `{id}` of TD-3.2's route carries no type, so it is resolved against
 * pending registrations first and then pending links. The two id spaces are
 * distinct UUID tables, so a value cannot mean both.
 */
export async function decide(
  prisma: PrismaClient,
  actorUserId: string,
  id: string,
  decision: Decision,
): Promise<{ type: ApprovalType; activated: number }> {
  const actor = await assertFreshActive(prisma, actorUserId, APPROVER_ROLES);

  if (!decision.approve && !decision.reason?.trim()) {
    // §5.6/§14.2: rejection carries a reason. Rejecting a family's application
    // without recording why is not an auditable decision.
    throw new AppError('VALIDATION_FAILED', 'a reason is required to reject (§5.6)');
  }

  return prisma.$transaction(async (tx) => {
    // ── Registration bundle?
    const applicant = await tx.user.findFirst({
      where: { id, accountStatus: 'pending', deletedAt: null, childLinks: { none: {} } },
      include: { parentLinks: { where: { deletedAt: null, status: 'pending' } } },
    });

    if (applicant) {
      const nextStatus = decision.approve ? 'active' : 'rejected';
      let activated = 1;

      // TD-1: Pending → Active | Rejected. The guard on `accountStatus` in the
      // WHERE above is what makes a double-approval first-wins (TD-15.3): the
      // second caller finds nothing pending and gets STATE_CONFLICT below.
      await tx.user.update({ where: { id: applicant.id }, data: { accountStatus: nextStatus } });

      for (const link of applicant.parentLinks) {
        // Child activation + link decision, atomic with the parent (TD-4.2).
        await tx.user.updateMany({
          where: { id: link.studentId, accountStatus: 'pending', deletedAt: null },
          data: { accountStatus: nextStatus },
        });
        await tx.familyLink.update({
          where: { id: link.id },
          data: {
            status: decision.approve ? 'approved' : 'rejected',
            decidedAt: new Date(),
            decidedById: actor.userId,
            ...(decision.reason ? { decisionReason: decision.reason } : {}),
          },
        });
        activated += 1;
      }

      await audit.write(tx, {
        actorUserId: actor.userId,
        actionType: decision.approve ? 'user.approve' : 'user.reject',
        targetEntity: 'User',
        targetId: applicant.id,
        detail: {
          type: 'registration',
          children_activated: applicant.parentLinks.length,
          ...(decision.reason ? { reason: decision.reason } : {}),
        },
      });

      return { type: 'registration' as const, activated };
    }

    // ── Standalone family link?
    const link = await tx.familyLink.findFirst({
      where: { id, status: 'pending', deletedAt: null },
    });
    if (!link) {
      // Either the id does not exist, or it was already decided — both are
      // STATE_CONFLICT for a decided item and NOT_FOUND for an unknown one.
      const exists = await tx.familyLink.count({ where: { id } });
      const wasUser = await tx.user.count({ where: { id } });
      if (exists > 0 || wasUser > 0) {
        // TD-15.3: two admins deciding the same item — first wins, the second is
        // told plainly and the UI treats it as "already handled, refreshing".
        throw new AppError('STATE_CONFLICT', 'already decided');
      }
      throw new AppError('NOT_FOUND', 'no such approval item');
    }

    await tx.familyLink.update({
      where: { id: link.id },
      data: {
        status: decision.approve ? 'approved' : 'rejected',
        decidedAt: new Date(),
        decidedById: actor.userId,
        ...(decision.reason ? { decisionReason: decision.reason } : {}),
      },
    });
    await audit.write(tx, {
      actorUserId: actor.userId,
      actionType: decision.approve ? 'familylink.approve' : 'familylink.reject',
      targetEntity: 'FamilyLink',
      targetId: link.id,
      detail: {
        parent_id: link.parentId,
        student_id: link.studentId,
        ...(decision.reason ? { reason: decision.reason } : {}),
      },
    });

    return { type: 'family-link' as const, activated: 1 };
  });
}
