import type { Request, Response } from 'express';

import type { PrismaClient } from '../generated/prisma/client.js';
import { requireActor } from '../middleware/authenticate.js';
import {
  scheduleExam,
  updateExamSchedule,
  type AvailabilityPolicy,
} from '../services/exam-scheduling.service.js';
import {
  scheduleExamSchema,
  updateExamScheduleSchema,
} from '../validators/exam-scheduling.validators.js';
import { idParam, parse } from './parse.js';

/**
 * `POST /exams/schedule` — الجدولة's one write, for both delivery modes
 * (R136). See `exam-scheduling.service.ts` for the atomic sequence this
 * triggers; nothing here decides anything beyond translating the wire shape.
 */
export function schedule(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const b = parse(scheduleExamSchema, req.body ?? {});
    const availability: AvailabilityPolicy | undefined =
      b.availability === undefined
        ? undefined
        : b.availability.policy === 'custom'
          ? { policy: 'custom', at: new Date(b.availability.at) }
          : b.availability;
    const created = await scheduleExam(prisma, requireActor(req), {
      mode: b.mode,
      ...(b.source_exam_id === undefined ? {} : { sourceExamId: b.source_exam_id }),
      target: { kind: b.target.kind, ...(b.target.id === undefined ? {} : { id: b.target.id }) },
      ...(b.date === undefined ? {} : { date: b.date }),
      ...(b.start_time === undefined ? {} : { startTime: b.start_time }),
      ...(b.end_time === undefined ? {} : { endTime: b.end_time }),
      ...(b.branch_id === undefined ? {} : { branchId: b.branch_id }),
      ...(b.room_id === undefined ? {} : { roomId: b.room_id }),
      ...(b.scheduling_type_id === undefined ? {} : { schedulingTypeId: b.scheduling_type_id }),
      ...(b.visibility === undefined ? {} : { visibility: b.visibility }),
      ...(b.staff === undefined
        ? {}
        : { staff: b.staff.map((s) => ({ userId: s.user_id, position: s.position })) }),
      ...(b.surah_id === undefined ? {} : { surahId: b.surah_id }),
      ...(availability === undefined ? {} : { availability }),
      ...(b.bare === undefined
        ? {}
        : {
            bare: {
              title: b.bare.title,
              ...(b.bare.max_grade === undefined ? {} : { maxGrade: b.bare.max_grade }),
              ...(b.bare.description === undefined ? {} : { description: b.bare.description }),
              levelId: b.bare.level_id,
              subjectId: b.bare.subject_id,
              academicYearId: b.bare.academic_year_id,
            },
          }),
    });
    res.status(201).json({ id: created.id });
  };
}

/**
 * `PATCH /exams/{id}/schedule` — an online occurrence's ARRANGEMENT, edited
 * (Owner, 2026-09-15). See `updateExamSchedule`'s own docstring for the full
 * reasoning; this translates the wire shape and nothing more.
 */
export function updateSchedule(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const b = parse(updateExamScheduleSchema, req.body ?? {});
    const availability: AvailabilityPolicy | undefined =
      b.availability === undefined
        ? undefined
        : b.availability.policy === 'custom'
          ? { policy: 'custom', at: new Date(b.availability.at) }
          : b.availability;
    await updateExamSchedule(prisma, requireActor(req), idParam(req, 'id'), {
      version: b.version,
      ...(b.target === undefined
        ? {}
        : { target: { kind: b.target.kind, ...(b.target.id === undefined ? {} : { id: b.target.id }) } }),
      ...(b.date === undefined ? {} : { date: b.date }),
      ...(b.start_time === undefined ? {} : { startTime: b.start_time }),
      ...(b.end_time === undefined ? {} : { endTime: b.end_time }),
      ...(b.scheduling_type_id === undefined ? {} : { schedulingTypeId: b.scheduling_type_id }),
      ...(b.visibility === undefined ? {} : { visibility: b.visibility }),
      ...(b.staff === undefined
        ? {}
        : { staff: b.staff.map((s) => ({ userId: s.user_id, position: s.position })) }),
      ...(b.surah_id === undefined ? {} : { surahId: b.surah_id }),
      ...(availability === undefined ? {} : { availability }),
    });
    res.status(204).end();
  };
}
