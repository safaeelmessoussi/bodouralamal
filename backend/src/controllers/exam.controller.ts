import type { Request, Response } from 'express';

import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { pageParamsFrom } from '../lib/pagination.js';
import { requireActor } from '../middleware/authenticate.js';
import {
  createPhysicalExam,
  deleteExam,
  listExams,
  updatePhysicalExam,
} from '../services/exam.service.js';
import {
  createExamSchema,
  listExamsQuerySchema,
  updateExamSchema,
} from '../validators/exam.validators.js';
import { examDto, pageOf } from './dto.js';
import { idParam, parse } from './parse.js';

/**
 * Exams (TD-3.6 as amended by SRS Revision 58).
 *
 * **Only the `physical` mode exists.** `online` is declared in the schema and
 * refused here with a coded reason, so a client learns *which* capability is
 * missing rather than receiving a generic validation error — the interface
 * offers the option disabled for the same purpose (§14.4).
 *
 * No online endpoint is added *"for later"*: a route with nothing behind it is a
 * promise the platform has not made, and it would appear in the contract as a
 * capability that exists.
 */
export function create(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const b = parse(createExamSchema, req.body ?? {});
    if (b.mode === 'online') {
      throw new AppError('STATE_CONFLICT', 'online exams are not built yet (§4.6, R58)', {
        reason: 'ONLINE_NOT_AVAILABLE',
      });
    }

    const result = await createPhysicalExam(prisma, requireActor(req), {
      title: b.title,
      ...(b.description !== undefined ? { description: b.description } : {}),
      date: b.date,
      startTime: b.start_time,
      endTime: b.end_time,
      levelId: b.level_id,
      subjectId: b.subject_id,
      academicYearId: b.academic_year_id,
      branchId: b.branch_id,
      roomId: b.room_id,
      ...(b.administrative_group_id !== undefined
        ? { administrativeGroupId: b.administrative_group_id }
        : {}),
      ...(b.staff ? { staff: b.staff.map((s) => ({ userId: s.user_id, position: s.position })) } : {}),
    });
    res.status(201).json({ id: result.id });
  };
}

export function update(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const b = parse(updateExamSchema, req.body ?? {});
    await updatePhysicalExam(prisma, requireActor(req), idParam(req, 'id'), {
      version: b.version,
      ...(b.title !== undefined ? { title: b.title } : {}),
      ...(b.description !== undefined ? { description: b.description } : {}),
      ...(b.date !== undefined ? { date: b.date } : {}),
      ...(b.start_time !== undefined ? { startTime: b.start_time } : {}),
      ...(b.end_time !== undefined ? { endTime: b.end_time } : {}),
      ...(b.room_id !== undefined ? { roomId: b.room_id } : {}),
      ...(b.administrative_group_id !== undefined
        ? { administrativeGroupId: b.administrative_group_id }
        : {}),
      ...(b.staff ? { staff: b.staff.map((s) => ({ userId: s.user_id, position: s.position })) } : {}),
    });
    res.status(204).end();
  };
}

export function remove(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    await deleteExam(prisma, requireActor(req), idParam(req, 'id'));
    res.status(204).end();
  };
}

export function list(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const q = parse(listExamsQuerySchema, req.query);
    const result = await listExams(prisma, requireActor(req), {
      ...(q.branch_id !== undefined ? { branchId: q.branch_id } : {}),
      ...(q.level_id !== undefined ? { levelId: q.level_id } : {}),
      ...(q.from !== undefined ? { from: q.from } : {}),
      ...(q.to !== undefined ? { to: q.to } : {}),
      ...pageParamsFrom(req.query),
    });
    res.json(pageOf(result, examDto));
  };
}
