import type { Request, Response } from 'express';

import type { PrismaClient } from '../generated/prisma/client.js';
import { requireActor } from '../middleware/authenticate.js';
import { readOperationsStatus } from '../services/operations-status.service.js';

/**
 * `GET /admin/operations/status` — **what is failing quietly** (SRS Revision 169
 * §11): failed and late background jobs, and storage retirements that did not
 * finish. Super Admin only, asserted in the service against live role rows.
 * Counts only — never a payload, an error text or a key.
 */
export function status(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    res.set('Cache-Control', 'no-store');
    res.json({ data: await readOperationsStatus(prisma, requireActor(req)) });
  };
}
