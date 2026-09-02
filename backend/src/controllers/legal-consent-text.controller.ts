import type { Request, Response } from 'express';
import { z } from 'zod';

import type { PrismaClient } from '../generated/prisma/client.js';
import { requireActor } from '../middleware/authenticate.js';
import { idParam, parse } from './parse.js';
import { legalConsentTextDto, publicConsentTextDto } from './dto.js';
import {
  activateConsentText,
  activeConsentText,
  createConsentText,
  listConsentTexts,
  updateConsentText,
} from '../services/legal-consent-text.service.js';

/**
 * **The versioned legal consent wording** (§2.3, §4.1a; Owner, 2026-09-02).
 *
 * Super Admin only for everything under `/admin/`, enforced in the service
 * against live rows (TD-12) — the `/admin/` prefix is not a permission
 * boundary.
 *
 * `GET /registration/consent-text` is deliberately **anonymous**: the
 * registration form is reached before any account exists, and the wording it
 * must display is the wording it is about to record. Publishing it is not a
 * disclosure — it is the notice the association is legally obliged to show the
 * person before they agree to it.
 */
const bodySchema = z
  .object({
    version_label: z.string().min(1).max(60),
    /**
     * No `.trim()` here. The service trims the ends and nothing else, because
     * line breaks and paragraph structure are part of the wording somebody
     * approved — Zod's `.trim()` would be a second, differently-shaped
     * normalisation, and two of them is one too many.
     */
    body_arabic: z.string().min(1).max(20000),
  })
  .strict();

const updateBodySchema = bodySchema.extend({
  /** TD-15 — two Super Admins on one draft. */
  version: z.coerce.number().int().min(0),
});

/** `GET /admin/legal-consent-texts` — every version, newest first. */
export function list(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const rows = await listConsentTexts(prisma, requireActor(req));
    res.json({ data: rows.map(legalConsentTextDto) });
  };
}

/** `POST /admin/legal-consent-texts` — a DRAFT; activating is a second step. */
export function create(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const b = parse(bodySchema, req.body ?? {});
    const row = await createConsentText(prisma, requireActor(req), {
      versionLabel: b.version_label,
      bodyArabic: b.body_arabic,
    });
    res.status(201).json(legalConsentTextDto(row));
  };
}

/** `PATCH /admin/legal-consent-texts/{id}` — a draft only; see the service. */
export function update(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const b = parse(updateBodySchema, req.body ?? {});
    const row = await updateConsentText(
      prisma,
      requireActor(req),
      idParam(req, 'id'),
      { versionLabel: b.version_label, bodyArabic: b.body_arabic },
      b.version,
    );
    res.json(legalConsentTextDto(row));
  };
}

/**
 * `POST /admin/legal-consent-texts/{id}/activate` — put it into force.
 *
 * **Its own route, not a `status` field on the PATCH above.** Activation is a
 * different decision with a different audit action and a different invariant
 * (exactly one active version, enforced by a partial unique index); folding it
 * into the edit would make *correcting a typo in a draft* and *deciding what
 * every future applicant is held to* the same request.
 */
export function activate(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const row = await activateConsentText(prisma, requireActor(req), idParam(req, 'id'));
    res.json(legalConsentTextDto(row));
  };
}

/**
 * `GET /registration/consent-text` — the wording the form must display.
 *
 * **The id travels back with the submission**, and the server refuses a
 * mismatch: that pair is what makes *«displayed X, recorded X»* a property of
 * the system rather than a hope. Fails closed with `503` /
 * `CONSENT_TEXT_VERSION_NOT_CONFIGURED` when nothing is in force.
 */
export function readActive(prisma: PrismaClient) {
  return async (_req: Request, res: Response): Promise<void> => {
    const row = await activeConsentText(prisma);
    res.json(publicConsentTextDto(row));
  };
}
