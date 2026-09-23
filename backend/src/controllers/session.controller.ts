import type { Request, Response } from "express";
import { z } from "zod";

import type { PrismaClient } from "../generated/prisma/client.js";
import { requireActor } from "../middleware/authenticate.js";
import { sessionTitles } from "../services/class-title.js";
import * as sessions from "../services/session.service.js";
import { sessionContentLinkDto, sessionDto, sessionRosterDto } from "./dto.js";
import { idParam, parse } from "./parse.js";
import {
  cancelSessionSchema,
  linkContentSchema,
  overrideSessionSchema,
  restoreSessionSchema,
  sessionAudienceSchema,
} from "../validators/session.validators.js";

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

/**
 * R166 §3 — a write answers with the occurrence as it now reads, COMPOSED title
 * included: the stored column is retired, and the title a client is handed
 * must be the one every other reader is given.
 */
async function titled<T extends { id: string }>(
  prisma: PrismaClient,
  session: T,
): Promise<Omit<T, "title"> & { title: string }> {
  const title = (await sessionTitles(prisma, [session.id])).get(session.id) ?? "";
  return { ...session, title };
}

export function override(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = parse(overrideSessionSchema, req.body ?? {});
    const session = await sessions.overrideSession(
      prisma,
      requireActor(req),
      idParam(req, "id"),
      {
        version: body.version,
        ...(body.date !== undefined ? { date: body.date } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.start_time !== undefined
          ? { startTime: body.start_time }
          : {}),
        ...(body.end_time !== undefined ? { endTime: body.end_time } : {}),
        ...(body.room_id !== undefined ? { roomId: body.room_id } : {}),
        // R97 — passed through as sent; `policies/delivery.ts` resolves the
        // three columns together in the service, which is the only place that
        // knows what this occurrence currently is.
        ...(body.delivery_mode !== undefined
          ? { deliveryMode: body.delivery_mode }
          : {}),
        ...(body.online_media_mode !== undefined
          ? { onlineMediaMode: body.online_media_mode }
          : {}),
        // R109 — this occurrence's own tier. Absent leaves it untouched; the
        // override still sets `overridden`, because the flag records that a
        // human decided about this date at all.
        ...(body.visibility !== undefined
          ? { visibility: body.visibility }
          : {}),
        // Owner-reported, 2026-09-17 — this occurrence's own Subject.
        // `null` is a real instruction (clear the override); absent leaves
        // it untouched, the same distinction every field above already
        // makes.
        ...(body.subject_id !== undefined ? { subjectId: body.subject_id } : {}),
        ...(body.surah_ids !== undefined ? { surahIds: body.surah_ids } : {}),
        ...(body.audience !== undefined
          ? {
              audience: {
                branchIds: body.audience.branch_ids,
                categoryIds: body.audience.category_ids,
                levelIds: body.audience.level_ids,
                administrativeGroupIds: body.audience.administrative_group_ids,
                teachingGroupIds: body.audience.teaching_group_ids,
              },
            }
          : {}),
        // Absent leaves the snapshot untouched; an empty array is a real
        // instruction — *this session has no staff* — so the two must not
        // collapse into one another here.
        ...(body.staff !== undefined
          ? {
              staff: body.staff.map((s) => ({
                userId: s.user_id,
                position: s.position,
              })),
            }
          : {}),
      },
    );
    res.json(sessionDto(await titled(prisma, session)));
  };
}

export function cancel(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = parse(cancelSessionSchema, req.body ?? {});
    const session = await sessions.cancelSession(
      prisma,
      requireActor(req),
      idParam(req, "id"),
      body.reason,
      body.version,
    );
    res.json(sessionDto(await titled(prisma, session)));
  };
}

/** R172 §9 — one occurrence to the Trash. `?version=` is TD-15's coordinate. */
const removeQuerySchema = z.object({ version: z.coerce.number().int().min(0) }).strict();

export function remove(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const q = parse(removeQuerySchema, req.query);
    await sessions.deleteSession(prisma, requireActor(req), idParam(req, "id"), q.version);
    res.status(204).end();
  };
}

export function restore(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = parse(restoreSessionSchema, req.body ?? {});
    const session = await sessions.restoreSession(
      prisma,
      requireActor(req),
      idParam(req, "id"),
      body.version,
    );
    res.json(sessionDto(await titled(prisma, session)));
  };
}

export function linkContent(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = parse(linkContentSchema, req.body ?? {});
    const sessionId = idParam(req, "id");
    const link = await sessions.linkContent(
      prisma,
      requireActor(req),
      sessionId,
      body.educational_content_id,
    );
    res
      .status(201)
      .json(
        sessionContentLinkDto({
          id: link.id,
          sessionId,
          contentId: body.educational_content_id,
        }),
      );
  };
}

/** Unlinks. **Never deletes the file** (TD-3.12) — the content outlives the link. */
export function unlinkContent(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    await sessions.unlinkContent(
      prisma,
      requireActor(req),
      idParam(req, "id"),
      idParam(req, "contentId"),
    );
    res.status(204).end();
  };
}

/**
 * **Who is expected at this occurrence, and where it happens** (R92).
 *
 * Two facts on one response and never one field: `venue` is the branch and room
 * the class meets in, `audience_branches` are the populations expected there.
 * They coincide for every occurrence but the rare combined one, and reporting
 * them together is what stops a reader inferring the override from calendar
 * behaviour.
 */
export function roster(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const data = await sessions.readSessionRoster(
      prisma,
      requireActor(req),
      idParam(req, "id"),
    );
    res.json({ data: sessionRosterDto(data) });
  };
}

/** R92 — set this occurrence's own audience along all five dimensions, or clear any override. */
export function setAudience(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = parse(sessionAudienceSchema, req.body ?? {});
    const result = await sessions.setSessionAudienceOverrides(
      prisma,
      requireActor(req),
      idParam(req, "id"),
      body.version,
      {
        branchIds: body.branch_ids,
        categoryIds: body.category_ids,
        levelIds: body.level_ids,
        administrativeGroupIds: body.administrative_group_ids,
        teachingGroupIds: body.teaching_group_ids,
      },
    );
    res.json({
      data: {
        branch_ids: result.branchIds,
        category_ids: result.categoryIds,
        level_ids: result.levelIds,
        administrative_group_ids: result.administrativeGroupIds,
        teaching_group_ids: result.teachingGroupIds,
        overridden: result.overridden,
      },
    });
  };
}
