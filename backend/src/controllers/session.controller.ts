import type { Request, Response } from 'express';

import type { PrismaClient } from '../generated/prisma/client.js';
import { requireActor } from '../middleware/authenticate.js';
import * as sessions from '../services/session.service.js';
import { sessionContentLinkDto, sessionDto } from './dto.js';
import { idParam, parse } from './parse.js';
import {
  cancelSessionSchema,
  linkContentSchema,
  overrideSessionSchema,
  restoreSessionSchema,
} from '../validators/session.validators.js';

/**
 * Sessions over HTTP (TD-3.12, §4.4, TD-1).
 *
 * **One verb per transition, and `PATCH` is not one of them.** Cancelling and
 * restoring are TD-1 transitions carrying obligations a field assignment cannot:
 * a cancellation must state a reason and records how many people it affected, a
 * restore is refused once the date has passed. `PATCH` edits *fields* and always
 * marks the occurrence `overridden`. Collapsing them into one endpoint that
 * accepted `status` would give the state machine a second entrance with none of
 * those obligations attached.
 *
 * **Authorisation is not repeated here.** `loadForWrite` in the service is what
 * limits a Teacher to the sessions they actually staff (TD-2) and answers `404`
 * rather than `403` for anything outside reach (§20 rule 17).
 *
 * **No route sets `held`.** `markHeld` exists in the service, TD-3.12 documents
 * no endpoint for it, and §20 rule 16 forbids inventing one.
 */

export function override(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = parse(overrideSessionSchema, req.body ?? {});
    const session = await sessions.overrideSession(
      prisma,
      requireActor(req),
      idParam(req, 'id'),
      {
        version: body.version,
        ...(body.date !== undefined ? { date: body.date } : {}),
        ...(body.start_time !== undefined ? { startTime: body.start_time } : {}),
        ...(body.end_time !== undefined ? { endTime: body.end_time } : {}),
        ...(body.room_id !== undefined ? { roomId: body.room_id } : {}),
        // Absent leaves the snapshot untouched; an empty array is a real
        // instruction — *this session has no staff* — so the two must not
        // collapse into one another here.
        ...(body.staff !== undefined
          ? { staff: body.staff.map((s) => ({ userId: s.user_id, position: s.position })) }
          : {}),
      },
    );
    res.json(sessionDto(session));
  };
}

export function cancel(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = parse(cancelSessionSchema, req.body ?? {});
    const session = await sessions.cancelSession(
      prisma,
      requireActor(req),
      idParam(req, 'id'),
      body.reason,
      body.version,
    );
    res.json(sessionDto(session));
  };
}

export function restore(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = parse(restoreSessionSchema, req.body ?? {});
    const session = await sessions.restoreSession(
      prisma,
      requireActor(req),
      idParam(req, 'id'),
      body.version,
    );
    res.json(sessionDto(session));
  };
}

export function linkContent(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = parse(linkContentSchema, req.body ?? {});
    const sessionId = idParam(req, 'id');
    const link = await sessions.linkContent(
      prisma,
      requireActor(req),
      sessionId,
      body.content_id,
    );
    res
      .status(201)
      .json(sessionContentLinkDto({ id: link.id, sessionId, contentId: body.content_id }));
  };
}

/** Unlinks. **Never deletes the file** (TD-3.12) — the content outlives the link. */
export function unlinkContent(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    await sessions.unlinkContent(
      prisma,
      requireActor(req),
      idParam(req, 'id'),
      idParam(req, 'contentId'),
    );
    res.status(204).end();
  };
}
