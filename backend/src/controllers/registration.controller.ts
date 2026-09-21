import type { Request, Response } from 'express';
import { z } from 'zod';

import type { PrismaClient } from '../generated/prisma/client.js';
import type { AppConfig } from '../lib/config.js';
import { AppError } from '../lib/errors.js';
import { offeredCircleSlots } from '../services/registration-circle-slots.service.js';
import { register } from '../services/registration.service.js';
import { registrationSchema } from '../validators/registration.validators.js';

/**
 * `POST /registrations` (SRS TD-3.2, §4.1b step 5).
 *
 * Public, but gated by the signed onboarding token rather than a session — at
 * this point no account exists yet (§4.1b step 4c).
 */
export function createRegistration(prisma: PrismaClient, config: AppConfig) {
  return async (req: Request, res: Response): Promise<void> => {
    // The token arrives in a header, not the body: it is a credential, and
    // keeping it out of the body keeps it out of anything that logs a payload
    // (TD-14 forbids logging request bodies on registration endpoints anyway).
    const token = req.header('x-onboarding-token');
    if (!token) throw new AppError('VALIDATION_FAILED', 'missing X-Onboarding-Token header');

    const parsed = registrationSchema.safeParse(req.body);
    if (!parsed.success) {
      // `.strict()` means a body carrying `email` or `provider_subject_id` lands
      // here rather than being quietly dropped (§20 rule 9).
      throw new AppError('VALIDATION_FAILED', 'registration payload rejected', {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }

    const result = await register(prisma, token, parsed.data, config.ONBOARDING_TOKEN_KEY);
    res.status(201).json({
      applicant_id: result.applicantId,
      // R62 — no child account exists yet; these identify the applications an
      // approver will decide, one at a time.
      child_application_ids: result.childApplicationIds,
      account_status: result.accountStatus,
    });
  };
}

/**
 * `GET /registration/circle-slots?category_id=&branch_id=` — **the memorisation
 * circles a first-time مستفيدة may order** (SRS Revision 168 §1). Anonymous,
 * like the consent text beside it: the applicant has no account yet. It
 * publishes the least that lets her choose — see `offeredCircleSlots`.
 */
const circleSlotsQuery = z.object({ category_id: z.uuid(), branch_id: z.uuid() }).strict();

export function circleSlots(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const parsed = circleSlotsQuery.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', 'category_id and branch_id are required uuids');
    }
    res.set('Cache-Control', 'no-store');
    res.json({
      data: await offeredCircleSlots(prisma, parsed.data.category_id, parsed.data.branch_id),
    });
  };
}
