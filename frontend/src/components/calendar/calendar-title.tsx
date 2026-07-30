import type { ReactNode } from 'react';

import type { GregorianMonthRef, HijriMonthRef } from '../../adapters/calendar.js';
import { t, tList } from '../../i18n/index.js';

/**
 * The dual-calendar title: **Gregorian on the right, Hijri on the left**, with a
 * hairline rule between them. It is the one place the displayed month is named.
 *
 *     يوليوز 2026 │ محرم 1448
 *     يوليوز 2026 │ ذو الحجة / محرم 1448      ← the month spans two Hijri months
 *
 * **The client performs no Hijri computation and no month arithmetic.** Both
 * sides render lists the backend already assembled — `gregorian_months` and
 * `hijri.months` from the bootstrap — in the order it encountered them. One
 * entry renders one name, two render both joined by a slash. That is the whole
 * rule, and it is why a Gregorian month straddling two Hijri months needs no
 * special case here (§20 rule 14; Revisions 31, 36).
 *
 * **Colour carries meaning, not decoration**: each side takes its own date
 * system's colour, the same pairing the day cells use — so the eye learns
 * "orange is Gregorian, green is Hijri" once and reads both surfaces. The tokens
 * are the *readable* variants; the raw logo colours fail contrast as text (see
 * `tokens/primitives.css`).
 *
 * **The two sides fail differently, on purpose.**
 *
 * The Hijri side has **no fallback**: when no month in view has been recorded and
 * published, it and its separator are omitted entirely rather than rendered
 * empty. An empty slot would assert that a value exists and is blank; absence is
 * the honest statement that the Ministry has not announced it (Revision 31).
 *
 * The Gregorian side **falls back to `month`**, the date the page is already
 * displaying. This is deliberately not symmetrical: the month being viewed is
 * *client state*, so a failed reference fetch must not cost the page its own
 * heading — and a Gregorian month name is not a Hijri computation. It reads from
 * the same i18n list the dialogs use, so there is still one source for the names.
 */
export function CalendarTitle({
  gregorianMonths,
  hijriMonths,
  month,
}: {
  gregorianMonths: GregorianMonthRef[];
  hijriMonths: HijriMonthRef[];
  /** The month on screen — the fallback source for the Gregorian side only. */
  month: Date;
}): ReactNode {
  const gregorian = formatGregorian(gregorianMonths) || fallbackGregorian(month);
  const hijri = formatHijri(hijriMonths);

  return (
    // `aria-live` lives here rather than on a control: this is the element that
    // names the month, so a keyboard user stepping through months hears where
    // they landed. The removed month selector used to carry this, and losing it
    // would have made navigation silent.
    <p className="cal-title" aria-live="polite">
      <span className="cal-title__gregorian">{gregorian}</span>
      {hijri ? (
        <>
          <span className="cal-title__divider" aria-hidden="true" />
          <span className="cal-title__hijri">{hijri}</span>
        </>
      ) : null}
    </p>
  );
}

/**
 * `يوليوز 2026`, or `يوليوز / غشت 2026` when the range spans two months of one
 * year, or `دجنبر 2026 / يناير 2027` across a year boundary.
 *
 * The year prints once when both months share it and twice when they do not —
 * repeating an identical year is noise, and omitting a differing one is wrong.
 */
function formatGregorian(months: GregorianMonthRef[]): string {
  if (months.length === 0) return '';
  const years = new Set(months.map((m) => m.year));
  if (years.size === 1) {
    return `${months.map((m) => m.month_ar).join(' / ')} ${months[0]?.year ?? ''}`.trim();
  }
  return months.map((m) => `${m.month_ar} ${m.year}`).join(' / ');
}

/** The same rule for the Hijri side, over the months the backend resolved. */
function formatHijri(months: HijriMonthRef[]): string {
  if (months.length === 0) return '';
  const years = new Set(months.map((m) => m.hijri_year));
  if (years.size === 1) {
    return `${months.map((m) => m.hijri_month_ar).join(' / ')} ${months[0]?.hijri_year ?? ''}`.trim();
  }
  return months.map((m) => `${m.hijri_month_ar} ${m.hijri_year}`).join(' / ');
}

/** Gregorian only, from the month the page is displaying (see the note above). */
function fallbackGregorian(month: Date): string {
  const names = tList('calendar.months');
  return `${names[month.getMonth()] ?? t('calendar.monthLabel')} ${month.getFullYear()}`;
}
