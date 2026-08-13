import type { Request, Response } from 'express';
import { z } from 'zod';

import type { PrismaClient } from '../generated/prisma/client.js';
import { requireActor } from '../middleware/authenticate.js';
import {
  enrolAtLevel,
  listEnrollments,
  unenrolById,
  updateEnrollmentPlacement,
} from '../services/enrollment.service.js';
import { idParam } from './parse.js';
import { parse } from './parse.js';

/**
 * Enrolment as its own surface (§7 R66, §14.1 R74).
 *
 * **`administrative_group_id` is optional and `null` is a real answer**, not a
 * missing one: R66 made a Level enrollable without any subdivision, so a request
 * that names no Group is enrolling into the Level itself — which is the case
 * that had no route at all.
 */
const createSchema = z
  .object({
    student_id: z.string().uuid(),
    level_id: z.string().uuid(),
    branch_id: z.string().uuid(),
    administrative_group_id: z.string().uuid().nullable().optional(),
  })
  .strict();

const querySchema = z
  .object({ level_id: z.string().uuid().optional(), branch_id: z.string().uuid().optional() })
  .strict();

export function list(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const q = parse(querySchema, req.query ?? {});
    res.json({
      data: await listEnrollments(prisma, requireActor(req), {
        ...(q.level_id ? { levelId: q.level_id } : {}),
        ...(q.branch_id ? { branchId: q.branch_id } : {}),
      }),
    });
  };
}

export function create(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const b = parse(createSchema, req.body ?? {});
    const row = await enrolAtLevel(prisma, requireActor(req), {
      studentId: b.student_id,
      levelId: b.level_id,
      branchId: b.branch_id,
      ...(b.administrative_group_id === undefined
        ? {}
        : { administrativeGroupId: b.administrative_group_id }),
    });
    res.status(201).json({ id: row.id });
  };
}

/**
 * `PATCH /admin/enrollments/{id}` — change the placement **within its Level**.
 *
 * **`level_id` is deliberately absent.** BR-21 makes `(student, level)` unique,
 * so an enrolment *is* that pair: moving to another Level is ending one and
 * beginning another, which the delete and create verbs already express.
 * `.strict()` refuses the key rather than dropping it, so a client that sends
 * one is told rather than silently ignored (the R55/R57 lesson).
 */
const patchSchema = z
  .object({
    administrative_group_id: z.string().uuid().nullable().optional(),
    branch_id: z.string().uuid().optional(),
  })
  .strict();

export function update(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const b = parse(patchSchema, req.body ?? {});
    await updateEnrollmentPlacement(prisma, requireActor(req), idParam(req, 'id'), {
      ...(b.administrative_group_id === undefined
        ? {}
        : { administrativeGroupId: b.administrative_group_id }),
      ...(b.branch_id === undefined ? {} : { branchId: b.branch_id }),
    });
    res.status(204).end();
  };
}

/** `DELETE /admin/enrollments/{id}` — end it, group or not (R66). */
export function remove(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    await unenrolById(prisma, requireActor(req), idParam(req, 'id'));
    res.status(204).end();
  };
}
