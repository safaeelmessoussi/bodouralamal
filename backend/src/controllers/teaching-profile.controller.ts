import type { Request, Response } from 'express';

import type { PrismaClient } from '../generated/prisma/client.js';
import { requireActor } from '../middleware/authenticate.js';
import {
  readTeachingProfile,
  replaceTeachingProfile,
} from '../services/teaching-profile.service.js';
import { teachingProfileSchema } from '../validators/teaching-profile.validators.js';
import { idParam, parse } from './parse.js';

/**
 * A مؤطِّرة's planning profile (§E, R88) — **Admin-owned, and authority-free**.
 *
 * Thin by rule (§16.2): the service owns the overlap rule, the reference checks
 * and the audit row. What matters at this layer is that both verbs are behind
 * the guarded router and neither is public: planning data names what a person
 * says she can do, which is hers rather than the platform's to publish.
 */
export function read(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    res.json({
      data: await readTeachingProfile(prisma, requireActor(req), idParam(req, 'id')),
    });
  };
}

export function replace(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = parse(teachingProfileSchema, req.body ?? {});
    const profile = await replaceTeachingProfile(prisma, requireActor(req), idParam(req, 'id'), {
      subjectIds: body.subject_ids,
      categoryIds: body.category_ids,
      availability: body.availability.map((a) => ({
        weekday: a.weekday,
        startTime: a.start_time,
        endTime: a.end_time,
      })),
    });
    res.json({ data: profile });
  };
}
