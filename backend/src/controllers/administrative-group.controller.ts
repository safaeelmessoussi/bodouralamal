import type { Request, Response } from 'express';

import type { PrismaClient } from '../generated/prisma/client.js';
import { pageParamsFrom } from '../lib/pagination.js';
import { requireActor } from '../middleware/authenticate.js';
import * as groups from '../services/administrative-group.service.js';
import * as enrolments from '../services/enrollment.service.js';
import { administrativeGroupDto, enrollmentDto, pageOf, rosterEntryDto } from './dto.js';
import { idParam, parse } from './parse.js';
import {
  createAdministrativeGroupSchema,
  enrolStudentSchema,
  listAdministrativeGroupsQuerySchema,
  updateAdministrativeGroupSchema,
} from '../validators/administrative-group.validators.js';

/**
 * Administrative Groups over HTTP (TD-3.12, §4.4c, Revision 43).
 *
 * Controllers validate with Zod, call **one** service method, and map the result
 * through a DTO — no business logic here (§16.2). In particular the permission
 * rule is **not** repeated: `assertCanManage` and `assertInScope` live in
 * `administrative-group.service.ts`, and the `/admin/` URL prefix is not the
 * boundary. A controller-side check would be a second, weaker copy of a rule the
 * service already enforces for every caller, including the jobs and tests that
 * never pass through Express.
 *
 * **Why these routes only reappear now.** The Revision 43 contract phase removed
 * the nine `/admin/groups` routes of the retired model, leaving the services
 * built and tested but unreachable. These four are the first of TD-3.12 to be
 * mounted; the roster verbs follow in the same section.
 */

export function list(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const filters = parse(listAdministrativeGroupsQuerySchema, req.query);
    const result = await groups.listAdministrativeGroups(prisma, requireActor(req), {
      // Absent stays absent. Coercing an omitted filter to `undefined` explicitly
      // is what keeps "not filtering by level" distinct from "filtering by no
      // level", which the service's `where` builder relies on.
      ...(filters.level_id !== undefined ? { levelId: filters.level_id } : {}),
      ...(filters.branch_id !== undefined ? { branchId: filters.branch_id } : {}),
      ...pageParamsFrom(req.query),
    });
    res.json(pageOf(result, administrativeGroupDto));
  };
}

export function create(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = parse(createAdministrativeGroupSchema, req.body ?? {});
    const group = await groups.createAdministrativeGroup(prisma, requireActor(req), {
      name: body.name,
      levelId: body.level_id,
      branchId: body.branch_id,
      ...(body.display_order !== undefined ? { displayOrder: body.display_order } : {}),
    });
    res.status(201).json(administrativeGroupDto(group));
  };
}

export function update(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = parse(updateAdministrativeGroupSchema, req.body ?? {});
    const group = await groups.updateAdministrativeGroup(prisma, requireActor(req), idParam(req, 'id'), {
      version: body.version,
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.display_order !== undefined ? { displayOrder: body.display_order } : {}),
    });
    res.json(administrativeGroupDto(group));
  };
}

export function remove(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    await groups.deleteAdministrativeGroup(prisma, requireActor(req), idParam(req, 'id'));
    res.status(204).end();
  };
}

/* ── Roster (TD-3.12, §5.6 enrollment screen) ────────────────────────────── */

export function listRoster(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const result = await enrolments.listGroupRoster(
      prisma,
      requireActor(req),
      idParam(req, 'id'),
      pageParamsFrom(req.query),
    );
    res.json(pageOf(result, rosterEntryDto));
  };
}

export function enrol(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = parse(enrolStudentSchema, req.body ?? {});
    const row = await enrolments.enrolStudent(
      prisma,
      requireActor(req),
      idParam(req, 'id'),
      body.student_id,
    );
    res.status(201).json(enrollmentDto(row));
  };
}

export function unenrol(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    await enrolments.unenrolStudent(
      prisma,
      requireActor(req),
      idParam(req, 'id'),
      idParam(req, 'studentId'),
    );
    res.status(204).end();
  };
}
