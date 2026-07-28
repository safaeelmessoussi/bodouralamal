-- SRS Revision 31, TD-9 — range constraints for the official Hijri calendar.
--
-- Hand-written (TD-6a): Prisma has no CHECK constraints, and these belong in
-- the database rather than only in Zod. This table is the sole source of every
-- Hijri value the platform displays, and a wrong row silently mislabels every
-- date in its month — so the invariant is enforced where the data lives, not
-- only where it happens to enter.

ALTER TABLE "hijri_month_start"
  ADD CONSTRAINT "hijri_month_start_month_check"
  CHECK ("hijri_month" BETWEEN 1 AND 12);

-- A range that comfortably brackets any date this platform will ever render,
-- while rejecting a Gregorian year typed into the Hijri field — the single most
-- likely data-entry slip on this screen.
ALTER TABLE "hijri_month_start"
  ADD CONSTRAINT "hijri_month_start_year_check"
  CHECK ("hijri_year" BETWEEN 1300 AND 1600);
