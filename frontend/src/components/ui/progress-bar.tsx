import type { ReactNode } from 'react';

/**
 * **One progress bar for the whole platform** (rule C, 2026-08-20).
 *
 * Written for Quran memorisation, but deliberately **generic**: it knows about
 * a value, a total and a label, and nothing about Surahs, ayahs or curricula.
 * A Quran-specific visual primitive would be the second implementation the
 * moment anything else on the platform showed a proportion — level completion
 * and exam coverage are both already shaped like one.
 *
 * ## It is a meter, not a task in progress
 *
 * `role="progressbar"` with `aria-valuenow` is the ARIA pattern the Owner's
 * brief names, and it is what assistive technology reads: **the percentage is
 * never conveyed by the coloured strip alone**, which a screen reader cannot see
 * and a colour-blind reader may not distinguish. `aria-valuetext` carries the
 * Arabic form so the reading is «٦٠٪» rather than a bare number.
 *
 * ## RTL comes from the document, not from a transform
 *
 * The page is `dir="rtl"`, so the fill is positioned with **logical**
 * properties — the track is a flex row and the fill is its first child, which
 * puts it at the right-hand edge in Arabic and the left in English without this
 * component testing the direction. `transform: scaleX()` was rejected for
 * exactly that reason: it would need to know which way *forward* is.
 *
 * ## Zero is a value, not an absence
 *
 * A Surah at 0% renders the empty track and «٠٪», because §C15 shows every
 * Surah of the syllabus — *not started* is the answer for most of them and is
 * different from *not in the curriculum*, which does not appear at all.
 */
export function ProgressBar({
  value,
  label,
  detail,
  complete,
}: {
  /** Percentage, 0–100. Clamped for display only — the value shown is the
   *  value given, so a bad figure is visible rather than silently tidied. */
  value: number;
  /** What this bar measures. Required: an unlabelled meter is unreadable to
   *  anybody not looking at the row it sits in. */
  label: string;
  /** The fraction behind the percentage, e.g. `4/7` — shown beside it. */
  detail?: string;
  /** Marks the bar done. Presentation only; the caller decides what done
   *  means, because that rule lives in the domain (BR-11), never here. */
  complete?: boolean;
}): ReactNode {
  const clamped = Math.max(0, Math.min(100, value));
  const rounded = Math.round(value * 100) / 100;

  return (
    <div className="progress">
      <div className="progress__head">
        <span className="progress__label">{label}</span>
        <span className="progress__value">
          {rounded}%{detail ? <span className="progress__detail"> — {detail}</span> : null}
        </span>
      </div>
      <div
        className={`progress__track${complete ? ' progress__track--complete' : ''}`}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={rounded}
        aria-valuetext={`${rounded}%`}
      >
        <div className="progress__fill" style={{ inlineSize: `${clamped}%` }} />
      </div>
    </div>
  );
}
