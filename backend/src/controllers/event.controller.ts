import type { Request, Response } from 'express';
import { pageParamsFrom } from '../lib/pagination.js';
import { z } from 'zod';

import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { requireActor } from '../middleware/authenticate.js';
import {
  backfillAttach,
  backfillCandidates,
  createEvent,
  deleteEvent,
  listEventScopeOptions,
  listEventStaffOptions,
  listEvents,
  setEventStaff,
  updateEvent,
} from '../services/event.service.js';
import { eventDefinitionDto, pageOf } from './dto.js';
import { parse } from './parse.js';
import type { Actor } from '../policies/actor.js';

/**
 * Events — TD-3.4 (`/events`, `/admin/branches/{id}/event-backfill`), §4.4.
 *
 * Scope selection is validated here; which scopes a caller may actually reach is
 * decided in the service, server-side.
 */

/** Local calendar date, `YYYY-MM-DD` (TD-11) — never an instant. */
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')
  .transform((v) => new Date(`${v}T00:00:00.000Z`));

/** Local wall-clock `HH:MM`, matching the Group boundary format. */
const clock = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM, 24-hour')
  .transform((v) => {
    const [h, m] = v.split(':').map(Number);
    return new Date(Date.UTC(1970, 0, 1, h!, m!, 0));
  });

const createSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).nullable().optional(),
    visibility: z.enum(['public', 'private', 'hidden']),
    start_date: calendarDate,
    end_date: calendarDate.nullable().optional(),
    start_time: clock.nullable().optional(),
    end_time: clock.nullable().optional(),
    recurrence_type: z.enum(['none', 'daily', 'weekly', 'biweekly_alternating', 'yearly']),
    recurrence_end_date: calendarDate.nullable().optional(),
    // Scope selection — §4.4 materialises these into join rows at creation.
    global: z.boolean().optional(),
    branch_ids: z.array(z.uuid()).max(50).optional(),
    category_ids: z.array(z.uuid()).max(50).optional(),
    level_ids: z.array(z.uuid()).max(100).optional(),
    group_ids: z.array(z.uuid()).max(200).optional(),
  })
  .strict();

/**
 * `PATCH /events/{id}` — the event's own attributes only.
 *
 * `.strict()` matters here: scope keys (`global`, `branch_ids`, …) are **not**
 * editable, and a strict schema **rejects** them with a 400 rather than
 * accepting the request and silently dropping them. §4.4 materialises scope at
 * creation and provides the manual backfill action for later attachment; see
 * `updateEvent` for why re-resolving on edit would break that rule.
 */
const patchSchema = z
  .object({
    version: z.number().int().min(0),
    title: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    visibility: z.enum(['public', 'private', 'hidden']).optional(),
    start_date: calendarDate.optional(),
    end_date: calendarDate.nullable().optional(),
    start_time: clock.nullable().optional(),
    end_time: clock.nullable().optional(),
    recurrence_type: z
      .enum(['none', 'daily', 'weekly', 'biweekly_alternating', 'yearly'])
      .optional(),
    recurrence_end_date: calendarDate.nullable().optional(),
  })
  .strict();

const backfillSchema = z.object({ event_ids: z.array(z.uuid()).min(1).max(200) }).strict();

const actorOf = (req: Request): Actor => {
  const a = requireActor(req);
  return { userId: a.userId, roles: a.roles, roleScopes: a.roleScopes };
};

function pathId(req: Request): string {
  const parsed = z.uuid().safeParse(req.params['id']);
  if (!parsed.success) throw new AppError('NOT_FOUND', 'not found');
  return parsed.data;
}

/** R56: the List view's window and branch narrowing. Not `.strict()` — TD-10's
 *  `page`/`page_size` share the query object. */
const listEventsQuerySchema = z.object({
  branch_id: z.uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export function create(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const parsed = createSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new AppError('VALIDATION_FAILED', 'invalid event payload');
    const b = parsed.data;

    const result = await createEvent(prisma, actorOf(req), {
      title: b.title,
      ...(b.description !== undefined ? { description: b.description } : {}),
      visibility: b.visibility,
      startDate: b.start_date,
      ...(b.end_date !== undefined ? { endDate: b.end_date } : {}),
      ...(b.start_time !== undefined ? { startTime: b.start_time } : {}),
      ...(b.end_time !== undefined ? { endTime: b.end_time } : {}),
      recurrenceType: b.recurrence_type,
      ...(b.recurrence_end_date !== undefined ? { recurrenceEndDate: b.recurrence_end_date } : {}),
      ...(b.global !== undefined ? { global: b.global } : {}),
      ...(b.branch_ids ? { branchIds: b.branch_ids } : {}),
      ...(b.category_ids ? { categoryIds: b.category_ids } : {}),
      ...(b.level_ids ? { levelIds: b.level_ids } : {}),
      ...(b.group_ids ? { groupIds: b.group_ids } : {}),
    });

    res.status(201).json({
      id: result.event.id,
      visibility: result.event.visibility,
      recurrence_type: result.event.recurrenceType,
      // Reports what was ACTUALLY attached, which may be fewer branches than
      // requested: §4.4 excludes branches that are not yet operational.
      attached: result.attached,
    });
  };
}

export function update(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const id = pathId(req);
    const parsed = patchSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', 'invalid event patch; scope is not editable');
    }
    const { version, ...b } = parsed.data;

    const event = await updateEvent(prisma, actorOf(req), id, version, {
      ...(b.title !== undefined ? { title: b.title } : {}),
      ...(b.description !== undefined ? { description: b.description } : {}),
      ...(b.visibility !== undefined ? { visibility: b.visibility } : {}),
      ...(b.start_date !== undefined ? { startDate: b.start_date } : {}),
      ...(b.end_date !== undefined ? { endDate: b.end_date } : {}),
      ...(b.start_time !== undefined ? { startTime: b.start_time } : {}),
      ...(b.end_time !== undefined ? { endTime: b.end_time } : {}),
      ...(b.recurrence_type !== undefined ? { recurrenceType: b.recurrence_type } : {}),
      ...(b.recurrence_end_date !== undefined ? { recurrenceEndDate: b.recurrence_end_date } : {}),
    });

    res.json({
      id: event.id,
      title: event.title,
      visibility: event.visibility,
      recurrence_type: event.recurrenceType,
      version: event.version,
    });
  };
}

export function remove(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    await deleteEvent(prisma, actorOf(req), pathId(req));
    res.status(204).end();
  };
}

/** `GET /admin/branches/{id}/event-backfill` — §4.4 "listing applicable events". */
export function listBackfill(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const result = await backfillCandidates(prisma, actorOf(req), pathId(req), pageParamsFrom(req.query));
    res.json({
      meta: result.meta,
      data: result.data.map((e) => ({
        id: e.id,
        title: e.title,
        start_date: e.startDate.toISOString().slice(0, 10),
        recurrence_type: e.recurrenceType,
        visibility: e.visibility,
      })),
    });
  };
}

/** `POST /admin/branches/{id}/event-backfill` — attach, or knowingly skip (§4.4). */
export function applyBackfill(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const parsed = backfillSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new AppError('VALIDATION_FAILED', 'event_ids is required');

    const attached = await backfillAttach(
      prisma,
      actorOf(req),
      pathId(req),
      parsed.data.event_ids,
    );
    res.json({ attached });
  };
}

/**
 * `GET /events` (TD-3.4, R56) — the stored **definitions**, for the List view of
 * the unified Scheduling screen.
 *
 * Not `GET /calendar`: that returns the *expansion*, which is right for a
 * calendar and wrong for a management table. See `listEvents` for why the two
 * halves of one screen have to answer the same kind of question.
 */
export function list(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const q = parse(listEventsQuerySchema, req.query);
    const result = await listEvents(prisma, actorOf(req), {
      ...(q.branch_id !== undefined ? { branchId: q.branch_id } : {}),
      ...(q.from !== undefined ? { from: q.from } : {}),
      ...(q.to !== undefined ? { to: q.to } : {}),
      ...pageParamsFrom(req.query),
    });
    res.json(pageOf(result, eventDefinitionDto));
  };
}

/**
 * R71 — who answers for an event. The shape the exam and schedule staff
 * payloads already use; `responsible` is capped at one **by the service**,
 * where the domain rule belongs rather than in a schema that cannot explain it.
 */
const staffSchema = z
  .object({
    staff: z
      .array(
        z
          .object({ user_id: z.string().uuid(), position: z.enum(['responsible', 'assistant']) })
          .strict(),
      )
      .max(20),
  })
  .strict();

/** `PUT /events/{id}/staff` — Admin and above (R71.4); the service enforces it. */
export function setStaff(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const b = parse(staffSchema, req.body ?? {});
    await setEventStaff(
      prisma,
      actorOf(req),
      pathId(req),
      b.staff.map((p) => ({ userId: p.user_id, position: p.position })),
    );
    res.status(204).end();
  };
}

/** Who the caller may name on an event she answers for (2026-08-20). */
export function staffOptions(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    res.json({ data: await listEventStaffOptions(prisma, requireActor(req)) });
  };
}

/** The scopes the caller may address an event to (2026-08-20). */
export function scopeOptions(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    res.json({ data: await listEventScopeOptions(prisma, requireActor(req)) });
  };
}
