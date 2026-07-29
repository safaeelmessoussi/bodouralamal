import type { ReactNode } from 'react';

import type { GregorianMonthRef, HijriMonthRef } from '../../adapters/calendar.js';

/**
 * The dual-calendar title: **Gregorian on the right, Hijri on the left**, with a
 * hairline rule between them.
 *
 *     يوليوز 2026 │ محرم 1448
 *     يوليوز 2026 │ ذو الحجة / محرم 1448      ← the month spans two Hijri months
 *
 * **The client performs no month arithmetic and no Hijri computation.** Both
 * sides render lists the backend already assembled — `gregorian_months` and
 * `hijri.months` from the bootstrap — in the order it encountered them. One
 * entry renders one name, two render both joined by a slash. That is the whole
 * rule, and it is why a Gregorian month straddling two Hijri months needs no
 * special case here (§20 rule 14; Revisions 31, 36).
 *
 * **Colour carries meaning, not decoration**: each side takes its own date
 * system's colour, which is the same pairing the day cells use — so the eye
 * learns "orange is Gregorian, green is Hijri" once and reads both surfaces.
 * The values are the *readable* variants of the logo colours; the raw logo
 * values fail contrast as small text (see `tokens/primitives.css`).
 *
 * When no Hijri month in view has been recorded and published, **the Hijri side
 * and its separator are omitted entirely** rather than rendered empty. An empty
 * slot would assert that a value exists and is blank; absence is the honest
 * statement that the Ministry has not announced it yet (Revision 31).
 */
export function CalendarTitle({
  gregorianMonths,
  hijriMonths,
}: {
  gregorianMonths: GregorianMonthRef[];
  hijriMonths: HijriMonthRef[];
}): ReactNode {
  const gregorian = formatGregorian(gregorianMonths);
  const hijri = formatHijri(hijriMonths);
  if (!gregorian && !hijri) return null;

  return (
    <p className="cal-title">
      {gregorian ? <span className="cal-title__gregorian">{gregorian}</span> : null}
      {gregorian && hijri ? (
        <span className="cal-title__divider" aria-hidden="true" />
      ) : null}
      {hijri ? <span className="cal-title__hijri">{hijri}</span> : null}
    </p>
  );
}

/**
 * `يوليوز 2026`, or `يوليوز / غشت 2026` across a year-end boundary as
 * `دجنبر 2026 / يناير 2027`.
 *
 * The year is printed once when both months share it and twice when they do not
 * — repeating an identical year is noise, and omitting a differing one is wrong.
 */
function formatGregorian(months: GregorianMonthRef[]): string {
  if (months.length === 0) return '';
  const years = new Set(months.map((month) => month.year));
  if (years.size === 1) {
    const names = months.map((month) => month.month_ar).join(' / ');
    return `${names} ${months[0]?.year ?? ''}`.trim();
  }
  return months.map((month) => `${month.month_ar} ${month.year}`).join(' / ');
}

/** The same rule for the Hijri side, over the months the backend resolved. */
function formatHijri(months: HijriMonthRef[]): string {
  if (months.length === 0) return '';
  const years = new Set(months.map((month) => month.hijri_year));
  if (years.size === 1) {
    const names = months.map((month) => month.hijri_month_ar).join(' / ');
    return `${names} ${months[0]?.hijri_year ?? ''}`.trim();
  }
  return months.map((month) => `${month.hijri_month_ar} ${month.hijri_year}`).join(' / ');
}
