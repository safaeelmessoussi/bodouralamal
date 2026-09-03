import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import type { Actor } from '../policies/actor.js';
import * as scope from '../policies/branch-scope.js';
import * as audit from '../repositories/audit.repository.js';

/**
 * **Academic periods — the semesters an academic year is made of** (SRS
 * Revision 122).
 *
 * ## The defect this closes
 *
 * An `Enrollment` carried `enrolled_at` and `deleted_at` and nothing else, so a
 * row was current until somebody remembered to soft-delete it. *Is this
 * beneficiary enrolled right now* had no answer the database could give, and
 * the association enrols **by semester**.
 *
 * ## Reference data, on R26's terms
 *
 * A period belongs to an `AcademicYear`, which R26 lists among the
 * reference/configuration data **only a Super Admin may write** while any staff
 * member may read — operational work depends on reading it, and the enrolment
 * form is exactly that case. So: read = any staff who may read reference data;
 * write = Super Admin, freshness-checked, audited.
 *
 * ## Dates are recorded, never computed
 *
 * Nothing here assumes a September start or a January boundary. The
 * association's own dates are entered by the Super Admin, and **the seed
 * creates no periods** — inventing semester boundaries would be fabricating a
 * fact about the association's calendar.
 *
 * `end_date` is **inclusive**: a period runs to the end of that day, which is
 * what «الفصل ينتهي يوم كذا» means to the person recording it.
 */
/**
 * TD-2 R26/R43.3 — a period is curriculum reference data, so writing it is
 * Super Admin, exactly as writing the `AcademicYear` it belongs to is.
 *
 * **Deliberately NOT `assertFreshActive`.** TD-12 freshness is scoped to the
 * surfaces that list it — approvals, consent overrides, pass/fail overrides,
 * user-management and settings — and applying it here alone would make one
 * reference-data write authorize differently from every sibling beside it in
 * the same screen, for a row that grants nothing.
 */
function assertCanWritePeriods(actor: Actor): void {
  if (!scope.isSuperAdmin(actor.roleScopes)) {
    throw new AppError('FORBIDDEN', 'academic periods are Super Admin only (R26, R43.3)');
  }
}

/** TD-2 R26/R30 — reading reference data is Admin or Super Admin. */
function assertCanReadReferenceData(actor: Actor): void {
  const permitted =
    scope.isSuperAdmin(actor.roleScopes) || scope.hasRole(actor.roleScopes, 'admin');
  if (!permitted) {
    throw new AppError('FORBIDDEN', 'reading reference data requires admin (TD-2 R26, R30)');
  }
}

export interface AcademicPeriodRow {
  id: string;
  academicYearId: string;
  academicYearLabel: string;
  sequence: number;
  startDate: Date;
  endDate: Date;
  /** Derived, never stored — see `isCurrentPeriod`. */
  isCurrent: boolean;
  version: number;
}

const SELECT = {
  id: true,
  academicYearId: true,
  sequence: true,
  startDate: true,
  endDate: true,
  version: true,
  academicYear: { select: { label: true } },
} as const;

type Row = Prisma.AcademicPeriodGetPayload<{ select: typeof SELECT }>;

/**
 * **The one definition of *now* in this module.**
 *
 * A period is current when today falls inside `[start_date, end_date]`,
 * inclusive at both ends. Comparing dates rather than instants is deliberate:
 * `start_date`/`end_date` are `DATE` columns and a semester begins on a day,
 * not at a moment, so a timestamp comparison would make the boundary depend on
 * the reader's clock.
 */
export function isCurrentPeriod(
  row: { startDate: Date; endDate: Date },
  today: Date = new Date(),
): boolean {
  const day = today.toISOString().slice(0, 10);
  return row.startDate.toISOString().slice(0, 10) <= day &&
    day <= row.endDate.toISOString().slice(0, 10);
}

function toRow(row: Row, today: Date): AcademicPeriodRow {
  return {
    id: row.id,
    academicYearId: row.academicYearId,
    academicYearLabel: row.academicYear.label,
    sequence: row.sequence,
    startDate: row.startDate,
    endDate: row.endDate,
    isCurrent: isCurrentPeriod(row, today),
    version: row.version,
  };
}

/* ── Reads ──────────────────────────────────────────────────────────────── */

/** `GET /admin/academic-periods` — the enrolment form's source, and the year's own list. */
export async function listAcademicPeriods(
  prisma: PrismaClient,
  actor: Actor,
  filters: { academicYearId?: string } = {},
  today: Date = new Date(),
): Promise<AcademicPeriodRow[]> {
  // TD-2 R26/R30 — the same gate `reference-data.service` applies to the
  // academic YEAR this period belongs to. Reading it is administrative work,
  // and stating the rule twice is how the two would drift.
  assertCanReadReferenceData(actor);
  const rows = await prisma.academicPeriod.findMany({
    where: filters.academicYearId ? { academicYearId: filters.academicYearId } : {},
    // Chronological: a form offers the year in the order it is lived.
    orderBy: [{ startDate: 'desc' }, { sequence: 'desc' }],
    select: SELECT,
  });
  return rows.map((row) => toRow(row, today));
}

/**
 * **The period an enrolment recorded RIGHT NOW belongs to.**
 *
 * Used by the approval path, which enrols somebody as a consequence of a
 * decision taken today rather than from a form that named a semester.
 *
 * **Fails closed** when no period contains today: an enrolment with no period
 * is exactly the open-ended row R122 exists to remove, so the platform refuses
 * and names the remedy rather than writing one. A period spanning today is
 * something the Super Admin records once per semester.
 */
export async function currentAcademicPeriod(
  tx: { academicPeriod: PrismaClient['academicPeriod'] },
  today: Date = new Date(),
): Promise<{ id: string }> {
  const day = today.toISOString().slice(0, 10);
  const row = await tx.academicPeriod.findFirst({
    where: { startDate: { lte: new Date(day) }, endDate: { gte: new Date(day) } },
    orderBy: [{ startDate: 'desc' }],
    select: { id: true },
  });
  if (!row) {
    throw new AppError('STATE_CONFLICT', 'no academic period covers today', {
      reason: 'NO_CURRENT_ACADEMIC_PERIOD',
    });
  }
  return row;
}

/** Resolves a period a caller named, refusing one that does not exist. */
export async function assertPeriodExists(
  tx: { academicPeriod: PrismaClient['academicPeriod'] },
  academicPeriodId: string,
): Promise<{ id: string }> {
  const row = await tx.academicPeriod.findUnique({
    where: { id: academicPeriodId },
    select: { id: true },
  });
  if (!row) throw new AppError('NOT_FOUND', 'no such academic period');
  return row;
}

/* ── Writes ─────────────────────────────────────────────────────────────── */

export interface PeriodInput {
  academicYearId: string;
  sequence: number;
  startDate: Date;
  endDate: Date;
}

/**
 * **Two periods of one year may not overlap**, and the check lives here rather
 * than in the database.
 *
 * PostgreSQL can express it only with an exclusion constraint over a range
 * type, which needs `btree_gist`; this installation loads no extensions and
 * §20 forbids adding one casually. The invariant is small, the write is rare
 * and Super-Admin-only, and the refusal is coded so a screen can explain it —
 * which a raw constraint violation could not.
 *
 * **Overlap matters because `currentAcademicPeriod` picks one row.** Two
 * overlapping periods would make *which semester is it* ambiguous, and an
 * approval would enrol somebody into whichever sorted first.
 */
async function assertNoOverlap(
  tx: Prisma.TransactionClient,
  input: PeriodInput,
  excludeId: string | null,
): Promise<void> {
  const clash = await tx.academicPeriod.findFirst({
    where: {
      academicYearId: input.academicYearId,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      // Two closed intervals overlap when each starts before the other ends.
      startDate: { lte: input.endDate },
      endDate: { gte: input.startDate },
    },
    select: { id: true, sequence: true },
  });
  if (clash) {
    throw new AppError('STATE_CONFLICT', 'that period overlaps another in the same year', {
      reason: 'ACADEMIC_PERIOD_OVERLAP',
      conflicting_sequence: clash.sequence,
    });
  }
}

function normalize(input: PeriodInput): PeriodInput {
  if (input.endDate < input.startDate) {
    throw new AppError('VALIDATION_FAILED', 'the period ends before it starts', {
      issues: [{ path: 'end_date', message: 'must not precede start_date' }],
    });
  }
  return input;
}

/** `POST /admin/academic-periods` — Super Admin, audited. */
export async function createAcademicPeriod(
  prisma: PrismaClient,
  caller: Actor,
  input: PeriodInput,
  today: Date = new Date(),
): Promise<AcademicPeriodRow> {
  assertCanWritePeriods(caller);
  const actor = caller;
  normalize(input);

  return prisma.$transaction(async (tx) => {
    const year = await tx.academicYear.findUnique({
      where: { id: input.academicYearId },
      select: { id: true },
    });
    if (!year) throw new AppError('NOT_FOUND', 'no such academic year');

    const taken = await tx.academicPeriod.findUnique({
      where: {
        academicYearId_sequence: {
          academicYearId: input.academicYearId,
          sequence: input.sequence,
        },
      },
      select: { id: true },
    });
    // A coded refusal, not a raw unique violation: the sequence is a number
    // somebody typed, so the screen must be able to name the field.
    if (taken) {
      throw new AppError('STATE_CONFLICT', 'that academic year already has this period', {
        reason: 'ACADEMIC_PERIOD_SEQUENCE_TAKEN',
      });
    }
    await assertNoOverlap(tx, input, null);

    const created = await tx.academicPeriod.create({ data: input, select: SELECT });
    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'academicperiod.create',
      targetEntity: 'AcademicPeriod',
      targetId: created.id,
      detail: {
        academic_year_id: input.academicYearId,
        sequence: input.sequence,
        start_date: input.startDate.toISOString().slice(0, 10),
        end_date: input.endDate.toISOString().slice(0, 10),
      },
    });
    return toRow(created, today);
  });
}

/**
 * `PATCH /admin/academic-periods/{id}` — Super Admin, TD-15, audited.
 *
 * **The dates are editable and the year is not.** Correcting a semester's dates
 * is ordinary administration; moving a period to another year would silently
 * re-file every enrolment that names it under a different academic year, which
 * is a re-creation rather than an edit.
 */
export async function updateAcademicPeriod(
  prisma: PrismaClient,
  caller: Actor,
  id: string,
  patch: { sequence: number; startDate: Date; endDate: Date },
  expectedVersion: number,
  today: Date = new Date(),
): Promise<AcademicPeriodRow> {
  assertCanWritePeriods(caller);
  const actor = caller;

  return prisma.$transaction(async (tx) => {
    const existing = await tx.academicPeriod.findUnique({
      where: { id },
      select: { id: true, academicYearId: true, version: true },
    });
    if (!existing) throw new AppError('NOT_FOUND', 'no such academic period');
    // TD-15 — a stale version means another Super Admin moved these dates while
    // this form was open, and dates decide who counts as enrolled.
    if (existing.version !== expectedVersion) {
      throw new AppError('VERSION_CONFLICT', 'that period was changed by someone else');
    }

    const input = normalize({ ...patch, academicYearId: existing.academicYearId });

    const taken = await tx.academicPeriod.findUnique({
      where: {
        academicYearId_sequence: {
          academicYearId: existing.academicYearId,
          sequence: patch.sequence,
        },
      },
      select: { id: true },
    });
    if (taken && taken.id !== id) {
      throw new AppError('STATE_CONFLICT', 'that academic year already has this period', {
        reason: 'ACADEMIC_PERIOD_SEQUENCE_TAKEN',
      });
    }
    await assertNoOverlap(tx, input, id);

    const saved = await tx.academicPeriod.update({
      where: { id },
      data: {
        sequence: patch.sequence,
        startDate: patch.startDate,
        endDate: patch.endDate,
        version: { increment: 1 },
      },
      select: SELECT,
    });
    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'academicperiod.update',
      targetEntity: 'AcademicPeriod',
      targetId: id,
      detail: {
        sequence: patch.sequence,
        start_date: patch.startDate.toISOString().slice(0, 10),
        end_date: patch.endDate.toISOString().slice(0, 10),
      },
    });
    return toRow(saved, today);
  });
}
