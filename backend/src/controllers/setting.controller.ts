import type { Request, Response } from 'express';
import { z } from 'zod';

import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { requireActor } from '../middleware/authenticate.js';
import { settingDto } from './dto.js';
import { listSettings, updateSetting } from '../services/setting.service.js';

/**
 * Platform settings (TD-3.11, §5.6, Revision 42).
 *
 * Super Admin only — enforced in the service against live rows (TD-12), not by
 * the `/admin/` prefix, which is not a permission boundary.
 */

const updateSchema = z.object({
  // `unknown` deliberately: each key validates its own value in the service,
  // where the per-key rule lives. A `z.string()` here would silently decide
  // that every future setting is a string.
  value: z.unknown(),
  /** TD-15 optimistic locking; 0 for a setting that has never been written. */
  version: z.coerce.number().int().min(0),
});

/** `GET /admin/settings` — the writable settings and their current values. */
export function list(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const rows = await listSettings(prisma, requireActor(req));
    res.json({ data: rows.map(settingDto) });
  };
}

/** `PUT /admin/settings/{key}` — set one value, audited with its predecessor. */
export function update(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const parsed = updateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', 'bad body', {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const key = z.string().min(1).max(80).safeParse(req.params['key']);
    if (!key.success) throw new AppError('VALIDATION_FAILED', 'bad key');

    const saved = await updateSetting(
      prisma,
      requireActor(req),
      key.data,
      parsed.data.value,
      parsed.data.version,
    );
    res.json(settingDto(saved));
  };
}
