import type { Request, Response } from 'express';

import type { PrismaClient } from '../generated/prisma/client.js';
import { listPublicPrograms } from '../services/public-program.service.js';

/**
 * `GET /programs` — the homepage's programme overview (Owner-reported,
 * 2026-09-14). Public and anonymous, on the same reasoning
 * `public-branch.controller.ts` already states: no actor, no tier to
 * resolve, and a credential could only ever be ignored here.
 */
export function list(prisma: PrismaClient) {
  return async (_req: Request, res: Response): Promise<void> => {
    const categories = await listPublicPrograms(prisma);

    // R182 §3 / R183 §1 — by Surah, and seasonal (a course, not the programme).
    const subjectRef = (s: { id: string; name: string; worksBySurah: boolean; seasonal: boolean }) => ({
      id: s.id,
      name: s.name,
      works_by_surah: s.worksBySurah,
      seasonal: s.seasonal,
    });
    res.json({
      data: categories.map((category) => ({
        id: category.id,
        name: category.name,
        description: category.description,
        // R180 §4 — derived from the first and last Level; `null` = no bound.
        min_age: category.minAge,
        max_age: category.maxAge,
        // R182 §1 — the Subjects shared by every step, once; R182 §5 — who holds the login.
        subjects: category.subjects.map(subjectRef),
        holds_own_login: category.holdsOwnLogin,
        levels: category.levels.map((level) => ({
          id: level.id,
          name: level.name,
          description: level.description,
          min_age: level.minAge,
          max_age: level.maxAge,
          // R180 §6 — what the Level is on the journey.
          journey_role: level.journeyRole,
          // R181 §6 — «مقرر الحفظ» in Hizb. R184 §2 — no `gender_restriction`
          // any more: the page composes no audience words (the Category's
          // description, the Super Admin's, says who it is for).
          memorisation_hizb: level.memorisationHizb,
          subjects: level.subjects.map(subjectRef),
          surahs: level.surahs.map((s) => ({ id: s.id, name: s.name })),
        })),
      })),
    });
  };
}
