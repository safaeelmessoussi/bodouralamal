import type { Request, Response } from 'express';
import { z } from 'zod';

import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { readCalendar, type CalendarActor } from '../services/calendar.service.js';

/**
 * `GET /calendar` (TD-3.4) — the one **public** read in the system.
 *
 * §4.4: *"public sees public tier only"*. An anonymous visitor gets the public
 * tier; everything above it is resolved server-side from the caller's live
 * roles, never from a query parameter.
 */
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')
  .transform((v) => new Date(`${v}T00:00:00.000Z`));

const querySchema = z.object({
  from: calendarDate,
  to: calendarDate,
  branch_id: z.uuid().optional(),
  level_id: z.uuid().optional(),
  group_id: z.uuid().optional(),
});

/**
 * `req.actor` is absent for an anonymous caller and present-but-possibly-Pending
 * otherwise; the service decides what each may see.
 */
function calendarActor(req: Request): CalendarActor | null {
  const a = req.actor;
  if (!a) return null;
  return {
    userId: a.userId,
    roles: a.roles,
    roleScopes: a.roleScopes,
    accountStatus: a.accountStatus ?? 'active',
  };
}

export function read(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', 'from and to are required as YYYY-MM-DD');
    }
    const q = parsed.data;

    const occurrences = await readCalendar(prisma, calendarActor(req), {
      from: q.from,
      to: q.to,
      ...(q.branch_id ? { branchId: q.branch_id } : {}),
      ...(q.level_id ? { levelId: q.level_id } : {}),
      ...(q.group_id ? { groupId: q.group_id } : {}),
    });

    res.json({
      data: occurrences.map((o) => ({
        kind: o.kind,
        id: o.id,
        title: o.title,
        date: o.date,
        start_time: o.startTime,
        end_time: o.endTime,
        visibility: o.visibility,
        branch_id: o.branchId,
        // §4.4 decorative overlay, admin offset applied server-side.
        hijri_date: o.hijriDate,
        hijri_month_ar: o.hijriMonthArabic,
      })),
    });
  };
}
