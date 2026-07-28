import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { branchesForRole, hasRole, isSuperAdmin, type RoleScope } from './branch-scope.js';

/**
 * Teacher scoping (SRS §4.2, §7, TD-2).
 *
 * §4.2 is unambiguous: teacher-to-group assignment lives in `GroupTeacher`, and
 * **all** teacher scoping — exam authoring, Quran logging, sensitive social-data
 * access (§4.10) — resolves **exclusively** through it. A Teacher's
 * `UserBranchRole` row carries the role, never their teaching reach, so nothing
 * here consults branch scope for a Teacher.
 *
 * This is what makes "a Teacher may teach Level 1 in Marrakesh and Level 2 in
 * Casablanca" expressible without a second scope axis: a `Group` already carries
 * both `level_id` and `branch_id`, so the group assignment *is* the scope.
 *
 * TD-2's teacher rows are all qualified the same way — "own groups", "own
 * students", "only own assigned students" — and every one of them reduces to a
 * question this module answers.
 *
 * **Out-of-scope reads `404`, never `403`** (§20 rule 17, TD-3.8): telling a
 * teacher that a student exists but belongs to someone else leaks the existence
 * of a minor's record. The same answer is given for "no such student".
 */

/**
 * **The composable predicate — the primary abstraction (§4.2).**
 *
 * A Prisma `where` fragment selecting the students a teacher reaches. Every
 * scope-aware query composes this instead of materialising ids and issuing
 * `WHERE student_id IN (…)`.
 *
 * The reason is composability and freshness rather than raw speed. Materialising
 * ids first costs an extra round trip, and — more importantly — takes a
 * **snapshot**: between computing the set and using it, a group assignment can
 * be revoked, so the request acts on scope that is no longer true. TD-12's whole
 * posture is that authorization is re-evaluated per request; a single query that
 * joins scope and data evaluates both at one instant. It also composes with
 * TD-10 pagination and the normalized-shadow-column search, which an in-memory
 * id list cannot do without re-filtering in application code.
 *
 * Postgres receives nested `EXISTS` subqueries and plans the joins itself.
 *
 * Both sides are live: a soft-deleted enrolment, a revoked assignment, or a
 * deleted group each remove the student, on the very next query.
 */
export function taughtByTeacher(teacherId: string): {
  enrollments: { some: Record<string, unknown> };
} {
  return {
    enrollments: {
      some: {
        deletedAt: null,
        group: {
          deletedAt: null,
          teachers: { some: { teacherId, deletedAt: null } },
        },
      },
    },
  };
}

/** The `Group` counterpart, for roster and exam-authoring scope ("own groups"). */
export function groupTaughtByTeacher(teacherId: string): Record<string, unknown> {
  return { deletedAt: null, teachers: { some: { teacherId, deletedAt: null } } };
}

/** Live group assignments for a teacher; soft-deleted rows never count. */
export async function teacherGroupIds(prisma: PrismaClient, teacherId: string): Promise<string[]> {
  const rows = await prisma.groupTeacher.findMany({
    where: { teacherId, deletedAt: null, group: { deletedAt: null } },
    select: { groupId: true },
  });
  return [...new Set(rows.map((r) => r.groupId))];
}

/** Whether a teacher is assigned to a specific group (co-teaching included). */
export async function teachesGroup(
  prisma: PrismaClient,
  teacherId: string,
  groupId: string,
): Promise<boolean> {
  const row = await prisma.groupTeacher.findFirst({
    where: { teacherId, groupId, deletedAt: null, group: { deletedAt: null } },
    select: { id: true },
  });
  return row !== null;
}

/**
 * Whether a student is enrolled in **any** group this teacher is assigned to.
 *
 * Both sides must be live: a soft-deleted enrolment or a revoked group
 * assignment ends the teacher's reach on the very next request, exactly as
 * revoking a family link does (§4.3).
 */
export async function teachesStudent(
  prisma: PrismaClient,
  teacherId: string,
  studentId: string,
): Promise<boolean> {
  // One query via the predicate: scope and subject are evaluated together, so
  // there is no window in which the assignment could change between them.
  const student = await prisma.user.findFirst({
    where: { id: studentId, deletedAt: null, ...taughtByTeacher(teacherId) },
    select: { id: true },
  });
  return student !== null;
}

/** The students a teacher may act on, across every group they are assigned to. */
export async function teacherStudentIds(
  prisma: PrismaClient,
  teacherId: string,
): Promise<string[]> {
  // Retained for the genuine "list my students" case, but built on the same
  // predicate so there is one definition of reach. Endpoints that filter
  // students should compose `taughtByTeacher` directly rather than call this and
  // then issue `IN (…)`.
  const students = await prisma.user.findMany({
    where: { deletedAt: null, ...taughtByTeacher(teacherId) },
    select: { id: true },
  });
  return students.map((s) => s.id);
}

/** The caller as the freshness policy resolves them (§4.2 Revision 24). */
export interface ScopedActor {
  userId: string;
  roleScopes: RoleScope[];
}

/**
 * Asserts the caller may act on a student's record, resolving each role the way
 * TD-2 qualifies it:
 *
 *   - **Super Admin** — unscoped by role (§2.1).
 *   - **Admin** — constrained to their branch scope; a student belongs to a
 *     branch through the groups they are enrolled in, since `Group` carries
 *     `branch_id`. An all-branches Admin reaches every student.
 *   - **Teacher** — only students in their own groups, via `GroupTeacher`.
 *
 * Throws `404` rather than `403` when out of scope, so the response cannot be
 * used to discover that a student exists.
 */
export async function assertCanAccessStudent(
  prisma: PrismaClient,
  actor: ScopedActor,
  studentId: string,
): Promise<void> {
  if (isSuperAdmin(actor.roleScopes)) return;

  if (hasRole(actor.roleScopes, 'admin')) {
    const managed = branchesForRole(actor.roleScopes, 'admin');
    if (managed === null) return; // all-branches Admin

    const inScope = await prisma.studentGroup.findFirst({
      where: {
        studentId,
        deletedAt: null,
        group: { deletedAt: null, branchId: { in: managed } },
      },
      select: { id: true },
    });
    if (inScope) return;
    // Deliberately falls through: an Admin who also teaches may still reach the
    // student through their own groups, checked below.
  }

  if (hasRole(actor.roleScopes, 'teacher') && (await teachesStudent(prisma, actor.userId, studentId))) {
    return;
  }

  // §20 rule 17: identical answer for out-of-scope and nonexistent, so the
  // response cannot be used to discover that a minor's record exists.
  throw new AppError('NOT_FOUND', 'no such student in scope');
}

/** Group-scoped variant, for exam authoring and roster work (TD-2 "own groups"). */
export async function assertCanAccessGroup(
  prisma: PrismaClient,
  actor: ScopedActor,
  groupId: string,
): Promise<void> {
  if (isSuperAdmin(actor.roleScopes)) return;

  if (hasRole(actor.roleScopes, 'admin')) {
    const managed = branchesForRole(actor.roleScopes, 'admin');
    if (managed === null) return;
    const group = await prisma.group.findFirst({
      where: { id: groupId, deletedAt: null, branchId: { in: managed } },
      select: { id: true },
    });
    if (group) return;
  }

  if (hasRole(actor.roleScopes, 'teacher') && (await teachesGroup(prisma, actor.userId, groupId))) {
    return;
  }

  throw new AppError('NOT_FOUND', 'no such group in scope');
}
