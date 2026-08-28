import type { AdministrativeGroup, Prisma, PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { applyOrder } from '../lib/reorder.js';
import { resolveSort, type SortableFields, type SortParams } from '../lib/sorting.js';
import { page, pageWindow, type Page, type PageParams } from '../lib/pagination.js';
import * as scope from '../policies/branch-scope.js';
import * as audit from '../repositories/audit.repository.js';
import * as trash from '../repositories/trash.repository.js';
import {
  assertNoBlockingReferences,
  updateWithVersion,
} from '../repositories/optimistic-lock.js';
import type { Actor } from '../policies/actor.js';
import { liveMemberEnrolment, liveMembersOfGroup } from '../policies/enrolment-membership.js';

/**
 * Administrative Groups — the permanent **organisational** unit inside a Level
 * (SRS §4.4c, Revision 43).
 *
 * A group carries a Level, a Branch and a name, and **nothing else**: no room,
 * no teacher, no assistant, no schedule and **no capacity**. Those belong to
 * delivery, and re-adding any of them here rebuilds the exact conflation
 * Revision 43 removed (§20 rule 22).
 *
 * **Two consequences a reader should not have to rediscover:**
 *
 * 1. **There is no capacity check anywhere in this file** (BR-23). The retired
 *    `Group.max_students` was the only roster-side check-then-write invariant,
 *    and removing it removed its `SELECT … FOR UPDATE` (TD-15.2) with it. That
 *    is safe **only because the invariant went too** — a future capacity rule
 *    must bring the lock back, not rely on the constraint alone.
 * 2. **`branch_id` stays on this entity and is load-bearing** (§4.4c). It is the
 *    single answer to *"which branch is this person at"* — the answer
 *    `User.intended_branch_id` deliberately does not give, since that records
 *    only what an applicant asked for (§4.1, R39).
 *
 * **TD-2:** operational data — Admin within branch scope, or Super Admin.
 */

/** §4.2 Revision 24: naming the role is what keeps this a per-role check rather
 *  than a union across every role the caller happens to hold. */
const MANAGING_ROLE = 'admin';

const isSuperAdmin = (actor: Actor): boolean => scope.isSuperAdmin(actor.roleScopes);

function assertCanManage(actor: Actor): void {
  if (!(scope.hasRole(actor.roleScopes, MANAGING_ROLE) || isSuperAdmin(actor))) {
    throw new AppError('FORBIDDEN', 'administrative group management requires admin');
  }
}

/** Out-of-scope reads answer `404`, never `403` (§20 rule 17) — a `403` would
 *  confirm that a group exists at a branch the caller may not see. */
function assertInScope(actor: Actor, branchId: string): void {
  scope.assertCanActOnBranch(actor.roleScopes, MANAGING_ROLE, branchId, 'no such group');
}

/**
 * A group as the management table needs it: the row plus **how many مستفيدات are
 * in it**. The count is derived, never stored — a stored one drifts the moment
 * an enrolment is added anywhere else.
 */
export type AdministrativeGroupRow = AdministrativeGroup & { memberCount: number };

export interface AdministrativeGroupInput {
  name: string;
  levelId: string;
  branchId: string;
  displayOrder?: number | null;
}

/** What `/admin/administrative-groups` may be sorted by (R76.1). */
export const GROUP_SORT_FIELDS: SortableFields = { name: (dir) => [{ name: dir }] };

/** BR-19's order (R76.2). */
const GROUP_DEFAULT_ORDER = [{ displayOrder: 'asc' }, { name: 'asc' }];

export async function listAdministrativeGroups(
  prisma: PrismaClient,
  actor: Actor,
  filters: { levelId?: string; branchId?: string } & PageParams & SortParams,
): Promise<Page<AdministrativeGroupRow>> {
  assertCanManage(actor);

  const branches = scope.branchesForRole(actor.roleScopes, MANAGING_ROLE);
  const where: Prisma.AdministrativeGroupWhereInput = {
    deletedAt: null,
    ...(filters.levelId ? { levelId: filters.levelId } : {}),
    ...(filters.branchId ? { branchId: filters.branchId } : {}),
    // `null` from branchesForRole means all-branches (§7, Revision 24) — not
    // "no branches". Collapsing the two is how a scoped admin ends up seeing
    // nothing or everything by accident.
    ...(branches === null ? {} : { branchId: { in: branches } }),
  };

  const window = pageWindow(filters);
  const [rows, total] = await Promise.all([
    prisma.administrativeGroup.findMany({
      where,
      skip: window.skip,
      take: window.take,
      // R76 — the caller's sort if given, else BR-19's, with `id` appended so
      // offset pagination stays deterministic.
      orderBy: resolveSort(GROUP_SORT_FIELDS, filters, GROUP_DEFAULT_ORDER) as never,
      // **How many مستفيدات are in the group** — the field the management table
      // most needs and the one it could not previously show. Counted in the
      // same query rather than fetched per row, and filtered to live enrolments
      // so a soft-deleted one (TD-5) does not inflate it.
      // **The shared membership predicate** — the same one the roster and the
      // deletion refusal use. It was `{ deletedAt: null }` here, so this column
      // counted the preserved enrolments of deleted accounts as members.
      include: { _count: { select: { enrollments: { where: liveMemberEnrolment } } } },
    }),
    prisma.administrativeGroup.count({ where }),
  ]);
  return page(
    rows.map(({ _count, ...row }) => ({ ...row, memberCount: _count.enrollments })),
    window,
    total,
  );
}

export async function createAdministrativeGroup(
  prisma: PrismaClient,
  actor: Actor,
  input: AdministrativeGroupInput,
): Promise<AdministrativeGroupRow> {
  assertCanManage(actor);
  assertInScope(actor, input.branchId);

  return prisma.$transaction(async (tx) => {
    const level = await tx.level.findFirst({
      where: { id: input.levelId, deletedAt: null },
      select: { id: true },
    });
    if (!level) throw new AppError('NOT_FOUND', 'no such level');

    const branch = await tx.branch.findFirst({
      where: { id: input.branchId, deletedAt: null },
      select: { id: true },
    });
    if (!branch) throw new AppError('NOT_FOUND', 'no such branch');

    const group = await tx.administrativeGroup.create({
      data: {
        name: input.name,
        levelId: input.levelId,
        branchId: input.branchId,
        displayOrder: input.displayOrder ?? null,
      },
    });

    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'administrativegroup.create',
      targetEntity: 'AdministrativeGroup',
      targetId: group.id,
      detail: { level_id: group.levelId, branch_id: group.branchId },
    });
    // A group is created empty; nothing can have enrolled into it yet.
    return { ...group, memberCount: 0 };
  });
}

export async function updateAdministrativeGroup(
  prisma: PrismaClient,
  actor: Actor,
  id: string,
  data: { name?: string; displayOrder?: number | null; version: number },
): Promise<AdministrativeGroupRow> {
  assertCanManage(actor);

  const existing = await prisma.administrativeGroup.findFirst({
    where: { id, deletedAt: null },
    select: { branchId: true },
  });
  if (!existing) throw new AppError('NOT_FOUND', 'no such group');
  assertInScope(actor, existing.branchId);

  // **Level and Branch are deliberately not editable here.** Moving a group to
  // another Level would silently invalidate every `Enrollment.level_id` that
  // points at it — the composite FK would refuse the update, but as an opaque
  // constraint error rather than an explained refusal. Moving it to another
  // branch would change where its students are recorded as attending without
  // anyone deciding that per student. Both are re-creations, not edits.
  return prisma.$transaction(async (tx) => {
    const updated = await updateWithVersion<AdministrativeGroup>({
      delegate: tx.administrativeGroup,
      id,
      expectedVersion: data.version,
      requireNotDeleted: true,
      data: {
        ...(data.name === undefined ? {} : { name: data.name }),
        ...(data.displayOrder === undefined ? {} : { displayOrder: data.displayOrder }),
      },
    });
    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'administrativegroup.update',
      targetEntity: 'AdministrativeGroup',
      targetId: id,
      detail: { fields: ['name'] },
    });
    // Editing a group's name or position never changes who is enrolled in it,
    // so the count is read alongside rather than recomputed from the write.
    const memberCount = await tx.enrollment.count({
      where: liveMembersOfGroup(updated.id),
    });
    return { ...updated, memberCount };
  });
}

/**
 * Soft-deletes a group (TD-5).
 *
 * **Prohibited while enrolments exist**, and — new in Revision 43 — while a
 * Course Schedule targets it. The second guard matters even though schedules are
 * not yet built: it is the reason a group cannot vanish from under a timetable,
 * and adding it later would mean the window in between was unguarded.
 */
export async function deleteAdministrativeGroup(
  prisma: PrismaClient,
  actor: Actor,
  id: string,
): Promise<void> {
  assertCanManage(actor);

  const group = await prisma.administrativeGroup.findFirst({ where: { id, deletedAt: null } });
  if (!group) throw new AppError('NOT_FOUND', 'no such group');
  assertInScope(actor, group.branchId);

  await prisma.$transaction(async (tx) => {
    /**
     * **ONE refusal shape, the platform's** (2026-08-27).
     *
     * This used to throw two bespoke `STATE_CONFLICT`s carrying `reason:
     * 'ENROLMENTS_EXIST'` and `reason: 'SCHEDULES_EXIST'` with `enrolled` /
     * `schedules` beside them — a third vocabulary for a refusal every other
     * reference deletion already expressed as `blocked_by`. The consequence was
     * not cosmetic: `blockingDependencies()` keys on `details.blocked_by`, so it
     * returned `null` here, the screen fell through to the generic
     * `STATE_CONFLICT` sentence — *«يرجى تحديث الصفحة»* — and **refreshing can
     * never resolve an enrolled student.** The reader followed the instruction,
     * nothing changed, and Delete read as broken.
     *
     * The rules are unchanged; only the shape is. Both are still hard blockers:
     * a group holding students, and one a class is still delivered to.
     */
    const [enrolled, scheduled, grades] = await Promise.all([
      tx.enrollment.count({ where: liveMembersOfGroup(id) }),
      tx.recurringCourseSchedule.count({
        where: { administrativeGroupId: id, deletedAt: null },
      }),
      // A Grade names its group, and a mark a student was awarded is never
      // removed to let a reference row be tidied away. No `deleted_at` term —
      // the model gives a Grade no soft-delete column at all.
      tx.grade.count({ where: { administrativeGroupId: id } }),
    ]);
    await assertNoBlockingReferences([
      { label: 'enrollments', count: enrolled },
      { label: 'course_schedules', count: scheduled },
      { label: 'grades', count: grades },
    ]);

    // `EventAdministrativeGroup` is an owned join row — *«this activity is
    // addressed to that group»* — so it follows the deletion rather than
    // refusing it. The Event and its other scopes are untouched.
    await tx.eventAdministrativeGroup.deleteMany({ where: { administrativeGroupId: id } });

    /**
     * **`LAST_GROUP_IN_LEVEL` retired by Revision 66.**
     *
     * It existed only to stop a Level reaching the group-less state TD-4.6b
     * prevented at creation — the same broken state arrived at from the other
     * side. R66 makes that state ordinary: a Level nobody has subdivided needs
     * no group, and students are enrolled in it directly.
     *
     * **The rule that actually protects people is unchanged**: a group holding
     * students is still refused above by `ENROLMENTS_EXIST`. What may now be
     * deleted is an EMPTY last group, which leaves the Level directly
     * enrollable rather than leaving anybody stranded.
     */

    await tx.administrativeGroup.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: actor.userId },
    });
    await trash.snapshot(tx, {
      targetEntity: 'AdministrativeGroup',
      targetId: id,
      snapshot: JSON.parse(JSON.stringify(group)) as object,
      deletedById: actor.userId,
    });
    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'administrativegroup.delete',
      targetEntity: 'AdministrativeGroup',
      targetId: id,
      detail: { level_id: group.levelId, branch_id: group.branchId },
    });
  });
}

/**
 * **`backfillFirstGroups` was here and is removed by Revision 66.**
 *
 * TD-4.6d gave every group-less Level a `المجموعة 1` when the first Branch
 * appeared, because a Level without a group could admit nobody. R66 makes that
 * state ordinary, so the backfill has nothing to repair — and creating a branch
 * no longer makes placement decisions nobody asked for.
 */

/**
 * `PATCH /admin/administrative-groups/order` (R76.4).
 *
 * **Ordered within a Level, and the request says which.** A group's position is
 * meaningful among the other groups of its own Level — a global sequence across
 * every Level would write positions that mean nothing beside each other.
 *
 * **The live set is additionally narrowed to the caller's branches**, through the
 * same `branchesForRole` the list uses, so a branch-scoped Admin reorders the
 * groups they can see and the exact-set rule refuses a sequence naming any other.
 */
export async function reorderAdministrativeGroups(
  prisma: PrismaClient,
  actor: Actor,
  levelId: string,
  ids: readonly string[],
): Promise<string[]> {
  assertCanManage(actor);
  const branches = scope.branchesForRole(actor.roleScopes, MANAGING_ROLE);

  return applyOrder(
    prisma,
    {
      liveIds: async (tx) =>
        (
          await tx.administrativeGroup.findMany({
            where: {
              deletedAt: null,
              levelId,
              ...(branches === null ? {} : { branchId: { in: branches } }),
            },
            select: { id: true },
          })
        ).map((r) => r.id),
      write: (tx, id, displayOrder) =>
        tx.administrativeGroup.update({ where: { id }, data: { displayOrder } }),
    },
    ids,
  );
}
