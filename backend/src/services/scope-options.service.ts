import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import * as scope from '../policies/branch-scope.js';
import type { Actor } from '../policies/actor.js';
import {
  DEFAULT_VISIBILITY_PREFIX,
  readDefaultVisibility,
} from './level.service.js';

/**
 * **`GET /me/scope-options` — *what may I filter and compose by?*** (NEW D).
 *
 * ## The defect this ends
 *
 * A مؤطِّرة opening مكتبة المحتوى met three `403`s and a half-dead filter row.
 * `useScopeOptions` — the ONE hook every scoped screen shares — loaded its
 * vocabulary from `/admin/levels`, `/admin/subjects` and
 * `/admin/academic-years`, and `assertCanReadReferenceData` excludes teachers
 * **by design** (R30: *"reference data is an administrative concern"*). Only
 * `/admin/branches` answered her, because `branch.service` admits teachers for
 * exactly this reason (R61.2). So the wrong layer was the shared hook, not the
 * page — and fixing the page would have left the same hole in every other
 * screen the hook serves.
 *
 * ## Why a new endpoint rather than widening the admin reads
 *
 * **R93.4 already set the precedent and the mechanism.** When the event form
 * needed the groups a مؤطِّرة may address, the answer was
 * `GET /me/event-scope-options` — *a narrower question, never a wider
 * permission* (rule O). This is the same move for the content/scheduling
 * vocabulary: `/admin/levels` is untouched and still refuses her.
 *
 * **Reading an option and managing a catalogue are different permissions**, and
 * this endpoint grants only the first. Nothing here lets a Teacher create,
 * rename, reorder or delete a Level, a Subject, an Academic Year or a Branch;
 * those routes are unchanged and still refuse her (R26/R43.3/OD-01).
 *
 * ## Why the curriculum vocabulary is not narrowed further for staff
 *
 * A tempting alternative was to return only the Levels a مؤطِّرة teaches. That
 * would be **wrong on the domain model and worse for her**: §4.9 tier 3 already
 * admits every staff member to every content tier, so narrowing the *filter
 * axes* would hide content she is entitled to read while granting nothing —
 * a filter that cannot express a legitimate question. §14.4's rule holds:
 * filters narrow what is visible; they are never the thing that decides it.
 *
 * **The list is not the authorization.** `GET /library` re-derives §4.9's tiers
 * for every request, and `/content/{id}/download-url` re-derives them again, so
 * an option appearing here reaches nothing on its own. That separation is the
 * whole reason this endpoint is safe, and it is asserted rather than assumed.
 *
 * ## Branches ARE scoped, because branch scope is a real boundary
 *
 * Unlike the curriculum vocabulary, `UserBranchRole` genuinely bounds a staff
 * member's reach (§7, R24), so branches come from `reachableBranches` — `null`
 * meaning *every* branch, never *none*.
 */

/** Staff only. A beneficiary composes nothing and filters her own screens from
 *  her own enrolments; offering her the platform's vocabulary would answer a
 *  question she is never asked. */
function assertStaff(actor: Actor): void {
  const permitted =
    scope.isSuperAdmin(actor.roleScopes) ||
    scope.hasRole(actor.roleScopes, 'admin') ||
    scope.hasRole(actor.roleScopes, 'teacher');
  if (!permitted) {
    throw new AppError('FORBIDDEN', 'scope options are for staff who compose scoped work');
  }
}

export interface ScopeOptions {
  categories: { id: string; name: string }[];
  levels: {
    id: string;
    name: string;
    categoryId: string;
    categoryName: string;
    /** §4.9's default content visibility for this Level, through its Category
     *  (§15.1) — carried on the Level because that is the list a screen loads. */
    defaultVisibility: string;
    /**
     * **The Subjects this Level teaches** (§4.4b `LevelSubject`).
     *
     * Carried inline so the Level → Subject narrowing needs no second request.
     * That is not merely a round trip saved: the second request was
     * `/admin/levels/{id}/subjects`, which is another read a مؤطِّرة is refused,
     * so a client that kept it would have traded three `403`s for one.
     */
    subjectIds: string[];
  }[];
  subjects: { id: string; name: string }[];
  academicYears: { id: string; label: string; isCurrent: boolean }[];
  branches: { id: string; name: string }[];
}

export async function readScopeOptions(
  prisma: PrismaClient,
  actor: Actor,
): Promise<ScopeOptions> {
  assertStaff(actor);

  const reachable = scope.reachableBranches(actor.roleScopes, ['admin', 'teacher']);

  const [categories, levels, subjects, years, branches] = await Promise.all([
    prisma.category.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: [{ displayOrder: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }],
    }),
    prisma.level.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        categoryId: true,
        category: { select: { name: true } },
        subjects: {
          where: { deletedAt: null, subject: { deletedAt: null } },
          select: { subjectId: true },
        },
      },
      orderBy: [{ displayOrder: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }],
    }),
    prisma.subject.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: [{ displayOrder: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }],
    }),
    prisma.academicYear.findMany({
      select: { id: true, label: true, isCurrent: true },
      orderBy: { label: 'desc' },
    }),
    prisma.branch.findMany({
      where: {
        deletedAt: null,
        // `null` is every branch (§7, R24) — never "no branches".
        ...(reachable === null ? {} : { id: { in: reachable } }),
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  /**
   * §15.1 keeps the per-Category default in `SystemSetting`, not on the
   * Category row, and `level.service` owns both the key shape and the
   * fail-closed reading (*"never widen on a surprise"*). Both are imported
   * rather than restated: a second copy would be a second answer to *what does
   * this Level default to*, and the copy that drifts still passes its own tests.
   */
  const settings = await prisma.systemSetting.findMany({
    where: {
      key: {
        in: [...new Set(levels.map((l) => l.categoryId))].map(
          (id) => `${DEFAULT_VISIBILITY_PREFIX}${id}`,
        ),
      },
    },
    select: { key: true, value: true },
  });
  const byCategory = new Map(
    settings.map((s) => [s.key.slice(DEFAULT_VISIBILITY_PREFIX.length), s.value]),
  );

  return {
    categories,
    levels: levels.map((l) => ({
      id: l.id,
      name: l.name,
      categoryId: l.categoryId,
      categoryName: l.category.name,
      defaultVisibility: readDefaultVisibility(byCategory.get(l.categoryId)),
      subjectIds: l.subjects.map((s) => s.subjectId),
    })),
    subjects,
    academicYears: years.map((y) => ({
      id: y.id,
      label: y.label,
      isCurrent: y.isCurrent,
    })),
    branches,
  };
}
