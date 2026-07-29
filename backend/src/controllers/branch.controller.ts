import type { Request, Response } from 'express';
import { pageParamsFrom } from '../lib/pagination.js';

import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { requireActor } from '../middleware/authenticate.js';
import * as branches from '../services/branch.service.js';
import {
  createBranchSchema,
  createRoomSchema,
  updateBranchSchema,
  updateRoomSchema,
  uuidParam,
} from '../validators/branch.validators.js';

/**
 * Branches & Rooms (SRS §5.6, §14.2).
 *
 * Controllers validate with Zod, call **one** service method, and map the
 * result — no business logic here (§16.2).
 */

/** Zod failures become `400 VALIDATION_FAILED` in the envelope, never a 500. */
function parse<T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: unknown } }, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success || result.data === undefined) {
    throw new AppError('VALIDATION_FAILED', 'schema validation failed', {
      issues: (result.error as { issues?: unknown })?.issues ?? [],
    });
  }
  return result.data;
}

const id = (req: Request, key: string): string =>
  parse<string>(uuidParam, req.params[key]);

export function listBranches(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    res.json(await branches.listBranches(prisma, requireActor(req), pageParamsFrom(req.query)));
  };
}

export function createBranch(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = parse(createBranchSchema, req.body);
    // Pass through only what the client actually SUPPLIED. Coercing an absent
    // field to null would make it look supplied, and the §2.2 Super-Admin-only
    // check on display_order tests presence — so a plain Admin creating a
    // branch with no ordering at all would have been refused.
    const branch = await branches.createBranch(prisma, requireActor(req), {
      name: body.name,
      ...(body.operational_start_date !== undefined
        ? { operationalStartDate: body.operational_start_date }
        : {}),
      ...(body.display_order !== undefined ? { displayOrder: body.display_order } : {}),
      // Revision 35 public fields — same absent-stays-absent rule.
      ...(body.address !== undefined ? { address: body.address } : {}),
      ...(body.phone !== undefined ? { phone: body.phone } : {}),
      ...(body.email !== undefined ? { email: body.email } : {}),
      ...(body.opening_hours_ar !== undefined ? { openingHoursAr: body.opening_hours_ar } : {}),
      ...(body.google_maps_url !== undefined ? { googleMapsUrl: body.google_maps_url } : {}),
    });
    res.status(201).json(branch);
  };
}

export function updateBranch(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = parse(updateBranchSchema, req.body);
    const branch = await branches.updateBranch(prisma, requireActor(req), id(req, 'id'), body.version, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.operational_start_date !== undefined
        ? { operationalStartDate: body.operational_start_date }
        : {}),
      ...(body.display_order !== undefined ? { displayOrder: body.display_order } : {}),
      // Revision 35 public fields — same absent-stays-absent rule.
      ...(body.address !== undefined ? { address: body.address } : {}),
      ...(body.phone !== undefined ? { phone: body.phone } : {}),
      ...(body.email !== undefined ? { email: body.email } : {}),
      ...(body.opening_hours_ar !== undefined ? { openingHoursAr: body.opening_hours_ar } : {}),
      ...(body.google_maps_url !== undefined ? { googleMapsUrl: body.google_maps_url } : {}),
    });
    res.json(branch);
  };
}

export function deleteBranch(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    await branches.deleteBranch(prisma, requireActor(req), id(req, 'id'));
    res.status(204).end();
  };
}

export function listRooms(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    res.json(
      await branches.listRooms(prisma, requireActor(req), id(req, 'id'), pageParamsFrom(req.query)),
    );
  };
}

export function createRoom(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = parse(createRoomSchema, req.body);
    const room = await branches.createRoom(prisma, requireActor(req), id(req, 'id'), body);
    res.status(201).json(room);
  };
}

export function updateRoom(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = parse(updateRoomSchema, req.body);
    const room = await branches.updateRoom(prisma, requireActor(req), id(req, 'id'), body.version, {
      ...(body.name !== undefined ? { name: body.name } : {}),
    });
    res.json(room);
  };
}

export function deleteRoom(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    await branches.deleteRoom(prisma, requireActor(req), id(req, 'id'));
    res.status(204).end();
  };
}
