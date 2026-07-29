/**
 * Calendar date helpers.
 *
 * Everything is **local wall-clock** and formatted as `YYYY-MM-DD` (TD-11) —
 * the backend stores `date`/`time` columns, never instants, and a `toISOString()`
 * here would silently shift a day across the timezone boundary the columns exist
 * to avoid.
 *
 * **Weeks start Monday** (BR-17), which is why every index below is rebased.
 */
export const MONDAY_FIRST_DAY_INDEX = 1;

/** `YYYY-MM-DD` from local parts — never via `toISOString`. */
export function toIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

export function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

export function isSameDay(a: Date, b: Date): boolean {
  return toIsoDate(a) === toIsoDate(b);
}

/** How many blank cells precede the 1st, with Monday as column one (BR-17). */
export function leadingBlanks(monthStart: Date): number {
  return (monthStart.getDay() - MONDAY_FIRST_DAY_INDEX + 7) % 7;
}

/**
 * The full grid for a month: leading blanks, the month's days, then trailing
 * blanks so the last week is complete. Returning `null` for padding — rather
 * than dates from the neighbouring months — keeps "is this cell in the month"
 * out of every consumer.
 */
export function monthGrid(monthStart: Date): (Date | null)[] {
  const days = endOfMonth(monthStart).getDate();
  const cells: (Date | null)[] = Array.from({ length: leadingBlanks(monthStart) }, () => null);
  for (let day = 1; day <= days; day += 1) {
    cells.push(new Date(monthStart.getFullYear(), monthStart.getMonth(), day));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}
