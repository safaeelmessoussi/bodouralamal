import { createHash } from 'node:crypto';

import type { Request, Response } from 'express';
import { z } from 'zod';

import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { calendarBootstrap, MAX_RANGE_DAYS } from '../services/calendar-bootstrap.service.js';

/**
 * `GET /calendar/bootstrap` — TD-3.10 (Revision 36).
 *
 * Public and anonymous, like `/calendar` itself. It takes no actor: the payload
 * is reference data that is identical for every caller, which is precisely what
 * makes it cacheable.
 */
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')
  .transform((v) => new Date(`${v}T00:00:00.000Z`));

/**
 * `category_id` narrows the Level list, **server-side** — §4.4 requires it
 * (*"so the client never filters a list it was handed"*) and Revision 36 names
 * the parameter. It does not touch the Hijri days, the month metadata, the
 * Category list or the Branch list: those are the calendar's chrome regardless
 * of which Category is selected.
 */
const querySchema = z.object({
  from: calendarDate,
  to: calendarDate,
  category_id: z.uuid().optional(),
});

const MS_PER_DAY = 86_400_000;
/** Five minutes, chosen against what actually changes: a Super Admin recording
 *  a Hijri month or adding a Level is not something a visitor must see within
 *  seconds, while an event edit is — which is why `/calendar` is uncached. */
const MAX_AGE_SECONDS = 300;

export function read(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', 'from and to are required as YYYY-MM-DD');
    }
    const { from, to } = parsed.data;
    if (to < from) throw new AppError('VALIDATION_FAILED', 'to must not precede from');
    if ((to.getTime() - from.getTime()) / MS_PER_DAY > MAX_RANGE_DAYS) {
      throw new AppError('VALIDATION_FAILED', `range exceeds ${MAX_RANGE_DAYS} days`);
    }

    const bootstrap = await calendarBootstrap(prisma, from, to, parsed.data.category_id);
    const body = {
      data: {
        hijri: {
          days: bootstrap.hijri.days.map((day) => ({
            date: day.date,
            hijri_date: day.hijriDate,
            hijri_day: day.hijriDay,
            hijri_month: day.hijriMonth,
            hijri_month_ar: day.hijriMonthArabic,
            hijri_year: day.hijriYear,
          })),
          months: bootstrap.hijri.months.map((month) => ({
            hijri_month: month.hijriMonth,
            hijri_month_ar: month.hijriMonthArabic,
            hijri_year: month.hijriYear,
          })),
        },
        gregorian_months: bootstrap.gregorianMonths.map((month) => ({
          month: month.month,
          month_ar: month.monthArabic,
          year: month.year,
        })),
        categories: bootstrap.categories.map((c) => ({
          id: c.id,
          name: c.name,
          display_order: c.displayOrder,
        })),
        levels: bootstrap.levels.map((l) => ({
          id: l.id,
          name: l.name,
          category_id: l.categoryId,
          display_order: l.displayOrder,
        })),
        branches: bootstrap.branches.map((b) => ({
          id: b.id,
          name: b.name,
          display_order: b.displayOrder,
        })),
        // R84's public matrix — see the note on `subjects` in the service.
        subjects: bootstrap.subjects.map((s) => ({
          id: s.id,
          name: s.name,
          display_order: s.displayOrder,
        })),
      },
    };

    // A strong ETag over the content, so a repeat request costs a 304 rather
    // than a re-render. Express compares it against If-None-Match for us.
    const etag = `"${createHash('sha1').update(JSON.stringify(body)).digest('base64url')}"`;
    res.set('Cache-Control', `public, max-age=${MAX_AGE_SECONDS}`);
    res.set('ETag', etag);
    res.json(body);
  };
}
