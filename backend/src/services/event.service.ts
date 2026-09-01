import type { Event, Prisma, PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import * as scope from '../policies/branch-scope.js';
import { isResponsibleForEvent, teacherEventScope } from '../policies/roster-resolution.js';
import { page, pageWindow, type Page, type PageParams } from '../lib/pagination.js';
import * as audit from '../repositories/audit.repository.js';
import {
  notifyEventStaffChanged,
  reconcileEventNotificationVisibility,
  withdrawEventStaffNotificationAccess,
} from './notification.service.js';
import { updateWithVersion } from '../repositories/optimistic-lock.js';
import * as trash from '../repositories/trash.repository.js';
import type { Actor } from '../policies/actor.js';
import { assertActivityType } from './scheduling-type.service.js';
import { assertStaffAccountsAvailable } from './staffing-integrity.service.js';

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


/**
 * **What a عطلة may carry** (Owner decision, 2026-08-28).
 *
 * A holiday is a period on which nothing is delivered: *which branches, and
 * which Categories, are off*. It has no staff, no Levels and no groups — so
 * those are **refused at the write boundary** rather than hidden by the form and
 * persisted empty. Hiding them in the interface would leave an activity-shaped
 * record behind and put the structural distinction in the one layer that must
 * not hold it.
 *
 * The fields a class carries and an Event does not — القاعة, المادة, الحلقة,
 * نمط التدريس, طريقة الحضور — need no refusal here: `Event` has no column for
 * any of them, which is the model already saying so.
 *
 * **Staff is refused in `setEventStaff`, not here**: it is a separate endpoint
 * with its own transaction, so a rule written into this shape check would have
 * been dead code that read like protection.
 */
function assertHolidayShape(input: { levelIds?: string[]; groupIds?: string[] }): void {
  const carried: string[] = [];
  if (input.levelIds?.length) carried.push('levels');
  if (input.groupIds?.length) carried.push('administrative_groups');
  if (carried.length > 0) {
    throw new AppError('VALIDATION_FAILED', 'a holiday carries branches and categories only', {
      reason: 'HOLIDAY_SHAPE',
      refused: carried,
    });
  }
}

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
  /**
   * **R110 — which catalogue type this activity is** (محاضرة, حفل, عطلة).
   *
   * Optional on the TYPE and required by the FORM, which is §7's standing
   * division (R35): every activity created before R110 has its type recorded
   * nowhere a query can reach — R56 told administrators to write عطلة in the
   * title — and inferring one from that title would be the name-matching §4.4b
   * forbids. So the column tolerates the past and the boundary demands a value
   * where a real one can be asked for.
   *
   * Refused unless it names a **live type whose `structural_kind` is
   * `activity`**: an `Event` typed حصة دراسية would be a row the calendar
   * renders as an activity and the catalogue calls a class.
   */
  schedulingTypeId?: string | null;
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

    // R110 — checked before the row is written, so a bad type is a coded
    // refusal rather than a foreign-key violation surfacing as a 500.
    if (input.schedulingTypeId) {
      const kind = await assertActivityType(tx, input.schedulingTypeId);
      if (kind === 'holiday') assertHolidayShape(input);
    }

    if (!isAdmin(actor) && isTeacher(actor)) {
      await assertStaffAccountsAvailable(tx, [actor.userId]);
    }

    const event = await tx.event.create({
      data: {
        title: input.title,
        description: input.description ?? null,
        schedulingTypeId: input.schedulingTypeId ?? null,
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

    // **R71.3 — creating an event is what makes a مؤطرة answerable for it.**
    // Structural, not a grant: assigning staff is otherwise Admin-and-above, and
    // without this a مؤطرة who created an event would need an Admin to hand it
    // back to her before she could edit it. An Admin creating an event is NOT
    // recorded — their authority is their branch scope, and a row saying they
    // personally answer for every event they set up would be a fiction.
    if (!isAdmin(actor) && isTeacher(actor)) {
      await tx.eventStaff.create({
        data: { eventId: event.id, userId: actor.userId, position: 'responsible' },
      });
    }

    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
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
/**
 * **Exported for R82's optional send**: whoever may edit an event may announce a
 * change to it, and the announcement asks the *same* question the write asked.
 * A second implementation of "may this person touch this event" would be a
 * second answer, and the two would drift.
 */
export async function assertMayEdit(
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

  // **R71.2 — responsibility grants event scope on its own.** This is the whole
  // gap the audit found: a مؤطرة responsible for a celebration who teaches
  // nothing had EMPTY event scope, because scope derived only from teaching
  // schedules, and so could not manage the very event she answers for.
  //
  // **`responsible` only.** An `assistant` sees the event, including a Hidden
  // one, and does not change it (R71.3) — the one place a `*Staff` position is
  // authorization-bearing, because an event names ONE answerable person where a
  // class has co-teachers who deliver it equally.
  if (await isResponsibleForEvent(tx as unknown as PrismaClient, actor.userId, eventId)) return;

  // Otherwise the pre-R71 rule, unchanged: a teacher's reach is groups only, and
  // any wider scope row puts the event beyond them even if one of its groups
  // happens to be theirs.
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
      // R110 — absent leaves the type alone; `null` is a real instruction to
      // clear it, the same `undefined` / `null` distinction every PATCH on this
      // platform makes.
      schedulingTypeId:
        patch.schedulingTypeId === undefined
          ? existing.schedulingTypeId
          : patch.schedulingTypeId,
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
    // R110 — re-checked on the MERGED value, so an edit cannot move an activity
    // onto a type that routes somewhere else.
    if (merged.schedulingTypeId) {
      const kind = await assertActivityType(tx, merged.schedulingTypeId);
      // The merged view, so changing a type to عطلة on an activity that carries
      // Levels or staff is refused rather than silently keeping them.
      if (kind === 'holiday') assertHolidayShape(merged);
    }

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
        schedulingTypeId: merged.schedulingTypeId ?? null,
        visibility: merged.visibility as never,
        startDate: merged.startDate,
        endDate: merged.endDate ?? null,
        startTime: merged.startTime ?? null,
        endTime: merged.endTime ?? null,
        recurrenceType: merged.recurrenceType as never,
        recurrenceEndDate: merged.recurrenceEndDate ?? null,
      },
    });

    await reconcileEventNotificationVisibility(
      tx,
      id,
      existing.visibility,
      merged.visibility,
      actor.userId,
    );

    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
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
export interface EventStaffInput {
  userId: string;
  position: 'responsible' | 'assistant';
}

/**
 * The existing Event-deletion authority, exported so R82's separate
 * post-delete notification request can require the same capability before it
 * consults the deletion record. The same-actor Trash check then narrows it
 * further; it never substitutes for this role check.
 */
export function assertMayDeleteEvent(actor: Actor): void {
  if (!isAdmin(actor)) throw new AppError('FORBIDDEN', 'deleting events requires admin');
}

/**
 * `PUT /events/{id}/staff` — **who answers for this event** (§4.4, R71).
 *
 * **Admin and above (R71.4).** Being answerable for an event is not authority to
 * decide who else answers for it — and granting it would let a مؤطرة with
 * momentary edit rights make herself permanently responsible, which is scope she
 * would then keep after the teaching assignment that gave her the edit expired.
 * The one exception is structural rather than a grant: creating an event records
 * the creator `responsible`, because creating it is what makes her answerable.
 *
 * **Replaced, not merged**, exactly as `ExamStaff` is: one call is one decision,
 * and there is no window in which the event holds half of an intended change.
 *
 * **Tombstone and revive, never hard delete (R59).** These rows carry
 * `deleted_at`, so TD-5 means an ordinary write never destroys them — and the
 * `@@unique([eventId, userId])` pair is deliberately not filtered on it, so a
 * returning assistant must be **revived**: an insert would be refused by the
 * constraint. It earns **no Trash entry**, because reconciliation is one field
 * of an update expressed as a tombstone, which is the distinction R59 draws for
 * `SessionStaff` and `UserBranchRole`.
 */
export async function setEventStaff(
  prisma: PrismaClient,
  actor: Actor,
  eventId: string,
  staff: EventStaffInput[],
): Promise<void> {
  const teacherOnly = !isAdmin(actor) && isTeacher(actor);
  if (!isAdmin(actor) && !teacherOnly) {
    throw new AppError('FORBIDDEN', 'assigning event staff requires admin (TD-2, R71.4)');
  }

  // At most one person answers for an event. The association's own description
  // is *a main responsible مؤطرة and one or more assistants*, and two people
  // named responsible is not a stricter version of that — it is a different
  // arrangement nobody asked for.
  /**
   * **Nobody staffs a عطلة** (Owner, 2026-08-28). A holiday is a period on
   * which nothing is delivered, so there is no one to be answerable for it —
   * and refusing it here rather than hiding the control is what keeps the rule
   * true for a forged request.
   */
  if (staff.length > 0) {
    const event = await prisma.event.findFirst({
      where: { id: eventId, deletedAt: null },
      select: { schedulingType: { select: { structuralKind: true } } },
    });
    if (event?.schedulingType?.structuralKind === 'holiday') {
      throw new AppError('VALIDATION_FAILED', 'a holiday carries no staff', {
        reason: 'HOLIDAY_SHAPE',
        refused: ['staff'],
      });
    }
  }

  if (staff.filter((p) => p.position === 'responsible').length > 1) {
    throw new AppError('VALIDATION_FAILED', 'an event has one responsible مؤطرة', {
      reason: 'ONE_RESPONSIBLE_ONLY',
    });
  }

  /**
   * **A مؤطرة may staff HER OWN event, and may not hand it to anybody else.**
   *
   * R71.4 kept this Admin-and-above on the reasoning that *being answerable for
   * an event is not authority to decide who else answers for it* — which is
   * right about the **responsible** position and wrong about assistants: a
   * مؤطرة who may create a celebration in her own scope could not name the two
   * people helping her run it, so she had to ask an Admin to do it for her.
   *
   * The narrow grant: she may set the assistants, and **the responsible person
   * must be herself**. Not by hiding a control — a forged body naming somebody
   * else is refused here, which is the only place it can be. Admins keep their
   * existing reach untouched, so this widens nothing for them.
   */
  if (teacherOnly) {
    const named = staff.find((p) => p.position === 'responsible');
    if (named && named.userId !== actor.userId) {
      throw new AppError('FORBIDDEN', 'a مؤطرة answers for her own event', {
        reason: 'RESPONSIBLE_MUST_BE_SELF',
      });
    }
  }

  await prisma.$transaction(async (tx) => {
    const event = await tx.event.findFirst({ where: { id: eventId, deletedAt: null } });
    if (!event) throw new AppError('NOT_FOUND', 'no such event');
    await assertMayEdit(tx, actor, eventId);

    if (teacherOnly) {
      // **And she must already answer for it.** `assertMayEdit` grants a مؤطرة
      // edit rights on events inside her teaching scope, which is wider than
      // *hers*: without this she could restaff a colleague's celebration.
      const mine = await tx.eventStaff.findFirst({
        where: { eventId, userId: actor.userId, position: 'responsible', deletedAt: null },
        select: { id: true },
      });
      if (!mine) {
        throw new AppError('FORBIDDEN', 'staffing an event requires answering for it', {
          reason: 'NOT_RESPONSIBLE_FOR_EVENT',
        });
      }
    }

    const existing = await tx.eventStaff.findMany({ where: { eventId } });
    const wanted = new Map(staff.map((p) => [p.userId, p.position]));

    for (const row of existing) {
      const position = wanted.get(row.userId);
      if (position === undefined) {
        if (row.deletedAt === null) {
          await tx.eventStaff.update({
            where: { id: row.id },
            data: { deletedAt: new Date(), deletedById: actor.userId },
          });
        }
      } else {
        await tx.eventStaff.update({
          where: { id: row.id },
          data: { position, deletedAt: null, deletedById: null },
        });
      }
    }

    for (const person of staff) {
      if (!existing.some((row) => row.userId === person.userId)) {
        await tx.eventStaff.create({
          data: { eventId, userId: person.userId, position: person.position },
        });
      }
    }

    /**
     * **The people who were not on it a moment ago** (R93).
     *
     * *Newly assigned* is the difference between the live staffing and the
     * submitted set — not everybody in the request. Re-saving the same staffing
     * after an edit to the title tells nobody again, which is the whole reason
     * this is computed rather than taken from `staff`.
     *
     * A person **removed and later re-added counts as new**: her row was
     * withdrawn in between, and the second assignment is a second fact.
     *
     * **Inside this transaction**, like R77.4's cancellation notices and for the
     * same reason — an event saved with assistants and no communication cannot
     * be told apart, on retry, from one already announced.
     */
    const newlyAssigned = staff
      .filter((person) => {
        const before = existing.find((row) => row.userId === person.userId);
        return before === undefined || before.deletedAt !== null;
      })
      .map((person) => person.userId);
    const removed = existing
      .filter(
        (row) =>
          row.deletedAt === null && !staff.some((person) => person.userId === row.userId),
      )
      .map((row) => row.userId);
    const accessGained =
      event.visibility === 'hidden'
        ? staff
            .filter((person) => {
              const before = existing.find((row) => row.userId === person.userId);
              return (
                before?.deletedAt === null &&
                before.position === 'assistant' &&
                person.position === 'responsible'
              );
            })
            .map((person) => person.userId)
        : [];
    const accessLost =
      event.visibility === 'hidden'
        ? existing
            .filter((row) => {
              const after = staff.find((person) => person.userId === row.userId);
              return (
                row.deletedAt === null &&
                row.position === 'responsible' &&
                after?.position === 'assistant'
              );
            })
            .map((row) => row.userId)
        : [];
    await withdrawEventStaffNotificationAccess(tx, eventId, accessLost);
    const staffNotices = await notifyEventStaffChanged(
      tx,
      eventId,
      [...newlyAssigned, ...accessGained],
      removed,
      actor.userId,
    );
    await assertStaffAccountsAvailable(
      tx,
      staff.map((person) => person.userId),
    );

    // R71.4 — its own action type: *who answers for this celebration* is not an
    // attribute edit, and `event.update` would bury the decision.
    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'event.staff_change',
      targetEntity: 'Event',
      targetId: eventId,
      detail: {
        positions: staff.map((p) => ({ user_id: p.userId, position: p.position })),
        // *Who was told, and how many* — the question somebody asks when an
        // assistant says she never heard.
        newly_assigned: newlyAssigned,
        notified: staffNotices.assigned,
        removed,
        unassigned_notified: staffNotices.unassigned,
      },
    });
  });
}

export async function deleteEvent(
  prisma: PrismaClient,
  actor: Actor,
  id: string,
): Promise<void> {
  assertMayDeleteEvent(actor);

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
      activeRole: actor.activeRole,
      actionType: 'event.delete',
      targetEntity: 'Event',
      targetId: id,
      // The target id is the durable coordinate. Event titles are free text and
      // may contain a person's identity; copying one here would put it under a
      // broader/indefinite audit retention rule for no accountability gain.
      detail: {},
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
      activeRole: actor.activeRole,
      actionType: 'event.backfill',
      targetEntity: 'Branch',
      targetId: branchId,
      detail: { events_requested: eventIds.length, events_attached: attached },
    });
    return attached;
  });
}

/**
 * `GET /events` — the stored event **definitions** (TD-3.4, R56).
 *
 * ## Why this exists, and why it is not `GET /calendar`
 *
 * Reads of events had always gone through the calendar, which returns their
 * **expansion**: a weekly event appears there as forty dated occurrences. That
 * is right for a calendar and wrong for a management list — the administrator
 * created **one rule**, and a table offering forty *edit* buttons for it would
 * be offering to edit something that does not exist as a row.
 *
 * So this returns the rule, exactly as `GET /admin/course-schedules` does for
 * the other half of the unified Scheduling screen. The two lists have to answer
 * the same *kind* of question or the screen showing them together is incoherent
 * — which is precisely what the two former pages did, one listing rules and the
 * other listing occurrences.
 *
 * **The date window filters by overlap, not by start.** An event that began in
 * September and runs to June belongs in a January window; filtering on
 * `start_date` alone would hide exactly the long-running items an administrator
 * is most likely to be looking for. `recurrence_end_date`/`end_date` bound it,
 * and a null bound means open-ended and therefore always current.
 */
export async function listEvents(
  prisma: PrismaClient,
  actor: Actor,
  filters: { branchId?: string; from?: Date; to?: Date } & PageParams,
): Promise<
  Page<
    Event & {
      branchScopes: { branchId: string }[];
      staff: { userId: string; position: 'responsible' | 'assistant' }[];
    }
  >
> {
  // TD-2: the same audience that may read the admin schedule list. A teacher
  // reaches events through the calendar at their own tier, not through this.
  if (!isAdmin(actor) && !isTeacher(actor)) {
    throw new AppError('FORBIDDEN', 'listing event definitions requires staff');
  }

  const reachable = scope.reachableBranches(actor.roleScopes, [MANAGING_ROLE]);

  const where: Prisma.EventWhereInput = {
    deletedAt: null,
    ...(filters.branchId ? { branchScopes: { some: { branchId: filters.branchId } } } : {}),
    // Overlap, both ends optional: `start <= to` AND (`end` is null OR `end >= from`).
    ...(filters.to ? { startDate: { lte: filters.to } } : {}),
    ...(filters.from
      ? {
          OR: [
            { recurrenceEndDate: { gte: filters.from } },
            { endDate: { gte: filters.from } },
            // Neither bound set: a one-off on its own start date, or an
            // open-ended recurrence. Both are current for any later window.
            { AND: [{ recurrenceEndDate: null }, { endDate: null }, { startDate: { gte: filters.from } }] },
            { AND: [{ recurrenceEndDate: null }, { endDate: null }, { recurrenceType: { not: 'none' } }] },
          ],
        }
      : {}),
    // **Applied last so an explicit filter NARROWS a scoped caller's reach and
    // never widens it** — the same discipline `listCourseSchedules` uses. A
    // Global event (no branch join at all) is visible to everyone, because it
    // belongs to every branch rather than to none (§4.4).
    ...(reachable === null
      ? {}
      : { OR: [{ branchScopes: { none: {} } }, { branchScopes: { some: { branchId: { in: reachable } } } }] }),
  };

  const window = pageWindow(filters);
  const [rows, total] = await Promise.all([
    prisma.event.findMany({
      where,
      skip: window.skip,
      take: window.take,
      // Soonest first: a scheduling list is read forwards from today.
      orderBy: [{ startDate: 'asc' }, { startTime: 'asc' }, { id: 'asc' }],
      include: {
        branchScopes: { select: { branchId: true } },
        // R71 — live rows only. A tombstoned assignment is somebody who USED to
        // answer for this, and prefilling the form with them would re-assign
        // them on the next save.
        staff: {
          where: { deletedAt: null },
          select: { userId: true, position: true },
        },
      },
    }),
    prisma.event.count({ where }),
  ]);
  return page(rows, window, total);
}

/**
 * **The scopes this caller may address an event to** (2026-08-20).
 *
 * A مؤطرة's event scope is TD-2's: **the Administrative Groups she teaches**,
 * and nothing wider. The form built that list from `GET /admin/levels` and
 * `GET /admin/academic-years`, which answer **403** for her — so the chain that
 * produces groups never resolved and the selector was empty. She could open the
 * form, fill it in, and only discover on save that it could not work.
 *
 * **Rule O again: a narrower question, never a wider permission.** This returns
 * the groups themselves — ids and names — derived from the schedules she staffs
 * through §4.4c, which is the same resolution every other teacher-scope answer
 * uses. `/admin/levels` is untouched and still refuses her.
 *
 * **Effective staffing decides it** (R91): a group she taught last term is not
 * one she may address an event to today.
 */
export async function listEventScopeOptions(
  prisma: PrismaClient,
  actor: Actor,
): Promise<{ id: string; name: string }[]> {
  if (!isAdmin(actor) && !isTeacher(actor)) {
    throw new AppError('FORBIDDEN', 'scoping an event requires teaching staff or admin');
  }

  const mine = await teacherEventScope(prisma, actor.userId);
  if (mine.administrativeGroupIds.length === 0) return [];

  const rows = await prisma.administrativeGroup.findMany({
    where: { id: { in: mine.administrativeGroupIds }, deletedAt: null },
    select: { id: true, name: true, level: { select: { name: true } } },
    orderBy: { name: 'asc' },
  });
  // **`{Level} — {Group}`** (rule D): a group's name is not unique across
  // Levels, so a bare one does not identify it.
  return rows.map((r) => ({ id: r.id, name: `${r.level.name} — ${r.name}` }));
}

/**
 * **Who this caller may name on an event she answers for** (2026-08-20).
 *
 * A مؤطرة may staff her own celebration now, and she could not: listing people
 * is `GET /admin/users`, which answers **403** for her — so the assistants
 * control was empty and the capability was complete and unreachable, rule P's
 * defect once more.
 *
 * **The fix is a narrower question, never a wider permission** (rule O). This
 * does not let her list users: it answers *whom may I name here*, which is
 * active teaching staff and nothing else — no email, no phone, no status, no
 * roles, no branch scope. `GET /admin/users` is untouched and still refuses her.
 *
 * **There is no id in the request.** The subject is the authenticated actor, the
 * same property that makes `GET /students/me` untamperable (TD-12, R63.3).
 */
export async function listEventStaffOptions(
  prisma: PrismaClient,
  actor: Actor,
): Promise<{ id: string; name: string }[]> {
  if (!isAdmin(actor) && !isTeacher(actor)) {
    throw new AppError('FORBIDDEN', 'staffing an event requires teaching staff or admin');
  }

  const rows = await prisma.user.findMany({
    where: {
      deletedAt: null,
      accountStatus: 'active',
      // The مؤطِّرة role, asked of the database — the same authoritative
      // condition `إدارة المؤطِّرات` uses (rule AQ), never `is_beneficiary`.
      branchRoles: { some: { deletedAt: null, role: { name: 'teacher' } } },
    },
    // **Name and id only.** Anything more would make this a user directory by
    // another door, which is the thing the 403 on `/admin/users` protects.
    select: { id: true, nameArabic: true },
    orderBy: { nameArabic: 'asc' },
  });
  return rows.map((r) => ({ id: r.id, name: r.nameArabic }));
}
