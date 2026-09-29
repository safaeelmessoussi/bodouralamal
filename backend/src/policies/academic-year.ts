import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * **R178 §6(a) (Owner, 2026-09-29) — the academic year a dated item belongs to
 * is DERIVED from its date, never asked.** A year carries no dates of its own;
 * its periods do (R122, «الفترات الدراسية»), so the year is the one whose
 * period covers the date. Where no period does — the periods not entered yet,
 * or a date in a gap — the current year answers (§15.1's `is_current`), and
 * where there is no current year either, the item is refused in words rather
 * than filed under a guess. The caller's explicit `academic_year_id`, when it
 * still sends one, wins: an older client or a deliberate choice is not
 * second-guessed here.
 */
export async function academicYearForDate(db: Db, date: Date): Promise<string> {
  const period = await db.academicPeriod.findFirst({
    where: { startDate: { lte: date }, endDate: { gte: date }, academicYear: { deletedAt: null } },
    select: { academicYearId: true },
    orderBy: { startDate: 'desc' },
  });
  if (period) return period.academicYearId;
  const current = await db.academicYear.findFirst({
    where: { isCurrent: true, deletedAt: null },
    select: { id: true },
  });
  if (current) return current.id;
  throw new AppError('VALIDATION_FAILED', 'no academic year covers this date and none is current', {
    reason: 'NO_ACADEMIC_YEAR_FOR_DATE',
  });
}
