import type { Request, Response } from 'express';
import { z } from 'zod';

import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { requireActor } from '../middleware/authenticate.js';
import { preProvision } from '../services/user.service.js';

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
