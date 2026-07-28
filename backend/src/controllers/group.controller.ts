import type { Request, Response } from 'express';
import { z } from 'zod';

import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { requireActor } from '../middleware/authenticate.js';
import {
  createGroup,
  deleteGroup,
  listGroups,
  updateGroup,
  type Actor,
} from '../services/group.service.js';

/**
 * `/admin/groups` — Group management (§4.4, §5.6, TD-2).
 *
 * Authorization and every scheduling invariant live in the service; this is
 * boundary validation only.
 */

/** §7 `day_of_week`. */
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;

/**
 * `HH:MM` local wall-clock (TD-11) — never an instant. Parsed onto a fixed
 * epoch date so only the clock part is meaningful, which is what a `time`
 * column stores.
 */
const clock = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM, 24-hour')
  .transform((v) => {
    const [h, m] = v.split(':').map(Number);
    return new Date(Date.UTC(1970, 0, 1, h!, m!, 0));
  });

const createSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    level_id: z.uuid(),
    branch_id: z.uuid(),
    room_id: z.uuid().nullable().optional(),
    day_of_week: z.enum(DAYS),
    start_time: clock,
    end_time: clock,
    max_students: z.number().int().min(1).max(500),
  })
  .strict();

const updateSchema = z
  .object({
    version: z.number().int().min(0),
    name: z.string().trim().min(1).max(120).optional(),
    level_id: z.uuid().optional(),
    branch_id: z.uuid().optional(),
    room_id: z.uuid().nullable().optional(),
    day_of_week: z.enum(DAYS).optional(),
    start_time: clock.optional(),
    end_time: clock.optional(),
    max_students: z.number().int().min(1).max(500).optional(),
  })
  .strict();

const hhmm = (d: Date): string =>
  `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;

const view = (g: Awaited<ReturnType<typeof createGroup>>) => ({
  id: g.id,
  name: g.name,
  level_id: g.levelId,
  branch_id: g.branchId,
  room_id: g.roomId,
  day_of_week: g.dayOfWeek,
  start_time: hhmm(g.startTime),
  end_time: hhmm(g.endTime),
  max_students: g.maxStudents,
  version: g.version,
});

const actorOf = (req: Request): Actor => {
  const a = requireActor(req);
  return { userId: a.userId, roles: a.roles, roleScopes: a.roleScopes };
};

function groupId(req: Request): string {
  const parsed = z.uuid().safeParse(req.params['id']);
  if (!parsed.success) throw new AppError('NOT_FOUND', 'no such group');
  return parsed.data;
}

export function list(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    res.json({ data: (await listGroups(prisma, actorOf(req))).map(view) });
  };
}

export function create(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const parsed = createSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new AppError('VALIDATION_FAILED', 'invalid group payload');
    const b = parsed.data;

    const group = await createGroup(prisma, actorOf(req), {
      name: b.name,
      levelId: b.level_id,
      branchId: b.branch_id,
      roomId: b.room_id ?? null,
      dayOfWeek: b.day_of_week,
      startTime: b.start_time,
      endTime: b.end_time,
      maxStudents: b.max_students,
    });
    res.status(201).json(view(group));
  };
}

export function update(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const parsed = updateSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new AppError('VALIDATION_FAILED', 'invalid group payload');
    const b = parsed.data;

    const group = await updateGroup(prisma, actorOf(req), groupId(req), b.version, {
      ...(b.name !== undefined ? { name: b.name } : {}),
      ...(b.level_id !== undefined ? { levelId: b.level_id } : {}),
      ...(b.branch_id !== undefined ? { branchId: b.branch_id } : {}),
      ...(b.room_id !== undefined ? { roomId: b.room_id } : {}),
      ...(b.day_of_week !== undefined ? { dayOfWeek: b.day_of_week } : {}),
      ...(b.start_time !== undefined ? { startTime: b.start_time } : {}),
      ...(b.end_time !== undefined ? { endTime: b.end_time } : {}),
      ...(b.max_students !== undefined ? { maxStudents: b.max_students } : {}),
    });
    res.json(view(group));
  };
}

export function remove(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    await deleteGroup(prisma, actorOf(req), groupId(req));
    res.status(204).end();
  };
}
