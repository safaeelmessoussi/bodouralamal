import type { Request, Response } from 'express';

import type { PrismaClient } from '../generated/prisma/client.js';
import { requireActor } from '../middleware/authenticate.js';
import { sortParamsFrom } from '../lib/sorting.js';
import { reorderSchema, reorderWithinSchema } from '../validators/reorder.validators.js';
import {
  createLevel,
  deleteLevel,
  listLevels,
  reorderLevels,
  updateLevel,
} from '../services/level.service.js';
import {
  createCategory,
  createSubject,
  deleteCategory,
  deleteSubject,
  listCategories,
  reorderCategories,
  updateCategory,
  updateSubject,
} from '../services/taxonomy.service.js';
import {
  categoryDto,
  createdLevelDto,
  levelCoreDto,
  levelDto,
  subjectRefDto,
} from './dto.js';
import { idParam, parse } from './parse.js';
import {
  createCategorySchema,
  createLevelSchema,
  createSubjectSchema,
  updateCategorySchema,
  updateLevelSchema,
  updateSubjectSchema,
} from '../validators/taxonomy.validators.js';
import { uuid } from '../validators/common.js';

/**
 * Curriculum taxonomy over HTTP — Categories, Subjects and Levels (§5.6, §14.1).
 *
 * **Thin by rule** (§16.2): parse, delegate, project. Every authorisation
 * decision, every delete guard and every TD-15 version check lives in the
 * services; a controller that re-implemented one of them would be a second
 * answer to the same question.
 *
 * Lists here are **unpaginated**, unlike the operational endpoints: the sets are
 * bounded by the curriculum, and a taxonomy screen with a hidden second page
 * cannot answer *"does this already exist"* — which is the question it is opened
 * to answer.
 */

/* ── Categories ───────────────────────────────────────────────────────────── */

export function categories(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const rows = await listCategories(prisma, requireActor(req), sortParamsFrom(req.query));
    res.json({ data: rows.map(categoryDto) });
  };
}

/** `PATCH /admin/categories/order` — the categories, in the order given (R76.4). */
export function reorderCategoriesHandler(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = parse(reorderSchema, req.body ?? {});
    const ids = await reorderCategories(prisma, requireActor(req), body.ids);
    res.json({ data: { ids } });
  };
}

export function createCategoryHandler(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = parse(createCategorySchema, req.body);
    const created = await createCategory(prisma, requireActor(req), {
      name: body.name,
      ...(body.display_order !== undefined ? { displayOrder: body.display_order } : {}),
    });
    res.status(201).json({ data: categoryDto(created) });
  };
}

export function updateCategoryHandler(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = parse(updateCategorySchema, req.body);
    const updated = await updateCategory(
      prisma,
      requireActor(req),
      idParam(req, 'id'),
      body.version,
      {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.display_order !== undefined ? { displayOrder: body.display_order } : {}),
      },
    );
    res.json({ data: categoryDto(updated) });
  };
}

export function deleteCategoryHandler(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    await deleteCategory(prisma, requireActor(req), idParam(req, 'id'));
    res.status(204).end();
  };
}

/* ── Subjects ─────────────────────────────────────────────────────────────── */

export function createSubjectHandler(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = parse(createSubjectSchema, req.body);
    const created = await createSubject(prisma, requireActor(req), {
      name: body.name,
      ...(body.display_order !== undefined ? { displayOrder: body.display_order } : {}),
    });
    res.status(201).json({ data: subjectRefDto(created) });
  };
}

export function updateSubjectHandler(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = parse(updateSubjectSchema, req.body);
    const updated = await updateSubject(
      prisma,
      requireActor(req),
      idParam(req, 'id'),
      body.version,
      {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.display_order !== undefined ? { displayOrder: body.display_order } : {}),
      },
    );
    res.json({ data: subjectRefDto(updated) });
  };
}

export function deleteSubjectHandler(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    await deleteSubject(prisma, requireActor(req), idParam(req, 'id'));
    res.status(204).end();
  };
}

/* ── Levels ───────────────────────────────────────────────────────────────── */

export function levels(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    // A malformed `category_id` is a `400`, not a silently unfiltered list —
    // the filter is the whole request when a screen drills into one Category.
    const raw = req.query['category_id'];
    const categoryId = typeof raw === 'string' && raw !== '' ? parse<string>(uuid, raw) : undefined;
    const rows = await listLevels(
      prisma,
      requireActor(req),
      categoryId !== undefined ? { categoryId } : {},
      sortParamsFrom(req.query),
    );
    res.json({ data: rows.map(levelDto) });
  };
}

/**
 * `PATCH /admin/levels/order` — one Category's Levels, in the order given.
 *
 * **The Category is required**, because §2.2 scopes `Level.display_order` to its
 * parent: a global sequence across every Level would write positions that mean
 * nothing beside each other.
 */
export function reorderLevelsHandler(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = parse(reorderWithinSchema, req.body ?? {});
    const ids = await reorderLevels(prisma, requireActor(req), body.within, body.ids);
    res.json({ data: { ids } });
  };
}

export function createLevelHandler(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = parse(createLevelSchema, req.body);
    const created = await createLevel(prisma, requireActor(req), {
      name: body.name,
      categoryId: body.category_id,
      genderRestriction: body.gender_restriction,
      ...(body.display_order !== undefined ? { displayOrder: body.display_order } : {}),
    });
    res.status(201).json({ data: createdLevelDto(created.level) });
  };
}

export function updateLevelHandler(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = parse(updateLevelSchema, req.body);
    const updated = await updateLevel(prisma, requireActor(req), idParam(req, 'id'), body.version, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.gender_restriction !== undefined
        ? { genderRestriction: body.gender_restriction }
        : {}),
      ...(body.display_order !== undefined ? { displayOrder: body.display_order } : {}),
    });
    res.json({ data: levelCoreDto(updated) });
  };
}

export function deleteLevelHandler(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    await deleteLevel(prisma, requireActor(req), idParam(req, 'id'));
    res.status(204).end();
  };
}
