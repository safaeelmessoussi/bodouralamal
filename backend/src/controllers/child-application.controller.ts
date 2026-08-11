import type { Request, Response } from 'express';
import { z } from 'zod';

import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { requireActor } from '../middleware/authenticate.js';
import {
  decideChildApplication,
  listMyApplications,
  proposeMatches,
  submitChildApplications,
} from '../services/child-application.service.js';
import { CONSENT_TEXT_VERSION_KEY } from '../services/registration.service.js';
import { idParam, parse } from './parse.js';

/**
 * Child applications over HTTP (SRS Revision 62).
 *
 * Two write surfaces and two reads:
 *
 * * `POST /child-applications` — an **already-signed-in** adult (a student, or a
 *   parent adding another child) submits a request. The registration flow uses
 *   the *same service* through `POST /registrations`, because two
 *   implementations of one shape drift.
 * * `POST /admin/child-applications/{id}/decide` — one child, decided alone.
 * * `GET /child-applications/mine` — a parent's own, and nothing else.
 * * `GET /admin/child-applications/{id}/matches` — proposals, never a merge.
 */
const SCHOOLING_STAGE = z.enum([
  'pre_primary',
  'primary',
  'middle',
  'high',
  'post_secondary',
  'not_in_school',
]);

const submitSchema = z
  .object({
    children: z
      .array(
        z
          .object({
            first_name_arabic: z.string().trim().min(1).max(60),
            last_name_arabic: z.string().trim().min(1).max(60),
            sex: z.enum(['female', 'male']).optional(),
            schooling_stage: SCHOOLING_STAGE.optional(),
            requested_category_id: z.uuid().optional(),
            /**
             * R62.3b — **per child**, because a parent may allow photographs of
             * one and refuse for another. Required rather than optional: BR-1
             * makes absence a refusal, and an unstated answer must not be
             * mistaken for one that was given.
             */
            consent_media_release: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(12),
    /** §4.1a — a refusal cannot reach the service, so the type refuses it here. */
    consent_data_processing: z.literal(true),
  })
  .strict();

const decideSchema = z
  .object({
    approve: z.boolean(),
    match_existing_user_id: z.uuid().optional(),
    administrative_group_id: z.uuid().optional(),
    rejection_reason: z
      .enum(['duplicate_application', 'insufficient_information', 'not_eligible', 'other'])
      .optional(),
    internal_note: z.string().trim().max(500).optional(),
  })
  .strict();

/**
 * The consent text version **in force now**, captured onto the application.
 *
 * Read here rather than at approval: R62.3b makes this the version the parent
 * actually saw, and `legal.consent_text_version` is editable between the two
 * moments. Approval must never substitute the current value for it.
 */
async function currentConsentTextVersion(prisma: PrismaClient): Promise<string> {
  const row = await prisma.systemSetting.findUnique({
    where: { key: CONSENT_TEXT_VERSION_KEY },
    select: { value: true },
  });
  const version = typeof row?.value === 'string' ? row.value.trim() : '';
  if (!version) {
    // §4.1a: no version, no lawful consent, no application. Failing closed is
    // what stops one being recorded against text that does not exist.
    throw new AppError('STATE_CONFLICT', 'no consent text version is configured', {
      reason: 'CONSENT_TEXT_VERSION_MISSING',
    });
  }
  return version;
}

export function submit(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const body = parse(submitSchema, req.body ?? {});
    const consentTextVersion = await currentConsentTextVersion(prisma);

    const result = await prisma.$transaction((tx) =>
      submitChildApplications(tx, actor.userId, {
        consentDataProcessing: true,
        consentTextVersion,
        children: body.children.map((c) => ({
          firstNameArabic: c.first_name_arabic,
          lastNameArabic: c.last_name_arabic,
          ...(c.sex ? { sex: c.sex } : {}),
          ...(c.schooling_stage ? { schoolingStage: c.schooling_stage } : {}),
          ...(c.requested_category_id ? { requestedCategoryId: c.requested_category_id } : {}),
          consentMediaRelease: c.consent_media_release,
        })),
      }),
    );

    res.status(201).json({
      request_id: result.requestId,
      application_ids: result.applicationIds,
    });
  };
}

export function decide(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = parse(decideSchema, req.body ?? {});
    const result = await decideChildApplication(
      prisma,
      requireActor(req),
      idParam(req, 'id'),
      {
        approve: body.approve,
        ...(body.match_existing_user_id
          ? { matchExistingUserId: body.match_existing_user_id }
          : {}),
        ...(body.administrative_group_id
          ? { administrativeGroupId: body.administrative_group_id }
          : {}),
        ...(body.rejection_reason ? { rejectionReason: body.rejection_reason } : {}),
        ...(body.internal_note ? { internalNote: body.internal_note } : {}),
      },
    );

    res.json({
      child_user_id: result.childUserId,
      parent_role_granted: result.parentRoleGranted,
    });
  };
}

export function matches(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const rows = await proposeMatches(prisma, requireActor(req), idParam(req, 'id'));
    res.json({
      data: rows.map((r) => ({
        id: r.id,
        name_arabic: r.nameArabic,
        // The two facts that identify a child without a birth date (R62.3).
        reference_code: r.referenceCode,
        linked_parents: r.parents,
      })),
    });
  };
}

export function mine(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const rows = await listMyApplications(prisma, requireActor(req));
    res.json({
      data: rows.map((r) => ({
        id: r.id,
        request_id: r.requestId,
        first_name_arabic: r.firstNameArabic,
        last_name_arabic: r.lastNameArabic,
        status: r.status,
        /**
         * Bounded, and the only reason a parent is told (R62.8). `internal_note`
         * is **absent from this projection**, which is where that rule holds
         * rather than where it is merely stated.
         */
        rejection_reason: r.rejectionReason,
        reference_code: r.childUser?.referenceCode ?? null,
        decided_at: r.decidedAt?.toISOString() ?? null,
        created_at: r.createdAt.toISOString(),
      })),
    });
  };
}
