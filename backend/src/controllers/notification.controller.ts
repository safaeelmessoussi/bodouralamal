import type { Request, Response } from 'express';

import type { PrismaClient } from '../generated/prisma/client.js';
import { requireActor } from '../middleware/authenticate.js';
import { notifyEventSchema, notifySessionSchema } from '../validators/notification.validators.js';
import { pageParamsFrom } from '../lib/pagination.js';
import {
  notifySessionChange,
  notifyEventChange,
  listNotifications,
  markRead,
  unreadCount,
  type NotificationRow,
} from '../services/notification.service.js';
import { idParam, parse } from './parse.js';

/**
 * The caller's own notifications (§4.8 as narrowed by Revision 77).
 *
 * **There is no id in either request that names a user.** The recipient is the
 * authenticated actor and nothing else, so there is no parameter to tamper with
 * and no role that widens the read — which is what makes R77.6's *"the caller's
 * own and nobody else's"* a property of the shape rather than of a check.
 */

/**
 * An explicit contract DTO (§16.2), never the Prisma row.
 *
 * **One shape for three targets** (R82.1). A notice is about a Session, an Event
 * or an Exam, and the client renders one list — so the fields that mean the same
 * thing across targets are published under the same names (`title`, `date`,
 * `start_time`, `reason`) and the target ids travel beside them so a row can be
 * linked to the thing it is about. The alternative — a differently-shaped object
 * per type — would put a switch in every consumer for a difference the reader
 * does not experience.
 *
 * `session_*` keys are kept **in addition**, unchanged, because R77's client
 * reads them and a contract does not break to be tidier.
 */
function notificationDto(row: NotificationRow): Record<string, unknown> {
  // TD-11 — a calendar date and a wall-clock time, never an instant.
  const date = (d: Date): string => d.toISOString().slice(0, 10);
  const time = (d: Date): string => d.toISOString().slice(11, 16);

  const target =
    row.session !== null
      ? {
          title: row.session.schedule.subject?.name ?? null,
          date: date(row.session.date),
          start_time: time(row.session.startTime),
          // The reason is the whole point of a cancellation notice: *cancelled*
          // without *why* is what §4.8's manual channels already managed, badly.
          reason: row.session.cancellationReason,
          scope_name: row.session.schedule.level?.name ?? null,
        }
      : row.event !== null
        ? {
            title: row.event.title,
            date: date(row.event.startDate),
            start_time: row.event.startTime === null ? null : time(row.event.startTime),
            // See `LIST_INCLUDE`: an Event has no cancellation reason column.
            reason: null,
            scope_name: null,
          }
        : row.exam !== null
          ? {
              title: row.exam.title,
              date: date(row.exam.date),
              start_time: null,
              // A grade notice carries no reason and, deliberately, no score:
              // it says a grade is available and her own screen shows it.
              reason: null,
              scope_name: row.exam.subject?.name ?? null,
            }
          : { title: null, date: null, start_time: null, reason: null, scope_name: null };

  return {
    id: row.id,
    type: row.type,
    session_id: row.sessionId,
    event_id: row.eventId,
    exam_id: row.examId,
    ...target,
    // R77's original keys, unchanged for the client that already reads them.
    session_date: row.session === null ? null : date(row.session.date),
    session_start_time: row.session === null ? null : time(row.session.startTime),
    subject_name: row.session?.schedule.subject?.name ?? row.exam?.subject?.name ?? null,
    level_name: row.session?.schedule.level?.name ?? null,
    read_at: row.readAt === null ? null : row.readAt.toISOString(),
    created_at: row.createdAt.toISOString(),
  };
}

export function list(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const result = await listNotifications(prisma, actor, {
      ...pageParamsFrom(req.query),
      ...(req.query['unread_only'] === 'true' ? { unread_only: true } : {}),
    });
    res.json({
      data: result.data.map(notificationDto),
      meta: {
        ...result.meta,
        // The count the screen shows, in the same read: a separate endpoint for
        // it would be a second answer to *how many are new* and would disagree
        // with this list the moment one was marked read between the two calls.
        unread: await unreadCount(prisma, actor),
      },
    });
  };
}

export function read(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const updated = await markRead(prisma, requireActor(req), idParam(req, 'id'));
    res.json({ data: notificationDto(updated) });
  };
}

/**
 * `POST /events/{id}/notify` — **the optional send, after the change is saved**
 * (R82.5).
 *
 * The client says *which kind of change happened*; it never says **who** to
 * tell. Recipients are resolved from the event's own scope rows on the server,
 * which is what makes *"do not invent recipient lists in the frontend"* a
 * property of the contract rather than a convention.
 *
 * Authorization is the event's own: whoever may edit it may announce it. That is
 * asserted by the service through the same path the write used, so a caller who
 * could not have made the change cannot announce one either.
 */
export function notifyEventHandler(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const body = parse(notifyEventSchema, req.body ?? {});
    const result = await notifyEventChange(prisma, actor, idParam(req, 'id'), body.change);
    res.json({ data: result });
  };
}

/**
 * `POST /sessions/{id}/notify` — the same decision, for an occurrence (R83.3).
 */
export function notifySessionHandler(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const body = parse(notifySessionSchema, req.body ?? {});
    const result = await notifySessionChange(prisma, actor, idParam(req, 'id'), body.change);
    res.json({ data: result });
  };
}
