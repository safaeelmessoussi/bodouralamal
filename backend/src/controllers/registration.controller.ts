import type { Request, Response } from 'express';

import type { PrismaClient } from '../generated/prisma/client.js';
import type { AppConfig } from '../lib/config.js';
import { AppError } from '../lib/errors.js';
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
      child_id: result.childId,
      account_status: result.accountStatus,
    });
  };
}
