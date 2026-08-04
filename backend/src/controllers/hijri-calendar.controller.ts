import type { Request, Response } from 'express';
import { z } from 'zod';

import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { MAX_HIJRI_YEAR, MIN_HIJRI_YEAR, MONTHS_IN_YEAR } from '../lib/hijri.js';
import { requireActor } from '../middleware/authenticate.js';
import {
  listYear,
  publishYear,
  recordMonthStart,
  yearHistory,
} from '../services/hijri-calendar.service.js';
import type { Actor } from '../policies/actor.js';

/**
 * Recording the Ministry's official Hijri announcements — TD-3.4 (Revisions
 * 31–32), §5.7.
 *
 * Super Admin only; the service enforces that, not the URL prefix (Revision 26:
 * *"the URL prefix is not the permission boundary"*).
 *
 * The vocabulary is deliberate (Revision 32): a Super Admin **records** the
 * Ministry's official announcement. No import route exists — see §10.1.
 */

/** Local calendar date, `YYYY-MM-DD` (TD-11) — never an instant. */
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')
  .transform((v) => new Date(`${v}T00:00:00.000Z`));

const yearParam = z.coerce.number().int().min(MIN_HIJRI_YEAR).max(MAX_HIJRI_YEAR);
const monthParam = z.coerce.number().int().min(1).max(MONTHS_IN_YEAR);

const recordSchema = z
  .object({
    gregorian_start_date: calendarDate,
    /** Required when correcting an existing month (TD-15); absent on first recording. */
    version: z.number().int().min(0).optional(),
  })
  .strict();

const actorOf = (req: Request): Actor => {
  const a = requireActor(req);
  return { userId: a.userId, roles: a.roles, roleScopes: a.roleScopes };
};

function pathYear(req: Request): number {
  const parsed = yearParam.safeParse(req.params['year']);
  if (!parsed.success) throw new AppError('VALIDATION_FAILED', 'invalid hijri year');
  return parsed.data;
}

const isoDate = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

export function list(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const parsed = yearParam.safeParse(req.query['year']);
    if (!parsed.success) throw new AppError('VALIDATION_FAILED', 'year is required');

    const months = await listYear(prisma, actorOf(req), parsed.data);
    res.json({
      year: parsed.data,
      data: months.map((m) => ({
        hijri_month: m.hijriMonth,
        month_name_ar: m.monthNameArabic,
        gregorian_start_date: isoDate(m.gregorianStartDate),
        status: m.status,
        version: m.version,
        source: m.source,
      })),
    });
  };
}

export function recordMonth(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const year = pathYear(req);
    const month = monthParam.safeParse(req.params['month']);
    if (!month.success) throw new AppError('VALIDATION_FAILED', 'invalid hijri month');

    const parsed = recordSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new AppError('VALIDATION_FAILED', 'invalid month payload');

    const row = await recordMonthStart(prisma, actorOf(req), {
      year,
      month: month.data,
      gregorianStartDate: parsed.data.gregorian_start_date,
      expectedVersion: parsed.data.version,
    });

    res.json({
      hijri_year: row.hijriYear,
      hijri_month: row.hijriMonth,
      gregorian_start_date: isoDate(row.gregorianStartDate),
      status: row.status,
      version: row.version,
      source: row.source,
    });
  };
}

export function publish(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const result = await publishYear(prisma, actorOf(req), pathYear(req));
    res.json({ published: result.published });
  };
}

export function history(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const entries = await yearHistory(prisma, actorOf(req), pathYear(req));
    res.json({
      data: entries.map((e) => ({
        at: e.at.toISOString(),
        actor_user_id: e.actorUserId,
        action_type: e.actionType,
        detail: e.detail,
      })),
    });
  };
}
