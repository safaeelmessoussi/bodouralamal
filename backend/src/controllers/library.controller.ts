import type { Request, Response } from 'express';

import type { PrismaClient } from '../generated/prisma/client.js';
import { pageParamsFrom } from '../lib/pagination.js';
import * as library from '../services/library.service.js';
import { libraryItemDto, pageOf } from './dto.js';
import { parse } from './parse.js';
import { listLibraryQuerySchema } from '../validators/library.validators.js';

/**
 * `GET /library` (TD-3.13, §5.2) — **public, and anonymous by default.**
 *
 * Mounted before the guarded router with optional authentication, exactly as
 * `/calendar` is: a credential **reorders** the result (own branch → Global →
 * other branches) and never unlocks anything a signed-in member could not
 * otherwise reach. An invalid token is *ignored* rather than refused, so this
 * endpoint never answers `401` — a public surface that can 401 is not public.
 */

/** Absent for an anonymous caller; possibly Pending otherwise — the service decides. */
function libraryActor(req: Request): library.LibraryActor | null {
  const a = req.actor;
  if (!a) return null;
  return {
    userId: a.userId,
    roles: a.roles,
    roleScopes: a.roleScopes,
    accountStatus: a.accountStatus ?? 'active',
  };
}

export function list(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const filters = parse(listLibraryQuerySchema, req.query);
    const result = await library.listLibrary(prisma, libraryActor(req), {
      ...(filters.category_id !== undefined ? { categoryId: filters.category_id } : {}),
      ...(filters.level_id !== undefined ? { levelId: filters.level_id } : {}),
      ...(filters.academic_year_id !== undefined
        ? { academicYearId: filters.academic_year_id }
        : {}),
      ...(filters.subject_id !== undefined ? { subjectId: filters.subject_id } : {}),
      ...pageParamsFrom(req.query),
    });
    res.json(pageOf(result, libraryItemDto));
  };
}
