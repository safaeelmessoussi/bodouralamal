import type { Request, Response } from 'express';
import { z } from 'zod';

import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { requireActor } from '../middleware/authenticate.js';
import { createLink, revokeLink } from '../services/family-link.service.js';

const createSchema = z.object({ parent_id: z.uuid(), student_id: z.uuid() });

/**
 * `POST /family-links` — staff-mediated link of an EXISTING child (§4.3 R23).
 *
 * Not parent-facing: the MVP gives parents no search over existing children, so
 * both ids come from the §14.2 staff screen. Parent self-service is registering a
 * NEW child through §4.1b.
 */
export function create(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const parsed = createSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', 'parent_id and student_id are required');
    }
    const link = await createLink(
      prisma,
      requireActor(req),
      parsed.data.parent_id,
      parsed.data.student_id,
    );
    res.status(201).json({ id: link.id, status: link.status });
  };
}

/** TD-9: reasons max 500 chars, as on the approval decisions. */
const revokeSchema = z.object({ reason: z.string().trim().min(1).max(500) });

/**
 * `DELETE /admin/family-links/{id}` — revoke an approved link (§4.3 Revision 16).
 *
 * Expressed as a DELETE because §4.3 is explicit that the soft-delete IS the
 * revocation: there is no `Approved → Revoked` state to PATCH into.
 */
export function revoke(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const id = z.uuid().safeParse(req.params['id']);
    if (!id.success) throw new AppError('VALIDATION_FAILED', 'bad id');

    const parsed = revokeSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', 'a reason of 1–500 characters is required');
    }

    const result = await revokeLink(prisma, requireActor(req), id.data, parsed.data.reason);
    res.json({ revoked: true, parent_id: result.parentId, student_id: result.studentId });
  };
}
