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
  /** R178 §4 — what KIND of thing this is when it is not the item itself: a
   *  recording of a class carries «تسجيل صوتي» ahead of the class's title. */
  prefix?: string | null;
  /** The catalogue type's name («حصة دراسية», «اختبار»…); `null` when unrecorded. */
  typeName: string | null;
  subjectName: string | null;
  /** In Mushaf order; empty wherever the Subject is not taught by Surah.
   *  Each is rendered «سورة {name}» (R178 §4). */
  surahNames: readonly string[];
  /** R178 §4 — who the class is for when it names a group or a circle
   *  («الحلقة 1»), between the Surahs and the teacher; never a Level or a
   *  Category, which the Subject already implies. */
  audienceName?: string | null;
  /** A PUBLIC display name (§20 rule 12) — this text reaches public calendars.
   *  Composed as «{TEACHER_HONORIFIC} {name}» (R172 §12); the bare name is
   *  what the caller passes. */
  leadName: string | null;
  /** `YYYY-MM-DD`, rendered «الخميس 17 شتنبر 2026» (R178 §4); `null` for a
   *  repeating class's own row, which spans dates. */
  date: string | null;
  /** R178 §4 — a repeating class names the weekday of its first occurrence
   *  instead of a date: «الخميس 09:00». Read only when `date` is null. */
  weekday?: string | null;
  /** Wall-clock `HH:MM` (TD-11); `null` for an all-day item. */
  time: string | null;
}

const SEPARATOR = ' — ';
const ELLIPSIS = '…';
const SURAH_WORD = 'سورة';
const CIRCLE_WORD = 'الحلقة';

/**
 * R178 §4 — the group or circle a class is for, as a title names it: a circle
 * as «الحلقة {name}» (its name is a number in practice), a group by its own
 * name; nothing for a class addressed to a Level or a Category, which the
 * Subject already implies. A circle wins when both are named — it is the
 * narrower answer.
 */
/** R195 — what a class of ALL a Level's Subjects is called where a Subject's
 *  name would stand alone (a calendar chip with no group or type to name it). */
export const ALL_SUBJECTS = 'كل المواد';

export function audienceTitle(circleName: string | null | undefined, groupName: string | null | undefined): string | null {
  const circle = clean(circleName);
  // R199 §4 (the Owner) — a circle whose name already says «حلقة» is not
  // prefixed again: «الحلقة الحلقة 1» doubled the word on every chip.
  if (circle !== '') return circle.includes('حلقة') ? circle : `${CIRCLE_WORD} ${circle}`;
  const group = clean(groupName);
  return group === '' ? null : group;
}

/** Moroccan month names, the same the calendar's own title uses (§6). */
export const GREGORIAN_MONTHS_AR = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'ماي', 'يونيو',
  'يوليوز', 'غشت', 'شتنبر', 'أكتوبر', 'نونبر', 'دجنبر',
] as const;
/** Sunday first, as `Date#getUTCDay` counts. */
export const WEEKDAYS_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'] as const;

function calendarDay(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * **R178 §4 — a date reads as a person says it: «الخميس 17 شتنبر 2026».** The
 * ISO form stayed in titles because nothing rendered them but the tables; a
 * title is read aloud, printed on a recording's name and searched for, and
 * «2026-09-17» is none of those. Western digits throughout (§6).
 */
export function arabicCalendarDate(iso: string): string {
  const date = calendarDay(iso);
  if (!date) return iso;
  return `${WEEKDAYS_AR[date.getUTCDay()]} ${date.getUTCDate()} ${GREGORIAN_MONTHS_AR[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** The weekday a `YYYY-MM-DD` falls on, in Arabic — a repeating class's «when». */
export function arabicWeekday(iso: string | null): string | null {
  const date = iso === null ? null : calendarDay(iso);
  return date ? WEEKDAYS_AR[date.getUTCDay()]! : null;
}

const WEEKDAY_ENUM = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
/** The recurrence rule's own weekday name (`weekdays[0]`), in Arabic — for a
 *  repeating class whose anchor date is not recorded. */
export function arabicWeekdayOf(weekday: string | null | undefined): string | null {
  const index = WEEKDAY_ENUM.indexOf((weekday ?? '') as (typeof WEEKDAY_ENUM)[number]);
  return index === -1 ? null : WEEKDAYS_AR[index]!;
}

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
  // «when»: a dated occurrence reads its Arabic date; a repeating class its
  // first occurrence's weekday (R178 §4); either followed by the time.
  const dateWord = clean(parts.date) === '' ? clean(parts.weekday) : arabicCalendarDate(clean(parts.date));
  const when = [dateWord, clean(parts.time)].filter((x) => x !== '').join(' ');
  const head = [clean(parts.prefix), clean(parts.typeName), clean(parts.subjectName)];
  const surahs = parts.surahNames.map(clean).filter((name) => name !== '').map((name) => `${SURAH_WORD} ${name}`);
  const audience = clean(parts.audienceName);
  const lead = honoured(parts.leadName);

  const build = (surahCount: number, withLead: boolean): string =>
    join([
      ...head,
      surahCount === surahs.length
        ? surahs.join('، ')
        : surahCount === 0
          ? ''
          : `${surahs.slice(0, surahCount).join('، ')}${ELLIPSIS}`,
      audience,
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
  // Still too long: the head alone with «when» whole, then a shortened head.
  const tail = when === '' ? '' : `${SEPARATOR}${when}`;
  const headOnly = join(head);
  if (headOnly.length + tail.length <= maxLength) return `${headOnly}${tail}`;
  const room = Math.max(0, maxLength - tail.length - ELLIPSIS.length);
  return `${headOnly.slice(0, room).trimEnd()}${ELLIPSIS}${tail}`;
}

/** `HH:MM` from a wall-clock `time` column (stored as 1970-01-01T..Z — TD-11). */
export function wallClockHHMM(value: Date | null): string | null {
  return value === null ? null : value.toISOString().slice(11, 16);
}

/** `YYYY-MM-DD` from a `date` column (midnight UTC — TD-11). */
export function calendarDateIso(value: Date | null): string | null {
  return value === null ? null : value.toISOString().slice(0, 10);
}
