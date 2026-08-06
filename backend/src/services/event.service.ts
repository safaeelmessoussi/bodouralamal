import type { Event, Prisma, PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import * as scope from '../policies/branch-scope.js';
import { teacherEventScope } from '../policies/roster-resolution.js';
import { page, pageWindow, type Page, type PageParams } from '../lib/pagination.js';
import * as audit from '../repositories/audit.repository.js';
import { updateWithVersion } from '../repositories/optimistic-lock.js';
import * as trash from '../repositories/trash.repository.js';
import type { Actor } from '../policies/actor.js';

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
  // Revision 43: "their own groups" now means the Administrative Groups their
  // courses reach (§4.4c) — including the groups behind a Teaching Group they
  // teach, since those students are organised elsewhere.
  const own = new Set(
    (await teacherEventScope(tx as unknown as PrismaClient, actor.userId)).administrativeGroupIds,
  );
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
      // Revision 43: events scope to **Administrative Groups** (§7) — the
      // organisational unit — never to Teaching Groups, which are
      // subject-specific. `EventGroup` is retired with the `Group` it pointed at.
      await tx.eventAdministrativeGroup.create({
        data: { eventId: event.id, administrativeGroupId: groupId },
      });
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
 * TD-2 *"Schedule/edit Events"* — who may edit an EXISTING event.
 *
 * Editing is narrower than creating, because the event's reach already exists:
 *  - Super Admin, and an Admin with all-branches scope: any event.
 *  - A branch-scoped Admin: only an event **every** branch of which is inside
 *    their scope. An event reaching a branch they do not manage is not theirs
 *    to retitle or re-time, and one carrying no branch rows at all (a teacher's
 *    group-only event) is not attributable to them either.
 *  - A Teacher: only an event scoped **exclusively** to groups they teach —
 *    the same shape `assertMayScope` permits them to create.
 *
 * A caller who fails the test gets `NOT_FOUND`, not `FORBIDDEN` (§20 rule 17):
 * whether an event they cannot reach exists is not information they are owed.
 */
async function assertMayEdit(
  tx: Prisma.TransactionClient,
  actor: Actor,
  eventId: string,
): Promise<void> {
  if (isSuperAdmin(actor)) return;

  const [branches, categories, levels, groups] = await Promise.all([
    tx.eventBranch.findMany({ where: { eventId }, select: { branchId: true } }),
    tx.eventCategory.count({ where: { eventId } }),
    tx.eventLevel.count({ where: { eventId } }),
    tx.eventAdministrativeGroup.findMany({
      where: { eventId },
      select: { administrativeGroupId: true },
    }),
  ]);

  if (isAdmin(actor)) {
    const reachable = scope.reachableBranches(actor.roleScopes, [MANAGING_ROLE]);
    if (reachable === null) return; // all-branches Admin
    const outside = branches.length === 0 || branches.some((b) => !reachable.includes(b.branchId));
    if (outside) throw new AppError('NOT_FOUND', 'no such event');
    return;
  }

  if (!isTeacher(actor)) throw new AppError('FORBIDDEN', 'editing events requires staff');

  // A teacher's reach is groups only; any wider scope row puts the event beyond
  // them even if one of its groups happens to be theirs.
  if (branches.length > 0 || categories > 0 || levels > 0 || groups.length === 0) {
    throw new AppError('NOT_FOUND', 'no such event');
  }
  const own = new Set(
    (await teacherEventScope(tx as unknown as PrismaClient, actor.userId)).administrativeGroupIds,
  );
  if (groups.some((g) => !own.has(g.administrativeGroupId))) {
    throw new AppError('NOT_FOUND', 'no such event');
  }
}

/** The event's own attributes. Scope is deliberately absent — see `updateEvent`. */
export type EventPatch = Partial<Omit<EventInput, keyof EventScopes>>;

/**
 * `PATCH /events/{id}` (TD-3.4) — edits the event's own attributes under TD-15
 * optimistic locking.
 *
 * **Scope is not editable here, by design.** §4.4 populates the four join
 * tables *"at creation time"* and provides the manual **backfill** action as the
 * one sanctioned way to attach a branch afterwards. Re-resolving scope on edit
 * would mean a global event silently gaining every branch that opened since it
 * was created — precisely the auto-fill §4.4 forbids (*"never silently
 * auto-filled and never silently ignored"*). Scope keys are therefore rejected
 * at the API boundary rather than quietly ignored.
 */
export async function updateEvent(
  prisma: PrismaClient,
  actor: Actor,
  id: string,
  expectedVersion: number,
  patch: EventPatch,
): Promise<Event> {
  if (!isAdmin(actor) && !isTeacher(actor)) {
    throw new AppError('FORBIDDEN', 'editing events requires staff');
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.event.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new AppError('NOT_FOUND', 'no such event');
    await assertMayEdit(tx, actor, id);

    // Validated on the MERGED event: clearing a recurrence end date while the
    // recurrence stays weekly must fail, and only the merge can see that.
    const merged: EventInput = {
      title: patch.title ?? existing.title,
      description: patch.description === undefined ? existing.description : patch.description,
      visibility: (patch.visibility ?? existing.visibility) as EventInput['visibility'],
      startDate: patch.startDate ?? existing.startDate,
      endDate: patch.endDate === undefined ? existing.endDate : patch.endDate,
      startTime: patch.startTime === undefined ? existing.startTime : patch.startTime,
      endTime: patch.endTime === undefined ? existing.endTime : patch.endTime,
      recurrenceType: (patch.recurrenceType ?? existing.recurrenceType) as EventInput['recurrenceType'],
      recurrenceEndDate:
        patch.recurrenceEndDate === undefined ? existing.recurrenceEndDate : patch.recurrenceEndDate,
    };
    assertValidDates(merged);

    // TD-15.1: conditional UPDATE on `version` — a stale version is a coded 409,
    // never a silent overwrite of a colleague's edit.
    const updated = await updateWithVersion<Event>({
      delegate: tx.event,
      id,
      expectedVersion,
      requireNotDeleted: true,
      data: {
        title: merged.title,
        description: merged.description ?? null,
        visibility: merged.visibility as never,
        startDate: merged.startDate,
        endDate: merged.endDate ?? null,
        startTime: merged.startTime ?? null,
        endTime: merged.endTime ?? null,
        recurrenceType: merged.recurrenceType as never,
        recurrenceEndDate: merged.recurrenceEndDate ?? null,
      },
    });

    await audit.write(tx, {
      actorUserId: actor.userId,
      actionType: 'event.update',
      targetEntity: 'Event',
      targetId: id,
      detail: {
        fields_changed: Object.keys(patch),
        // Recorded explicitly: a visibility change moves the event between
        // audience tiers, which is the edit most worth being able to trace.
        ...(patch.visibility && patch.visibility !== existing.visibility
          ? { visibility_from: existing.visibility, visibility_to: patch.visibility }
          : {}),
      },
    });
    return updated;
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

    // **Captured BEFORE the joins are removed**, because they are hard-deleted
    // rather than soft-deleted: after this point the event's audience is not
    // merely hidden, it is gone. §4.10's runbook rule is that a snapshot must
    // carry the relationship rows the cascade removes, or a restore produces a
    // record that exists and reaches nobody.
    const [branches, categories, levels, groups] = await Promise.all([
      tx.eventBranch.findMany({ where: { eventId: id }, select: { branchId: true } }),
      tx.eventCategory.findMany({ where: { eventId: id }, select: { categoryId: true } }),
      tx.eventLevel.findMany({ where: { eventId: id }, select: { levelId: true } }),
      tx.eventAdministrativeGroup.findMany({
        where: { eventId: id },
        select: { administrativeGroupId: true },
      }),
    ]);

    await tx.eventBranch.deleteMany({ where: { eventId: id } });
    await tx.eventCategory.deleteMany({ where: { eventId: id } });
    await tx.eventLevel.deleteMany({ where: { eventId: id } });
    await tx.eventAdministrativeGroup.deleteMany({ where: { eventId: id } });

    await tx.event.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: actor.userId },
    });
    // TD-5/BR-15: a soft delete without a snapshot is a row nobody can find and
    // nobody can restore — the Trash is where a deletion becomes answerable, and
    // an entity that skips it is invisible to the one screen that exists to
    // report it.
    await trash.snapshot(tx, {
      targetEntity: 'Event',
      targetId: id,
      snapshot: {
        ...event,
        scope: {
          branch_ids: branches.map((r) => r.branchId),
          category_ids: categories.map((r) => r.categoryId),
          level_ids: levels.map((r) => r.levelId),
          administrative_group_ids: groups.map((r) => r.administrativeGroupId),
        },
      },
      deletedById: actor.userId,
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
  params: PageParams = {},
): Promise<Page<Event>> {
  if (!isAdmin(actor)) throw new AppError('FORBIDDEN', 'backfill requires admin');
  if (!isSuperAdmin(actor) && !scope.canActOnBranch(actor.roleScopes, MANAGING_ROLE, branchId)) {
    throw new AppError('NOT_FOUND', 'branch out of scope');
  }

  // Events that reach at least one other branch but not this one — i.e. those a
  // late-opening branch missed at creation time.
  const where = {
    deletedAt: null,
    branchScopes: { none: { branchId } },
    NOT: { branchScopes: { none: {} } },
  };
  const window = pageWindow(params);
  const [rows, total] = await Promise.all([
    prisma.event.findMany({
      where,
      orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
      skip: window.skip,
      take: window.take,
    }),
    prisma.event.count({ where }),
  ]);
  return page(rows, window, total);
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
