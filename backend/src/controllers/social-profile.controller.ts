import type { Request, Response } from 'express';
import { z } from 'zod';

import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { requireActor } from '../middleware/authenticate.js';
import { readProfile, writeProfile } from '../services/social-profile.service.js';

/**
 * `/students/{id}/social-profile` — minors' case-file data (§4.10, BR-16, TD-2 R28).
 *
 * The controller does no authorization of its own: TD-2 is enforced in the
 * service, server-side, using the §4.2 predicate. Everything here is boundary
 * validation against the §7 column limits.
 */

/** §7 column widths, mirrored at the boundary per TD-9. */
const longText = z.string().trim().max(2000);
const shortText = z.string().trim().max(120);

const profileSchema = z
  .object({
    health_condition: longText.nullable().optional(),
    family_situation: longText.nullable().optional(),
    home_address: longText.nullable().optional(),
    siblings_count: z.number().int().min(0).max(50).nullable().optional(),
    father_name: shortText.nullable().optional(),
    father_profession: shortText.nullable().optional(),
    mother_name: shortText.nullable().optional(),
    mother_profession: shortText.nullable().optional(),
  })
  .strict();

const view = (p: Awaited<ReturnType<typeof readProfile>>) => ({
  student_id: p.studentId,
  health_condition: p.healthCondition,
  family_situation: p.familySituation,
  home_address: p.homeAddress,
  siblings_count: p.siblingsCount,
  father_name: p.fatherName,
  father_profession: p.fatherProfession,
  mother_name: p.motherName,
  mother_profession: p.motherProfession,
});

function studentId(req: Request): string {
  const parsed = z.uuid().safeParse(req.params['id']);
  if (!parsed.success) {
    // A malformed id joins the out-of-scope cases as 404 rather than 400: a
    // distinguishable response would let a caller probe id validity against a
    // safeguarding surface (§20 rule 17).
    throw new AppError('NOT_FOUND', 'no such student in scope');
  }
  return parsed.data;
}

export function read(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const profile = await readProfile(prisma, requireActor(req), studentId(req));
    res.json(view(profile));
  };
}

export function write(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const parsed = profileSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new AppError('VALIDATION_FAILED', 'invalid social profile payload');
    const b = parsed.data;

    const profile = await writeProfile(prisma, requireActor(req), studentId(req), {
      ...(b.health_condition !== undefined ? { healthCondition: b.health_condition } : {}),
      ...(b.family_situation !== undefined ? { familySituation: b.family_situation } : {}),
      ...(b.home_address !== undefined ? { homeAddress: b.home_address } : {}),
      ...(b.siblings_count !== undefined ? { siblingsCount: b.siblings_count } : {}),
      ...(b.father_name !== undefined ? { fatherName: b.father_name } : {}),
      ...(b.father_profession !== undefined ? { fatherProfession: b.father_profession } : {}),
      ...(b.mother_name !== undefined ? { motherName: b.mother_name } : {}),
      ...(b.mother_profession !== undefined ? { motherProfession: b.mother_profession } : {}),
    });
    res.json(view(profile));
  };
}
