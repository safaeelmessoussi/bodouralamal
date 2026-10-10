import type { Prisma } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import type { FramingPreferenceInput } from '../validators/registration.validators.js';

/**
 * **A مؤطِّرة's framing preference, written and read in one place** (R115;
 * R215). Planning data, never authority (R88.3): what she is willing to do —
 * remote or in class, in which branches, since R215 also WHEN (this year, this
 * semester, or a span of dates), in which POSITION (main teacher, assistant,
 * either) and for which LEVELS — so the administration can plan. Four writers
 * share it: registration, a role request, the مؤطِّرة herself, an
 * administrator.
 */
type Tx = Pick<
  Prisma.TransactionClient,
  'branch' | 'level' | 'academicYear' | 'academicPeriod' | 'framingPreference' | 'framingPreferenceBranch' | 'framingPreferenceLevel'
>;

/** A Morocco calendar day as the `DATE` columns hold it. */
const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
const isoOf = (date: Date): string => date.toISOString().slice(0, 10);

/** What she says NOW replaces what she said before, whole. */
export async function writeFramingPreference(
  tx: Tx,
  userId: string,
  framing: FramingPreferenceInput,
  today: Date = new Date(),
): Promise<void> {
  const physical = framing.mode !== 'online' ? framing.willingness : null;
  const branchIds = physical && !physical.all_branches ? physical.branch_ids : [];
  if (branchIds.length > 0) {
    const live = await tx.branch.count({ where: { id: { in: branchIds }, deletedAt: null } });
    if (live !== branchIds.length) {
      throw new AppError('VALIDATION_FAILED', 'framing branch_ids must each name a live branch');
    }
  }
  const levelIds = framing.levels && !framing.levels.all_levels ? framing.levels.level_ids : [];
  if (levelIds.length > 0) {
    const live = await tx.level.count({ where: { id: { in: levelIds }, deletedAt: null } });
    if (live !== levelIds.length) {
      throw new AppError('VALIDATION_FAILED', 'framing level_ids must each name a live level', {
        reason: 'UNKNOWN_LEVEL',
      });
    }
  }

  // «This year» / «this semester» are resolved now and stored: next semester
  // the statement is about this one, and no longer reads as «now».
  let period: Pick<
    Prisma.FramingPreferenceUncheckedCreateInput,
    'period' | 'academicYearId' | 'academicPeriodId' | 'availableFrom' | 'availableUntil'
  > = {};
  if (framing.period?.kind === 'academic_year') {
    const year = await tx.academicYear.findFirst({ where: { isCurrent: true, deletedAt: null }, select: { id: true } });
    if (!year) {
      throw new AppError('STATE_CONFLICT', 'no current academic year is set', { reason: 'NO_CURRENT_YEAR' });
    }
    period = { period: 'academic_year', academicYearId: year.id };
  } else if (framing.period?.kind === 'academic_period') {
    const now = day(isoOf(today));
    const semester = await tx.academicPeriod.findFirst({
      where: { startDate: { lte: now }, endDate: { gte: now } },
      orderBy: [{ startDate: 'desc' }],
      select: { id: true },
    });
    if (!semester) {
      throw new AppError('STATE_CONFLICT', 'no academic period covers today', { reason: 'NO_CURRENT_PERIOD' });
    }
    period = { period: 'academic_period', academicPeriodId: semester.id };
  } else if (framing.period?.kind === 'date_range') {
    period = { period: 'date_range', availableFrom: day(framing.period.from), availableUntil: day(framing.period.until) };
  }

  await tx.framingPreferenceLevel.deleteMany({ where: { userId } });
  await tx.framingPreferenceBranch.deleteMany({ where: { userId } });
  await tx.framingPreference.deleteMany({ where: { userId } });
  await tx.framingPreference.create({
    data: {
      userId,
      mode: framing.mode,
      allBranches: physical?.all_branches ?? false,
      ...period,
      ...(framing.position ? { position: framing.position } : {}),
      allLevels: levelIds.length === 0,
      ...(branchIds.length > 0 ? { branches: { create: branchIds.map((branchId) => ({ branchId })) } } : {}),
      ...(levelIds.length > 0 ? { levels: { create: levelIds.map((levelId) => ({ levelId })) } } : {}),
    },
  });
}

/** What a reader of the preference needs, alongside the select that loads it. */
export const FRAMING_SELECT = {
  mode: true,
  allBranches: true,
  branches: {
    select: { branch: { select: { id: true, name: true } } },
    orderBy: { branch: { name: 'asc' } },
  },
  period: true,
  availableFrom: true,
  availableUntil: true,
  academicYear: { select: { id: true, label: true, isCurrent: true } },
  academicPeriod: { select: { id: true, sequence: true, startDate: true, endDate: true, academicYear: { select: { label: true } } } },
  position: true,
  allLevels: true,
  levels: {
    select: { level: { select: { id: true, name: true, category: { select: { name: true } } } } },
    orderBy: { level: { displayOrder: 'asc' } },
  },
} as const satisfies Prisma.FramingPreferenceSelect;

type FramingRow = Prisma.FramingPreferenceGetPayload<{ select: typeof FRAMING_SELECT }>;

export interface FramingView {
  mode: 'in_person' | 'online' | 'both';
  all_branches: boolean;
  branches: { id: string; name: string }[];
  /** R215 — `null`: not stated. */
  period:
    | { kind: 'academic_year'; label: string }
    | { kind: 'academic_period'; label: string; sequence: number; from: string; until: string }
    | { kind: 'date_range'; from: string; until: string }
    | null;
  position: 'teacher' | 'assistant' | 'both' | null;
  all_levels: boolean;
  levels: { id: string; name: string; category_name: string }[];
  /**
   * **R215 — available this semester?** `true`/`false` against the semester
   * covering today (or today itself when none does); `null` when she has not
   * said when — every preference recorded before R215.
   */
  available_now: boolean | null;
}

/** The current semester's span, or today alone when no semester covers it. */
export async function currentSpan(
  tx: Pick<Prisma.TransactionClient, 'academicPeriod'>,
  today: Date = new Date(),
): Promise<{ id: string | null; from: string; until: string }> {
  const now = day(isoOf(today));
  const semester = await tx.academicPeriod.findFirst({
    where: { startDate: { lte: now }, endDate: { gte: now } },
    orderBy: [{ startDate: 'desc' }],
    select: { id: true, startDate: true, endDate: true },
  });
  return semester
    ? { id: semester.id, from: isoOf(semester.startDate), until: isoOf(semester.endDate) }
    : { id: null, from: isoOf(now), until: isoOf(now) };
}

export function framingView(row: FramingRow, span: { id: string | null; from: string; until: string }): FramingView {
  let period: FramingView['period'] = null;
  let available: boolean | null = null;
  if (row.period === 'academic_year' && row.academicYear) {
    period = { kind: 'academic_year', label: row.academicYear.label };
    available = row.academicYear.isCurrent;
  } else if (row.period === 'academic_period' && row.academicPeriod) {
    period = {
      kind: 'academic_period',
      label: row.academicPeriod.academicYear.label,
      sequence: row.academicPeriod.sequence,
      from: isoOf(row.academicPeriod.startDate),
      until: isoOf(row.academicPeriod.endDate),
    };
    available = span.id !== null && row.academicPeriod.id === span.id;
  } else if (row.period === 'date_range' && row.availableFrom && row.availableUntil) {
    const from = isoOf(row.availableFrom);
    const until = isoOf(row.availableUntil);
    period = { kind: 'date_range', from, until };
    // Any overlap with the semester: she is there for part of it.
    available = from <= span.until && span.from <= until;
  }
  return {
    mode: row.mode,
    all_branches: row.allBranches,
    branches: row.branches.map((entry) => entry.branch),
    period,
    position: row.position,
    all_levels: row.allLevels,
    levels: row.levels.map((entry) => ({ id: entry.level.id, name: entry.level.name, category_name: entry.level.category.name })),
    available_now: available,
  };
}
