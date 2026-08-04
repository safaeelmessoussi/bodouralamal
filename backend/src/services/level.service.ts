import type { Level, PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import * as scope from '../policies/branch-scope.js';
import * as audit from '../repositories/audit.repository.js';
import type { Actor } from '../policies/actor.js';

/**
 * Level creation — **TD-4.6b, SRS Revision 43.1.**
 *
 * *"`Level` insert + its first `AdministrativeGroup` (**المجموعة 1**) at the
 * Branch supplied in the request + `AuditLog` row."*
 *
 * **Why the group is created in the same act rather than later.** A Level with
 * no Administrative Group is a Level nobody can be admitted to: the §4.1
 * approval flow asks the administrator to pick one group per selected Level and
 * would have nothing to offer. Creating it in the same transaction means that
 * state **never exists**, rather than existing until something fills it in —
 * which is precisely the difference Revision 43.1 was issued to make.
 *
 * **The Branch is an INPUT, not a column on `Level`** (§4.4b). A Level stays
 * Category-scoped and branch-independent, and may hold groups at several
 * branches; what this asks is *where the first group sits*, and that answer is
 * stored on the group. Adding `branch_id` to `Level` would make a Level
 * branch-local and break `entire_level` teaching mode, which resolves a Level's
 * students **across** the groups at one branch (§4.4c).
 *
 * **Levels are reference data: Super Admin only** (§5.6, Revision 26). The
 * group this creates is operational data an Admin may later manage, which is not
 * a contradiction — Super Admin is unscoped and may act anywhere.
 *
 * *Not built here:* the `/admin/levels` endpoints. This is the service layer;
 * the route arrives with TD-3's registry work.
 */

/** §7: the name every Level's first group is given. Arabic, matching the
 *  platform's structural-entity convention (§2.2) — never "Group 1". */
export const FIRST_GROUP_NAME = 'المجموعة 1';

export interface CreateLevelInput {
  name: string;
  categoryId: string;
  genderRestriction: 'any' | 'girls_only' | 'boys_only';
  displayOrder?: number | null;
  /**
   * **Required (Revision 43.1).** Where المجموعة 1 sits. Not stored on the
   * Level — see the note above.
   */
  branchId: string;
}

export interface CreatedLevel {
  level: Level;
  firstGroup: { id: string; name: string; branchId: string };
}

function assertCanManageReferenceData(actor: Actor): void {
  if (!scope.isSuperAdmin(actor.roleScopes)) {
    throw new AppError('FORBIDDEN', 'level management is Super Admin only');
  }
}

/**
 * Creates a Level **and** its first Administrative Group, atomically (TD-4.6b).
 *
 * Both rows commit or neither does. A partial commit here is the one outcome
 * this transaction exists to prevent.
 */
export async function createLevel(
  prisma: PrismaClient,
  actor: Actor,
  input: CreateLevelInput,
): Promise<CreatedLevel> {
  assertCanManageReferenceData(actor);

  return prisma.$transaction(async (tx) => {
    const category = await tx.category.findFirst({
      where: { id: input.categoryId, deletedAt: null },
      select: { id: true },
    });
    if (!category) throw new AppError('NOT_FOUND', 'no such category');

    // Validated live: a Level created against a soft-deleted branch would give
    // its first group a home nobody can reach. `operational_start_date` is
    // deliberately NOT checked — a branch that has not opened yet is a
    // legitimate place to prepare groups for (§7, the same rule R39 applies to
    // `intended_branch_id`).
    const branch = await tx.branch.findFirst({
      where: { id: input.branchId, deletedAt: null },
      select: { id: true },
    });
    if (!branch) throw new AppError('NOT_FOUND', 'no such branch');

    const level = await tx.level.create({
      data: {
        name: input.name,
        categoryId: input.categoryId,
        genderRestriction: input.genderRestriction,
        displayOrder: input.displayOrder ?? null,
      },
    });

    const firstGroup = await tx.administrativeGroup.create({
      data: {
        name: FIRST_GROUP_NAME,
        levelId: level.id,
        branchId: input.branchId,
        displayOrder: 0,
      },
      select: { id: true, name: true, branchId: true },
    });

    await audit.write(tx, {
      actorUserId: actor.userId,
      actionType: 'level.create',
      targetEntity: 'Level',
      targetId: level.id,
      detail: {
        name: level.name,
        category_id: level.categoryId,
        gender_restriction: level.genderRestriction,
        // The group is part of the same decision, so it belongs in the same
        // record — otherwise "where did this group come from" is unanswerable.
        first_group_id: firstGroup.id,
        first_group_branch_id: firstGroup.branchId,
      },
    });

    return { level, firstGroup };
  });
}

/**
 * Levels that have no live Administrative Group.
 *
 * Exists for the TD-4.6d bootstrap backfill and for asserting the invariant in
 * tests. **After bootstrap this must always be empty** — `createLevel` above is
 * the only way a Level enters the system through the application, and it cannot
 * produce one.
 */
export async function levelsWithoutGroups(
  prisma: PrismaClient,
): Promise<{ id: string; name: string }[]> {
  return prisma.level.findMany({
    where: {
      deletedAt: null,
      administrativeGroups: { none: { deletedAt: null } },
    },
    select: { id: true, name: true },
    orderBy: { displayOrder: 'asc' },
  });
}
