import type { Occurrence } from '../adapters/calendar.js';

/**
 * **SRS Revision 208 — the Surahs an occurrence is about, and how a short
 * place says them** (the Owner, 2026-10-07).
 *
 * The occurrence's own Surahs when it names any; else, for a Subject that
 * works by Surah (حفظ, تفسير), its Level's «مقرر الحفظ» — the server resolves
 * both (`surah_names`, `level_surah_names`), this only chooses between them.
 */
export function occurrenceSurahs(
  occurrence: Pick<Occurrence, 'surah_names' | 'level_surah_names'>,
): string[] {
  const own = occurrence.surah_names ?? [];
  return own.length > 0 ? own : (occurrence.level_surah_names ?? []);
}

/** Up to this many Surahs are named in full where room is short. */
export const SURAH_LIST_MAX = 4;

/**
 * A list for a chip or a row: in full up to four, else the first and the last
 * with «…» between them («النبأ … الناس»). A full-screen or details view shows
 * the whole list instead and does not call this.
 */
export function shortSurahList(names: readonly string[], max = SURAH_LIST_MAX): string {
  if (names.length <= max) return names.join('، ');
  return `${names[0]!} … ${names[names.length - 1]!}`;
}
