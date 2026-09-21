import type { Request, Response } from 'express';
import { z } from 'zod';

import type { PrismaClient } from '../generated/prisma/client.js';
import { requireActor } from '../middleware/authenticate.js';
import { requireActingStudent } from '../middleware/child-context.js';
import * as marks from '../services/level-completion-mark.service.js';
import { idParam, parse } from './parse.js';

/**
 * «إتمام المستوى» and its certificate (SRS Revision 167 §3). HTTP only — every
 * rule, the scope check and the audit live in the service.
 */
const markSchema = z
  .object({
    // She may be marked while BR-11 is unmet — but only by a caller who says
    // she has SEEN what is missing. Absent means «not told yet».
    acknowledge_unmet: z.boolean().optional(),
  })
  .strict();

export function list(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    res.json({
      data: await marks.listForStudent(prisma, requireActor(req), idParam(req, 'id')),
    });
  };
}

export function mark(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = parse(markSchema, req.body ?? {});
    await marks.markCompleted(
      prisma,
      requireActor(req),
      idParam(req, 'id'),
      idParam(req, 'levelId'),
      { acknowledgeUnmet: body.acknowledge_unmet === true },
    );
    res.status(204).end();
  };
}

export function unmark(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    await marks.unmarkCompleted(
      prisma,
      requireActor(req),
      idParam(req, 'id'),
      idParam(req, 'levelId'),
    );
    res.status(204).end();
  };
}

export function issueCertificate(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    await marks.issueCertificate(
      prisma,
      requireActor(req),
      idParam(req, 'id'),
      idParam(req, 'levelId'),
    );
    res.status(204).end();
  };
}

export function withdrawCertificate(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    await marks.withdrawCertificate(
      prisma,
      requireActor(req),
      idParam(req, 'id'),
      idParam(req, 'levelId'),
    );
    res.status(204).end();
  };
}

/**
 * `GET /students/me/certificates` — **`me` is the ACTING student** (§4.3): the
 * subject comes from `childContext`, never from the request, so there is
 * nowhere for a caller to name somebody else's certificates.
 */
export function mine(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    res.json({
      data: await marks.certificatesOf(prisma, requireActingStudent(req).studentId),
    });
  };
}
