import type { Request, Response } from 'express';

import type { PrismaClient } from '../generated/prisma/client.js';
import { requireActor } from '../middleware/authenticate.js';
import { pageParamsFrom } from '../lib/pagination.js';
import {
  listNotifications,
  markRead,
  unreadCount,
  type NotificationRow,
} from '../services/notification.service.js';
import { idParam } from './parse.js';

/**
 * The caller's own notifications (§4.8 as narrowed by Revision 77).
 *
 * **There is no id in either request that names a user.** The recipient is the
 * authenticated actor and nothing else, so there is no parameter to tamper with
 * and no role that widens the read — which is what makes R77.6's *"the caller's
 * own and nobody else's"* a property of the shape rather than of a check.
 */

/** An explicit contract DTO (§16.2), never the Prisma row. */
function notificationDto(row: NotificationRow): Record<string, unknown> {
  return {
    id: row.id,
    type: row.type,
    session_id: row.sessionId,
    // TD-11 — a calendar date and a wall-clock time, never an instant.
    session_date: row.session.date.toISOString().slice(0, 10),
    session_start_time: row.session.startTime.toISOString().slice(11, 16),
    subject_name: row.session.schedule.subject?.name ?? null,
    level_name: row.session.schedule.level?.name ?? null,
    // The reason is the whole point of the notice: *cancelled* without *why* is
    // what §4.8's manual channels already managed, badly.
    reason: row.session.cancellationReason,
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
