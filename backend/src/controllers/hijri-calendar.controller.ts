import type { Request, Response } from 'express';
import { z } from 'zod';

import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { MAX_HIJRI_YEAR, MIN_HIJRI_YEAR, MONTHS_IN_YEAR } from '../lib/hijri.js';
import { requireActor } from '../middleware/authenticate.js';
import {
  importYear,
  listYear,
  publishYear,
  setMonthStart,
  yearHistory,
} from '../services/hijri-calendar.service.js';
import type { Actor } from './../services/group.service.js';

/**
 * Official Moroccan Hijri calendar management — TD-3.4 (Revision 31), §5.7.
 *
 * Super Admin only; the service enforces that, not the URL prefix (Revision 26:
 * *"the URL prefix is not the permission boundary"*).
 */

/** Local calendar date, `YYYY-MM-DD` (TD-11) — never an instant. */
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')
  .transform((v) => new Date(`${v}T00:00:00.000Z`));

const yearParam = z.coerce.number().int().min(MIN_HIJRI_YEAR).max(MAX_HIJRI_YEAR);
const monthParam = z.coerce.number().int().min(1).max(MONTHS_IN_YEAR);

const setSchema = z
  .object({
    gregorian_start_date: calendarDate,
    /** Required when correcting an existing month (TD-15); absent on first entry. */
    version: z.number().int().min(0).optional(),
  })
  .strict();

const importSchema = z.object({ year: yearParam, source: z.string().min(1).max(80) }).strict();

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

export function setMonth(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const year = pathYear(req);
    const month = monthParam.safeParse(req.params['month']);
    if (!month.success) throw new AppError('VALIDATION_FAILED', 'invalid hijri month');

    const parsed = setSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new AppError('VALIDATION_FAILED', 'invalid month payload');

    const row = await setMonthStart(prisma, actorOf(req), {
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

export function runImport(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const parsed = importSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new AppError('VALIDATION_FAILED', 'year and source are required');

    const result = await importYear(prisma, actorOf(req), parsed.data.year, parsed.data.source);
    res.json({ imported: result.imported, source: result.source });
  };
}
