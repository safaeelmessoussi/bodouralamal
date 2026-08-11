import type { Request, Response } from 'express';
import { z } from 'zod';

import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { requireActor } from '../middleware/authenticate.js';
import { approvalDto, pageOf } from './dto.js';
import { decide, listApprovals, type ApprovalType } from '../services/approval.service.js';

/**
 * TD-9: reasons max 500 chars.
 *
 * `assignments` (Revision 49, proposed) is the role and branch scope the
 * approver grants **in the same transaction as the activation**, so the account
 * never exists in the `Active`-with-no-role state — a person who can sign in and
 * reach nothing. It is accepted on both verbs and **ignored on rejection**,
 * where the service discards it: a rejected applicant receiving a role is the
 * single worst outcome this endpoint could produce, so it is refused in the
 * service rather than merely omitted from a schema a client could still fill.
 *
 * `branch_id: null` means **all branches for that assignment** (§7 R24), never
 * *no branch* — a required, explicitly nullable key, so the unscoped grant is
 * never the easiest thing to type by accident.
 */
const decisionSchema = z.object({
  reason: z.string().trim().max(500).optional(),
  assignments: z
    .array(z.object({ role: z.string().trim().min(1).max(40), branch_id: z.uuid().nullable() }))
    .max(20)
    .optional(),
  /**
   * §4.1 (Revision 43) — the Levels and Administrative Groups the applicant is
   * admitted to, written in the same transaction as the activation.
   *
   * **`level_id` is deliberately absent**: the group already names its Level,
   * and taking one from the caller would create a second source for a fact the
   * database constrains through a composite FK. `Enrollment.level_id` is read
   * from the group for exactly that reason.
   *
   * `user_id` is required because a bundle admits more than one person and they
   * are not interchangeable — on the parent+child path the **child** enrols.
   */
  enrollments: z
    .array(
      z
        .object({
          user_id: z.uuid(),
          administrative_group_id: z.uuid().optional(),
          level_id: z.uuid().optional(),
          branch_id: z.uuid().optional(),
        })
        .strict()
        /**
         * **Exactly one of the two shapes (R66.5).** A group names a Level that
         * IS subdivided and the Level and branch are read from it; a Level and
         * branch name one that is not. Both together would have to be
         * reconciled, and neither is the missing placement §4.1 refuses — so
         * the boundary rejects each rather than letting the service guess.
         */
        .refine(
          (e) =>
            (e.administrative_group_id !== undefined) !==
            (e.level_id !== undefined && e.branch_id !== undefined),
          {
            message:
              'a placement is either administrative_group_id, or level_id with branch_id (R66.5)',
          },
        )
        .refine((e) => (e.level_id === undefined) === (e.branch_id === undefined), {
          message: 'level_id and branch_id are given together or not at all',
        }),
    )
    .max(20)
    .optional(),
});
const listSchema = z.object({
  type: z.enum(['registration', 'family-link', 'child-application']).optional(),
  /** §14.2 / Revision 39 — a filter, never a scope (see the service). */
  branch_id: z.uuid().optional(),
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(100).optional(),
});

/** `GET /admin/approvals` (TD-3.2, §5.6). */
export function list(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const parsed = listSchema.safeParse(req.query);
    if (!parsed.success) throw new AppError('VALIDATION_FAILED', 'bad query');
    const result = await listApprovals(prisma, requireActor(req), {
      ...(parsed.data.type ? { type: parsed.data.type as ApprovalType } : {}),
      ...(parsed.data.branch_id ? { branchId: parsed.data.branch_id } : {}),
      ...(parsed.data.page ? { page: parsed.data.page } : {}),
      ...(parsed.data.page_size ? { pageSize: parsed.data.page_size } : {}),
    });
    res.json(pageOf(result, approvalDto));
  };
}

function decision(prisma: PrismaClient, approve: boolean) {
  return async (req: Request, res: Response): Promise<void> => {
    const parsed = decisionSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new AppError('VALIDATION_FAILED', 'bad body');
    const id = z.uuid().safeParse(req.params['id']);
    if (!id.success) throw new AppError('VALIDATION_FAILED', 'bad id');

    const result = await decide(prisma, requireActor(req), id.data, {
      approve,
      ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
      ...(parsed.data.assignments
        ? {
            assignments: parsed.data.assignments.map((a) => ({
              role: a.role,
              branchId: a.branch_id,
            })),
          }
        : {}),
      ...(parsed.data.enrollments
        ? {
            enrollments: parsed.data.enrollments.map((e) => ({
              userId: e.user_id,
              // The refinements above guarantee exactly one shape reaches here,
              // so this reads the discriminator rather than re-deciding it.
              placement:
                e.administrative_group_id !== undefined
                  ? { administrativeGroupId: e.administrative_group_id }
                  : { levelId: e.level_id!, branchId: e.branch_id! },
            })),
          }
        : {}),
    });
    res.json({ type: result.type, records_updated: result.activated });
  };
}

/** `POST /admin/approvals/{id}/approve` — atomic bundle activation (TD-4.2). */
export const approve = (prisma: PrismaClient) => decision(prisma, true);
/** `POST /admin/approvals/{id}/reject` — body `{ reason }` (§5.6). */
export const reject = (prisma: PrismaClient) => decision(prisma, false);
