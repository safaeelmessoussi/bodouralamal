import { activeLocale, tList } from '../i18n/index.js';

/**
 * **SRS Revision 209 — a month's name in the page's language.** The server
 * resolves the Arabic names (`month_ar`, `hijri_month_ar`) and Arabic reads
 * them as sent; a translation names the month by its number from its own
 * catalogue, and falls back to the Arabic name where it has none.
 */
export function gregorianMonthName(month: number | null | undefined, arabic: string): string {
  if (activeLocale() === 'ar' || !month) return arabic;
  return tList('calendar.months')[month - 1] ?? arabic;
}

export function hijriMonthName(month: number | null | undefined, arabic: string): string {
  if (activeLocale() === 'ar' || !month) return arabic;
  return tList('calendar.hijriMonths')[month - 1] ?? arabic;
}
