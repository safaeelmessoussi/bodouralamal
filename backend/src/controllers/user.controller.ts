import type { Request, Response } from 'express';
import { z } from 'zod';

import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { requireActor } from '../middleware/authenticate.js';
import {
  listUsers,
  preProvision,
  reactivateUser,
  setUserRoles,
  suspendUser,
  updateUser,
} from '../services/user.service.js';
import { userDto } from './dto.js';
import { idParam, parse } from './parse.js';
import {
  reactivateUserSchema,
  setUserRolesSchema,
  suspendUserSchema,
  updateUserSchema,
} from '../validators/user.validators.js';

/**
 * `POST /admin/users` — staff pre-provisioning (§5.6 `/admin/users` "create
 * (staff pre-provisioning against a Google email)", §4.1b step 4b, TD-2).
 */
const createSchema = z.object({
  // TD-9 length limits, matching the registration validators.
  name_arabic: z.string().trim().min(1).max(200),
  email: z.email().max(320),
  role: z.enum(['admin', 'teacher', 'student', 'parent']).optional(),
  branch_id: z.uuid().optional(),
  pre_approved: z.boolean().optional(),
  /* TD-9 (Revision 36.1): trimmed, and an empty value becomes NULL so "unset"
     has exactly one representation — a blank would read as set and render as
     nothing, defeating the fallback. */
  public_display_name: z
    .string()
    .trim()
    .max(120)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
});

export function create(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const parsed = createSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', 'name_arabic and a valid email are required');
    }
    const { name_arabic, email, role, branch_id, pre_approved } = parsed.data;

    const user = await preProvision(prisma, requireActor(req).userId, {
      nameArabic: name_arabic,
      email,
      ...(role ? { role } : {}),
      ...(branch_id ? { branchId: branch_id } : {}),
      ...(pre_approved !== undefined ? { preApproved: pre_approved } : {}),
    });

    res.status(201).json({
      id: user.id,
      account_status: user.accountStatus,
      pre_provisioned_email: user.preProvisionedEmail,
    });
  };
}

/** `GET /admin/users` — §14.2 Users screen; TD-10 pagination, filters and search. */
const listSchema = z.object({
  q: z.string().trim().max(120).optional(),
  role: z.enum(['super_admin', 'admin', 'teacher', 'student', 'parent']).optional(),
  branch_id: z.uuid().optional(),
  status: z.enum(['pending', 'active', 'rejected', 'suspended']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(100).optional(),
});

export function list(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const parsed = listSchema.safeParse(req.query);
    if (!parsed.success) throw new AppError('VALIDATION_FAILED', 'bad query parameters');
    const { q, role, branch_id, status, page, page_size } = parsed.data;

    const result = await listUsers(prisma, requireActor(req).userId, {
      ...(q ? { q } : {}),
      ...(role ? { role } : {}),
      ...(branch_id ? { branchId: branch_id } : {}),
      ...(status ? { status } : {}),
      ...(page ? { page } : {}),
      ...(page_size ? { pageSize: page_size } : {}),
    });

    res.json({ data: result.data.map(userDto), meta: result.meta });
  };
}

/* ── Management (§5.6 "edit, deactivate, role/branch-scope assignment") ───── */

/**
 * `PATCH /admin/users/{id}` — the person's own fields, and nothing else.
 *
 * `account_status` is **refused** by the schema rather than dropped: a
 * suspension carries TD-4.15's obligation to revoke every live session in the
 * same transaction, so accepting it here would give that transition a second
 * entrance with none of that attached — the same reason `PATCH /sessions/{id}`
 * refuses `status`.
 */
export function update(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = parse(updateUserSchema, req.body ?? {});
    const user = await updateUser(
      prisma,
      requireActor(req).userId,
      idParam(req, 'id'),
      body.version,
      {
        ...(body.name_arabic !== undefined ? { nameArabic: body.name_arabic } : {}),
        ...(body.name_french !== undefined ? { nameFrench: body.name_french } : {}),
        ...(body.nickname !== undefined ? { nickname: body.nickname } : {}),
        ...(body.phone !== undefined ? { phone: body.phone } : {}),
      },
    );
    res.json({ data: userDto(user) });
  };
}

/** `POST /admin/users/{id}/suspend` — TD-1 `Active → Suspended`, TD-4.15. */
export function suspend(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = parse(suspendUserSchema, req.body ?? {});
    const user = await suspendUser(
      prisma,
      requireActor(req).userId,
      idParam(req, 'id'),
      body.version,
      body.reason,
    );
    res.json({ data: userDto(user) });
  };
}

/** `POST /admin/users/{id}/reactivate` — TD-1 `Suspended → Active`. */
export function reactivate(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = parse(reactivateUserSchema, req.body ?? {});
    const user = await reactivateUser(
      prisma,
      requireActor(req).userId,
      idParam(req, 'id'),
      body.version,
    );
    res.json({ data: userDto(user) });
  };
}

/**
 * `PUT /admin/users/{id}/roles` — **replaces** the whole assignment set.
 *
 * A `PUT` of the complete set rather than add/remove verbs: one call is one
 * decision and one audit row, and there is no window in which the user holds
 * half of an intended change — which add-then-remove creates every time a role
 * moves between branches.
 */
export function setRoles(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = parse(setUserRolesSchema, req.body ?? {});
    const user = await setUserRoles(
      prisma,
      requireActor(req).userId,
      idParam(req, 'id'),
      body.assignments.map((a) => ({ role: a.role, branchId: a.branch_id })),
    );
    res.json({ data: userDto(user) });
  };
}
