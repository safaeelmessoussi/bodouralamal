import type { Request, Response } from 'express';

import type { PrismaClient } from '../generated/prisma/client.js';
import { requireActor } from '../middleware/authenticate.js';
import { listAcademicYears, listSubjects } from '../services/reference-data.service.js';
import { academicYearRefDto, subjectRefDto } from './dto.js';

/**
 * Reference-data selectors (TD-3 extension, Document Owner decision 2026-08-05).
 *
 * **The canonical source for every admin selector needing a Subject or an
 * Academic Year.** A screen that needs either reads these rather than growing
 * its own list — which is the point of the decision, not a side effect of it.
 *
 * Both are unpaginated: a selector that offers a subset is lying about the
 * choice available, and these sets are bounded by the curriculum.
 */

export function subjects(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const rows = await listSubjects(prisma, requireActor(req));
    res.json({ data: rows.map(subjectRefDto) });
  };
}

export function academicYears(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const rows = await listAcademicYears(prisma, requireActor(req));
    res.json({ data: rows.map(academicYearRefDto) });
  };
}
