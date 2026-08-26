import type { Request, Response } from 'express';

import type { PrismaClient } from '../generated/prisma/client.js';
import { requireActor } from '../middleware/authenticate.js';
import {
  assignSubjectToLevel,
  listAcademicYears,
  listLevelSubjects,
  unassignSubjectFromLevel,
  assignSurahToLevel,
  listLevelSurahs,
  listQuranSurahs,
  unassignSurahFromLevel,
} from '../services/reference-data.service.js';
// Subject's home is the taxonomy service — this endpoint is its selector
// projection, not a second source for it.
import { listSubjects, reorderSubjects } from '../services/taxonomy.service.js';
import { sortParamsFrom } from '../lib/sorting.js';
import { reorderSchema } from '../validators/reorder.validators.js';
import { academicYearRefDto, subjectRefDto, subjectWithLevelsDto } from './dto.js';
import { idParam, parse } from './parse.js';

/**
 * Reference-data selectors (TD-3 extension, Document Owner decision 2026-08-05).
 *
 * **The canonical source for every admin selector needing a Subject or an
 * Academic Year.** A screen that needs either reads these rather than growing
 * its own list — which is the point of the decision, not a side effect of it.
 *
 * Both are unpaginated: a selector that offers a subset is lying about the
 * choice available, and these sets are bounded by the curriculum.
 */

export function subjects(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const rows = await listSubjects(prisma, requireActor(req), sortParamsFrom(req.query));
    // The WIDER projection: each Subject with the Levels that teach it, so
    // `/admin/subjects` can show the dependency that makes deletion refusable
    // (2026-08-17). `levelSubjects` below keeps the narrow one — a Level's own
    // subjects have no use for the reverse join.
    res.json({ data: rows.map(subjectWithLevelsDto) });
  };
}

/** `PATCH /admin/subjects/order` — the subjects, in the order given (R76.4). */
export function reorderSubjectsHandler(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = parse(reorderSchema, req.body ?? {});
    const ids = await reorderSubjects(prisma, requireActor(req), body.ids);
    res.json({ data: { ids } });
  };
}

export function academicYears(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const rows = await listAcademicYears(prisma, requireActor(req));
    res.json({ data: rows.map(academicYearRefDto) });
  };
}

/* ── Level ↔ Subject assignment ─────────────────────────────────────────── */

export function levelSubjects(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const rows = await listLevelSubjects(prisma, requireActor(req), idParam(req, 'levelId'));
    res.json({ data: rows.map(subjectRefDto) });
  };
}

export function assignSubject(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    await assignSubjectToLevel(
      prisma,
      requireActor(req),
      idParam(req, 'levelId'),
      idParam(req, 'subjectId'),
    );
    res.status(204).end();
  };
}

export function unassignSubject(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    await unassignSubjectFromLevel(
      prisma,
      requireActor(req),
      idParam(req, 'levelId'),
      idParam(req, 'subjectId'),
    );
    res.status(204).end();
  };
}

/** `GET /admin/levels/{id}/surahs` — the Level's حفظ القرآن syllabus (§4.5, BR-11, R107). */
export function levelSurahs(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    res.json({ data: await listLevelSurahs(prisma, requireActor(req), idParam(req, 'levelId')) });
  };
}

/** `PUT /admin/levels/{id}/surahs/{surahId}` — Super Admin (R26 curriculum). */
export function assignSurah(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    await assignSurahToLevel(
      prisma,
      requireActor(req),
      idParam(req, 'levelId'),
      Number(req.params['surahId']),
    );
    res.status(204).end();
  };
}

export function unassignSurah(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    await unassignSurahFromLevel(
      prisma,
      requireActor(req),
      idParam(req, 'levelId'),
      Number(req.params['surahId']),
    );
    res.status(204).end();
  };
}

/** `GET /admin/quran-surahs` — the seeded 114 (§4.5's definitive denominator). */
export function quranSurahs(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    res.json({ data: await listQuranSurahs(prisma, requireActor(req)) });
  };
}
