import type { Request, Response } from 'express';
import { z } from 'zod';

import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { requireActor } from '../middleware/authenticate.js';
import { idParam, parse } from './parse.js';
import { legalDocumentDto, publicLegalDocumentDto } from './dto.js';
import {
  activateDocument,
  activeDocument,
  createDocument,
  listDocuments,
  updateDocument,
  type LegalDocumentKind,
} from '../services/legal-document.service.js';

/**
 * **The versioned Privacy Policy and Terms of Use** (R138 §12/§13).
 *
 * Super Admin only for everything under `/admin/`, enforced in the service
 * against live rows (TD-12) exactly as `legal-consent-text.controller.ts`
 * already does — the `/admin/` prefix is not the permission boundary.
 *
 * `GET /legal-documents/{kind}` is deliberately **anonymous**: a Privacy
 * Policy nobody could read without an account would not be a notice.
 */
const KIND_PARAM = z.enum(['privacy_policy', 'terms_of_use']);

function kindParam(req: Request): LegalDocumentKind {
  const result = KIND_PARAM.safeParse(req.params['kind']);
  if (!result.success) {
    throw new AppError('VALIDATION_FAILED', 'unknown legal document kind', {
      issues: [{ path: 'kind', message: 'must be privacy_policy or terms_of_use' }],
    });
  }
  return result.data;
}

const createBodySchema = z
  .object({
    kind: KIND_PARAM,
    version_label: z.string().min(1).max(60),
    // No `.trim()` — the service trims the ends and nothing else, for the
    // same reason `legal-consent-text.controller.ts` records: line breaks and
    // paragraph structure are part of the wording somebody approved.
    body_arabic: z.string().min(1).max(20000),
  })
  .strict();

const updateBodySchema = z
  .object({
    version_label: z.string().min(1).max(60),
    body_arabic: z.string().min(1).max(20000),
    /** TD-15 — two Super Admins on one draft. */
    version: z.coerce.number().int().min(0),
  })
  .strict();

/** `GET /admin/legal-documents/{kind}` — every version of one kind, newest first. */
export function list(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const rows = await listDocuments(prisma, requireActor(req), kindParam(req));
    res.json({ data: rows.map(legalDocumentDto) });
  };
}

/** `POST /admin/legal-documents` — a DRAFT of one kind; activating is a second step. */
export function create(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const b = parse(createBodySchema, req.body ?? {});
    const row = await createDocument(prisma, requireActor(req), {
      kind: b.kind,
      versionLabel: b.version_label,
      bodyArabic: b.body_arabic,
    });
    res.status(201).json(legalDocumentDto(row));
  };
}

/** `PATCH /admin/legal-documents/{id}` — a draft only; see the service. */
export function update(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const b = parse(updateBodySchema, req.body ?? {});
    const row = await updateDocument(
      prisma,
      requireActor(req),
      idParam(req, 'id'),
      { versionLabel: b.version_label, bodyArabic: b.body_arabic },
      b.version,
    );
    res.json(legalDocumentDto(row));
  };
}

/**
 * `POST /admin/legal-documents/{id}/activate` — put it into force.
 *
 * Its own route, not a `status` field on the PATCH above — the same reason
 * `legal-consent-text.controller.ts` keeps its own activation separate:
 * activation is a different decision with a different audit action and a
 * different invariant (one active version per kind), and folding it into the
 * edit would make *correcting a typo in a draft* and *deciding what the
 * public reads* the same request.
 */
export function activate(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const row = await activateDocument(prisma, requireActor(req), idParam(req, 'id'));
    res.json(legalDocumentDto(row));
  };
}

/**
 * `GET /legal-documents/{kind}` — the version the public page must show.
 *
 * Fails closed with `503` / `LEGAL_DOCUMENT_NOT_CONFIGURED` when nothing of
 * that kind is in force, the same shape `GET /registration/consent-text`
 * already fails with.
 */
export function readActive(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const row = await activeDocument(prisma, kindParam(req));
    res.json(publicLegalDocumentDto(row));
  };
}
