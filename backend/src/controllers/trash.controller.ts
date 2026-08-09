import type { Request, Response } from 'express';
import { z } from 'zod';

import type { PrismaClient } from '../generated/prisma/client.js';
import { requireActor } from '../middleware/authenticate.js';
import type { StorageClients } from '../lib/storage.js';
import { purgeQuarantinedObject } from '../services/content.service.js';
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
 * audited indefinitely, and BR-15's ninety-day window remains the default path
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

/**
 * `DELETE /admin/trash/{id}` — destroys a soft-deleted record permanently
 * (R59.1). Super Admin only, asserted in the service.
 *
 * **The object reaping happens after the transaction commits.** An S3 call
 * cannot join a database transaction, and this ordering is the safe one: a
 * destroyed row beside a surviving object is a reapable leftover, while the
 * reverse would be a record pointing at bytes that no longer exist.
 */
export function purge(prisma: PrismaClient, storage: StorageClients) {
  return async (req: Request, res: Response): Promise<void> => {
    const id = idParam(req, 'id');

    // Read BEFORE the purge: the snapshot is the only place the storage key
    // still exists once both the row and the entry are gone.
    const entry = await prisma.trash.findUnique({ where: { id } });
    const snapshot = (entry?.snapshot ?? null) as Record<string, unknown> | null;

    const result = await purgeEntry(prisma, requireActor(req), id);

    if (
      result.targetEntity === 'EducationalContent' &&
      typeof snapshot?.['storageBucket'] === 'string' &&
      typeof snapshot['storageKey'] === 'string'
    ) {
      await purgeQuarantinedObject(
        storage,
        result.targetId,
        snapshot['storageBucket'],
        snapshot['storageKey'],
      );
    }

    res.status(204).end();
  };
}
