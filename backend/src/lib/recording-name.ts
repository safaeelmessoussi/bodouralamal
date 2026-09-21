import { composeItemTitle } from './item-title.js';
import { moroccoDateIso, moroccoTimeHHMM } from './morocco-clock.js';

/**
 * **What a recording is called, decided by the server** (SRS Revision 75.6,
 * carried to the server by Revision 99).
 *
 * ## Why this is not in the browser any more
 *
 * R75.6's rule was implemented in `frontend/src/lib/recorder.ts`, which was
 * correct while a browser was the only thing that could produce a recording.
 * R99 adds a second producer — the platform's **own server-side capture of an
 * online class**, ingested by a background worker with no browser anywhere near
 * it — and a rule stated in a place one of its two producers cannot reach is a
 * rule that will be implemented twice and will drift.
 *
 * So the algorithm lives here, once, and **both origins consume it**: the
 * browser recorder receives a server-computed suggestion it may edit, and the
 * ingestion worker allocates the canonical name under a row lock. The visible
 * convention is unchanged — first is the bare base name, then ` 2`, ` 3`.
 *
 * ## One namespace per Session
 *
 * The numbering is chosen from the titles **already linked to that occurrence**,
 * whatever produced them. A مؤطِّرة's browser recording and the platform's own
 * capture of the same class are two recordings of one lesson, and numbering them
 * in separate sequences would produce two files called the same thing.
 */

/** Long enough to identify a session, short enough to read in a list. */
export const DESCRIPTION_LIMIT = 40;

/** The name used when there is nothing at all to derive one from. */
export const FALLBACK_BASE = 'تسجيل';

export interface RecordingNameSource {
  /** The occurrence's own title — on this platform, the Subject's name. */
  title: string;
  /** Free multiline text (§7); only its first line is used, and bounded. */
  description: string | null;
  /** The occurrence's calendar date, `YYYY-MM-DD` (TD-11 — a date, never an
   *  instant). */
  date: string;
}

/**
 * **The base name a recording is derived from** (R75.6).
 *
 * The specification names three sources — *its title, its description and its
 * date* — and all three earn their place: the title says which class, the date
 * says which occurrence, and the description is where a teacher writes what made
 * this session different. A file called *تسجيل 4* answers none of those a year
 * later.
 *
 * Absent parts are **omitted rather than left as empty separators**.
 */
export function recordingBaseName(source: RecordingNameSource): string {
  const firstLine = (source.description ?? '').split('\n')[0]?.trim() ?? '';
  const note =
    firstLine.length > DESCRIPTION_LIMIT
      ? `${firstLine.slice(0, DESCRIPTION_LIMIT).trimEnd()}…`
      : firstLine;
  return [source.title.trim(), note, source.date]
    .filter((part) => part !== '')
    .join(' — ');
}

/**
 * **The next free name in a namespace** (R75.6).
 *
 * The first carries no number; the second and subsequent are suffixed ` 2`,
 * ` 3`, … — chosen from the names already taken rather than from a counter, so a
 * gap left by a renamed or removed item is reused instead of being skipped.
 *
 * Bounded rather than unbounded: a session with a thousand recordings is a
 * different problem, and the timestamp fallback is a name that cannot collide
 * rather than a guess at the right one.
 */
export function nextRecordingName(
  base: string,
  taken: readonly string[],
  now: Date = new Date(),
): string {
  const trimmed = base.trim() === '' ? FALLBACK_BASE : base.trim();
  const used = new Set(taken.map((title) => title.trim()));
  if (!used.has(trimmed)) return trimmed;
  for (let n = 2; n <= 999; n += 1) {
    const candidate = `${trimmed} ${n}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${trimmed} ${now.getTime()}`;
}

/**
 * The association's own calendar date (TD-11 — the process TZ is pinned to
 * `Africa/Casablanca`, so the local getters *are* the association's date).
 *
 * `toISOString().slice(0, 10)` is what the browser did, and it is UTC's date:
 * for the first hour after local midnight it names yesterday. The same defect
 * was found in an R98 fixture and is not worth repeating here.
 */
export function localDateIso(now: Date = new Date()): string {
  // R167 §2 — Morocco's date from the HOST's zone rules (`morocco-clock`), not
  // from the local getters: those read the zone data frozen into the image.
  return moroccoDateIso(now);
}

/**
 * **What the platform's own capture of a class is called** (Owner, 2026-09-20 —
 * SRS Revision 165 §1): *the type of the session, the Subject, the Surah, the
 * main teacher, and the date and time she pressed «إيقاف التسجيل»*.
 *
 * `at` is the recording's own `stopped_at`, never *now*: the ingestion worker
 * derives the object's storage key from this name, and a retry after a partial
 * failure must find the object it already wrote rather than mint a second key
 * beside it (R99.15). A stored instant answers the same on every attempt.
 *
 * The time is the association's wall clock — the runtime pins `TZ` to
 * `Africa/Casablanca`, so the local getters *are* that clock (`localDateIso`).
 * Absent parts are omitted rather than left as empty separators, as above.
 */
export interface SessionRecordingNameSource {
  /** The catalogue type's name («حصة», «درس»…); `null` for a pre-catalogue row. */
  typeName: string | null;
  subjectName: string;
  /** In Mushaf order; empty wherever the Subject is not taught by Surah. */
  surahNames: readonly string[];
  /** Her public display name (§20 rule 12) — never her civil name. */
  teacherName: string | null;
  at: Date;
}

/**
 * A recording's title is STORED, in `EducationalContent.title` — `VARCHAR(120)`.
 * A class about several Surahs, or led by somebody with a long name, overflowed
 * it (found 2026-09-21, a day after this rule shipped): the row is then refused
 * rather than truncated, which is one more way for «إيقاف التسجيل» to end in a
 * recording nobody can reach. Six characters are kept back for R75.6's ` 2`…
 * ` 999` suffix. `composeItemTitle` decides what gives way, and never «when».
 */
export const RECORDING_TITLE_LIMIT = 120 - 6;

export function sessionRecordingBaseName(source: SessionRecordingNameSource): string {
  return composeItemTitle(
    {
      typeName: source.typeName,
      subjectName: source.subjectName,
      surahNames: source.surahNames,
      leadName: source.teacherName,
      date: localDateIso(source.at),
      time: moroccoTimeHHMM(source.at),
    },
    RECORDING_TITLE_LIMIT,
  );
}
