/**
 * **What a class, one occurrence, a bare exam or a recording is CALLED — composed,
 * never typed** (Owner, 2026-09-21 — SRS Revision 166 §3).
 *
 * *The type of the session — the Subject — the Surah(s) — the main teacher —
 * when.* Revision 165 offered this as a suggestion in «العنوان», which the form
 * then stored. A stored suggestion goes stale the first time anything it was
 * built from changes: a cover teacher takes one date, a Surah is changed for one
 * occurrence, a class moves an hour — and the title kept saying what used to be
 * true. So a class no longer HAS a typed title. Every reader is given this one,
 * composed at read time from what the row says now; what somebody wants to add
 * in her own words goes in «الوصف».
 *
 * One function, so the calendar, الجدولة's list, the series editor, the exam
 * target picker and a recording's title cannot describe one class five ways.
 * Absent parts are omitted rather than left as empty separators.
 */
export interface ItemTitleParts {
  /** The catalogue type's name («حصة دراسية», «اختبار»…); `null` when unrecorded. */
  typeName: string | null;
  subjectName: string | null;
  /** In Mushaf order; empty wherever the Subject is not taught by Surah. */
  surahNames: readonly string[];
  /** A PUBLIC display name (§20 rule 12) — this text reaches public calendars.
   *  Composed as «{TEACHER_HONORIFIC} {name}» (R172 §12); the bare name is
   *  what the caller passes. */
  leadName: string | null;
  /** `YYYY-MM-DD`; `null` for a repeating class's own row, which spans dates. */
  date: string | null;
  /** Wall-clock `HH:MM` (TD-11); `null` for an all-day item. */
  time: string | null;
}

const SEPARATOR = ' — ';
const ELLIPSIS = '…';

/**
 * **The word before a teacher's name, everywhere a title carries one** (the
 * Owner, 2026-09-23 — SRS Revision 172 §12): «محاضرة — دورة علوم القرآن —
 * الأستاذة فاطمة بوخبزى — 2026-09-22 15:00». Defined ONCE, here, on the
 * composer every title and recording name flows through; the browser's live
 * preview receives it from `/me/scope-options` (`teacher_honorific`) rather
 * than keeping a copy. To change the word, change this constant.
 */
export const TEACHER_HONORIFIC = 'الأستاذة';

const clean = (value: string | null | undefined): string => (value ?? '').trim();

/** `الأستاذة فاطمة` — the honorific before a (public, §20 rule 12) name; nothing for nobody. */
export function honoured(name: string | null | undefined): string {
  const bare = clean(name);
  return bare === '' ? '' : `${TEACHER_HONORIFIC} ${bare}`;
}

function join(parts: readonly string[]): string {
  return parts.filter((part) => part !== '').join(SEPARATOR);
}

/**
 * `maxLength` is for the two places the text is STORED in a bounded column — a
 * recording's `EducationalContent.title` and a bare exam's `Exam.title`, both
 * `VARCHAR(120)`. Overflow would not truncate: it would refuse the row, which
 * for a recording means a class that was recorded and reaches nobody.
 *
 * What gives way, in order: Surahs beyond the ones that fit (the rest become
 * «…»), then the main teacher, then the head of the text. **«when» is never
 * shortened** — it is what tells two recordings of one class apart.
 */
export function composeItemTitle(parts: ItemTitleParts, maxLength?: number): string {
  const when = join([clean(parts.date), clean(parts.time)].filter((x) => x !== '')).replace(
    SEPARATOR,
    ' ',
  );
  const head = [clean(parts.typeName), clean(parts.subjectName)];
  const surahs = parts.surahNames.map(clean).filter((name) => name !== '');
  const lead = honoured(parts.leadName);

  const build = (surahCount: number, withLead: boolean): string =>
    join([
      ...head,
      surahCount === surahs.length
        ? surahs.join('، ')
        : surahCount === 0
          ? ''
          : `${surahs.slice(0, surahCount).join('، ')}${ELLIPSIS}`,
      withLead ? lead : '',
      when,
    ]);

  const full = build(surahs.length, true);
  if (maxLength === undefined || full.length <= maxLength) return full;

  for (let count = surahs.length - 1; count >= 1; count -= 1) {
    const candidate = build(count, true);
    if (candidate.length <= maxLength) return candidate;
  }
  for (const withLead of [true, false]) {
    const candidate = build(surahs.length > 0 ? 1 : 0, withLead);
    if (candidate.length <= maxLength) return candidate;
  }
  // Still too long: a very long type or Subject name. Keep «when» whole.
  const tail = when === '' ? '' : `${SEPARATOR}${when}`;
  const room = Math.max(0, maxLength - tail.length - ELLIPSIS.length);
  return `${join(head).slice(0, room).trimEnd()}${ELLIPSIS}${tail}`;
}

/** `HH:MM` from a wall-clock `time` column (stored as 1970-01-01T..Z — TD-11). */
export function wallClockHHMM(value: Date | null): string | null {
  return value === null ? null : value.toISOString().slice(11, 16);
}

/** `YYYY-MM-DD` from a `date` column (midnight UTC — TD-11). */
export function calendarDateIso(value: Date | null): string | null {
  return value === null ? null : value.toISOString().slice(0, 10);
}
