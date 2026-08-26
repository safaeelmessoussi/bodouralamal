import type { Request, Response } from 'express';

import type { PrismaClient } from '../generated/prisma/client.js';
import {
  createSchedulingType,
  deleteSchedulingType,
  listSchedulingTypes,
  reorderSchedulingTypes,
  updateSchedulingType,
} from '../services/scheduling-type.service.js';
import { requireActor } from '../middleware/authenticate.js';
import { idParam, parse } from './parse.js';
import { schedulingTypeDto } from './dto.js';
import { reorderSchema } from '../validators/reorder.validators.js';
import {
  createSchedulingTypeSchema,
  updateSchedulingTypeSchema,
} from '../validators/scheduling-type.validators.js';

/**
 * `GET /admin/scheduling-types` and its writes (R110, NEW H).
 *
 * **`/admin/` is a routing namespace, not an authorization boundary** — the
 * sentence this codebase repeats wherever the prefix appears. The read is open
 * to any staff member who may put something on the timetable, a مؤطِّرة included
 * (R93/R94): a picker that refused her would be a form she cannot open. The
 * writes are Super Admin only (OD-01). Both are asserted in the service.
 */
export function list(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const rows = await listSchedulingTypes(prisma, requireActor(req));
    res.json({ data: rows.map(schedulingTypeDto) });
  };
}

export function create(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = parse(createSchedulingTypeSchema, req.body);
    const created = await createSchedulingType(prisma, requireActor(req), {
      name: body.name,
      structuralKind: body.structural_kind,
      attendanceRequired: body.attendance_required,
    });
    // The count is 0 on a fresh row by construction; stating it keeps the
    // create response the same shape the list returns.
    res.status(201).json(schedulingTypeDto({ ...created, eventCount: 0 }));
  };
}

export function update(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = parse(updateSchedulingTypeSchema, req.body);
    const updated = await updateSchedulingType(
      prisma,
      requireActor(req),
      idParam(req, 'id'),
      body.version,
      {
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.attendance_required === undefined
          ? {}
          : { attendanceRequired: body.attendance_required }),
      },
    );
    res.json(schedulingTypeDto({ ...updated, eventCount: 0 }));
  };
}

export function remove(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    await deleteSchedulingType(prisma, requireActor(req), idParam(req, 'id'));
    res.status(204).end();
  };
}

export function reorder(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = parse(reorderSchema, req.body ?? {});
    const ids = await reorderSchedulingTypes(prisma, requireActor(req), body.ids);
    res.json({ data: { ids } });
  };
}
