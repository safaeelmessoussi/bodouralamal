import type { Request, Response } from 'express';

import type { PrismaClient } from '../generated/prisma/client.js';
import { requireActor } from '../middleware/authenticate.js';
import { markToBp, readGradingScale } from '../policies/grading.js';
import {
  overridePassFail,
  publishGrades,
  readGradeSheet,
  saveGradeDraft,
  type GradeEntry,
} from '../services/grade.service.js';
import { overridePassFailSchema, saveGradesSchema } from '../validators/grade.validators.js';
import { idParam, parse } from './parse.js';

/**
 * Grade entry (§4.6, TD-3; SRS Revision 70).
 *
 * **The /20 ↔ basis-point conversion happens here and nowhere else on the write
 * path.** Revision 8 requires the round-half-up exactly once, at final
 * persistence; doing it in the controller keeps the service dealing only in the
 * integers §20 rule 3 mandates, and keeps the client from owning a rounding rule
 * that decides whether somebody passed.
 */

export function sheet(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    res.json({ data: await readGradeSheet(prisma, requireActor(req), idParam(req, 'id')) });
  };
}

export function save(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = parse(saveGradesSchema, req.body ?? {});
    const scale = await readGradingScale(prisma);

    const entries: GradeEntry[] = body.entries.map((e) => ({
      studentId: e.student_id,
      // `null` stays `null` all the way into the service: it means *unmarked*,
      // and converting it to 0 here would erase the distinction BR-7 depends on.
      valueBp: e.mark === null ? null : markToBp(e.mark, scale.displayScale),
      absent: e.absent,
      version: e.version,
    }));

    const result = await saveGradeDraft(prisma, requireActor(req), idParam(req, 'id'), entries);
    res.json({ data: result });
  };
}

export function publish(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    res.json({ data: await publishGrades(prisma, requireActor(req), idParam(req, 'id')) });
  };
}

export function override(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const b = parse(overridePassFailSchema, req.body ?? {});
    await overridePassFail(
      prisma,
      requireActor(req),
      idParam(req, 'id'),
      idParam(req, 'studentId'),
      { value: b.value, reason: b.reason ?? '', version: b.version },
    );
    res.status(204).end();
  };
}
