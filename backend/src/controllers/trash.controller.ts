import type { Request, Response } from 'express';
import { z } from 'zod';

import type { PrismaClient } from '../generated/prisma/client.js';
import { requireActor } from '../middleware/authenticate.js';
import { listTrash, purgeEntry, restoreEntry } from '../services/trash.service.js';
import { pageOf, trashEntryDto } from './dto.js';
import { idParam, parse } from './parse.js';

/**
 * `/admin/trash` — soft-deleted records (§7, TD-5, BR-15, Revision 52).
 *
 * **Super Admin only**, asserted in the service: the list spans every entity in
 * the platform regardless of branch, so a branch-scoped Admin would see other
 * branches' records — which no other surface allows.
 *
 * **Permanent deletion is a Super Admin action** (Revision 59.1, which is the
 * *further revision* Revision 52 required before one could exist). It stays
 * restricted to the single role holding the platform's data authority, it is
 * audited indefinitely, and BR-15's seven-day window remains the default path
 * for everything nobody acts on.
 *
 * **Authority is asserted in the service, not here and not in the client.** The
 * `/admin/` prefix is a URL, and a hidden button is a decoration — a Teacher
 * calling this endpoint directly receives the same refusal as one who never saw
 * a screen.
 */
const listSchema = z.object({
  entity: z.string().trim().max(60).optional(),
  deleted_by: z.uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  q: z.string().trim().max(120).optional(),
  // Which side of the Trash: actionable items, retained history, or both.
  view: z.enum(['actionable', 'retained', 'all']).optional(),
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
      ...(q.view ? { view: q.view } : {}),
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

/**
 * `DELETE /admin/trash/{id}` — destroys a soft-deleted record permanently
 * (R59.1). Super Admin only, asserted in the service.
 *
 * EducationalContent storage retirement is enqueued in the same transaction as
 * destruction; this HTTP handler never owns a best-effort object side effect.
 */
export function purge(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    await purgeEntry(prisma, requireActor(req), idParam(req, 'id'));
    res.status(204).end();
  };
}
