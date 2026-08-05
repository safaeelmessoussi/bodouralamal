import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { page, pageWindow, type Page, type PageParams } from '../lib/pagination.js';
import * as scope from '../policies/branch-scope.js';
import * as audit from '../repositories/audit.repository.js';
import type { Actor } from '../policies/actor.js';

/**
 * The Trash — **soft-deleted records, browsable; restorable where restoration is
 * PROVEN** (§7, TD-5, BR-15, SRS Revision 52).
 *
 * ## Why restoration is per entity type rather than a single button
 *
 * §7 states the hazard and this service exists to respect it:
 *
 * > the runbook **must explicitly capture and reinstate the relationship rows the
 * > TD-5 cascade removed** — `FamilyLink`, `Enrollment`, `StudentTeachingGroup`,
 * > `CourseScheduleStaff`, `UserBranchRole` and `UserIdentity` deactivations —
 * > **a User restored without their links, enrollments and roles is a
 * > half-restored, silently broken account.**
 *
 * Clearing `deleted_at` is the easy tenth of the problem, and every failure of
 * the other nine is **silent**: the row returns, every screen looks right, and
 * the person is enrolled in nothing.
 *
 * So the capability is decided **here, per entity type, and published on every
 * row** — never inferred by a client. A screen cannot know which deletions
 * cascade, and one that guessed would offer a button that quietly breaks people.
 *
 * ## What makes a type restorable
 *
 * **Its deletion is GUARDED rather than CASCADING.** These four refuse to delete
 * while anything references them — a Branch with rooms, a Subject a Level still
 * teaches — so nothing was removed alongside them and clearing the tombstone
 * genuinely restores the whole record.
 *
 * Everything else cascades and stays read-only until its reinstatement is
 * written and tested: a `Level` takes its Administrative Groups, a
 * `TeachingGroup` releases its members, a `RecurringCourseSchedule` removes
 * future Sessions, and a `User` reaches all six relationship types above.
 */
/** The delegate names on a transaction client — `keyof PrismaClient` would
 *  include `$connect` and friends, which are not models. */
type ModelName = 'branch' | 'category' | 'subject' | 'room';

const RESTORABLE: Record<string, { model: ModelName; parent?: { field: string; model: ModelName } }> = {
  // No parent: nothing above them can be missing.
  Branch: { model: 'branch' },
  Category: { model: 'category' },
  Subject: { model: 'subject' },
  // A Room belongs to a Branch, and restoring one into a deleted Branch would
  // produce a room nobody can reach — see `restoreEntry`.
  Room: { model: 'room', parent: { field: 'branchId', model: 'branch' } },
};

/**
 * Why a type cannot be restored yet, in the terms an administrator would use.
 *
 * **Stable codes**: they appear in the API response and a screen renders them,
 * so renaming one changes what an administrator is told about their own data.
 */
const BLOCKED_REASON: Record<string, string> = {
  User: 'CASCADE_RELATIONSHIPS',
  Level: 'CASCADE_CHILDREN',
  AdministrativeGroup: 'CASCADE_CHILDREN',
  TeachingGroup: 'CASCADE_CHILDREN',
  RecurringCourseSchedule: 'CASCADE_CHILDREN',
  Session: 'CASCADE_CHILDREN',
  Enrollment: 'CASCADE_RELATIONSHIPS',
  StudentTeachingGroup: 'CASCADE_RELATIONSHIPS',
  FamilyLink: 'CASCADE_RELATIONSHIPS',
};

/** TD-2: the Trash is Super Admin only. It exposes every entity in the platform
 *  regardless of branch, so a branch-scoped Admin would see other branches'
 *  records — which no other surface allows. */
function assertSuperAdmin(actor: Actor): void {
  if (!scope.isSuperAdmin(actor.roleScopes)) {
    throw new AppError('FORBIDDEN', 'the Trash is Super Admin only (TD-2)');
  }
}

export interface TrashRow {
  id: string;
  targetEntity: string;
  targetId: string;
  /** A human-readable identifier pulled from the snapshot — a name where the
   *  entity has one. Without it the list is a page of UUIDs. */
  label: string | null;
  deletedAt: Date;
  deletedById: string | null;
  deletedByName: string | null;
  /** BR-15: when the 90-day window purges it permanently. */
  purgeAfter: Date;
  /** Decided by the SERVER, per entity type. */
  restorable: boolean;
  /** `null` when restorable; otherwise a stable code saying why not. */
  restoreBlockedReason: string | null;
}

export interface TrashFilters extends PageParams {
  entity?: string;
  deletedById?: string;
  from?: Date;
  to?: Date;
  q?: string;
}

/**
 * **A name from the snapshot, not a second query.**
 *
 * The snapshot is the row exactly as it was, so the label is already in hand —
 * and reading it from there is also the only correct source: the live row may be
 * gone entirely once BR-15 purges, and a join would show nothing.
 */
function labelOf(snapshot: unknown): string | null {
  if (typeof snapshot !== 'object' || snapshot === null) return null;
  const row = snapshot as Record<string, unknown>;
  for (const key of ['name', 'nameArabic', 'title', 'label']) {
    const value = row[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return null;
}

export async function listTrash(
  prisma: PrismaClient,
  actor: Actor,
  filters: TrashFilters = {},
): Promise<Page<TrashRow>> {
  assertSuperAdmin(actor);

  const where: Prisma.TrashWhereInput = {
    ...(filters.entity ? { targetEntity: filters.entity } : {}),
    ...(filters.deletedById ? { deletedById: filters.deletedById } : {}),
    ...(filters.from || filters.to
      ? {
          deletedAt: {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lte: filters.to } : {}),
          },
        }
      : {}),
  };

  const window = pageWindow(filters);
  const [rows, total] = await Promise.all([
    prisma.trash.findMany({
      where,
      // Most recently deleted first: the record somebody is looking for is
      // almost always the one they just lost.
      orderBy: [{ deletedAt: 'desc' }, { id: 'asc' }],
      skip: window.skip,
      take: window.take,
      include: { deletedBy: { select: { id: true, nameArabic: true } } },
    }),
    prisma.trash.count({ where }),
  ]);

  const mapped = rows.map((row) => {
    const restorable = RESTORABLE[row.targetEntity] !== undefined;
    return {
      id: row.id,
      targetEntity: row.targetEntity,
      targetId: row.targetId,
      label: labelOf(row.snapshot),
      deletedAt: row.deletedAt,
      deletedById: row.deletedById,
      deletedByName: row.deletedBy?.nameArabic ?? null,
      purgeAfter: row.purgeAfter,
      restorable,
      restoreBlockedReason: restorable
        ? null
        : (BLOCKED_REASON[row.targetEntity] ?? 'NOT_YET_SUPPORTED'),
    };
  });

  // **Search is applied to the LABEL, after the page is read.** The label lives
  // inside a JSONB snapshot under a key that differs per entity, so a SQL
  // predicate would need one expression per entity type and would still miss any
  // type added later. Narrowing the page a reader is already looking at is
  // honest — and the entity and date filters above, which do run in SQL, are the
  // ones that make the page small enough for that to be true.
  const needle = filters.q?.trim().toLowerCase();
  const data = needle
    ? mapped.filter(
        (r) =>
          r.label?.toLowerCase().includes(needle) ||
          r.targetEntity.toLowerCase().includes(needle),
      )
    : mapped;

  return page(data, window, total);
}

/**
 * Restores one soft-deleted record — **only where §7's cascade problem does not
 * arise**.
 *
 * The refusal is deliberately loud rather than a hidden no-op: a client that
 * asks to restore a `User` is asking for something this service cannot yet do
 * correctly, and answering `200` would be the silent breakage §7 warns about.
 */
export async function restoreEntry(
  prisma: PrismaClient,
  actor: Actor,
  id: string,
): Promise<{ targetEntity: string; targetId: string }> {
  assertSuperAdmin(actor);

  const entry = await prisma.trash.findUnique({ where: { id } });
  if (!entry) throw new AppError('NOT_FOUND', 'no such trash entry');

  const plan = RESTORABLE[entry.targetEntity];
  if (!plan) {
    throw new AppError('STATE_CONFLICT', 'restoring this entity type is not yet supported', {
      reason: BLOCKED_REASON[entry.targetEntity] ?? 'NOT_YET_SUPPORTED',
      target_entity: entry.targetEntity,
    });
  }

  return prisma.$transaction(async (tx) => {
    const delegate = tx[plan.model] as unknown as {
      findUnique: (a: unknown) => Promise<Record<string, unknown> | null>;
      update: (a: unknown) => Promise<unknown>;
    };

    const row = await delegate.findUnique({ where: { id: entry.targetId } });
    // BR-15 has purged the row itself, so there is nothing left to un-delete —
    // the snapshot alone cannot recreate it safely, because every foreign key it
    // points at may since have gone too.
    if (!row) {
      throw new AppError('STATE_CONFLICT', 'the record itself is gone — BR-15 purged it', {
        reason: 'ALREADY_PURGED',
      });
    }
    if (row['deletedAt'] === null) {
      throw new AppError('STATE_CONFLICT', 'that record is not deleted', { reason: 'NOT_DELETED' });
    }

    // **A child cannot be restored into a deleted parent.** Restoring a Room
    // whose Branch is still in the Trash would produce a room nobody can reach
    // through any screen — technically alive, practically lost.
    if (plan.parent) {
      const parentId = row[plan.parent.field];
      const parentDelegate = tx[plan.parent.model] as unknown as {
        findFirst: (a: unknown) => Promise<unknown>;
      };
      const parent = await parentDelegate.findFirst({
        where: { id: parentId, deletedAt: null },
      });
      if (!parent) {
        throw new AppError('STATE_CONFLICT', 'restore its parent first', {
          reason: 'PARENT_DELETED',
          parent_entity: String(plan.parent.model),
        });
      }
    }

    await delegate.update({
      where: { id: entry.targetId },
      data: { deletedAt: null, deletedById: null },
    });
    // The tombstone goes with the restoration: the record is no longer deleted,
    // so leaving it listed would make the Trash disagree with the platform. The
    // audit row below is what keeps the event answerable afterwards.
    await tx.trash.delete({ where: { id } });

    await audit.write(tx, {
      actorUserId: actor.userId,
      actionType: 'trash.restore',
      targetEntity: entry.targetEntity,
      targetId: entry.targetId,
      detail: {
        deleted_at: entry.deletedAt.toISOString(),
        deleted_by: entry.deletedById,
      },
    });

    return { targetEntity: entry.targetEntity, targetId: entry.targetId };
  });
}
