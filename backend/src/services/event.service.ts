import type { Event, Prisma, PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import * as scope from '../policies/branch-scope.js';
import { teacherGroupIds } from '../policies/teacher-scope.js';
import * as audit from '../repositories/audit.repository.js';
import type { Actor } from './group.service.js';

/**
 * Events — the exception/special-activity layer (SRS §4.4, §7, TD-2, TD-5, TD-11).
 *
 * §4.4: *"Events are the exception layer"* — holidays, one-off activities,
 * exams, ceremonies. The recurring weekly timetable belongs to Groups, so an
 * Event never duplicates it.
 *
 * **Scope joins are populated explicitly at creation, never evaluated at read
 * time.** §4.4 is emphatic: the four join tables (`EventBranch`,
 * `EventCategory`, `EventLevel`, `EventGroup`) are written when the event is
 * created, *"never runtime null/wildcard evaluation"*. A wildcard would have to
 * be re-interpreted on every calendar read, and its meaning would silently
 * change as branches are added — which is exactly the drift the explicit rows
 * prevent.
 *
 * **Only branches whose `operational_start_date` has already occurred are
 * attached.** A branch that opens later is deliberately left out, and §4.4's
 * manual **backfill** action is how an Admin attaches it — *"the gap is never
 * silently auto-filled and never silently ignored"*.
 *
 * Dates are local wall-clock (TD-11): `date` and `time` columns, never instants.
 */

const MANAGING_ROLE = 'admin';

const isSuperAdmin = (actor: Actor) => scope.isSuperAdmin(actor.roleScopes);
const isAdmin = (actor: Actor) => scope.hasRole(actor.roleScopes, MANAGING_ROLE) || isSuperAdmin(actor);
const isTeacher = (actor: Actor) => scope.hasRole(actor.roleScopes, 'teacher');

export interface EventScopes {
  /** Empty with `global: true` means every already-operational branch. */
  branchIds?: string[];
  categoryIds?: string[];
  levelIds?: string[];
  groupIds?: string[];
  global?: boolean;
}

export interface EventInput extends EventScopes {
  title: string;
  description?: string | null;
  visibility: 'public' | 'private' | 'hidden';
  startDate: Date;
  endDate?: Date | null;
  startTime?: Date | null;
  endTime?: Date | null;
  recurrenceType: 'none' | 'daily' | 'weekly' | 'biweekly_alternating' | 'yearly';
  recurrenceEndDate?: Date | null;
}

function assertValidDates(input: EventInput): void {
  if (input.endDate && input.endDate < input.startDate) {
    throw new AppError('VALIDATION_FAILED', 'end_date must not precede start_date');
  }
  if (input.recurrenceType === 'none' && input.recurrenceEndDate) {
    throw new AppError('VALIDATION_FAILED', 'recurrence_end_date requires a recurring event');
  }
  if (input.recurrenceEndDate && input.recurrenceEndDate < input.startDate) {
    throw new AppError('VALIDATION_FAILED', 'recurrence_end_date must not precede start_date');
  }
  if (input.recurrenceType !== 'none' && !input.recurrenceEndDate) {
    // An unbounded recurrence would expand forever in every calendar query.
    throw new AppError('VALIDATION_FAILED', 'a recurring event needs recurrence_end_date');
  }
}

/**
 * Resolves which branches the event attaches to, applying §4.4's operational
 * filter. Returns the ids actually written, so callers can report what was
 * attached rather than what was asked for.
 */
async function resolveBranches(
  tx: Prisma.TransactionClient,
  input: EventScopes,
  today: Date,
): Promise<string[]> {
  const operational = { deletedAt: null, operationalStartDate: { lte: today } };

  if (input.global) {
    const rows = await tx.branch.findMany({ where: operational, select: { id: true } });
    return rows.map((r) => r.id);
  }
  if (!input.branchIds?.length) return [];

  const rows = await tx.branch.findMany({
    where: { id: { in: input.branchIds }, ...operational },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * TD-2: Admin/Super Admin schedule events; a **Teacher may too, but only for
 * their own groups** — including Hidden ones. So a teacher-authored event must
 * name at least one group and name *nothing* they do not teach.
 */
async function assertMayScope(
  tx: Prisma.TransactionClient,
  actor: Actor,
  input: EventInput,
): Promise<void> {
  if (isAdmin(actor)) return;
  if (!isTeacher(actor)) throw new AppError('FORBIDDEN', 'scheduling events requires staff');

  if (input.global || input.branchIds?.length || input.categoryIds?.length || input.levelIds?.length) {
    throw new AppError('FORBIDDEN', 'a teacher may scope events to their own groups only');
  }
  if (!input.groupIds?.length) {
    throw new AppError('FORBIDDEN', 'a teacher must scope the event to their own groups');
  }
  const own = new Set(await teacherGroupIds(tx as unknown as PrismaClient, actor.userId));
  const foreign = input.groupIds.filter((g) => !own.has(g));
  if (foreign.length > 0) {
    // §20 rule 17: naming a group they do not teach reveals nothing.
    throw new AppError('NOT_FOUND', 'group not found');
  }
}

export interface CreatedEvent {
  event: Event;
  attached: { branches: number; categories: number; levels: number; groups: number };
}

export async function createEvent(
  prisma: PrismaClient,
  actor: Actor,
  input: EventInput,
  today: Date = new Date(),
): Promise<CreatedEvent> {
  if (!isAdmin(actor) && !isTeacher(actor)) {
    throw new AppError('FORBIDDEN', 'scheduling events requires staff');
  }
  assertValidDates(input);

  return prisma.$transaction(async (tx) => {
    await assertMayScope(tx, actor, input);

    // An Admin may only attach branches inside their own scope; a global event
    // from a branch-scoped Admin means "all of MY operational branches".
    let branchIds = await resolveBranches(tx, input, today);
    if (!isSuperAdmin(actor)) {
      const reachable = scope.reachableBranches(actor.roleScopes, [MANAGING_ROLE]);
      if (reachable !== null) branchIds = branchIds.filter((b) => reachable.includes(b));
    }

    const event = await tx.event.create({
      data: {
        title: input.title,
        description: input.description ?? null,
        visibility: input.visibility as never,
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        startTime: input.startTime ?? null,
        endTime: input.endTime ?? null,
        recurrenceType: input.recurrenceType as never,
        recurrenceEndDate: input.recurrenceEndDate ?? null,
      },
    });

    // §4.4: written HERE, at creation. Never a wildcard resolved at read time.
    const categoryIds = [...new Set(input.categoryIds ?? [])];
    const levelIds = [...new Set(input.levelIds ?? [])];
    const groupIds = [...new Set(input.groupIds ?? [])];

    for (const branchId of branchIds) {
      await tx.eventBranch.create({ data: { eventId: event.id, branchId } });
    }
    for (const categoryId of categoryIds) {
      await tx.eventCategory.create({ data: { eventId: event.id, categoryId } });
    }
    for (const levelId of levelIds) {
      await tx.eventLevel.create({ data: { eventId: event.id, levelId } });
    }
    for (const groupId of groupIds) {
      await tx.eventGroup.create({ data: { eventId: event.id, groupId } });
    }

    await audit.write(tx, {
      actorUserId: actor.userId,
      actionType: 'event.create',
      targetEntity: 'Event',
      targetId: event.id,
      detail: {
        visibility: input.visibility,
        recurrence: input.recurrenceType,
        global: input.global === true,
        attached: {
          branches: branchIds.length,
          categories: categoryIds.length,
          levels: levelIds.length,
          groups: groupIds.length,
        },
      },
    });

    return {
      event,
      attached: {
        branches: branchIds.length,
        categories: categoryIds.length,
        levels: levelIds.length,
        groups: groupIds.length,
      },
    };
  });
}

/**
 * TD-5: *"Event — soft-delete; **scope join rows removed**; attached content
 * keeps `event_id` for provenance but no longer surfaces under the event."*
 *
 * The joins are removed rather than soft-deleted because they carry no history
 * of their own — they are the materialised reach of an event that no longer
 * applies.
 */
export async function deleteEvent(
  prisma: PrismaClient,
  actor: Actor,
  id: string,
): Promise<void> {
  if (!isAdmin(actor)) throw new AppError('FORBIDDEN', 'deleting events requires admin');

  await prisma.$transaction(async (tx) => {
    const event = await tx.event.findFirst({ where: { id, deletedAt: null } });
    if (!event) throw new AppError('NOT_FOUND', 'no such event');

    await tx.eventBranch.deleteMany({ where: { eventId: id } });
    await tx.eventCategory.deleteMany({ where: { eventId: id } });
    await tx.eventLevel.deleteMany({ where: { eventId: id } });
    await tx.eventGroup.deleteMany({ where: { eventId: id } });

    await tx.event.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: actor.userId },
    });
    await audit.write(tx, {
      actorUserId: actor.userId,
      actionType: 'event.delete',
      targetEntity: 'Event',
      targetId: id,
      detail: { title: event.title },
    });
  });
}

/**
 * §4.4 branch-activation backfill: the events a newly-operational branch could
 * be attached to — global/recurring events created before it opened.
 *
 * Listing is deliberately separate from attaching: *"the gap is never silently
 * auto-filled and never silently ignored"*, so an Admin sees the candidates and
 * chooses.
 */
export async function backfillCandidates(
  prisma: PrismaClient,
  actor: Actor,
  branchId: string,
): Promise<Event[]> {
  if (!isAdmin(actor)) throw new AppError('FORBIDDEN', 'backfill requires admin');
  if (!isSuperAdmin(actor) && !scope.canActOnBranch(actor.roleScopes, MANAGING_ROLE, branchId)) {
    throw new AppError('NOT_FOUND', 'branch out of scope');
  }

  // Events that reach at least one other branch but not this one — i.e. those a
  // late-opening branch missed at creation time.
  return prisma.event.findMany({
    where: {
      deletedAt: null,
      branchScopes: { none: { branchId } },
      NOT: { branchScopes: { none: {} } },
    },
    orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
  });
}

/** Attaches a branch to an event that missed it (§4.4 manual backfill). */
export async function backfillAttach(
  prisma: PrismaClient,
  actor: Actor,
  branchId: string,
  eventIds: string[],
): Promise<number> {
  if (!isAdmin(actor)) throw new AppError('FORBIDDEN', 'backfill requires admin');
  if (!isSuperAdmin(actor) && !scope.canActOnBranch(actor.roleScopes, MANAGING_ROLE, branchId)) {
    throw new AppError('NOT_FOUND', 'branch out of scope');
  }

  return prisma.$transaction(async (tx) => {
    const branch = await tx.branch.findFirst({
      where: { id: branchId, deletedAt: null },
      select: { id: true },
    });
    if (!branch) throw new AppError('NOT_FOUND', 'no such branch');

    let attached = 0;
    for (const eventId of eventIds) {
      const event = await tx.event.findFirst({
        where: { id: eventId, deletedAt: null },
        select: { id: true },
      });
      if (!event) throw new AppError('NOT_FOUND', 'no such event');

      const existing = await tx.eventBranch.findFirst({ where: { eventId, branchId } });
      if (existing) continue; // idempotent: attaching twice is not an error
      await tx.eventBranch.create({ data: { eventId, branchId } });
      attached += 1;
    }

    await audit.write(tx, {
      actorUserId: actor.userId,
      actionType: 'event.backfill',
      targetEntity: 'Branch',
      targetId: branchId,
      detail: { events_requested: eventIds.length, events_attached: attached },
    });
    return attached;
  });
}
