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
import { sortParamsFrom } from '../lib/sorting.js';
import { idParam, parse } from './parse.js';

/**
 * Exams (TD-3.6 as amended by SRS Revision 58).
 *
 * **This route schedules a `physical` SITTING, and `online` still belongs
 * elsewhere** — but no longer because it does not exist.
 *
 * R124 built the online half, at `/assessments`: that boundary asks for a paper
 * — a title, a maximum, a target and questions — while this one asks for a
 * room, a clock window and supervisors. One endpoint accepting either would be
 * a schema with two disjoint halves, so `online` is refused here and the reason
 * **names where to go** instead of saying it is unbuilt, which stopped being
 * true when the Owner ratified Revision 124.
 *
 * The code stays `ONLINE_NOT_AVAILABLE`: it is part of the TD-3.8 contract and
 * a client branching on it is still right to — *not available on this route* is
 * what it has always meant operationally. Renaming it would break that client
 * to improve a word.
 */
export function create(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const b = parse(createExamSchema, req.body ?? {});
    if (b.mode === 'online') {
      throw new AppError(
        'STATE_CONFLICT',
        'an online assessment is created at /assessments, not here (§4.6, R124)',
        { reason: 'ONLINE_NOT_AVAILABLE' },
      );
    }

    const result = await createPhysicalExam(prisma, requireActor(req), {
      title: b.title,
      maxGrade: b.max_grade,
      ...(b.description !== undefined ? { description: b.description } : {}),
      date: b.date,
      startTime: b.start_time,
      endTime: b.end_time,
      levelId: b.level_id,
      ...(b.scheduling_type_id !== undefined ? { schedulingTypeId: b.scheduling_type_id } : {}),
      subjectId: b.subject_id,
      academicYearId: b.academic_year_id,
      branchId: b.branch_id,
      roomId: b.room_id,
      // R109 — absent is the column's default, decided in the service.
      ...(b.visibility !== undefined ? { visibility: b.visibility } : {}),
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
      ...(b.scheduling_type_id !== undefined ? { schedulingTypeId: b.scheduling_type_id } : {}),
      ...(b.title !== undefined ? { title: b.title } : {}),
      ...(b.description !== undefined ? { description: b.description } : {}),
      ...(b.date !== undefined ? { date: b.date } : {}),
      ...(b.start_time !== undefined ? { startTime: b.start_time } : {}),
      ...(b.end_time !== undefined ? { endTime: b.end_time } : {}),
      ...(b.room_id !== undefined ? { roomId: b.room_id } : {}),
      // **R57's shape, caught here by its own test.** A validator that accepts a
      // key the update never maps answers 204, bumps the version and changes
      // nothing — which is what this line was missing for one commit.
      ...(b.max_grade !== undefined ? { maxGrade: b.max_grade } : {}),
      // R109 — absent leaves the tier alone. **The same shape as the line
      // above**: a validator that accepts a key an update never maps answers
      // 204, bumps the version and changes nothing.
      ...(b.visibility !== undefined ? { visibility: b.visibility } : {}),
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
      ...sortParamsFrom(req.query),
    });
    res.json(pageOf(result, examDto));
  };
}
