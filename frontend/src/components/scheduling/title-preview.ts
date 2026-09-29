/**
 * **A preview of the title the SERVER will compose** (SRS Revision 167 §1) —
 * *type — Subject — Surah(s) — main teacher — when*, the wording of
 * `backend/src/lib/item-title.ts`, mirrored here so the form can show it while
 * it is being filled in. The server's is the one that is stored and shown
 * afterwards; this is a courtesy, which is why it is labelled «يُنشأ تلقائيًا»
 * and why `title-preview.test.ts` holds the two to the same examples.
 *
 * A repeating class's own row carries its time and no date — each of its
 * sessions then carries its own date. A one-off, and an exam, carry both.
 */
import { formatDateWithWeekday } from '../../lib/format-date.js';

export function composeTitlePreview(parts: {
  typeName: string | null;
  subjectName: string | null;
  surahNames: readonly string[];
  /** R178 §4 — «الحلقة 1» or the group's name, when the class names one. */
  audienceName?: string | null;
  leadName: string | null;
  /** R172 §12 — the server's word before the teacher's name (`teacher_honorific`
   *  on `/me/scope-options`); `''` until it arrives, so the preview never
   *  guesses a word the server defines. */
  teacherHonorific: string;
  /** `YYYY-MM-DD`; rendered «الخميس 17 شتنبر 2026» (R178 §4). */
  date: string | null;
  /** R178 §4 — a repeating class's first-occurrence weekday, when `date` is null. */
  weekday?: string | null;
  time: string | null;
}): string {
  const dateWord = parts.date ? formatDateWithWeekday(parts.date) : (parts.weekday ?? '');
  const when = [dateWord, parts.time ?? ''].filter((x) => x !== '').join(' ');
  const lead = (parts.leadName ?? '').trim();
  return [
    parts.typeName ?? '',
    parts.subjectName ?? '',
    // Each Surah as a person names it: «سورة الفاتحة» (R178 §4).
    parts.surahNames.map((name) => `سورة ${name.trim()}`).join('، '),
    parts.audienceName ?? '',
    lead === '' ? '' : [parts.teacherHonorific.trim(), lead].filter((x) => x !== '').join(' '),
    when,
  ]
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .join(' — ');
}
