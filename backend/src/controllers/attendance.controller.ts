import type { Request, Response } from 'express';
import { z } from 'zod';

import type { PrismaClient } from '../generated/prisma/client.js';
import { requireActor } from '../middleware/authenticate.js';
import {
  attendanceCandidates,
  attendanceSheet,
  markPresent,
  removeAttendance,
  type OccurrenceKind,
  type OccurrenceRef,
} from '../services/attendance.service.js';
import { attendanceSheetDto } from './dto.js';
import { idParam, parse } from './parse.js';

/**
 * **Attendance (§4.7, R123)** — one controller family for the three dated
 * occurrence carriers.
 *
 * The routes are entity-rooted (`/sessions/{id}/attendance`, and the same under
 * `/events` and `/exams`) because that is how every sibling reads on this
 * platform — `/sessions/{id}/roster`, `/events/{id}/staff`. The **kind** is
 * bound once when the route is registered rather than taken from the path, so a
 * caller can never name a kind the route was not mounted for.
 *
 * **Authorization is the service's**, resolved per occurrence kind from the
 * rule that kind already has. Nothing here decides a permission; the `/admin/`
 * prefix is absent from these paths for the same reason `/sessions/{id}/roster`
 * has none — the audience is staff *and* beneficiaries, and the route prefix
 * has never been the boundary.
 */

/** TD-11 — a calendar date, never an instant. */
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
  .transform((value) => new Date(`${value}T00:00:00.000Z`));

const dateQuerySchema = z.object({ date: calendarDate.optional() }).strict();

const candidatesQuerySchema = z
  .object({ date: calendarDate.optional(), q: z.string().trim().max(120).optional() })
  .strict();

/**
 * **The mark body carries a beneficiary and nothing else.**
 *
 * No `present: boolean`: a row IS the presence, so *«mark her absent»* is
 * `DELETE`, not a `POST` with a flag. A flag would make the same route both
 * create and destroy a record, and the audit trail could not say which happened
 * without reading the payload.
 */
const markSchema = z.object({ student_id: z.uuid() }).strict();

/**
 * **The self route accepts no body at all** (§7 of the Owner's brief).
 *
 * *«A woman may mark ONLY HERSELF»* is expressed by there being nowhere to name
 * anybody else — not by a check on a field the schema still accepts. The
 * service refuses a mismatch too, which is the backstop that keeps the rule
 * structural rather than a property of this file.
 */
const selfSchema = z.object({}).strict();

function refOf(kind: OccurrenceKind, req: Request): OccurrenceRef {
  const q = parse(dateQuerySchema, req.query ?? {});
  return {
    kind,
    id: idParam(req, 'id'),
    ...(q.date === undefined ? {} : { date: q.date }),
  };
}

/** `GET /{sessions|events|exams}/{id}/attendance` — the sheet. */
export function sheet(prisma: PrismaClient, kind: OccurrenceKind) {
  return async (req: Request, res: Response): Promise<void> => {
    const data = await attendanceSheet(prisma, requireActor(req), refOf(kind, req));
    res.json(attendanceSheetDto(data));
  };
}

/**
 * `GET /{sessions|events|exams}/{id}/attendance/candidates` — who may be added.
 *
 * A **picker for one sheet**, not a directory: `GET /admin/directory` is Admin
 * and Super Admin only, so a مؤطِّرة marking her own class could not reach it,
 * and widening that endpoint would hand every teacher the whole people-picker
 * to solve one sheet's problem. A smaller question instead (rule O).
 */
export function candidates(prisma: PrismaClient, kind: OccurrenceKind) {
  return async (req: Request, res: Response): Promise<void> => {
    const q = parse(candidatesQuerySchema, req.query ?? {});
    const rows = await attendanceCandidates(
      prisma,
      requireActor(req),
      { kind, id: idParam(req, 'id'), ...(q.date === undefined ? {} : { date: q.date }) },
      q.q ?? '',
    );
    res.json({ data: rows.map((r) => ({ id: r.id, name: r.name })) });
  };
}

/** `POST /{sessions|events|exams}/{id}/attendance` — staff marks somebody. */
export function mark(prisma: PrismaClient, kind: OccurrenceKind) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = parse(markSchema, req.body ?? {});
    const result = await markPresent(
      prisma,
      requireActor(req),
      refOf(kind, req),
      body.student_id,
    );
    // **`200` on a repeat, `201` on a new row.** Idempotent, and the status says
    // which happened without the client having to compare the sheet before and
    // after.
    res.status(result.created ? 201 : 200).json({ id: result.id });
  };
}

/** `POST /{sessions|events}/{id}/attendance/self` — «تسجيل حضوري». */
export function selfCheckIn(prisma: PrismaClient, kind: OccurrenceKind) {
  return async (req: Request, res: Response): Promise<void> => {
    parse(selfSchema, req.body ?? {});
    const actor = requireActor(req);
    const result = await markPresent(prisma, actor, refOf(kind, req), actor.userId, {
      self: true,
    });
    res.status(result.created ? 201 : 200).json({ id: result.id });
  };
}

/** `DELETE /{sessions|events|exams}/{id}/attendance/{studentId}` — a mistaken
 *  mark withdrawn (TD-5 soft delete, Trash, audit). */
export function remove(prisma: PrismaClient, kind: OccurrenceKind) {
  return async (req: Request, res: Response): Promise<void> => {
    const studentId = idParam(req, 'studentId');
    await removeAttendance(prisma, requireActor(req), refOf(kind, req), studentId);
    res.status(204).end();
  };
}
