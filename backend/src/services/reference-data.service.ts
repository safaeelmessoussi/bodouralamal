import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import * as scope from '../policies/branch-scope.js';
import * as audit from '../repositories/audit.repository.js';
import type { Actor } from '../policies/actor.js';

/**
 * Reference-data selectors — Subjects and Academic Years (TD-3 extension,
 * Document Owner decision 2026-08-05).
 *
 * **Why these exist.** `POST /admin/course-schedules` requires `subject_id` and
 * `academic_year_id`, and nothing in TD-3 could list either — so the schedule
 * form could not be built at all. The Owner authorised the two endpoints as a
 * deliberate TD-3 extension rather than the alternatives that were rejected:
 * widening `/calendar/bootstrap` (whose contract is *the calendar screen's*
 * reference data, cached five minutes, and which would then be shaped by an
 * unrelated screen), or a screen-specific payload (which is how a second source
 * of truth for one concept starts).
 *
 * **These are the canonical source for every admin selector needing a Subject
 * or an Academic Year.** A future screen wanting either reads these, and does
 * not grow its own list.
 *
 * **Read-only, and minimal on purpose.** A selector needs an id, a label and
 * whatever it filters by. Everything else — timestamps, versions, soft-delete
 * columns — is deliberately absent: §16.2's allow-list projection applies here
 * exactly as it does to an operational endpoint, and a reference list is
 * precisely where "just return the row" is most tempting.
 *
 * **TD-2 (Revision 26): Admins read reference data, Super Admins write it.**
 * There is no write here at all — Subjects and Academic Years are seeded and
 * managed outside this surface — so the read rule is the whole rule.
 * **Teachers are excluded** (Revision 30): reference data is an administrative
 * concern, and a teacher receives subject and year information through the
 * operational APIs they are authorised to use.
 */

function assertCanReadReferenceData(actor: Actor): void {
  const permitted =
    scope.isSuperAdmin(actor.roleScopes) || scope.hasRole(actor.roleScopes, 'admin');
  if (!permitted) {
    throw new AppError('FORBIDDEN', 'reading reference data requires admin (TD-2 R26, R30)');
  }
}

export interface SubjectRef {
  id: string;
  name: string;
  displayOrder: number | null;
}

/**
 * Every live Subject, ordered as the platform orders reference data.
 *
 * **Not paginated, deliberately.** A selector must offer every option or it is
 * lying about the choice available, and a paged `<select>` is a control with a
 * hidden second page. The set is bounded by the curriculum — tens of rows, not
 * thousands — which is the condition that makes TD-10 the wrong tool here.
 */
export async function listSubjects(
  prisma: PrismaClient,
  actor: Actor,
): Promise<SubjectRef[]> {
  assertCanReadReferenceData(actor);

  const rows = await prisma.subject.findMany({
    where: { deletedAt: null },
    // BR-19: `display_order` first, then the natively `ar-x-icu` collated name —
    // correct Arabic ordering with no per-query COLLATE (§20 rule 13).
    orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, displayOrder: true },
  });
  return rows;
}

export interface AcademicYearRef {
  id: string;
  /** `YYYY-YYYY`, constrained by the database (§4.10, TD-6). */
  label: string;
  /**
   * **The one piece of metadata a selector genuinely needs**: it is what lets a
   * form default to the live year instead of asking an administrator to
   * remember which one that is.
   */
  isCurrent: boolean;
}

export async function listAcademicYears(
  prisma: PrismaClient,
  actor: Actor,
): Promise<AcademicYearRef[]> {
  assertCanReadReferenceData(actor);

  return prisma.academicYear.findMany({
    // Newest first: a form is almost always about the current year or the one
    // after it, and `label` sorts correctly precisely because TD-6 constrains it
    // to `YYYY-YYYY`.
    orderBy: { label: 'desc' },
    select: { id: true, label: true, isCurrent: true },
  });
}

/* ── Level ↔ Subject assignment (§4.4b, TD-3 extension 2026-08-05) ───────── */

/**
 * **Which Subjects a Level teaches.**
 *
 * This was the missing link, and its absence was not theoretical: the platform
 * shipped with **zero `LevelSubject` rows and no way to create one**, so
 * `createTeachingGroup` refused every request with `SUBJECT_NOT_IN_LEVEL` and
 * the Subject Organisation screen could not be used at all. A curriculum join
 * that nothing can write is a table that will always be empty.
 *
 * **Writes are Super Admin**, matching the Teaching Groups the join gates
 * (Revision 43.3): which Subjects a Level teaches is curriculum *structure*,
 * alongside the Levels and Subjects themselves (Revision 26). Reads follow the
 * reference-data rule — Admin and above.
 */
export async function listLevelSubjects(
  prisma: PrismaClient,
  actor: Actor,
  levelId: string,
): Promise<SubjectRef[]> {
  assertCanReadReferenceData(actor);

  const rows = await prisma.levelSubject.findMany({
    where: { levelId, deletedAt: null, subject: { deletedAt: null } },
    select: { subject: { select: { id: true, name: true, displayOrder: true } } },
    orderBy: { subject: { name: 'asc' } },
  });
  return rows.map((r) => r.subject);
}

function assertCanWriteCurriculum(actor: Actor): void {
  if (!scope.isSuperAdmin(actor.roleScopes)) {
    throw new AppError('FORBIDDEN', 'curriculum structure is Super Admin only (R26, R43.3)');
  }
}

/**
 * Assigns a Subject to a Level.
 *
 * **Idempotent by design.** A previously removed assignment is revived rather
 * than duplicated — the unique key is `(level_id, subject_id)`, and a second row
 * would make *"is this Subject taught here"* a question with two answers.
 */
export async function assignSubjectToLevel(
  prisma: PrismaClient,
  actor: Actor,
  levelId: string,
  subjectId: string,
): Promise<void> {
  assertCanWriteCurriculum(actor);

  await prisma.$transaction(async (tx) => {
    const level = await tx.level.findFirst({ where: { id: levelId, deletedAt: null }, select: { id: true } });
    if (!level) throw new AppError('NOT_FOUND', 'no such level');
    const subject = await tx.subject.findFirst({
      where: { id: subjectId, deletedAt: null },
      select: { id: true },
    });
    if (!subject) throw new AppError('NOT_FOUND', 'no such subject');

    const existing = await tx.levelSubject.findFirst({
      where: { levelId, subjectId },
      select: { id: true, deletedAt: true },
    });
    if (existing && existing.deletedAt === null) {
      throw new AppError('DUPLICATE', 'subject is already assigned to this level');
    }
    // TD-8's `target_id` is a UUID column, so the audit row points at the JOIN
    // ROW's own id — not a composite `level:subject` string, which is what the
    // first attempt used and what the database rejected outright. The join row
    // is also the more correct subject: it is the thing that was created.
    const id = existing
      ? (
          await tx.levelSubject.update({
            where: { id: existing.id },
            data: { deletedAt: null, deletedById: null },
            select: { id: true },
          })
        ).id
      : (await tx.levelSubject.create({ data: { levelId, subjectId }, select: { id: true } })).id;

    await audit.write(tx, {
      actorUserId: actor.userId,
      actionType: 'levelsubject.assign',
      targetEntity: 'LevelSubject',
      targetId: id,
      detail: { level_id: levelId, subject_id: subjectId },
    });
  });
}

/**
 * Removes a Subject from a Level (TD-5 soft delete).
 *
 * **Refused while Teaching Groups exist for the pair.** Those groups are the
 * split of a Subject this Level would no longer teach: removing the assignment
 * beneath them would leave every member holding a seat in a subject the Level
 * does not offer, and BR-22's unassigned list could not describe that state.
 */
export async function unassignSubjectFromLevel(
  prisma: PrismaClient,
  actor: Actor,
  levelId: string,
  subjectId: string,
): Promise<void> {
  assertCanWriteCurriculum(actor);

  await prisma.$transaction(async (tx) => {
    const row = await tx.levelSubject.findFirst({
      where: { levelId, subjectId, deletedAt: null },
      select: { id: true },
    });
    if (!row) throw new AppError('NOT_FOUND', 'subject is not assigned to this level');

    const splits = await tx.teachingGroup.count({ where: { levelId, subjectId, deletedAt: null } });
    if (splits > 0) {
      throw new AppError('STATE_CONFLICT', 'teaching groups exist for this subject and level', {
        reason: 'TEACHING_GROUPS_EXIST',
        teaching_groups: splits,
      });
    }

    await tx.levelSubject.update({
      where: { id: row.id },
      data: { deletedAt: new Date(), deletedById: actor.userId },
    });
    await audit.write(tx, {
      actorUserId: actor.userId,
      actionType: 'levelsubject.unassign',
      targetEntity: 'LevelSubject',
      targetId: row.id,
      detail: { level_id: levelId, subject_id: subjectId },
    });
  });
}
