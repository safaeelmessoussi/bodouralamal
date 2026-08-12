import type { Request, Response } from 'express';
import { z } from 'zod';

import type { PrismaClient } from '../generated/prisma/client.js';
import { requireActor } from '../middleware/authenticate.js';
import {
  correctLog,
  deleteLog,
  listQuranStudents,
  logProgress,
  readStudentCoverage,
} from '../services/quran.service.js';
import { idParam, parse } from './parse.js';

/**
 * Quran memorization tracking (§4.5, TD-3; M4a, SRS Revision 73).
 *
 * **The ayah bounds are checked in three places and that is deliberate**: the
 * schema's `CHECK` for `start <= end`, a database **trigger** for
 * `end <= total_ayahs` (TD-6 — it crosses tables), and the service, which turns
 * both into a coded refusal rather than a driver error. This layer only shapes
 * the request.
 */

const ayah = z.number().int().min(1).max(300);
const category = z.enum(['new_memorization', 'revision']);

const createSchema = z
  .object({
    student_id: z.string().uuid(),
    surah_id: z.number().int().min(1).max(114),
    start_ayah: ayah,
    end_ayah: ayah,
    category,
  })
  .strict()
  .refine((b) => b.start_ayah <= b.end_ayah, {
    message: 'the range ends before it starts',
    path: ['end_ayah'],
  });

const patchSchema = z
  .object({ start_ayah: ayah.optional(), end_ayah: ayah.optional(), category: category.optional() })
  .strict();

export function coverage(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    res.json({
      data: await readStudentCoverage(prisma, requireActor(req), idParam(req, 'id')),
    });
  };
}

export function create(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const b = parse(createSchema, req.body ?? {});
    const data = await logProgress(prisma, requireActor(req), {
      studentId: b.student_id,
      surahId: b.surah_id,
      startAyah: b.start_ayah,
      endAyah: b.end_ayah,
      category: b.category,
    });
    // The recalculated coverage comes back with the write: §4.5 requires the
    // مؤطرة to see the corrected percentage immediately, so making her fetch it
    // would be a second round trip for a value this request already computed.
    res.status(201).json({ data });
  };
}

export function update(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const b = parse(patchSchema, req.body ?? {});
    const data = await correctLog(prisma, requireActor(req), idParam(req, 'id'), {
      ...(b.start_ayah !== undefined ? { startAyah: b.start_ayah } : {}),
      ...(b.end_ayah !== undefined ? { endAyah: b.end_ayah } : {}),
      ...(b.category !== undefined ? { category: b.category } : {}),
    });
    res.json({ data });
  };
}

export function remove(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    res.json({ data: await deleteLog(prisma, requireActor(req), idParam(req, 'id')) });
  };
}

/** `GET /quran-students` — the selector's source (R73.1). */
export function students(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    res.json({ data: await listQuranStudents(prisma, requireActor(req)) });
  };
}
