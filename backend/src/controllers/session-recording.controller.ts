import type { Request, Response } from "express";

import type { PrismaClient } from "../generated/prisma/client.js";
import type { OnlineClassProvider } from "../lib/online-class-provider.js";
import { requireActor } from "../middleware/authenticate.js";
import { ACTIVE_CHILD_HEADER } from "../middleware/child-context.js";
import * as recordings from "../services/session-recording.service.js";
import { recordingStateDto } from "./dto.js";
import { idParam, parse } from "./parse.js";
import { recordingCommandSchema } from "../validators/session.validators.js";

/**
 * Recording an online class over HTTP (SRS Revision 99, TD-3.12).
 *
 * **Three routes, and the split is the point.** Starting and stopping are
 * `POST`s available to teaching staff; reading the state is a `GET` available
 * to **everybody who may enter the class**, because R99.5 requires every
 * participant — including a beneficiary, including somebody who arrives after
 * recording began — to see «جاري التسجيل». Transparency and authority are
 * different questions and get different routes.
 *
 * **Nothing here decides either one.** The service authorizes; this file maps.
 */

export function start(prisma: PrismaClient, provider: OnlineClassProvider | null) {
  return async (req: Request, res: Response): Promise<void> => {
    parse(recordingCommandSchema, req.body ?? {});
    const state = await recordings.startRecording(
      prisma,
      provider,
      requireActor(req),
      idParam(req, "id"),
    );
    res.status(202).json({ data: recordingStateDto(state) });
  };
}

export function stop(prisma: PrismaClient, provider: OnlineClassProvider | null) {
  return async (req: Request, res: Response): Promise<void> => {
    parse(recordingCommandSchema, req.body ?? {});
    const state = await recordings.stopRecording(
      prisma,
      provider,
      requireActor(req),
      idParam(req, "id"),
    );
    res.status(202).json({ data: recordingStateDto(state) });
  };
}

/**
 * **`null` is the ordinary answer**, and it is a real one: recording is
 * optional, so a class nobody recorded has no state to report and the interface
 * shows nothing rather than «لم يبدأ التسجيل» on every screen (R99.2).
 */
export function state(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const found = await recordings.readState(
      prisma,
      requireActor(req),
      idParam(req, "id"),
      req.header(ACTIVE_CHILD_HEADER) ?? undefined,
    );
    res.json({ data: found ? recordingStateDto(found) : null });
  };
}

/**
 * **The provider's callback — the one unauthenticated route in this area, and
 * the most carefully refused** (R99.15).
 *
 * It is not open: it is authenticated by the **provider's own signature** over
 * the raw body, which only a holder of the API secret can produce. Three
 * separate things must all be true before anything is written:
 *
 * 1. the signature verifies (`verifyCallback` returns `null` otherwise);
 * 2. the event is about an egress this platform **started** — a job id nobody
 *    here has seen is ignored, so an arbitrary request cannot manufacture a
 *    recording, let alone educational content;
 * 3. the state transition is one the machine allows, which makes a duplicate
 *    delivery a no-op rather than a second file.
 *
 * **It always answers `204`.** A verification failure that answered `401` would
 * tell a prober that its guess was wrong in a distinguishable way, and a
 * provider retrying forever against a `4xx` it cannot fix is worse than a
 * silent discard. What actually happened is in the log, not the status.
 */
export function callback(prisma: PrismaClient, provider: OnlineClassProvider | null) {
  return async (req: Request, res: Response): Promise<void> => {
    if (provider === null) {
      res.status(204).end();
      return;
    }
    /**
     * **The RAW body, not the parsed one.** The signature covers the exact
     * bytes the provider sent; a body that has been parsed and re-serialised no
     * longer matches it, and the route would reject every genuine callback
     * while accepting nothing extra. `express.raw` on this route only.
     */
    const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
    const report = await provider.verifyCallback(raw, req.header("authorization"));
    if (report) await recordings.applyProviderReport(prisma, report);
    res.status(204).end();
  };
}
