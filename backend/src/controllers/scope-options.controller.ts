import type { Request, Response } from 'express';

import type { PrismaClient } from '../generated/prisma/client.js';
import { requireActor } from '../middleware/authenticate.js';
import { readCourseScheduleOptions, readScopeOptions } from '../services/scope-options.service.js';
import { scopeOptionsDto } from './dto.js';

/**
 * `GET /me/scope-options` (NEW D) — R93.4's shape, for the content and
 * scheduling vocabulary.
 *
 * **A narrower question, never a wider permission.** `/admin/levels`,
 * `/admin/subjects` and `/admin/academic-years` are untouched and still refuse a
 * مؤطِّرة (R26/R30). This answers only *what may I filter and compose by*, and
 * the service asserts who may ask.
 */
export function read(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const options = await readScopeOptions(prisma, requireActor(req));
    res.json({ data: scopeOptionsDto(options) });
  };
}

/**
 * `GET /me/course-schedule-options` (SRS §2, Revision 140) — a مؤطِّرة's own
 * declared-capability scope for creating her own class.
 *
 * Same wire shape as `/me/scope-options` (`scopeOptionsDto` is reused
 * unchanged), narrowed to a different question by the SERVICE, not the DTO —
 * see `readCourseScheduleOptions`'s own docstring for why this is a separate
 * read rather than a flag on the one above.
 */
export function readForCourseSchedule(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const options = await readCourseScheduleOptions(prisma, requireActor(req));
    res.json({ data: scopeOptionsDto(options) });
  };
}
