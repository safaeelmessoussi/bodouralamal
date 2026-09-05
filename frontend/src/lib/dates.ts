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

/** Same convention as `addMonths` — the 1st of the resulting month, never the
 *  caller's day-of-month, since the callers that need this (year/decade
 *  paging) only ever care which year they land on. */
export function addYears(date: Date, delta: number): Date {
  return new Date(date.getFullYear() + delta, date.getMonth(), 1);
}

export function isSameDay(a: Date, b: Date): boolean {
  return toIsoDate(a) === toIsoDate(b);
}

/** Calendar-day arithmetic — `Date`'s own constructor already rolls month/year
 *  boundaries over correctly (day 0 of the next month is the last of this one
 *  in reverse), so this needs no month-length table of its own. */
export function addDays(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + delta);
}

/**
 * A month/year step that keeps a real calendar date — never `addMonths`'/
 * `addYears`' "the 1st", and never a silent rollover.
 *
 * `new Date(2026, 3, 31)` for "31 May, one month back" is NOT the 31st of
 * April — April has 30 days, so the constructor rolls it into the 1st of May,
 * and PageUp on 31 May would silently do nothing. The day is clamped to
 * whatever the TARGET month actually has, which is what a person pressing
 * PageUp from the last day of a long month expects: the last day of the
 * shorter one next to it.
 */
export function addMonthsClamped(date: Date, delta: number): Date {
  const targetStart = addMonths(date, delta);
  const lastDay = endOfMonth(targetStart).getDate();
  return new Date(targetStart.getFullYear(), targetStart.getMonth(), Math.min(date.getDate(), lastDay));
}

/** The same clamp, one year at a time — 29 February on a leap year, one year
 *  later, is 28 February rather than 1 March. */
export function addYearsClamped(date: Date, delta: number): Date {
  const targetYear = date.getFullYear() + delta;
  const lastDay = endOfMonth(new Date(targetYear, date.getMonth(), 1)).getDate();
  return new Date(targetYear, date.getMonth(), Math.min(date.getDate(), lastDay));
}

/** The Monday that starts `date`'s week — `leadingBlanks` needs no month
 *  context to answer this; it only ever reads `date.getDay()`. */
export function startOfWeek(date: Date): Date {
  return addDays(date, -leadingBlanks(date));
}

/**
 * `YYYY-MM-DD` → a LOCAL `Date`, or `null` for anything else.
 *
 * **Local, not UTC** — unlike `frontend/src/lib/birth-date.ts`'s
 * `isRealPastDate`, which compares two UTC instants and has no reason to
 * prefer one zone over another. This drives which GRID CELL a stored value
 * lands in, and every other date here (`toIsoDate`, `monthGrid`) is local for
 * the identical reason: a UTC round-trip near local midnight lands on the
 * wrong day.
 *
 * **Rejects a calendar impossibility rather than rolling it over** —
 * `new Date(2026, 1, 30)` is silently March the 2nd, which would show the
 * picker's own recorded value in the wrong cell. `isRealPastDate` guards the
 * same failure for validation; this guards it for display, because the two
 * call sites need the check at different times and neither should have to
 * remember the other exists.
 */
export function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
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
