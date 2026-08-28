/**
 * **Umm al-Qura month starts, computed locally from ICU** (Owner, 2026-08-30).
 *
 * ## What this is for, and what it is emphatically not
 *
 * Revision 31 makes `HijriMonthStart` **the sole source of every Hijri value
 * the platform displays**, recording what the Ministry of Habous and Islamic
 * Affairs announced by sighting. Nothing here changes that. This module exists
 * only to give a Super Admin a **starting point to correct**, instead of
 * twelve dates a year typed from nothing.
 *
 * So:
 *
 * * it is a **reference baseline**, never an authority. Once a value is in the
 *   table, the table answers — see `importMonthStarts`, which inserts and never
 *   updates;
 * * it is **not consulted at runtime**. No read path calls this. A displayed
 *   Hijri date comes from the database or does not exist;
 * * Umm al-Qura is a **calculated Saudi civil calendar**, and Morocco announces
 *   by **sighting**. The two disagree by a day with some regularity, which is
 *   precisely why the imported rows land as `draft` for review rather than
 *   `published`.
 *
 * ## Why ICU rather than an embedded table
 *
 * The alternative was a JSON file of month starts. ICU ships the Umm al-Qura
 * tables already — the same data a JSON copy would have been transcribed from —
 * and using them means **no network call at any time**, nothing to re-transcribe
 * when the range is extended, and no second copy to drift. Node is built with
 * full ICU here (`Intl.DateTimeFormat` resolves `islamic-umalqura`), and
 * `assertUmmAlQuraAvailable` fails loudly rather than silently falling back to
 * a different Islamic calendar, which would put dates a day or two out with
 * nothing to show for it.
 *
 * ICU's Umm al-Qura data covers roughly 1300–1600 AH; outside that ICU
 * extrapolates, which is one more reason the values are a draft.
 */

const CALENDAR = 'islamic-umalqura';

/** A Hijri month and the Gregorian date it began on. */
export interface UmmAlQuraMonth {
  hijriYear: number;
  hijriMonth: number;
  /** UTC midnight, matching the `@db.Date` column (TD-11). */
  gregorianStartDate: Date;
}

function formatter(): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(`en-u-ca-${CALENDAR}`, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Refuses rather than approximating. A Node built without full ICU resolves
 * this locale to `gregory` or to the arithmetic `islamic` calendar, and either
 * would produce plausible-looking dates that are simply wrong — the failure
 * mode that is worst here, because nobody would notice until a Ramadan.
 */
export function assertUmmAlQuraAvailable(): void {
  const resolved = formatter().resolvedOptions().calendar;
  if (resolved !== CALENDAR) {
    throw new Error(
      `this Node build has no ${CALENDAR} calendar (resolved '${resolved}'); ` +
        'a full-ICU build is required to derive the Hijri baseline',
    );
  }
}

/** The Hijri (year, month, day) that a Gregorian instant falls on. */
function hijriOf(date: Date): { year: number; month: number; day: number } {
  const parts = Object.fromEntries(
    formatter()
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return {
    year: Number(parts['year']),
    month: Number(parts['month']),
    day: Number(parts['day']),
  };
}

const DAY_MS = 86_400_000;

/**
 * Every month start in `[fromYear, toYear]`, inclusive.
 *
 * **Found by walking days, not by arithmetic.** A Hijri month is 29 or 30 days
 * and Umm al-Qura's pattern is tabular rather than formulaic, so the only
 * honest way to ask ICU where a month begins is to ask it what day each date
 * is and take the ones that answer «the 1st». Walking is cheap — a year is
 * ~354 iterations — and it cannot drift from ICU's own table the way a
 * reimplementation of the tabular rule would.
 */
export function ummAlQuraMonthStarts(fromYear: number, toYear: number): UmmAlQuraMonth[] {
  assertUmmAlQuraAvailable();
  if (!Number.isInteger(fromYear) || !Number.isInteger(toYear) || fromYear > toYear) {
    throw new Error('an ascending pair of Hijri years is required');
  }

  // Start a comfortable margin before the first day of `fromYear` and step
  // forward. The Hijri epoch is 622-07-16 CE and a Hijri year is ~354.367 days;
  // the margin absorbs the accumulated error of that approximation.
  const approx = new Date(Date.UTC(622, 6, 16) + Math.floor((fromYear - 1) * 354.367) * DAY_MS);
  let cursor = new Date(approx.getTime() - 30 * DAY_MS);

  const out: UmmAlQuraMonth[] = [];
  // A bound rather than `while (true)`: a malformed ICU response must end the
  // loop with an error, never spin.
  const maxDays = (toYear - fromYear + 2) * 400;
  for (let i = 0; i < maxDays; i += 1) {
    const h = hijriOf(cursor);
    if (h.day === 1 && h.year >= fromYear && h.year <= toYear) {
      out.push({
        hijriYear: h.year,
        hijriMonth: h.month,
        gregorianStartDate: new Date(
          Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate()),
        ),
      });
    }
    if (h.year > toYear) break;
    cursor = new Date(cursor.getTime() + DAY_MS);
  }
  return out;
}
