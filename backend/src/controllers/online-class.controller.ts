import type { Request, Response } from "express";

import type { PrismaClient } from "../generated/prisma/client.js";
import type { OnlineClassProvider } from "../lib/online-class-provider.js";
import { requireActor } from "../middleware/authenticate.js";
import { ACTIVE_CHILD_HEADER } from "../middleware/child-context.js";
import * as onlineClass from "../services/online-class.service.js";
import { onlineJoinDto } from "./dto.js";
import { idParam, parse } from "./parse.js";
import { onlineJoinSchema } from "../validators/session.validators.js";

/**
 * `POST /sessions/{id}/online-join` (SRS Revision 98, TD-3.12).
 *
 * **A sibling of `/cancel`, `/restore` and `/notify`, not a new area.** It is a
 * `POST` because it mints a credential — a fresh, short-lived, per-participant
 * token — and `GET` would put that credential in a place caches and logs are
 * entitled to keep.
 *
 * **`childContext` is deliberately NOT mounted**, exactly as `content.service`'s
 * download route decided: staff reach a classroom through a different path
 * (§4.4c) and would be asked for a header they have no reason to send. The
 * header is read here and passed to the service, which calls the shared §4.3
 * resolver for the callers that rule is about — one resolver, invoked where it
 * applies.
 *
 * **Nothing is decided in this file.** The service authorizes, derives the room
 * and the identity, and only then reaches the provider (rule O).
 */
export function join(prisma: PrismaClient, provider: OnlineClassProvider | null) {
  return async (req: Request, res: Response): Promise<void> => {
    // Empty and `.strict()` — a forged identity, role or room is a `400` here
    // rather than a value some service downstream might read.
    parse(onlineJoinSchema, req.body ?? {});

    const result = await onlineClass.joinOnlineClass(
      prisma,
      provider,
      requireActor(req),
      idParam(req, "id"),
      req.header(ACTIVE_CHILD_HEADER) ?? undefined,
    );

    res.json({ data: onlineJoinDto(result) });
  };
}
