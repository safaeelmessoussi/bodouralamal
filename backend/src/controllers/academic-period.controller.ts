import type { Request, Response } from 'express';
import { z } from 'zod';

import type { PrismaClient } from '../generated/prisma/client.js';
import { requireActor } from '../middleware/authenticate.js';
import { academicPeriodDto } from './dto.js';
import { idParam, parse } from './parse.js';
import {
  createAcademicPeriod,
  listAcademicPeriods,
  updateAcademicPeriod,
} from '../services/academic-period.service.js';

/**
 * **Academic periods — the semesters an academic year is made of** (R122).
 *
 * Read: any staff who may read reference data (TD-2 R26/R30) — the enrolment
 * form is exactly that case. Write: **Super Admin only**, asserted in the
 * service exactly as the sibling curriculum reference data is; the `/admin/`
 * prefix authenticates and is never the boundary.
 */

/** TD-11 — a calendar date, never an instant. A semester begins on a day. */
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
  .transform((value) => new Date(`${value}T00:00:00.000Z`));

const bodySchema = z
  .object({
    academic_year_id: z.string().uuid(),
    /** 1 is the first semester. The Arabic label is derived in the interface. */
    sequence: z.coerce.number().int().min(1).max(12),
    start_date: calendarDate,
    /** Inclusive — the period runs to the end of this day. */
    end_date: calendarDate,
  })
  .strict();

/**
 * **The year is not editable, and `.strict()` refuses it rather than dropping
 * it.** Moving a period to another year would silently re-file every enrolment
 * that names it under a different academic year — a re-creation, not an edit.
 */
const patchSchema = z
  .object({
    sequence: z.coerce.number().int().min(1).max(12),
    start_date: calendarDate,
    end_date: calendarDate,
    /** TD-15 — dates decide who counts as enrolled. */
    version: z.coerce.number().int().min(0),
  })
  .strict();

const querySchema = z.object({ academic_year_id: z.string().uuid().optional() }).strict();

/** `GET /admin/academic-periods` — the enrolment form's source. */
export function list(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const q = parse(querySchema, req.query ?? {});
    const rows = await listAcademicPeriods(
      prisma,
      requireActor(req),
      q.academic_year_id ? { academicYearId: q.academic_year_id } : {},
    );
    res.json({ data: rows.map(academicPeriodDto) });
  };
}

/** `POST /admin/academic-periods` — Super Admin, audited. */
export function create(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const b = parse(bodySchema, req.body ?? {});
    const row = await createAcademicPeriod(prisma, requireActor(req), {
      academicYearId: b.academic_year_id,
      sequence: b.sequence,
      startDate: b.start_date,
      endDate: b.end_date,
    });
    res.status(201).json(academicPeriodDto(row));
  };
}

/** `PATCH /admin/academic-periods/{id}` — Super Admin, TD-15, audited. */
export function update(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const b = parse(patchSchema, req.body ?? {});
    const row = await updateAcademicPeriod(
      prisma,
      requireActor(req),
      idParam(req, 'id'),
      { sequence: b.sequence, startDate: b.start_date, endDate: b.end_date },
      b.version,
    );
    res.json(academicPeriodDto(row));
  };
}
