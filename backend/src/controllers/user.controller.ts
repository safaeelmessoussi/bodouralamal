import type { Request, Response } from 'express';
import { z } from 'zod';

import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { requireActor } from '../middleware/authenticate.js';
import { listUsers, preProvision } from '../services/user.service.js';

/**
 * `POST /admin/users` — staff pre-provisioning (§5.6 `/admin/users` "create
 * (staff pre-provisioning against a Google email)", §4.1b step 4b, TD-2).
 */
const createSchema = z.object({
  // TD-9 length limits, matching the registration validators.
  name_arabic: z.string().trim().min(1).max(200),
  email: z.email().max(320),
  role: z.enum(['admin', 'teacher', 'student', 'parent']).optional(),
  branch_id: z.uuid().optional(),
  pre_approved: z.boolean().optional(),
  /* TD-9 (Revision 36.1): trimmed, and an empty value becomes NULL so "unset"
     has exactly one representation — a blank would read as set and render as
     nothing, defeating the fallback. */
  public_display_name: z
    .string()
    .trim()
    .max(120)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
});

export function create(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const parsed = createSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', 'name_arabic and a valid email are required');
    }
    const { name_arabic, email, role, branch_id, pre_approved } = parsed.data;

    const user = await preProvision(prisma, requireActor(req).userId, {
      nameArabic: name_arabic,
      email,
      ...(role ? { role } : {}),
      ...(branch_id ? { branchId: branch_id } : {}),
      ...(pre_approved !== undefined ? { preApproved: pre_approved } : {}),
    });

    res.status(201).json({
      id: user.id,
      account_status: user.accountStatus,
      pre_provisioned_email: user.preProvisionedEmail,
    });
  };
}

/** `GET /admin/users` — §14.2 Users screen; TD-10 pagination, filters and search. */
const listSchema = z.object({
  q: z.string().trim().max(120).optional(),
  role: z.enum(['super_admin', 'admin', 'teacher', 'student', 'parent']).optional(),
  branch_id: z.uuid().optional(),
  status: z.enum(['pending', 'active', 'rejected', 'suspended']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(100).optional(),
});

export function list(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const parsed = listSchema.safeParse(req.query);
    if (!parsed.success) throw new AppError('VALIDATION_FAILED', 'bad query parameters');
    const { q, role, branch_id, status, page, page_size } = parsed.data;

    const result = await listUsers(prisma, requireActor(req).userId, {
      ...(q ? { q } : {}),
      ...(role ? { role } : {}),
      ...(branch_id ? { branchId: branch_id } : {}),
      ...(status ? { status } : {}),
      ...(page ? { page } : {}),
      ...(page_size ? { pageSize: page_size } : {}),
    });

    res.json({
      data: result.data.map((u) => ({
        id: u.id,
        name_arabic: u.nameArabic,
        nickname: u.nickname,
        public_display_name: u.publicDisplayName,
        phone: u.phone,
        account_status: u.accountStatus,
        roles: u.roles.map((r) => ({
          role: r.role,
          branch_id: r.branchId,
          branch_name: r.branchName,
        })),
      })),
      meta: result.meta,
    });
  };
}
