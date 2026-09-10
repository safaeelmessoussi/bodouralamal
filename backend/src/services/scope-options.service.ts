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
     * **R123 — may a beneficiary of this Level's Category record her own
     * presence?**
     *
     * Carried on the Level for exactly the reason `defaultVisibility` is: this
     * is the list a scheduling screen loads, and the alternative is a second
     * request for a single boolean. It exists so the form does not **offer**
     * `self_or_staff` where the server will always refuse it — a control whose
     * every use is refused is worse than no control (rule P, read backwards).
     *
     * **Structural, never the Category's name** (§4.4b): the flag is a column,
     * and no client anywhere compares اليافعات to a string.
     */
    selfAttendanceAllowed: boolean;
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
        category: { select: { name: true, selfAttendanceAllowed: true } },
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
      where: { deletedAt: null },
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
      selfAttendanceAllowed: l.category.selfAttendanceAllowed,
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

/** Staff only, and a مؤطِّرة specifically — this answers *what may I schedule a
 *  class for*, which is never a question an Admin needs asked on her behalf
 *  (she already reads the unscoped `/me/scope-options`, §2). */
function assertTeacher(actor: Actor): void {
  if (!scope.hasRole(actor.roleScopes, 'teacher')) {
    throw new AppError('FORBIDDEN', 'course schedule options are for teaching staff');
  }
}

/**
 * **`GET /me/course-schedule-options` — a مؤطِّرة's own declared-capability
 * scope, for creating her own class** (SRS §2, Revision 140).
 *
 * ## Why this is not `/me/scope-options` with a flag
 *
 * `/me/scope-options` is deliberately **unscoped** on the curriculum axes
 * (`readScopeOptions`'s own docstring: *"the curriculum vocabulary is
 * deliberately not [narrowed]… §4.9 tier 3 already admits every staff member
 * to every content tier"*), and BOTH an Admin and a مؤطِّرة read that same
 * endpoint for the identical `ClassSection` scope chain today — an Admin's
 * class-creation authority is not bounded by declared capability at all. Add-
 * ing a mode flag to that endpoint risks the exact defect this platform's own
 * history warns against: one branch of a shared conditional quietly widening
 * (or narrowing) the OTHER caller. A new, single-purpose, single-caller read
 * carries no such risk — R93.4's own precedent (*"a narrower question, never
 * a wider permission"*), applied a second time for the second Owner-approved
 * capability grant this platform makes to a مؤطِّرة's own declared profile.
 *
 * ## What narrows, and why
 *
 * **Branches**: her live `teacher` `UserBranchRole` rows (`branchesForRole`) —
 * the SAME mechanism an Admin's own branch scope already uses, reused
 * deliberately for this ONE new grant rather than through
 * `teacherBranchIds`'s "where she already teaches" derivation (used
 * everywhere else a مؤطِّرة's reach is read): she has, by construction, no
 * `CourseScheduleStaff` row on the schedule she is about to create, so a
 * reach derived from existing schedules could never authorise a first one.
 * `NULL` still means every branch for that assignment (§7, R24) — this
 * endpoint does not invent a narrower reading of a role scope than any other
 * surface gives it.
 *
 * **Levels** (and their per-Level Subjects): a Level whose CATEGORY she has
 * declared (`TeacherCategoryCapability`) offers every Subject it teaches — the
 * Category declaration is the broader of the two grants and is not narrowed
 * further by which specific Subject she named. A Level reached ONLY through a
 * declared SUBJECT (`TeacherSubjectCapability`, no matching Category
 * declaration) offers just that Subject, never the Level's others — she
 * declared one Subject, not the whole curriculum of a Level she has no
 * Category claim on.
 */
export async function readCourseScheduleOptions(
  prisma: PrismaClient,
  actor: Actor,
): Promise<ScopeOptions> {
  assertTeacher(actor);

  const branchIds = scope.branchesForRole(actor.roleScopes, 'teacher');

  const [categoryCaps, subjectCaps] = await Promise.all([
    prisma.teacherCategoryCapability.findMany({
      where: { userId: actor.userId },
      select: { categoryId: true },
    }),
    prisma.teacherSubjectCapability.findMany({
      where: { userId: actor.userId },
      select: { subjectId: true },
    }),
  ]);
  const declaredCategoryIds = new Set(categoryCaps.map((c) => c.categoryId));
  const declaredSubjectIds = new Set(subjectCaps.map((s) => s.subjectId));

  const [categories, branches, levels, years] = await Promise.all([
    prisma.category.findMany({
      where: { deletedAt: null, id: { in: [...declaredCategoryIds] } },
      select: { id: true, name: true },
      orderBy: [{ displayOrder: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }],
    }),
    prisma.branch.findMany({
      where: {
        deletedAt: null,
        // `null` is every branch for that assignment (§7, R24) — never "none".
        ...(branchIds === null ? {} : { id: { in: branchIds } }),
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.level.findMany({
      where: {
        deletedAt: null,
        OR: [
          { categoryId: { in: [...declaredCategoryIds] } },
          {
            subjects: {
              some: {
                deletedAt: null,
                subject: { deletedAt: null },
                subjectId: { in: [...declaredSubjectIds] },
              },
            },
          },
        ],
      },
      select: {
        id: true,
        name: true,
        categoryId: true,
        category: { select: { name: true, selfAttendanceAllowed: true } },
        subjects: {
          where: { deletedAt: null, subject: { deletedAt: null } },
          select: { subjectId: true },
        },
      },
      orderBy: [{ displayOrder: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }],
    }),
    prisma.academicYear.findMany({
      where: { deletedAt: null },
      select: { id: true, label: true, isCurrent: true },
      orderBy: { label: 'desc' },
    }),
  ]);

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

  const narrowedLevels = levels.map((l) => {
    const categoryDeclared = declaredCategoryIds.has(l.categoryId);
    const subjectIds = l.subjects
      .map((s) => s.subjectId)
      .filter((id) => categoryDeclared || declaredSubjectIds.has(id));
    return {
      id: l.id,
      name: l.name,
      categoryId: l.categoryId,
      categoryName: l.category.name,
      defaultVisibility: readDefaultVisibility(byCategory.get(l.categoryId)),
      selfAttendanceAllowed: l.category.selfAttendanceAllowed,
      subjectIds,
    };
  });

  const referencedSubjectIds = new Set(narrowedLevels.flatMap((l) => l.subjectIds));
  const subjects = await prisma.subject.findMany({
    where: { deletedAt: null, id: { in: [...referencedSubjectIds] } },
    select: { id: true, name: true },
    orderBy: [{ displayOrder: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }],
  });

  return {
    categories,
    levels: narrowedLevels,
    subjects,
    academicYears: years.map((y) => ({
      id: y.id,
      label: y.label,
      isCurrent: y.isCurrent,
    })),
    branches,
  };
}
