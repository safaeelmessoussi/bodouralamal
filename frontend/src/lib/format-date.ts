import { tList } from '../i18n/index.js';

/**
 * A calendar date, written the way the rest of the interface reads it —
 * `١٢ يونيو ٢٠٢٦` rather than `2026-06-12` or the browser's `6/12/2026`.
 *
 * **One implementation, because a date is one concept.** This existed as a
 * private helper inside the content card while every other surface printed the
 * raw ISO string or `slice(0, 10)` of an instant, so the same day read three
 * different ways depending on which screen you were on. It is promoted here
 * rather than copied.
 *
 * **The month names come from the i18n catalogue the calendar already uses**, so
 * the two can never disagree about what to call a month.
 *
 * **This is presentation only.** TD-11 keeps calendar dates as `YYYY-MM-DD`
 * strings on the wire and in the database, and nothing here changes what is
 * stored, sent or parsed — `<time dateTime={iso}>` still carries the machine
 * value for anything that reads the page programmatically.
 */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '';
  // Accepts an instant as well as a date: several surfaces hold `created_at`
  // and were slicing it by hand at the call site.
  const iso = value.slice(0, 10);
  const [year, month, day] = iso.split('-').map(Number);
  const months = tList('calendar.months');
  // A value this cannot parse is returned untouched rather than blanked — an
  // unexpected shape should be visible, not silently erased.
  if (!year || !month || !day) return value;
  return `${toArabicDigits(day)} ${months[month - 1] ?? ''} ${toArabicDigits(year)}`;
}

/**
 * The numeric form, for places where a month name is too long to fit — a table
 * column, a chip. Still Arabic-Indic, still day-first.
 */
export function formatDateNumeric(value: string | null | undefined): string {
  if (!value) return '';
  const iso = value.slice(0, 10);
  const [year, month, day] = iso.split('-');
  if (!year || !month || !day) return value;
  return toArabicDigits(`${day}/${month}/${year}`);
}

/** Arabic-Indic digits, matching how the rest of the interface reads. */
export function toArabicDigits(value: string | number): string {
  return String(value).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)] ?? d);
}
