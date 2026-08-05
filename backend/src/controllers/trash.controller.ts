import type { Request, Response } from 'express';
import { z } from 'zod';

import type { PrismaClient } from '../generated/prisma/client.js';
import { requireActor } from '../middleware/authenticate.js';
import { listTrash, restoreEntry } from '../services/trash.service.js';
import { pageOf, trashEntryDto } from './dto.js';
import { idParam, parse } from './parse.js';

/**
 * `/admin/trash` — soft-deleted records (§7, TD-5, BR-15, Revision 52).
 *
 * **Super Admin only**, asserted in the service: the list spans every entity in
 * the platform regardless of branch, so a branch-scoped Admin would see other
 * branches' records — which no other surface allows.
 *
 * **There is no permanent-delete route, deliberately.** BR-15's 90-day window is
 * enforced by `content.quarantine-purge` (TD-7), and a manual *delete now* would
 * bypass a retention rule that exists for legal and safeguarding reasons. Adding
 * one is a data-retention decision and needs its own revision — not a button
 * because Trash pages conventionally have one.
 */
const listSchema = z.object({
  entity: z.string().trim().max(60).optional(),
  deleted_by: z.uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(100).optional(),
});

export function list(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const q = parse(listSchema, req.query);
    const result = await listTrash(prisma, requireActor(req), {
      ...(q.entity ? { entity: q.entity } : {}),
      ...(q.deleted_by ? { deletedById: q.deleted_by } : {}),
      ...(q.from ? { from: q.from } : {}),
      ...(q.to ? { to: q.to } : {}),
      ...(q.q ? { q: q.q } : {}),
      ...(q.page ? { page: q.page } : {}),
      ...(q.page_size ? { pageSize: q.page_size } : {}),
    });
    res.json(pageOf(result, trashEntryDto));
  };
}

/** `POST /admin/trash/{id}/restore` — only where §7's cascade problem does not
 *  arise. An unsupported entity type is refused loudly rather than silently
 *  half-restored. */
export function restore(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const result = await restoreEntry(prisma, requireActor(req), idParam(req, 'id'));
    res.json({ target_entity: result.targetEntity, target_id: result.targetId });
  };
}
