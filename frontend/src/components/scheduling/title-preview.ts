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
export function composeTitlePreview(parts: {
  typeName: string | null;
  subjectName: string | null;
  surahNames: readonly string[];
  leadName: string | null;
  /** R172 §12 — the server's word before the teacher's name (`teacher_honorific`
   *  on `/me/scope-options`); `''` until it arrives, so the preview never
   *  guesses a word the server defines. */
  teacherHonorific: string;
  date: string | null;
  time: string | null;
}): string {
  const when = [parts.date ?? '', parts.time ?? ''].filter((x) => x !== '').join(' ');
  const lead = (parts.leadName ?? '').trim();
  return [
    parts.typeName ?? '',
    parts.subjectName ?? '',
    parts.surahNames.join('، '),
    lead === '' ? '' : [parts.teacherHonorific.trim(), lead].filter((x) => x !== '').join(' '),
    when,
  ]
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .join(' — ');
}
