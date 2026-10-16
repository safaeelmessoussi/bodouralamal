/**
 * **Apply every live عطلة to the classes it covers** (the Owner, 2026-10-16 —
 * SRS Revision 223 §1).
 *
 * R199 §5 cancels a holiday's classes when the holiday is created, edited,
 * deleted or restored. Holidays entered before R199 shipped (2026-10-05) were
 * never applied, so their classes still read as scheduled. This runs the SAME
 * rule (`applyHoliday`) over every live holiday, in one transaction: each
 * covered `scheduled` class becomes «عطلة: …», linked to its holiday, and comes
 * back if the holiday is later edited away, deleted or restored. R224 §2 —
 * the activity dates it covers are cancelled too (left off the calendar). A class a
 * person held or cancelled is untouched. Re-running it is harmless: what is
 * already applied stays as it is. One audit row per holiday that changed.
 *
 *   docker compose exec -T -e DRY_RUN=1 api npm run --silent ops:apply-holidays </dev/null
 *   docker compose exec -T api npm run --silent ops:apply-holidays </dev/null
 *
 * `DRY_RUN=1` prints what would change and rolls everything back.
 */
import { loadConfig } from '../lib/config.js';
import { createPrismaClient } from '../lib/prisma.js';
import * as audit from '../repositories/audit.repository.js';
import { applyHoliday } from '../services/holiday-cancellation.service.js';

const dry = process.env['DRY_RUN'] === '1';
const prisma = createPrismaClient(loadConfig().DATABASE_URL, 2);

class Rollback extends Error {}
const day = (d: Date): string => d.toISOString().slice(0, 10);
let cancelled = 0;
let restored = 0;
let activityDates = 0;

try {
  await prisma.$transaction(
    async (tx) => {
      const holidays = await tx.event.findMany({
        where: { deletedAt: null, schedulingType: { structuralKind: 'holiday' } },
        select: { id: true, title: true, startDate: true, endDate: true },
        orderBy: { startDate: 'asc' },
      });
      for (const holiday of holidays) {
        const counts = await applyHoliday(tx, holiday.id);
        cancelled += counts.cancelled;
        restored += counts.restored;
        activityDates += counts.activityDates.cancelled;
        const span = holiday.endDate ? `${day(holiday.startDate)} → ${day(holiday.endDate)}` : day(holiday.startDate);
        console.log(`${dry ? 'would cancel' : 'cancelled'} ${String(counts.cancelled).padStart(4)}  restored ${String(counts.restored).padStart(3)}  activity dates ${String(counts.activityDates.cancelled).padStart(3)}  ${span}  ${holiday.title}`);
        const covered = await tx.session.findMany({
          where: { cancelledByEventId: holiday.id },
          select: { date: true, schedule: { select: { branch: { select: { name: true } } } } },
        });
        const perDay = new Map<string, number>();
        for (const row of covered) {
          const key = `${day(row.date)} ${row.schedule.branch.name}`;
          perDay.set(key, (perDay.get(key) ?? 0) + 1);
        }
        for (const [key, n] of [...perDay].sort()) console.log(`      ${key}: ${String(n)}`);
        if (!dry && (counts.cancelled > 0 || counts.restored > 0 || counts.activityDates.cancelled > 0 || counts.activityDates.released > 0)) {
          await audit.write(tx, {
            actorUserId: null,
            actionType: 'event.holiday_applied',
            targetEntity: 'Event',
            targetId: holiday.id,
            detail: {
              holiday_cancelled_sessions: counts.cancelled,
              holiday_restored_sessions: counts.restored,
              holiday_cancelled_activity_dates: counts.activityDates.cancelled,
              reason: 'R199 §5 applied to a holiday entered before it shipped (SRS R223 §1)',
            },
          });
        }
      }
      if (dry) throw new Rollback();
    },
    { timeout: 120_000 },
  );
} catch (error) {
  if (!(error instanceof Rollback)) throw error;
}

console.log(`${dry ? 'DRY RUN — nothing saved. ' : ''}classes cancelled: ${String(cancelled)}, restored: ${String(restored)}; activity dates cancelled: ${String(activityDates)}`);
await prisma.$disconnect();
