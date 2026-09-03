import type {
  AttendanceMode,
  PrismaClient,
  SchedulingStructuralKind,
  SchedulingType,
} from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { applyOrder } from '../lib/reorder.js';
import * as scope from '../policies/branch-scope.js';
import type { Actor } from '../policies/actor.js';
import * as audit from '../repositories/audit.repository.js';
import { assertNoBlockingReferences, updateWithVersion } from '../repositories/optimistic-lock.js';
import * as trash from '../repositories/trash.repository.js';

/**
 * **SRS Revision 110 — the scheduling-type catalogue** (NEW H).
 *
 * ## What this replaces
 *
 * The five types an administrator picks from — حصة دراسية, اختبار, محاضرة, حفل,
 * عطلة — lived in `frontend/src/adapters/scheduling-types.ts` as a hardcoded
 * constant. Nobody could add one, rename one, reorder them, or record which of
 * them takes attendance. **Seeded does not mean immutable** (Owner addendum,
 * 2026-08-26): the seed is the initial state, never a whitelist.
 *
 * ## R56 refused this, and named the condition for adding it
 *
 * R56 declined `Event.type` because *"the category would drive no rule, no job,
 * no report"*, and said in terms that *"it may be added when filtering or
 * reporting by category becomes a real requirement."* `attendance_required` is
 * that requirement — it drives the form (OD-03). This exercises R56's clause
 * rather than contradicting it, which is why no supersession is proposed for it.
 *
 * ## Five rows, THREE entities — and no fifth scheduling model
 *
 * R56 also settled the routing, and R110 stores it rather than re-deciding it:
 *
 * | type | `structural_kind` | entity |
 * |---|---|---|
 * | حصة دراسية | `class` | `RecurringCourseSchedule` |
 * | اختبار | `exam` | `Exam` |
 * | محاضرة · حفل · عطلة | `activity` | `Event` |
 *
 * **Three of the five are the same entity**, which is the whole reason the
 * catalogue has to exist as data: `Event` could not previously say *which* of
 * them it was, so nothing could tell a حفل from an عطلة except the words an
 * administrator happened to type in the title.
 *
 * ## Who may read, and who may write
 *
 * **Reading is anyone who may schedule** — Admin, Super Admin, and a مؤطِّرة,
 * who creates activities under R93/R94. A picker that refused her would be a
 * form she cannot open. **Writing is Super Admin only** (OD-01's final
 * sub-decision: scheduling types stay Super-Admin-only until an Owner decision
 * delegates them), which is also what keeps R105's الإدارة heading truthful.
 *
 * **The UI is never the authorization boundary** — the assertions below are, and
 * they are asserted before anything is read or written.
 */

/** Anyone who may put something on the timetable needs to name its type. */
function assertCanRead(actor: Actor): void {
  const permitted =
    scope.isSuperAdmin(actor.roleScopes) ||
    scope.hasRole(actor.roleScopes, 'admin') ||
    // R93/R94 — a مؤطِّرة schedules her own activities, so she must be able to
    // choose what kind of thing she is scheduling.
    scope.hasRole(actor.roleScopes, 'teacher');
  if (!permitted) {
    throw new AppError('FORBIDDEN', 'reading the scheduling-type catalogue requires staff');
  }
}

/** OD-01 (final): scheduling types are Super-Admin-only until delegated. */
function assertCanWrite(actor: Actor): void {
  if (!scope.isSuperAdmin(actor.roleScopes)) {
    throw new AppError(
      'FORBIDDEN',
      'managing the scheduling-type catalogue is Super Admin only (OD-01)',
    );
  }
}

export interface SchedulingTypeRef {
  id: string;
  name: string;
  structuralKind: SchedulingStructuralKind;
  attendanceMode: AttendanceMode;
  displayOrder: number;
  /**
   * **How many activities already use it** — the one number that says whether
   * deleting it is even possible, without a request per row. The same field
   * `CategoryRef.levelCount` carries and for the same reason: an administrator
   * meeting a blocked deletion should be able to see what it is about before
   * she meets it.
   */
  eventCount: number;
  /** TD-15: the editor sends it back; a stale one is a `409`. */
  version: number;
}

/**
 * The whole live catalogue, in the Owner's canonical order.
 *
 * **Not paginated, deliberately** — the same reasoning `listSubjects` records: a
 * picker must offer every option or it is lying about the choice available, and
 * this set is five rows.
 */
export async function listSchedulingTypes(
  prisma: PrismaClient,
  actor: Actor,
): Promise<SchedulingTypeRef[]> {
  assertCanRead(actor);
  const rows = await prisma.schedulingType.findMany({
    where: { deletedAt: null },
    // `display_order` is NOT NULL here, so there is no nulls-last arm to write:
    // this catalogue is seeded complete and ordered. `name` breaks a tie only
    // if an administrator has managed to give two rows the same position.
    orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { events: { where: { deletedAt: null } } } } },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    structuralKind: r.structuralKind,
    attendanceMode: r.attendanceMode,
    displayOrder: r.displayOrder,
    eventCount: r._count.events,
    version: r.version,
  }));
}

export async function createSchedulingType(
  prisma: PrismaClient,
  actor: Actor,
  data: {
    name: string;
    structuralKind: SchedulingStructuralKind;
    attendanceMode: AttendanceMode;
  },
): Promise<SchedulingType> {
  assertCanWrite(actor);

  return prisma.$transaction(async (tx) => {
    /**
     * **Appended, not inserted at a position.** A create that also chose a
     * position would be a second ordering mechanism beside `PATCH .../order`,
     * and R76 already settled that ordering is expressed as a whole sequence.
     * The administrator reorders afterwards if she wants it elsewhere.
     */
    const last = await tx.schedulingType.aggregate({
      where: { deletedAt: null },
      _max: { displayOrder: true },
    });

    const created = await tx.schedulingType.create({
      data: {
        name: data.name,
        structuralKind: data.structuralKind,
        attendanceMode: data.attendanceMode,
        displayOrder: (last._max.displayOrder ?? 0) + 1,
      },
    });

    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'schedulingtype.create',
      targetEntity: 'SchedulingType',
      targetId: created.id,
      detail: {
        structural_kind: created.structuralKind,
        attendance_mode: created.attendanceMode,
      },
    });
    return created;
  });
}

/**
 * Renames a type, or changes what attendance means for it.
 *
 * **`structural_kind` is NOT editable, and `.strict()` refuses it rather than
 * dropping it.** It decides which entity the type routes to, so changing it
 * would re-point every activity already recorded against this row at a model
 * that cannot represent them — the same reasoning §4.4 applies to a course
 * schedule's subject and target, and §4.6 to an exam's level. A type that
 * routes somewhere else is a new type.
 */
export async function updateSchedulingType(
  prisma: PrismaClient,
  actor: Actor,
  id: string,
  expectedVersion: number,
  data: { name?: string; attendanceMode?: AttendanceMode },
): Promise<SchedulingType> {
  assertCanWrite(actor);

  const existing = await prisma.schedulingType.findFirst({
    where: { id, deletedAt: null },
    select: { name: true, attendanceMode: true },
  });
  if (!existing) throw new AppError('NOT_FOUND', 'no such scheduling type');

  const updated = await updateWithVersion<SchedulingType>({
    delegate: prisma.schedulingType,
    id,
    expectedVersion,
    requireNotDeleted: true,
    data: { ...data },
  });

  await audit.write(prisma, {
    actorUserId: actor.userId,
    activeRole: actor.activeRole,
    actionType: 'schedulingtype.update',
    targetEntity: 'SchedulingType',
    targetId: id,
    // Record every changed field name, never the free-text catalogue value.
    // Attendance remains old → new only where it moved: *«When did محاضرة
    // start taking attendance, and on whose word»* is a question the record
    // has to answer, while logging the flag on every edit would bury that one
    // transition.
    detail: {
      fields: Object.keys(data),
      ...(data.attendanceMode !== undefined &&
      data.attendanceMode !== existing.attendanceMode
        ? {
            attendance_mode_from: existing.attendanceMode,
            attendance_mode_to: data.attendanceMode,
          }
        : {}),
    },
  });
  return updated;
}

/**
 * TD-5 soft delete, **refused while any activity still names this type**.
 *
 * A hard delete would destroy the record of what an activity WAS, which is why
 * `event.scheduling_type_id` is `Restrict` — and the alternative to this check
 * is that constraint surfacing as a 500 rather than as a reason an administrator
 * can act on (rule AZ.1). The remedy is hers: re-type those activities, or leave
 * the catalogue entry in place.
 */
export async function deleteSchedulingType(
  prisma: PrismaClient,
  actor: Actor,
  id: string,
): Promise<void> {
  assertCanWrite(actor);

  await prisma.$transaction(async (tx) => {
    // §16.2 sanctioned raw-SQL exception (a): the count and the delete must not
    // straddle a concurrent activity naming this type (TD-15.2 — check-then-write
    // needs the lock, not just the check).
    await tx.$queryRaw`SELECT id FROM "scheduling_type" WHERE id = ${id}::uuid FOR UPDATE`;

    const row = await tx.schedulingType.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new AppError('NOT_FOUND', 'no such scheduling type');

    const events = await tx.event.count({ where: { schedulingTypeId: id, deletedAt: null } });
    await assertNoBlockingReferences([{ label: 'events', count: events }]);

    await tx.schedulingType.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: actor.userId },
    });
    await trash.snapshot(tx, {
      targetEntity: 'SchedulingType',
      targetId: id,
      snapshot: JSON.parse(JSON.stringify(row)) as object,
      deletedById: actor.userId,
    });
    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'schedulingtype.delete',
      targetEntity: 'SchedulingType',
      targetId: id,
      detail: { structural_kind: row.structuralKind },
    });
  });
}

/** R76's whole-sequence reorder — the Owner calls this order canonical. */
export async function reorderSchedulingTypes(
  prisma: PrismaClient,
  actor: Actor,
  ids: readonly string[],
): Promise<string[]> {
  assertCanWrite(actor);
  return applyOrder(
    prisma,
    {
      liveIds: async (tx) =>
        (
          await tx.schedulingType.findMany({ where: { deletedAt: null }, select: { id: true } })
        ).map((r) => r.id),
      write: (tx, id, displayOrder) =>
        tx.schedulingType.update({ where: { id }, data: { displayOrder } }),
    },
    ids,
  );
}

/**
 * **Resolves the type an activity is being written with** (`Event` only).
 *
 * Shared by create and update so the rule cannot hold on one path and not the
 * other — the R57 shape this project has already paid for twice.
 *
 * Two refusals, and they are different failures:
 *
 * * an id that names no live type → `NOT_FOUND`;
 * * a live type whose `structural_kind` is not `activity` → `VALIDATION_FAILED`
 *   with `STRUCTURAL_KIND_MISMATCH`. Writing an `Event` typed حصة دراسية would
 *   produce a row the calendar renders as an activity and the catalogue claims
 *   is a class — two answers to *what is this*, which is exactly what storing
 *   the kind was meant to prevent.
 */
/**
 * **Resolves the type a row of a KNOWN structural kind is being written with.**
 *
 * `assertActivityType` was this, specialized to the one entity that could
 * record a type. R110's catalogue is now recorded by a schedule and a sitting
 * too (Owner, 2026-09-02), and each has the same two refusals against a
 * different set of admissible kinds, so the rule is stated once here rather
 * than copied per entity — the R57 shape this project has already paid for
 * twice.
 */
export async function assertTypeOfKind<K extends SchedulingStructuralKind>(
  tx: { schedulingType: PrismaClient['schedulingType'] },
  schedulingTypeId: string,
  kinds: readonly K[],
): Promise<K> {
  const type = await tx.schedulingType.findFirst({
    where: { id: schedulingTypeId, deletedAt: null },
    select: { structuralKind: true },
  });
  if (!type) throw new AppError('NOT_FOUND', 'no such scheduling type');
  if (!(kinds as readonly SchedulingStructuralKind[]).includes(type.structuralKind)) {
    throw new AppError('VALIDATION_FAILED', 'that type is not delivered as this kind', {
      reason: 'STRUCTURAL_KIND_MISMATCH',
      structural_kind: type.structuralKind,
    });
  }
  return type.structuralKind as K;
}

export async function assertActivityType(
  tx: { schedulingType: PrismaClient['schedulingType'] },
  schedulingTypeId: string,
): Promise<'activity' | 'holiday'> {
  /**
   * **Two kinds are stored as an `Event`, and they are not the same thing.**
   *
   * `activity` is something people attend; `holiday` is a period on which
   * nothing is delivered (Owner, 2026-08-28). Both are dated rows with a title
   * and a scope, so both live in `Event` — and the caller is told **which**, so
   * it can enforce the difference rather than accept an activity-shaped record
   * with the extra fields left empty by convention.
   */
  return assertTypeOfKind(tx, schedulingTypeId, ['activity', 'holiday'] as const);
}

/**
 * **R123 — an occurrence whose type takes no attendance may not be configured
 * to be self-marked.**
 *
 * The Owner's rule is that vacations and parties support no attendance at all,
 * and that *configuring* it must fail rather than the button merely being
 * hidden. `self_or_staff` on a عطلة is exactly that configuration: it says
 * *people may sign themselves in here*, at something that has no sheet. Refused
 * at the write boundary of both carriers rather than tolerated as inert, because
 * a stored contradiction is one the next reader has to decide about.
 *
 * A type recorded as NULL (every row predating R110) is refused too: what it was
 * is unknown, and guessing the permissive branch is how a holiday acquires a
 * sheet.
 */
export async function assertMarkingAllowedForType(
  tx: { schedulingType: PrismaClient['schedulingType'] },
  schedulingTypeId: string | null | undefined,
  marking: 'staff_only' | 'self_or_staff' | undefined,
): Promise<void> {
  if (marking !== 'self_or_staff') return;
  const type =
    schedulingTypeId == null
      ? null
      : await tx.schedulingType.findFirst({
          where: { id: schedulingTypeId, deletedAt: null },
          select: { attendanceMode: true },
        });
  if (type === null || type.attendanceMode === 'disabled') {
    throw new AppError('STATE_CONFLICT', 'this kind of activity takes no attendance', {
      reason: 'ATTENDANCE_NOT_AVAILABLE',
    });
  }
}
