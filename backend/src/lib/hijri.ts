/**
 * Hijri overlay — §4.4, §5.7, §16.1 (`/lib … hijri`), TD-9.
 *
 * §4.4 is explicit that this is **decorative**: every schedule, recurrence and
 * comparison in the system is Gregorian on Moroccan wall-clock time (TD-11).
 * Nothing here participates in scheduling arithmetic — it renders a second
 * label beside a date that has already been decided.
 *
 * **On "Morocco-tuned" (§4.4).** Morocco's Ministry of Habous fixes each Hijri
 * month by **local moon sighting**, so it regularly differs from Umm al-Qura
 * and from generic library algorithms — the SRS says exactly this, and answers
 * it with the **admin day-offset (−2…+2)**. This module therefore computes an
 * algorithmic base and applies that offset:
 *
 *   - the base is ICU's `islamic-umalqura`, the closest widely-available
 *     algorithmic approximation, isolated in `baseHijri` below;
 *   - the offset is the tuning knob §4.4 mandates, and shifts the result by
 *     whole days.
 *
 * A genuinely Morocco-tuned base would be a table of observed month starts
 * published by the Ministry. `baseHijri` is the single seam where such a table
 * would replace the algorithm, and no caller would change.
 */

/** Hijri month names, ar. Fixed here rather than taken from ICU locale data so
 *  the rendered string is deterministic across platforms and testable. */
const MONTH_NAMES_AR = [
  'محرم',
  'صفر',
  'ربيع الأول',
  'ربيع الآخر',
  'جمادى الأولى',
  'جمادى الآخرة',
  'رجب',
  'شعبان',
  'رمضان',
  'شوال',
  'ذو القعدة',
  'ذو الحجة',
] as const;

export interface HijriDate {
  year: number;
  /** 1–12. */
  month: number;
  day: number;
  /** Arabic month name, for the `DualDateDisplay` overlay (§14.3). */
  monthNameArabic: string;
  /** `1447-09-01` — the numeric form, zero-padded. */
  iso: string;
}

/** TD-9: `SystemSetting` Hijri offset: `-2 <= value <= 2`. */
export const MIN_OFFSET = -2;
export const MAX_OFFSET = 2;

const MS_PER_DAY = 86_400_000;

const formatter = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});

/**
 * The algorithmic base, before any Morocco tuning. The one seam a real
 * Ministry-of-Habous month-start table would replace.
 */
function baseHijri(gregorian: Date): { year: number; month: number; day: number } {
  const parts = formatter.formatToParts(gregorian);
  const part = (type: string): number => {
    const found = parts.find((p) => p.type === type);
    if (!found) throw new Error(`hijri: ICU returned no ${type} part`);
    // The year arrives as "1447" and, in some ICU builds, with an era suffix.
    return Number.parseInt(found.value, 10);
  };
  return { year: part('year'), month: part('month'), day: part('day') };
}

/**
 * Converts a Gregorian calendar date to its Hijri overlay.
 *
 * `dayOffset` is applied by shifting the **Gregorian** input, which is what
 * makes the arithmetic correct across month and year boundaries: an offset of
 * −1 on the first of a Hijri month must land on the last day of the previous
 * one, whose length differs from month to month. Shifting the Hijri day number
 * directly would have to know that length; shifting the input does not.
 *
 * Out-of-range and non-finite offsets are **clamped**, not rejected: this feeds
 * the public calendar, and a bad settings row must not take a decorative label
 * down with it. TD-9's range is enforced where the setting is *written*.
 */
export function toHijri(gregorian: Date, dayOffset = 0): HijriDate {
  const offset = Number.isFinite(dayOffset)
    ? Math.min(MAX_OFFSET, Math.max(MIN_OFFSET, Math.trunc(dayOffset)))
    : 0;

  const shifted = new Date(gregorian.getTime() + offset * MS_PER_DAY);
  const { year, month, day } = baseHijri(shifted);

  return {
    year,
    month,
    day,
    monthNameArabic: MONTH_NAMES_AR[month - 1] ?? '',
    iso: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  };
}
