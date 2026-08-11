import type { AdministrativeGroup, Prisma, PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { page, pageWindow, type Page, type PageParams } from '../lib/pagination.js';
import * as scope from '../policies/branch-scope.js';
import * as audit from '../repositories/audit.repository.js';
import * as trash from '../repositories/trash.repository.js';
import { updateWithVersion } from '../repositories/optimistic-lock.js';
import type { Actor } from '../policies/actor.js';

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

export interface AdministrativeGroupInput {
  name: string;
  levelId: string;
  branchId: string;
  displayOrder?: number | null;
}

export async function listAdministrativeGroups(
  prisma: PrismaClient,
  actor: Actor,
  filters: { levelId?: string; branchId?: string } & PageParams,
): Promise<Page<AdministrativeGroup>> {
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
      // BR-19: `display_order` first, then the natively `ar-x-icu` collated
      // name — correct Arabic ordering with no per-query COLLATE (§20 rule 13).
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    }),
    prisma.administrativeGroup.count({ where }),
  ]);
  return page(rows, window, total);
}

export async function createAdministrativeGroup(
  prisma: PrismaClient,
  actor: Actor,
  input: AdministrativeGroupInput,
): Promise<AdministrativeGroup> {
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
      detail: { name: group.name, level_id: group.levelId, branch_id: group.branchId },
    });
    return group;
  });
}

export async function updateAdministrativeGroup(
  prisma: PrismaClient,
  actor: Actor,
  id: string,
  data: { name?: string; displayOrder?: number | null; version: number },
): Promise<AdministrativeGroup> {
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
      detail: { name: updated.name },
    });
    return updated;
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
    const enrolled = await tx.enrollment.count({
      where: { administrativeGroupId: id, deletedAt: null },
    });
    if (enrolled > 0) {
      throw new AppError('STATE_CONFLICT', 'group still has enrolled students', {
        reason: 'ENROLMENTS_EXIST',
        enrolled,
      });
    }

    const scheduled = await tx.recurringCourseSchedule.count({
      where: { administrativeGroupId: id, deletedAt: null },
    });
    if (scheduled > 0) {
      throw new AppError('STATE_CONFLICT', 'group is targeted by a course schedule', {
        reason: 'SCHEDULES_EXIST',
        schedules: scheduled,
      });
    }

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
      detail: { name: group.name, level_id: group.levelId, branch_id: group.branchId },
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
