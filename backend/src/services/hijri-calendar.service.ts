import type { HijriMonthStart, Prisma, PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { MAX_HIJRI_YEAR, MIN_HIJRI_YEAR, MONTHS_IN_YEAR, hijriMonthNameArabic } from '../lib/hijri.js';
import * as scope from '../policies/branch-scope.js';
import * as audit from '../repositories/audit.repository.js';
import { updateWithVersion } from '../repositories/optimistic-lock.js';
import type { Actor } from '../policies/actor.js';

/**
 * Official Moroccan Hijri calendar management — SRS Revision 31, §5.7, TD-2,
 * TD-9, TD-15.
 *
 * The platform reproduces exactly the calendar published by the Ministry of
 * Habous and Islamic Affairs. **A Super Admin records the Ministry's official
 * announcements; nobody here decides when a month begins** (Revision 32).
 *
 * This service is the only way rows enter `HijriMonthStart`. **No importer
 * ships** (Revision 32): the Ministry publishes no machine-readable calendar, so
 * an import route could only ever answer *not configured*. Extensibility is
 * preserved by keeping this the single write path and recording provenance on
 * the row — not by an abstract provider interface with no implementation.
 *
 * **Reference/configuration data (Revision 26): Super Admin only.**
 */

const isSuperAdmin = (actor: Actor) => scope.isSuperAdmin(actor.roleScopes);

function assertSuperAdmin(actor: Actor): void {
  if (!isSuperAdmin(actor)) {
    throw new AppError('FORBIDDEN', 'the official Hijri calendar is Super Admin only');
  }
}

/** TD-9 (Revision 31). */
function assertValidCoordinates(year: number, month: number): void {
  if (!Number.isInteger(year) || year < MIN_HIJRI_YEAR || year > MAX_HIJRI_YEAR) {
    throw new AppError('VALIDATION_FAILED', `hijri_year must be ${MIN_HIJRI_YEAR}–${MAX_HIJRI_YEAR}`);
  }
  if (!Number.isInteger(month) || month < 1 || month > MONTHS_IN_YEAR) {
    throw new AppError('VALIDATION_FAILED', 'hijri_month must be 1–12');
  }
}

export interface MonthRow {
  hijriYear: number;
  hijriMonth: number;
  monthNameArabic: string;
  /** `null` for a month not yet recorded — the screen shows all twelve. */
  gregorianStartDate: Date | null;
  status: 'draft' | 'published' | null;
  version: number | null;
  source: string | null;
}

/**
 * The twelve months of one Hijri year, recorded or not.
 *
 * Always twelve rows: the management screen is a year grid, and a month the
 * Ministry has not yet announced is a blank to be filled rather than a row that
 * is missing.
 */
export async function listYear(
  prisma: PrismaClient,
  actor: Actor,
  year: number,
): Promise<MonthRow[]> {
  assertSuperAdmin(actor);
  assertValidCoordinates(year, 1);

  const rows = await prisma.hijriMonthStart.findMany({
    where: { hijriYear: year, deletedAt: null },
  });
  const byMonth = new Map(rows.map((r) => [r.hijriMonth, r]));

  return Array.from({ length: MONTHS_IN_YEAR }, (_, i) => {
    const month = i + 1;
    const row = byMonth.get(month);
    return {
      hijriYear: year,
      hijriMonth: month,
      monthNameArabic: hijriMonthNameArabic(month),
      gregorianStartDate: row?.gregorianStartDate ?? null,
      status: (row?.status as 'draft' | 'published' | undefined) ?? null,
      version: row?.version ?? null,
      source: row?.source ?? null,
    };
  });
}

/**
 * TD-9 (Revision 31): month *n+1* must start after month *n*, and no two months
 * of a year may share a start date — an out-of-order pair makes resolution
 * ambiguous, and resolution is what every Hijri label in the platform depends
 * on.
 *
 * Checked against neighbours only. Comparing against the whole year would be no
 * stronger: if every adjacent pair is ordered, the year is ordered.
 */
async function assertOrdered(
  tx: Prisma.TransactionClient,
  year: number,
  month: number,
  startDate: Date,
): Promise<void> {
  const neighbours = await tx.hijriMonthStart.findMany({
    where: {
      deletedAt: null,
      OR: [
        { hijriYear: year, hijriMonth: { in: [month - 1, month + 1] } },
        // Month 1 and month 12 have neighbours in the adjacent Hijri years.
        ...(month === 1 ? [{ hijriYear: year - 1, hijriMonth: MONTHS_IN_YEAR }] : []),
        ...(month === MONTHS_IN_YEAR ? [{ hijriYear: year + 1, hijriMonth: 1 }] : []),
      ],
    },
  });

  const ordinal = (y: number, m: number) => y * MONTHS_IN_YEAR + m;
  const mine = ordinal(year, month);

  for (const n of neighbours) {
    const theirs = ordinal(n.hijriYear, n.hijriMonth);
    const before = theirs < mine;
    const conflicts = before
      ? startDate.getTime() <= n.gregorianStartDate.getTime()
      : startDate.getTime() >= n.gregorianStartDate.getTime();

    if (conflicts) {
      throw new AppError('VALIDATION_FAILED', 'Hijri months must start in calendar order', {
        reason: 'MONTH_ORDER',
        conflicting_year: n.hijriYear,
        conflicting_month: n.hijriMonth,
        conflicting_start_date: n.gregorianStartDate.toISOString().slice(0, 10),
      });
    }
  }
}

export interface RecordMonthInput {
  year: number;
  month: number;
  gregorianStartDate: Date;
  /** Required for an existing row (TD-15); omitted when creating one. */
  expectedVersion?: number | undefined;
  /**
   * Provenance. `manual` — a Super Admin recording an official announcement —
   * is the only MVP value; an importer would record its own identifier here
   * (§10.1), which is why the column exists rather than an abstraction layer.
   */
  source?: string;
}

/**
 * Records — or corrects — the Ministry's official announcement for one month.
 *
 * **The Super Admin is not deciding when the month begins** (Revision 32). The
 * Ministry of Habous decides, by sighting; this transcribes what it announced.
 * The distinction is not cosmetic: it is why the value is never computed, never
 * defaulted, and never inferred from a neighbouring month.
 *
 * A correction is the interesting event, not the first recording: a wrong start
 * date silently mislabels every date in its month, so the audit row carries
 * **both** the previous and the new value.
 *
 * **This is the single write path** — the extension point a future importer
 * (§10.1) would call, inheriting the ordering rule, the optimistic locking, the
 * draft state and the audit trail rather than reimplementing them.
 */
export async function recordMonthStart(
  prisma: PrismaClient,
  actor: Actor,
  input: RecordMonthInput,
): Promise<HijriMonthStart> {
  assertSuperAdmin(actor);
  assertValidCoordinates(input.year, input.month);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.hijriMonthStart.findFirst({
      where: { hijriYear: input.year, hijriMonth: input.month, deletedAt: null },
    });
    await assertOrdered(tx, input.year, input.month, input.gregorianStartDate);

    let row: HijriMonthStart;
    if (existing) {
      if (input.expectedVersion === undefined) {
        // Without it, a second Super Admin's correction would be overwritten
        // silently — exactly what TD-15 exists to prevent.
        throw new AppError('VALIDATION_FAILED', 'version is required when correcting a month');
      }
      row = await updateWithVersion<HijriMonthStart>({
        delegate: tx.hijriMonthStart,
        id: existing.id,
        expectedVersion: input.expectedVersion,
        requireNotDeleted: true,
        data: {
          gregorianStartDate: input.gregorianStartDate,
          source: input.source ?? existing.source,
          updatedById: actor.userId,
          // A corrected month returns to draft: the change must be reviewed and
          // published deliberately, exactly as a new entry is.
          status: 'draft',
        },
      });
    } else {
      row = await tx.hijriMonthStart.create({
        data: {
          hijriYear: input.year,
          hijriMonth: input.month,
          gregorianStartDate: input.gregorianStartDate,
          source: input.source ?? 'manual',
          updatedById: actor.userId,
        },
      });
    }

    await audit.write(tx, {
      actorUserId: actor.userId,
      actionType: 'hijri.month_start.record',
      targetEntity: 'HijriMonthStart',
      targetId: row.id,
      detail: {
        hijri_year: input.year,
        hijri_month: input.month,
        previous_start_date: existing
          ? existing.gregorianStartDate.toISOString().slice(0, 10)
          : null,
        new_start_date: input.gregorianStartDate.toISOString().slice(0, 10),
        version: row.version,
        source: row.source,
      },
    });
    return row;
  });
}

/**
 * Publishes a year's recorded months (§5.7).
 *
 * Publishing is a separate act from recording because it is what makes a month
 * visible platform-wide: only published rows are rendered, so a year can be
 * entered progressively and reviewed before anyone sees it.
 */
export async function publishYear(
  prisma: PrismaClient,
  actor: Actor,
  year: number,
): Promise<{ published: number }> {
  assertSuperAdmin(actor);
  assertValidCoordinates(year, 1);

  return prisma.$transaction(async (tx) => {
    const drafts = await tx.hijriMonthStart.findMany({
      where: { hijriYear: year, status: 'draft', deletedAt: null },
      select: { id: true },
    });
    if (drafts.length === 0) {
      throw new AppError('STATE_CONFLICT', 'no draft months to publish for this year', {
        reason: 'NOTHING_TO_PUBLISH',
        hijri_year: year,
      });
    }

    await tx.hijriMonthStart.updateMany({
      where: { id: { in: drafts.map((d) => d.id) } },
      data: { status: 'published', updatedById: actor.userId },
    });

    await audit.write(tx, {
      actorUserId: actor.userId,
      actionType: 'hijri.year.publish',
      targetEntity: 'HijriMonthStart',
      detail: { hijri_year: year, months_published: drafts.length },
    });
    return { published: drafts.length };
  });
}

export interface HistoryEntry {
  at: Date;
  actorUserId: string | null;
  actionType: string;
  detail: unknown;
}

/**
 * The audit trail for one Hijri year (§5.7 *View history*).
 *
 * TD-8's `AuditLog` is the history: it is append-only and already records both
 * the previous and new start date on every change, so a second history table
 * would duplicate it and could drift from it.
 */
export async function yearHistory(
  prisma: PrismaClient,
  actor: Actor,
  year: number,
): Promise<HistoryEntry[]> {
  assertSuperAdmin(actor);
  assertValidCoordinates(year, 1);

  const rows = await prisma.auditLog.findMany({
    where: {
      targetEntity: 'HijriMonthStart',
      actionType: { in: ['hijri.month_start.record', 'hijri.year.publish'] },
      detail: { path: ['hijri_year'], equals: year },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  return rows.map((r) => ({
    at: r.createdAt,
    actorUserId: r.actorUserId,
    actionType: r.actionType,
    detail: r.detail,
  }));
}
