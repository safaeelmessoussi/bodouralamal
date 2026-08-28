import type { Request, Response } from 'express';

import type { PrismaClient } from '../generated/prisma/client.js';
import { requireActor } from '../middleware/authenticate.js';
import {
  createPartner,
  deletePartner,
  listPartners,
  listPublicPartners,
  updatePartner,
  type PartnerRow,
  type PublicPartner,
} from '../services/partner.service.js';
import { idParam, parse } from './parse.js';
import { createPartnerSchema, updatePartnerSchema } from '../validators/partner.validators.js';

/**
 * Partners over HTTP (NEW N).
 *
 * **Two DTOs, written out separately.** The public one carries `id` and `name`;
 * the management one adds ordering, visibility and the TD-15 version. Building
 * the public one by trimming the management one is how a field added for the
 * back office reaches a public page (§16.2 Revision 38) — so they are two
 * literals, not one with a filter.
 */
function publicDto(row: PublicPartner): { id: string; name: string } {
  return { id: row.id, name: row.name };
}

function adminDto(row: PartnerRow): {
  id: string;
  name: string;
  display_order: number | null;
  is_visible: boolean;
  version: number;
} {
  return {
    id: row.id,
    name: row.name,
    display_order: row.displayOrder,
    is_visible: row.isVisible,
    version: row.version,
  };
}

/** `GET /partners` — public; §5.1's landing section reads exactly this. */
export function listPublic(prisma: PrismaClient) {
  return async (_req: Request, res: Response): Promise<void> => {
    const partners = await listPublicPartners(prisma);
    res.json({ data: partners.map(publicDto) });
  };
}

export function list(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const partners = await listPartners(prisma, requireActor(req));
    res.json({ data: partners.map(adminDto) });
  };
}

export function create(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = parse(createPartnerSchema, req.body ?? {});
    const partner = await createPartner(prisma, requireActor(req), {
      name: body.name,
      ...(body.display_order !== undefined ? { displayOrder: body.display_order } : {}),
      ...(body.is_visible !== undefined ? { isVisible: body.is_visible } : {}),
    });
    res.status(201).json({ data: adminDto(partner) });
  };
}

export function update(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = parse(updatePartnerSchema, req.body ?? {});
    const partner = await updatePartner(
      prisma,
      requireActor(req),
      idParam(req, 'id'),
      body.version,
      {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.display_order !== undefined ? { displayOrder: body.display_order } : {}),
        ...(body.is_visible !== undefined ? { isVisible: body.is_visible } : {}),
      },
    );
    res.json({ data: adminDto(partner) });
  };
}

export function remove(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    await deletePartner(prisma, requireActor(req), idParam(req, 'id'));
    res.status(204).end();
  };
}
