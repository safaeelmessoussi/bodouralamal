import type { HijriMonthStart, Prisma, PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { MAX_HIJRI_YEAR, MIN_HIJRI_YEAR, MONTHS_IN_YEAR, hijriMonthNameArabic } from '../lib/hijri.js';
import { ummAlQuraMonthStarts } from '../lib/umm-al-qura.js';
import * as scope from '../policies/branch-scope.js';
import * as audit from '../repositories/audit.repository.js';
import { updateWithVersion } from '../repositories/optimistic-lock.js';
import * as trash from '../repositories/trash.repository.js';
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
 * **How far the official calendar actually reaches, and when it runs out.**
 *
 * The Revision 32 decision not to ship an importer is correct and is not
 * revisited here: Morocco's months are declared by the Ministry of Habous on
 * **actual moon sighting**, announced the evening before, and every computable
 * calendar — Umm al-Qura, tabular, astronomical conjunction — diverges from
 * those announcements unpredictably. Automating would produce a calendar that is
 * *confidently wrong* against the official one, which breaks the constraint
 * rather than serving it.
 *
 * **But the manual process has an operational failure mode, and this is it.**
 * When the recorded months run out, `baseHijri` correctly returns `null` and
 * every date renders Gregorian-only. Nothing is *wrong* — and nothing says the
 * overlay has stopped. The calendar degrades in silence, which is the one thing
 * a manually-maintained dataset must never do.
 *
 * So the coverage is computed and surfaced on the screen that exists to maintain
 * it. **This adds no route** (§20 rule 16) and **computes no Hijri date**: it
 * reports only what has been recorded and how many days of runway remain, which
 * is arithmetic on Gregorian dates the Ministry itself supplied.
 *
 * **Only PUBLISHED months count.** A draft is a transcription in progress, and
 * §5.7 already says only published months render anywhere — counting drafts here
 * would report runway the platform will not actually use.
 */
export interface HijriCoverage {
  /** The last published month start, or `null` when nothing is published. */
  publishedThroughStart: Date | null;
  /**
   * Days from `today` until the last published month reaches its guaranteed
   * 29-day floor. **Negative means the overlay has already gone dark.**
   *
   * The floor, not 30: day 30 only resolves when the *next consecutive* month is
   * recorded (see `baseHijri`), so 29 is the honest runway of the last published
   * month rather than an optimistic one.
   */
  daysRemaining: number | null;
  /** The first Hijri (year, month) after the published run — what to record next. */
  nextUnrecorded: { hijriYear: number; hijriMonth: number; monthNameArabic: string } | null;
}

/** Below this, the maintenance screen should be shouting. One month of warning. */
export const COVERAGE_WARNING_DAYS = 30;

const CERTAIN_MONTH_LENGTH = 29;

export async function coverage(
  prisma: PrismaClient,
  actor: Actor,
  today: Date = new Date(),
): Promise<HijriCoverage> {
  assertSuperAdmin(actor);

  const last = await prisma.hijriMonthStart.findFirst({
    where: { deletedAt: null, status: 'published' },
    orderBy: [{ hijriYear: 'desc' }, { hijriMonth: 'desc' }],
    select: { hijriYear: true, hijriMonth: true, gregorianStartDate: true },
  });
  if (!last) {
    return { publishedThroughStart: null, daysRemaining: null, nextUnrecorded: null };
  }

  const floorMs =
    last.gregorianStartDate.getTime() + CERTAIN_MONTH_LENGTH * 24 * 60 * 60 * 1000;
  const daysRemaining = Math.floor((floorMs - today.getTime()) / (24 * 60 * 60 * 1000));

  const nextMonth = last.hijriMonth === MONTHS_IN_YEAR ? 1 : last.hijriMonth + 1;
  const nextYear = last.hijriMonth === MONTHS_IN_YEAR ? last.hijriYear + 1 : last.hijriYear;

  return {
    publishedThroughStart: last.gregorianStartDate,
    daysRemaining,
    nextUnrecorded:
      nextYear > MAX_HIJRI_YEAR
        ? null
        : {
            hijriYear: nextYear,
            hijriMonth: nextMonth,
            monthNameArabic: hijriMonthNameArabic(nextMonth),
          },
  };
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
      activeRole: actor.activeRole,
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
/**
 * **The provenance an imported row carries.** A stored value that reads
 * `manual` was typed or corrected by a Super Admin; one that reads this was
 * derived and has not been touched since.
 */
export const UMM_AL_QURA_SOURCE = 'umm_al_qura_icu';

export interface ImportResult {
  imported: number;
  /** Months already present — left exactly as they were. */
  skipped: number;
  source: string;
}

/**
 * **Prefills a year from the Umm al-Qura baseline** (Owner, 2026-08-30).
 *
 * ## Insert-only, and that is the whole rule
 *
 * The Owner's constraint is that a Super Admin's correction must survive every
 * later import. This does not implement that as a comparison, a flag or a
 * "don't overwrite if edited" branch — **it never updates at all.** A month
 * that has a row is skipped, whatever that row says and whoever wrote it.
 *
 * That is stronger than a rule about *corrected* rows, and it is stronger on
 * purpose: any test of «has a human touched this?» is a test that can be got
 * wrong, and getting it wrong means silently replacing an official Moroccan
 * date with a computed Saudi one. Skipping every existing row cannot fail that
 * way. Re-running the import is therefore idempotent and safe by construction.
 *
 * ## Why the rows land as `draft`
 *
 * Umm al-Qura is **calculated**; Morocco announces by **sighting**, and the two
 * differ by a day with some regularity. `draft` is what §7 already means by
 * *"a year can be entered progressively and reviewed before it becomes
 * visible"* — so nothing derived is displayed to anybody until a Super Admin
 * has looked at it and published the year.
 *
 * ## The database stays authoritative
 *
 * This runs when a Super Admin asks it to. No read path consults the baseline,
 * and after the insert the row is an ordinary row: corrected through
 * `recordMonthStart` under TD-15, audited, publishable. The external calendar
 * is a starting point that is never consulted again.
 *
 * ## Ordering
 *
 * `assertOrdered` — the invariant that a month cannot begin before its
 * predecessor — is applied per row, so an import that would violate it against
 * *already stored* neighbours refuses that month rather than corrupting the
 * sequence. The rest of the year still imports; the refusal is reported as a
 * skip rather than failing the whole request, because one disputed boundary
 * must not block eleven uncontested months.
 */
export async function importYearFromUmmAlQura(
  prisma: PrismaClient,
  actor: Actor,
  year: number,
): Promise<ImportResult> {
  assertSuperAdmin(actor);
  assertValidCoordinates(year, 1);

  const derived = ummAlQuraMonthStarts(year, year);

  /**
   * **One transaction for the year, not one per month.**
   *
   * The first version opened a transaction per month so that an ordering
   * refusal on one boundary left the rest in place. It did leave them in
   * place — and twelve short transactions per call, run beside the rest of the
   * integration sweep, contended hard enough on this table to time out an
   * unrelated suite's `beforeAll`. The refusal is preserved by *deciding* per
   * month inside a single transaction rather than by *isolating* per month.
   */
  const { imported, skipped } = await prisma.$transaction(async (tx) => {
    const present = new Set(
      (
        await tx.hijriMonthStart.findMany({
          where: { hijriYear: year, deletedAt: null },
          select: { hijriMonth: true },
        })
      ).map((r) => r.hijriMonth),
    );

    const toInsert: typeof derived = [];
    for (const month of derived) {
      // **The Owner's rule, in one line.** Present means untouched by this —
      // whatever the row says and whoever wrote it.
      if (present.has(month.hijriMonth)) continue;
      try {
        await assertOrdered(tx, month.hijriYear, month.hijriMonth, month.gregorianStartDate);
      } catch {
        // A derived date that would sit out of sequence against an already
        // stored neighbour is skipped, not forced — and the other eleven
        // months still import.
        continue;
      }
      toInsert.push(month);
    }

    if (toInsert.length > 0) {
      await tx.hijriMonthStart.createMany({
        data: toInsert.map((m) => ({
          hijriYear: m.hijriYear,
          hijriMonth: m.hijriMonth,
          gregorianStartDate: m.gregorianStartDate,
          // Provenance per value (§7's `source` column, which exists for this).
          source: UMM_AL_QURA_SOURCE,
          updatedById: actor.userId,
        })),
        // The unique index on (hijri_year, hijri_month) is the real guarantee
        // that a concurrent import cannot double-write a month.
        skipDuplicates: true,
      });
    }
    return { imported: toInsert.length, skipped: derived.length - toInsert.length };
  });

  // TD-8 — one row for the act, not twelve. What matters later is *who ran the
  // import, for which year, and how much of it was already answered*.
  await audit.write(prisma, {
    actorUserId: actor.userId,
    activeRole: actor.activeRole,
    actionType: 'settings.change',
    targetEntity: 'HijriMonthStart',
    // **No `targetId`.** This act is about a YEAR — twelve rows, one decision —
    // and `target_id` is a uuid column, so the year travels in the detail
    // exactly as `hijri.year.publish` already carries it.
    detail: { hijri_import: { year, imported, skipped, source: UMM_AL_QURA_SOURCE } },
  });

  return { imported, skipped, source: UMM_AL_QURA_SOURCE };
}

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
      activeRole: actor.activeRole,
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

/**
 * **Withdraws a recorded month** (SRS Revision 59.5).
 *
 * `HijriMonthStart` was the only entity a Super Admin could create through the
 * platform with no deletion at all: the column existed, every read filtered on
 * it, and nothing could ever set it — a month entered by mistake was permanent.
 *
 * ## Only the last recorded month, and that is a domain rule
 *
 * The months are a **contiguous sequence** and §5.7's conversion walks it.
 * Removing one from the middle would leave a span the platform cannot convert,
 * which surfaces to a reader as *missing Ministry data* rather than as the
 * deletion that caused it — the wrong story about the wrong thing. This is
 * `assertOrdered`'s invariant, which the write path already enforces, applied to
 * removal instead of insertion.
 *
 * Publication is deliberately **not** a second obstacle: §5.7 already treats a
 * correction as returning a month to `draft`, so withdrawal is the stronger form
 * of something the specification permits. What is refused is the hole, whether or
 * not anybody could see the month.
 */
export async function deleteMonthStart(
  prisma: PrismaClient,
  actor: Actor,
  year: number,
  month: number,
  expectedVersion: number,
): Promise<void> {
  assertSuperAdmin(actor);
  assertValidCoordinates(year, month);

  await prisma.$transaction(async (tx) => {
    const row = await tx.hijriMonthStart.findFirst({
      where: { hijriYear: year, hijriMonth: month, deletedAt: null },
    });
    if (!row) throw new AppError('NOT_FOUND', 'no such recorded month');

    const ordinal = year * MONTHS_IN_YEAR + month;
    const later = await tx.hijriMonthStart.findFirst({
      where: {
        deletedAt: null,
        OR: [
          { hijriYear: { gt: year } },
          { hijriYear: year, hijriMonth: { gt: month } },
        ],
      },
      orderBy: [{ hijriYear: 'asc' }, { hijriMonth: 'asc' }],
      select: { hijriYear: true, hijriMonth: true },
    });
    if (later) {
      throw new AppError('STATE_CONFLICT', 'a later month is recorded — withdraw that one first', {
        reason: 'LATER_MONTH_RECORDED',
        // Named, so the remedy is the next click rather than a search.
        later_hijri_year: later.hijriYear,
        later_hijri_month: later.hijriMonth,
        ordinal,
      });
    }

    // TD-15 through the shared helper: the same optimistic lock a correction
    // uses, because withdrawing a month somebody else just corrected is the
    // identical hazard.
    await updateWithVersion<HijriMonthStart>({
      delegate: tx.hijriMonthStart,
      id: row.id,
      expectedVersion,
      requireNotDeleted: true,
      data: { deletedAt: new Date(), deletedById: actor.userId },
    });

    await trash.snapshot(tx, {
      targetEntity: 'HijriMonthStart',
      targetId: row.id,
      snapshot: JSON.parse(
        JSON.stringify({
          ...row,
          // A month has no name column; without this the entry is a UUID.
          label: `${hijriMonthNameArabic(month)} ${year}`,
        }),
      ) as object,
      deletedById: actor.userId,
    });

    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'hijri.month_start.delete',
      targetEntity: 'HijriMonthStart',
      targetId: row.id,
      detail: {
        hijri_year: year,
        hijri_month: month,
        start_date: row.gregorianStartDate.toISOString().slice(0, 10),
        status: row.status,
      },
    });
  });
}
