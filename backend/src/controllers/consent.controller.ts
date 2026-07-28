import type { Request, Response } from 'express';
import { z } from 'zod';

import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { requireActor } from '../middleware/authenticate.js';
import { readConsent, recordStaffConsent } from '../services/consent.service.js';

/**
 * `/students/{id}/consents` — staff-recorded consent (§4.1a, TD-2).
 *
 * Authorization lives in the service, server-side. This is boundary validation.
 */
const decisionSchema = z
  .object({
    consent_type: z.enum(['media_release', 'data_processing']),
    granted: z.boolean(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

function studentId(req: Request): string {
  const parsed = z.uuid().safeParse(req.params['id']);
  // Out-of-scope and malformed alike answer 404 (§20 rule 17): consent state is
  // safeguarding-adjacent and must not confirm that a child exists.
  if (!parsed.success) throw new AppError('NOT_FOUND', 'no such student in scope');
  return parsed.data;
}

export function read(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const state = await readConsent(prisma, requireActor(req).userId, studentId(req));
    res.json({ student_id: req.params['id'], consents: state });
  };
}

export function record(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const parsed = decisionSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new AppError('VALIDATION_FAILED', 'invalid consent decision');
    const { consent_type, granted, note } = parsed.data;

    const result = await recordStaffConsent(prisma, requireActor(req).userId, studentId(req), {
      consentType: consent_type,
      granted,
      ...(note ? { note } : {}),
    });
    res.status(201).json({
      id: result.recordId,
      groups_reevaluated: result.reevaluatedGroups.length,
    });
  };
}
