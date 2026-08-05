import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import * as scope from '../policies/branch-scope.js';
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
