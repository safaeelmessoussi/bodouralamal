import type { Request, Response } from 'express';
import { z } from 'zod';

import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { requireActor } from '../middleware/authenticate.js';
import { approvalDto, pageOf } from './dto.js';
import { decide, listApprovals, type ApprovalType } from '../services/approval.service.js';

/** TD-9: reasons max 500 chars. */
const decisionSchema = z.object({ reason: z.string().trim().max(500).optional() });
const listSchema = z.object({
  type: z.enum(['registration', 'family-link']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(100).optional(),
});

/** `GET /admin/approvals` (TD-3.2, §5.6). */
export function list(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const parsed = listSchema.safeParse(req.query);
    if (!parsed.success) throw new AppError('VALIDATION_FAILED', 'bad query');
    const result = await listApprovals(prisma, requireActor(req).userId, {
      ...(parsed.data.type ? { type: parsed.data.type as ApprovalType } : {}),
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

    const result = await decide(prisma, requireActor(req).userId, id.data, {
      approve,
      ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
    });
    res.json({ type: result.type, records_updated: result.activated });
  };
}

/** `POST /admin/approvals/{id}/approve` — atomic bundle activation (TD-4.2). */
export const approve = (prisma: PrismaClient) => decision(prisma, true);
/** `POST /admin/approvals/{id}/reject` — body `{ reason }` (§5.6). */
export const reject = (prisma: PrismaClient) => decision(prisma, false);
