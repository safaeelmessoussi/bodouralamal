import type { Request, Response } from 'express';

import type { PrismaClient } from '../generated/prisma/client.js';
import { requireActor } from '../middleware/authenticate.js';
import {
  readOwnTeachingProfile,
  readTeachingProfile,
  replaceOwnAvailability,
  replaceTeachingProfile,
} from '../services/teaching-profile.service.js';
import { listTeachingCandidates } from '../services/teaching-candidates.service.js';
import {
  ownAvailabilitySchema,
  teachingCandidatesQuerySchema,
  teachingProfileSchema,
} from '../validators/teaching-profile.validators.js';
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

/**
 * **Who would suit this class** (R90) — a read that decides nothing.
 *
 * Behind the guarded router beside the profile itself, and for the same reason:
 * the appraisal republishes what people have declared about themselves.
 */
export function candidates(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const q = parse(teachingCandidatesQuerySchema, req.query ?? {});
    res.json({
      data: await listTeachingCandidates(prisma, requireActor(req), {
        subjectId: q.subject_id,
        levelId: q.level_id,
        branchId: q.branch_id,
        excludeScheduleId: q.exclude_schedule_id,
        recurrence: q.recurrence,
        weekdays: q.weekdays,
        startTime: q.start_time,
        endTime: q.end_time,
      }),
    });
  };
}

/**
 * **`GET /me/teaching-profile`** — her own, read by her (R106).
 *
 * A separate handler from `read` rather than the same one resolving `me`,
 * because the two answer to different authorities: that one is
 * `assertMayManage`, this one `assertIsTeacher`. Collapsing them would put a
 * branch inside a handler whose whole job is to have none.
 */
export function readMine(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    res.json({ data: await readOwnTeachingProfile(prisma, requireActor(req)) });
  };
}

/**
 * **`PUT /me/teaching-profile/availability`** — the ranges only (R106).
 *
 * The path names the half it replaces, so the narrowness of the grant is
 * visible in the route rather than only in the schema. A `PUT` on
 * `/me/teaching-profile` would have announced that she replaces her profile,
 * which is exactly what R106 does NOT grant: what she can teach stays the
 * administration's (R88.2).
 */
export function replaceMyAvailability(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = parse(ownAvailabilitySchema, req.body ?? {});
    res.json({
      data: await replaceOwnAvailability(
        prisma,
        requireActor(req),
        body.availability.map((a) => ({
          weekday: a.weekday,
          startTime: a.start_time,
          endTime: a.end_time,
        })),
      ),
    });
  };
}
