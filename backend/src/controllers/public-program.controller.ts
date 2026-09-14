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

    res.json({
      data: categories.map((category) => ({
        id: category.id,
        name: category.name,
        description: category.description,
        levels: category.levels.map((level) => ({
          id: level.id,
          name: level.name,
          description: level.description,
          subjects: level.subjects.map((s) => ({ id: s.id, name: s.name })),
          surahs: level.surahs.map((s) => ({ id: s.id, name: s.name })),
        })),
      })),
    });
  };
}
