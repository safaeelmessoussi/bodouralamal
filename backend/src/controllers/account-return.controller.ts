import type { Request, Response } from 'express';
import { z } from 'zod';

import type { PrismaClient } from '../generated/prisma/client.js';
import type { AppConfig } from '../lib/config.js';
import { AppError } from '../lib/errors.js';
import { verifyOnboardingToken } from '../lib/onboarding-token.js';
import { REFERENCE_CODE_PREFIX } from '../lib/reference-code.js';
import { requireActor } from '../middleware/authenticate.js';
import {
  approveAccountReturn,
  listPendingReturns,
  rejectAccountReturn,
  requestAccountReturn,
} from '../services/account-return.service.js';
import { idParam, parse } from './parse.js';

/**
 * **A former beneficiary asks for her archived account back** (Owner decision,
 * 2026-09-04).
 *
 * The request side mirrors R132's claim exactly: **public but
 * onboarding-token-gated**, because she has proven control of a Google identity
 * and deliberately holds no session — issuing one would already be the
 * reactivation she is asking permission for.
 */

const requestSchema = z
  .object({
    reference_code: z
      .string()
      .trim()
      .max(16)
      .regex(new RegExp(`^${REFERENCE_CODE_PREFIX}-[0-9A-Za-z]{4,12}$`), 'expected a reference code'),
    /**
     * **Her CURRENT name** (TD-9 field limits, §1.1's two parts). The erased one
     * is not restored and is not asked for: it no longer exists, and inviting
     * her to retype it would be asking her to reconstruct a record the closure
     * deliberately destroyed.
     */
    first_name_arabic: z.string().trim().min(1).max(60),
    last_name_arabic: z.string().trim().min(1).max(60),
    phone: z.string().trim().max(30).optional(),
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
    const row = await requestAccountReturn(prisma, {
      identity: {
        email: verified.claims.email,
        providerSubjectId: verified.claims.provider_subject_id,
      },
      jti: verified.claims.jti,
      expiresAt: new Date(verified.claims.exp * 1000),
      referenceCode: body.reference_code,
      firstNameArabic: body.first_name_arabic,
      lastNameArabic: body.last_name_arabic,
      phone: body.phone,
    });

    // The request's own id and nothing else: it binds nothing, confirms nobody,
    // and there is no status for her to poll that would not disclose a decision
    // before an administrator has communicated it.
    res.status(201).json({ id: row.id, status: row.status });
  };
}

export function listPending(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const rows = await listPendingReturns(prisma, requireActor(req));
    res.json({
      data: rows.map((row) => ({
        id: row.id,
        subject_id: row.subjectId,
        // What she says her name is NOW — which is what an administrator
        // verifies against whatever the association holds on paper.
        first_name_arabic: row.firstNameArabic,
        last_name_arabic: row.lastNameArabic,
        phone: row.phone,
        created_at: row.createdAt.toISOString(),
      })),
    });
  };
}

export function approve(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const result = await approveAccountReturn(prisma, requireActor(req), idParam(req, 'id'));
    res.json({ approved: true, subject_id: result.subjectId });
  };
}

export function reject(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = parse(rejectSchema, req.body ?? {});
    await rejectAccountReturn(prisma, requireActor(req), idParam(req, 'id'), body.reason);
    res.status(204).end();
  };
}
