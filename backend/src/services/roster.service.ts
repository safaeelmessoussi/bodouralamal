import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import * as scope from '../policies/branch-scope.js';
import * as audit from '../repositories/audit.repository.js';
import { enqueue, JOB_QUEUES } from '../repositories/jobs.repository.js';
import type { Actor } from './group.service.js';

/**
 * Group enrolment (SRS §5.6, §4.1a, TD-4.6, TD-5, TD-15).
 *
 * §5.6: *"add/remove students; enforces `max_students`; **every roster change
 * enqueues consent re-evaluation** (§4.1a)."* Both halves of that sentence are
 * load-bearing and both are enforced here.
 *
 * **TD-15 pessimistic lock.** Capacity is a check-then-write invariant, and
 * TD-4.6 names the Group row specifically: *"roster mutation locks the Group row
 * (capacity check vs `max_students`)"*. Without it two concurrent enrolments at
 * capacity − 1 both see a free seat and both commit, over-filling the group.
 *
 * **TD-5 un-enrolment is a soft-delete of the enrolment row only.** It *never*
 * touches the student's Grades, exam submissions or Quran progress — those are
 * the historical academic record and survive a student leaving, so a re-enrolled
 * student rejoins a group that still knows what they did.
 */

/** TD-2: rosters are operational data — Admin within scope, or Super Admin. */
const MANAGING_ROLE = 'admin';

const isSuperAdmin = (actor: Actor) => scope.isSuperAdmin(actor.roleScopes);

function assertCanManage(actor: Actor): void {
  if (!(scope.hasRole(actor.roleScopes, MANAGING_ROLE) || isSuperAdmin(actor))) {
    throw new AppError('FORBIDDEN', 'roster management requires admin');
  }
}

function assertInScope(actor: Actor, branchId: string): void {
  if (isSuperAdmin(actor)) return;
  if (!scope.canActOnBranch(actor.roleScopes, MANAGING_ROLE, branchId)) {
    // §20 rule 17: out of scope is 404, never 403.
    throw new AppError('NOT_FOUND', 'no such group');
  }
}

export async function listRoster(
  prisma: PrismaClient,
  actor: Actor,
  groupId: string,
): Promise<{ studentId: string; nameArabic: string }[]> {
  assertCanManage(actor);
  const group = await prisma.group.findFirst({ where: { id: groupId, deletedAt: null } });
  if (!group) throw new AppError('NOT_FOUND', 'no such group');
  assertInScope(actor, group.branchId);

  const rows = await prisma.studentGroup.findMany({
    where: { groupId, deletedAt: null, student: { deletedAt: null } },
    select: { student: { select: { id: true, nameArabic: true } } },
    orderBy: { student: { nameArabic: 'asc' } },
  });
  return rows.map((r) => ({ studentId: r.student.id, nameArabic: r.student.nameArabic }));
}

/**
 * Enrols a student, enforcing `max_students` under the TD-4.6 row lock and
 * enqueuing the §4.1a consent re-evaluation in the same transaction.
 */
export async function enrolStudent(
  prisma: PrismaClient,
  actor: Actor,
  groupId: string,
  studentId: string,
): Promise<{ id: string; enrolled: number; capacity: number }> {
  assertCanManage(actor);

  return prisma.$transaction(async (tx) => {
    const group = await tx.group.findFirst({ where: { id: groupId, deletedAt: null } });
    if (!group) throw new AppError('NOT_FOUND', 'no such group');
    assertInScope(actor, group.branchId);

    const student = await tx.user.findFirst({
      where: { id: studentId, deletedAt: null },
      select: { id: true },
    });
    if (!student) throw new AppError('NOT_FOUND', 'no such student');

    const existing = await tx.studentGroup.findFirst({ where: { groupId, studentId } });
    if (existing && existing.deletedAt === null) {
      throw new AppError('DUPLICATE', 'student is already enrolled in this group');
    }

    // TD-4.6/TD-15: lock the Group row BEFORE counting, or two concurrent
    // enrolments at capacity − 1 both see a seat and both commit.
    await tx.$queryRaw`SELECT id FROM "group" WHERE id = ${groupId}::uuid FOR UPDATE`;
    const enrolled = await tx.studentGroup.count({ where: { groupId, deletedAt: null } });
    if (enrolled >= group.maxStudents) {
      // TD-3.8 has a dedicated code for exactly this condition.
      throw new AppError('CAPACITY_FULL', 'group is at capacity', {
        reason: 'MAX_STUDENTS_REACHED',
        constraint: 'GROUP_CAPACITY',
        capacity: group.maxStudents,
      });
    }

    // A previously un-enrolled student rejoins the same row rather than
    // duplicating it — the §7 unique pair spans soft-deleted rows.
    const row = existing
      ? await tx.studentGroup.update({
          where: { id: existing.id },
          data: { deletedAt: null, deletedById: null },
          select: { id: true },
        })
      : await tx.studentGroup.create({ data: { groupId, studentId }, select: { id: true } });

    // §4.1a: EVERY roster change re-evaluates the group's consent gate, in this
    // transaction (TD-4), so the gate cannot drift from the roster.
    await enqueue(tx, JOB_QUEUES.consentReevaluate, { group_id: groupId }, groupId);

    await audit.write(tx, {
      actorUserId: actor.userId,
      actionType: 'roster.enrol',
      targetEntity: 'StudentGroup',
      targetId: row.id,
      detail: { group_id: groupId, student_id: studentId, enrolled: enrolled + 1 },
    });
    return { id: row.id, enrolled: enrolled + 1, capacity: group.maxStudents };
  });
}

/**
 * Un-enrols a student — a soft-delete of the enrolment row **only** (TD-5).
 *
 * The enqueue names the group explicitly rather than deriving it from the
 * student's remaining groups: after this write the student is no longer in it,
 * so a derived lookup would skip the very group whose gate changed.
 */
export async function unenrolStudent(
  prisma: PrismaClient,
  actor: Actor,
  groupId: string,
  studentId: string,
): Promise<void> {
  assertCanManage(actor);

  await prisma.$transaction(async (tx) => {
    const group = await tx.group.findFirst({ where: { id: groupId, deletedAt: null } });
    if (!group) throw new AppError('NOT_FOUND', 'no such group');
    assertInScope(actor, group.branchId);

    const row = await tx.studentGroup.findFirst({
      where: { groupId, studentId, deletedAt: null },
    });
    if (!row) throw new AppError('NOT_FOUND', 'student is not enrolled in this group');

    await tx.studentGroup.update({
      where: { id: row.id },
      data: { deletedAt: new Date(), deletedById: actor.userId },
    });

    await enqueue(tx, JOB_QUEUES.consentReevaluate, { group_id: groupId }, groupId);

    await audit.write(tx, {
      actorUserId: actor.userId,
      actionType: 'roster.unenrol',
      targetEntity: 'StudentGroup',
      targetId: row.id,
      detail: { group_id: groupId, student_id: studentId },
    });
  });
}
