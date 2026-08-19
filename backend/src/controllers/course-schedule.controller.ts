import type { Request, Response } from "express";

import type { PrismaClient } from "../generated/prisma/client.js";
import { pageParamsFrom } from "../lib/pagination.js";
import { requireActor } from "../middleware/authenticate.js";
import * as schedules from "../services/course-schedule.service.js";
import {
  courseScheduleDto,
  courseScheduleWriteDto,
  pageOf,
  scheduleConflictDto,
  scheduleDeletionDto,
  scheduleRosterEntryDto,
  scheduleSessionDto,
} from "./dto.js";
import { idParam, parse } from "./parse.js";
import {
  createCourseScheduleSchema,
  listCourseSchedulesQuerySchema,
  updateCourseScheduleSchema,
} from "../validators/course-schedule.validators.js";

/**
 * Recurring Course Schedules over HTTP (TD-3.12, §4.4, Revision 43).
 *
 * **A write returns the schedule *and* what it did to the timetable.** Creating
 * or editing a schedule materializes Sessions, and some of those Sessions are
 * deliberately left alone because they hold data whose loss would change
 * historical truth (§4.4, Revision 43.6). An administrator who receives only the
 * schedule back has been told the timetable is now consistent when part of it
 * knowingly is not — so `materialization` travels with both verbs.
 */

export function list(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const filters = parse(listCourseSchedulesQuerySchema, req.query);
    const result = await schedules.listCourseSchedules(
      prisma,
      requireActor(req),
      {
        ...(filters.branch_id !== undefined
          ? { branchId: filters.branch_id }
          : {}),
        ...(filters.subject_id !== undefined
          ? { subjectId: filters.subject_id }
          : {}),
        ...(filters.academic_year_id !== undefined
          ? { academicYearId: filters.academic_year_id }
          : {}),
        ...pageParamsFrom(req.query),
      },
    );
    res.json(pageOf(result, courseScheduleDto));
  };
}

export function create(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = parse(createCourseScheduleSchema, req.body ?? {});
    const created = await schedules.createCourseSchedule(
      prisma,
      requireActor(req),
      {
        title: body.title,
        ...(body.description !== undefined
          ? { description: body.description }
          : {}),
        subjectId: body.subject_id,
        teachingMode: body.teaching_mode,
        targetId: body.target_id,
        branchId: body.branch_id,
        startTime: body.start_time,
        endTime: body.end_time,
        recurrence: body.recurrence,
        academicYearId: body.academic_year_id,
        ...(body.room_id !== undefined ? { roomId: body.room_id } : {}),
        ...(body.weekdays !== undefined ? { weekdays: body.weekdays } : {}),
        ...(body.day_of_month !== undefined
          ? { dayOfMonth: body.day_of_month }
          : {}),
        ...(body.month_of_year !== undefined
          ? { monthOfYear: body.month_of_year }
          : {}),
        ...(body.anchor_date !== undefined
          ? { anchorDate: body.anchor_date }
          : {}),
        ...(body.effective_until !== undefined
          ? { effectiveUntil: body.effective_until }
          : {}),
        ...(body.staff !== undefined
          ? {
              staff: body.staff.map((s) => ({
                userId: s.user_id,
                position: s.position,
                // R91 — absent and `null` both mean open-ended at that end.
                effectiveFrom: s.effective_from ?? null,
                effectiveUntil: s.effective_until ?? null,
              })),
            }
          : {}),
      },
    );
    const row = await reload(prisma, created.id);
    res.status(201).json(courseScheduleWriteDto(row, created.materialized));
  };
}

export function update(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = parse(updateCourseScheduleSchema, req.body ?? {});
    const updated = await schedules.updateCourseSchedule(
      prisma,
      requireActor(req),
      idParam(req, "id"),
      {
        version: body.version,
        ...(body.room_id !== undefined ? { roomId: body.room_id } : {}),
        ...(body.start_time !== undefined
          ? { startTime: body.start_time }
          : {}),
        ...(body.end_time !== undefined ? { endTime: body.end_time } : {}),
        ...(body.recurrence !== undefined
          ? { recurrence: body.recurrence }
          : {}),
        ...(body.weekdays !== undefined ? { weekdays: body.weekdays } : {}),
        ...(body.day_of_month !== undefined
          ? { dayOfMonth: body.day_of_month }
          : {}),
        ...(body.month_of_year !== undefined
          ? { monthOfYear: body.month_of_year }
          : {}),
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.description !== undefined
          ? { description: body.description }
          : {}),
        ...(body.anchor_date !== undefined
          ? { anchorDate: body.anchor_date }
          : {}),
        ...(body.effective_until !== undefined
          ? { effectiveUntil: body.effective_until }
          : {}),
        // R90 — staffing is editable now; it was accepted on create and refused
        // here while the form offered the controls on both.
        ...(body.staff !== undefined
          ? {
              staff: body.staff.map((x) => ({
                userId: x.user_id,
                position: x.position,
                effectiveFrom: x.effective_from ?? null,
                effectiveUntil: x.effective_until ?? null,
              })),
            }
          : {}),
        ...(body.scope !== undefined ? { scope: body.scope } : {}),
        ...(body.from_date !== undefined ? { fromDate: body.from_date } : {}),
      },
    );
    // **R50: a split answers with the SUCCESSOR, not the closed predecessor.**
    // The caller edited "this and all future", so the schedule they are now
    // looking at is the new one — returning the closed half would show them the
    // values they just replaced.
    const row = await reload(prisma, updated.successorId ?? updated.id);
    res.json({
      ...courseScheduleWriteDto(row, updated.materialized),
      // Named only when a split happened, so a client can tell that its list
      // now holds two rows where it held one.
      ...(updated.successorId ? { split_from_schedule_id: updated.id } : {}),
    });
  };
}

/**
 * Re-reads the written row so the response is the schedule as stored rather than
 * the input echoed back. The service returns an id and a materialization report;
 * a controller that reconstructed the DTO from the request body would report
 * what the caller *asked for*, which is exactly the class of contract lie the
 * DTO discipline exists to prevent.
 */
async function reload(
  prisma: PrismaClient,
  id: string,
): Promise<Parameters<typeof courseScheduleWriteDto>[0]> {
  return prisma.recurringCourseSchedule.findUniqueOrThrow({
    where: { id },
    include: {
      // R91 — the response must carry the periods, or a form that just saved a
      // replacement would reload without it and quietly offer to remove it.
      staff: {
        where: { deletedAt: null },
        select: {
          userId: true,
          position: true,
          effectiveFrom: true,
          effectiveUntil: true,
        },
      },
    },
  });
}

/**
 * Deleting reports what it removed and what it **kept** (§4.4, TD-5).
 *
 * `retained` is not a curiosity: those are sessions holding data whose loss
 * would change historical truth, and they survive the schedule that created
 * them. An administrator expecting the timetable to be clear needs to know the
 * ones that are not.
 */
export function remove(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const result = await schedules.deleteCourseSchedule(
      prisma,
      requireActor(req),
      idParam(req, "id"),
    );
    res.json(scheduleDeletionDto(result));
  };
}

/** Conflicts, computed against **materialized Sessions** — never against rules (§4.4). */
export function conflicts(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const found = await schedules.previewConflicts(
      prisma,
      requireActor(req),
      idParam(req, "id"),
    );
    res.json({ conflicts: found.map(scheduleConflictDto) });
  };
}

/** The resolved audience — computed live on every call, never a stored snapshot. */
/**
 * `GET /admin/course-schedules/{id}/sessions` — the occurrences the §4.4
 * (Revision 50) scope dialog is chosen from.
 *
 * A sibling of `/conflicts` and `/roster`: all three answer a question about one
 * schedule and hang off it.
 */
export function sessions(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    // TD-10's shared page parsing — the same helper every paginated read uses,
    // rather than a second interpretation of `page`/`page_size`.
    const result = await schedules.listScheduleSessions(
      prisma,
      requireActor(req),
      idParam(req, "id"),
      pageParamsFrom(req.query),
    );
    res.json(pageOf(result, scheduleSessionDto));
  };
}

export function roster(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const students = await schedules.resolveScheduleRoster(
      prisma,
      requireActor(req),
      idParam(req, "id"),
    );
    res.json({ students: students.map(scheduleRosterEntryDto) });
  };
}
