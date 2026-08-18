import type { Request, Response } from 'express';

import type { PrismaClient } from '../generated/prisma/client.js';
import { requireActingStudent } from '../middleware/child-context.js';
import { requireActor } from '../middleware/authenticate.js';
import {
  publishGrades,
  readGradeSheet,
  readPublishedGrades,
  saveGradeDraft,
  type GradeEntry,
} from '../services/grade.service.js';
import { saveGradesSchema } from '../validators/grade.validators.js';
import { idParam, parse } from './parse.js';

/**
 * Grade entry (§4.6, TD-3; SRS Revision 70).
 *
 * **There is no conversion any more** (R81). A score is stored on the exam's own
 * scale, so what the مؤطرة typed is what is persisted and what everyone reads
 * back. The controller parses and delegates; the bound against the exam's
 * maximum is the service's, because that is where the exam is loaded.
 */

export function sheet(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    res.json({ data: await readGradeSheet(prisma, requireActor(req), idParam(req, 'id')) });
  };
}

export function save(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = parse(saveGradesSchema, req.body ?? {});

    const entries: GradeEntry[] = body.entries.map((e) => ({
      studentId: e.student_id,
      // `null` stays `null` all the way into the service: it means *unmarked*,
      // and turning it into 0 here would erase the distinction BR-7 depends on.
      score: e.score,
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

/**
 * `GET /students/me/grades` — **the acting student's published grades** (§5.3).
 *
 * `requireActingStudent` is the same resolution `GET /students/me` and
 * `GET /students/me/quran` use: the JWT `sub`, or an approved `FamilyLink` child
 * named by `X-Active-Child-ID` (§4.3). **`requireActor` is deliberately not
 * called** — this endpoint takes no actor-scoped decision, because there is no
 * identifier in the request for a caller to have chosen. That absence is the
 * security property TD-12 asks for (R63.3).
 *
 * **Each row carries its own maximum** (R81): exams no longer share a scale, so
 * `15 / 20` and `8 / 10` can sit beside each other on one screen.
 */
export function myGrades(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const acting = requireActingStudent(req);
    const result = await readPublishedGrades(prisma, acting.studentId);
    res.json({ data: result.rows });
  };
}

