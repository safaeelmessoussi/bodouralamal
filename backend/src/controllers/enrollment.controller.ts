import type { Request, Response } from 'express';
import { sortParamsFrom } from '../lib/sorting.js';
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
    /**
     * **R122 — which semester this enrolment is for.** Required: an enrolment
     * with no period is the open-ended row that made *is she enrolled right
     * now* unanswerable, and the column is nullable only so rows written before
     * this revision stay honest.
     */
    academic_period_id: z.string().uuid(),
  })
  .strict();

const querySchema = z
  .object({
    level_id: z.string().uuid().optional(),
    branch_id: z.string().uuid().optional(),
    // R76.1 — parsed by the shared resolver, which refuses anything outside
    // this endpoint's own allow-list. Declared here so `.strict()` does not
    // reject the two parameters before the resolver ever sees them.
    sort_by: z.string().optional(),
    sort_dir: z.string().optional(),
  })
  .strict();

export function list(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const q = parse(querySchema, req.query ?? {});
    res.json({
      data: await listEnrollments(prisma, requireActor(req), {
        ...(q.level_id ? { levelId: q.level_id } : {}),
        ...(q.branch_id ? { branchId: q.branch_id } : {}),
        ...sortParamsFrom(req.query),
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
      academicPeriodId: b.academic_period_id,
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
 * **`level_id` AND `branch_id` are deliberately absent** (2026-08-18).
 *
 * An enrolment **is** `beneficiary + Level + Branch`. BR-21 makes
 * `(student, level)` unique, and R66 made `branch_id` the single answer to
 * *where is this student* — so changing either is not an edit of this
 * enrolment, it is a different enrolment. That move is already expressible:
 * **إنهاء التسجيل**, then **تسجيل مستفيدة** at the Level and Branch wanted.
 *
 * What remains editable is the *subdivision inside* the enrolment: the optional
 * Administrative Group, and the Teaching Circles, which are managed on their own
 * screen.
 *
 * `.strict()` refuses the keys rather than dropping them, so a client that sends
 * one is **told** rather than silently ignored (the R55/R57 lesson) — and a
 * forged request cannot move a beneficiary between branches.
 */
const patchSchema = z
  .object({
    administrative_group_id: z.string().uuid().nullable().optional(),
  })
  .strict();

export function update(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const b = parse(patchSchema, req.body ?? {});
    await updateEnrollmentPlacement(prisma, requireActor(req), idParam(req, 'id'), {
      ...(b.administrative_group_id === undefined
        ? {}
        : { administrativeGroupId: b.administrative_group_id }),
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
