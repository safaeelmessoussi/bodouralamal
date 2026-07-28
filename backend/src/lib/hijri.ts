/**
 * Hijri overlay — SRS Revision 31, §4.4, §5.7, §16.1 (`/lib … hijri`), TD-9.
 *
 * §4.4 is explicit that this is **decorative**: every schedule, recurrence and
 * comparison in the system is Gregorian on Moroccan wall-clock time (TD-11).
 * Nothing here participates in scheduling arithmetic — it renders a second
 * label beside a date that has already been decided.
 *
 * **Revisions 31–32: the Ministry's official announcements are the source of
 * truth.** The Ministry of Habous fixes each month by local moon sighting, so it
 * regularly differs from Umm al-Qura and from every library algorithm — and it
 * differs by a margin that varies month to month, which is why the former global
 * ±2-day offset was removed rather than retuned. Values come from the
 * announcements **recorded** in `HijriMonthStart` — a Super Admin transcribes
 * them and does not decide them — and **nothing here computes a Hijri date
 * astronomically**. `baseHijri` is the single seam every consumer goes through.
 *
 * **A month that is not recorded and published has no overlay.** The honest
 * answer to "what is the official Hijri date" for a month the Ministry has not
 * yet announced is silence, not a guess — fabricating one would defeat the
 * purpose of these revisions. Callers receive `null` and render the Gregorian
 * date alone (§14.3 `DualDateDisplay`).
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

export const MONTHS_IN_YEAR = 12;

/** TD-9 (Revision 31): the range a Hijri year must fall in. */
export const MIN_HIJRI_YEAR = 1300;
export const MAX_HIJRI_YEAR = 1600;

export function hijriMonthNameArabic(month: number): string {
  return MONTH_NAMES_AR[month - 1] ?? '';
}

/**
 * One recorded official month start. Deliberately a plain shape rather than the
 * Prisma row: this module is pure, and the caller decides what to load.
 */
export interface MonthStart {
  hijriYear: number;
  hijriMonth: number;
  /** The Gregorian date the month officially began, at UTC midnight. */
  gregorianStartDate: Date;
}

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

const MS_PER_DAY = 86_400_000;

/** Every Hijri month reaches 29 days; the 30th depends on the next sighting. */
const CERTAIN_MONTH_LENGTH = 29;

/** Whether `next` is the month immediately after `current` in the Hijri year. */
function isConsecutive(current: MonthStart, next: MonthStart | undefined): boolean {
  if (!next) return false;
  if (current.hijriMonth === MONTHS_IN_YEAR) {
    return next.hijriYear === current.hijriYear + 1 && next.hijriMonth === 1;
  }
  return next.hijriYear === current.hijriYear && next.hijriMonth === current.hijriMonth + 1;
}

/** Whole days between two dates, both taken at UTC midnight. */
function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/**
 * **The single implementation seam** (Revision 31). Every Hijri value in the
 * platform resolves through here, and here reads recorded official data only.
 *
 * `starts` must be the **published** month starts, sorted ascending by
 * `gregorianStartDate`. Resolution walks back to the latest month that began on
 * or before `gregorian`, then counts days.
 *
 * Returns `null` when the date falls outside recorded data in either direction:
 * before the earliest recorded month, or on or after the day the *next*
 * unrecorded month would begin. The second case is the subtle one — knowing
 * when a month started tells you nothing about when it ends, because that
 * depends on the *next* sighting. A month is therefore only safe to resolve
 * while the following month is also recorded, or while the date is within the
 * 29-day floor every Hijri month is guaranteed to reach.
 */
export function baseHijri(gregorian: Date, starts: readonly MonthStart[]): HijriDate | null {
  let index = -1;
  for (let i = 0; i < starts.length; i += 1) {
    if (starts[i]!.gregorianStartDate.getTime() <= gregorian.getTime()) index = i;
    else break;
  }
  if (index === -1) return null;

  const current = starts[index]!;
  const offsetDays = daysBetween(current.gregorianStartDate, gregorian);

  // Days 1–29 are certain: every Hijri month reaches 29 days. **Day 30 is only
  // certain when the next CONSECUTIVE month is recorded**, because that start is
  // what proves the month ran 30 days rather than 29.
  //
  // Requiring consecutiveness — not merely "some later month exists" — is what
  // makes a gap in the data safe. With Muharram and Rabi al-Awwal recorded but
  // Safar missing, a date 29 days into Muharram would otherwise be labelled
  // 30 Muharram when it may well be 1 Safar, and one 33 days in would resolve as
  // "day 34" of a month that has no such day.
  const next = starts[index + 1];
  if (offsetDays >= CERTAIN_MONTH_LENGTH && !isConsecutive(current, next)) return null;

  const day = offsetDays + 1;
  return {
    year: current.hijriYear,
    month: current.hijriMonth,
    day,
    monthNameArabic: hijriMonthNameArabic(current.hijriMonth),
    iso: `${current.hijriYear}-${String(current.hijriMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  };
}

/**
 * Sorts month starts into the order `baseHijri` expects. Callers that load rows
 * from the database in another order pass them through here rather than
 * re-implementing the comparison.
 */
export function sortMonthStarts(starts: readonly MonthStart[]): MonthStart[] {
  return [...starts].sort((a, b) => a.gregorianStartDate.getTime() - b.gregorianStartDate.getTime());
}
