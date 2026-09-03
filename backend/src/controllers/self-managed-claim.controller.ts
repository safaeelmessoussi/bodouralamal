import type { Request, Response } from 'express';
import { z } from 'zod';

import type { PrismaClient } from '../generated/prisma/client.js';
import type { AppConfig } from '../lib/config.js';
import { AppError } from '../lib/errors.js';
import { verifyOnboardingToken } from '../lib/onboarding-token.js';
import { REFERENCE_CODE_PREFIX } from '../lib/reference-code.js';
import { requireActor } from '../middleware/authenticate.js';
import {
  approveSelfManagedClaim,
  listPendingClaims,
  rejectSelfManagedClaim,
  requestSelfManagedClaim,
} from '../services/self-managed-claim.service.js';
import { idParam, parse } from './parse.js';

/**
 * `تحويل الحساب إلى حساب مستقل` — SRS Revision 132.
 *
 * The request half is **public but gated by the signed onboarding token**,
 * exactly as `POST /registrations` is and for the same reason: the caller has
 * proven control of a Google identity and holds no session, because issuing one
 * would already be the transition. The token carries the VERIFIED email and
 * subject, so no client can substitute another identity at submission (§20
 * rule 9), and it is single-use.
 *
 * The decision half is **Super Admin only**, asserted in the service against
 * live rows (R112/TD-12) — deciding who may hold a login is the same authority
 * as every other account act.
 */

/**
 * The reference code as it is spoken and written: `BA-7K4M2`. Accepted
 * case-insensitively and with surrounding space, because it is copied off paper.
 */
const requestSchema = z
  .object({
    reference_code: z
      .string()
      .trim()
      .max(16)
      .regex(new RegExp(`^${REFERENCE_CODE_PREFIX}-[0-9A-Za-z]{4,12}$`), 'expected a reference code'),
  })
  .strict();

/** TD-9: a decision's reason is 1–500 characters, as on every other refusal. */
const rejectSchema = z.object({ reason: z.string().trim().min(1).max(500) }).strict();

export function request(prisma: PrismaClient, config: AppConfig) {
  return async (req: Request, res: Response): Promise<void> => {
    const raw = req.header('x-onboarding-token');
    if (!raw) throw new AppError('VALIDATION_FAILED', 'missing X-Onboarding-Token header');

    const verified = verifyOnboardingToken(raw, config.ONBOARDING_TOKEN_KEY);
    if (!verified.valid) {
      // Forged or expired is a validation failure; a VALID token used twice is
      // the STATE_CONFLICT the service raises when it consumes the jti.
      throw new AppError('VALIDATION_FAILED', `onboarding token ${verified.reason}`);
    }

    const body = parse(requestSchema, req.body ?? {});
    const claim = await requestSelfManagedClaim(prisma, {
      identity: {
        email: verified.claims.email,
        providerSubjectId: verified.claims.provider_subject_id,
      },
      jti: verified.claims.jti,
      expiresAt: new Date(verified.claims.exp * 1000),
      referenceCode: body.reference_code,
    });

    // The claim's own id and nothing else: it binds nothing, names nobody, and
    // there is no status for her to poll that would not disclose a decision
    // before an administrator has communicated it.
    res.status(201).json({ id: claim.id, status: claim.status });
  };
}

export function listPending(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const rows = await listPendingClaims(prisma, requireActor(req));
    res.json({
      data: rows.map((row) => ({
        id: row.id,
        beneficiary_id: row.beneficiaryId,
        beneficiary_name: row.beneficiaryName,
        reference_code: row.referenceCode,
        email: row.email,
        created_at: row.createdAt.toISOString(),
      })),
    });
  };
}

export function approve(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const result = await approveSelfManagedClaim(prisma, requireActor(req), idParam(req, 'id'));
    res.json({ beneficiary_id: result.beneficiaryId, bound: true });
  };
}

export function reject(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = parse(rejectSchema, req.body ?? {});
    await rejectSelfManagedClaim(prisma, requireActor(req), idParam(req, 'id'), body.reason);
    res.status(204).end();
  };
}
