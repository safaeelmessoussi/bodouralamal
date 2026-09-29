import type { ReactNode } from 'react';

import type { Occurrence } from '../../adapters/calendar.js';
import { OCCURRENCE_KIND_LABEL } from '../../adapters/calendar.js';
import { t } from '../../i18n/index.js';
import { deliveryLabel } from '../scheduling/delivery.js';
import { chipText, type ChipPart, type ChipTaxonomy } from './chip-parts.js';

const NOTHING_HIDDEN: ReadonlySet<ChipPart> = new Set();

/**
 * One occurrence, at its smallest — used inside a day cell and in the day panel.
 *
 * A recurring group session and a one-off event are distinguished because §4.4
 * treats them as different things: the group timetable is the routine, events
 * are the exception layer over it.
 *
 * When `onOpen` is given the chip renders as a **button**, which is what lets
 * the browser return focus here after the details dialog closes. Without an
 * `onOpen` it is inert text, for contexts that only display.
 */
export function EventChip({
  occurrence,
  onOpen,
  hidden = NOTHING_HIDDEN,
  taxonomy,
}: {
  occurrence: Occurrence;
  onOpen?: (occurrence: Occurrence) => void;
  /** R179 §6 — the parts the surface's active filters already say (`hiddenChipParts`). */
  hidden?: ReadonlySet<ChipPart>;
  /** R179 §9 — so a whole-Category audience reads as the Category (`chipTaxonomy`). */
  taxonomy?: ChipTaxonomy;
}): ReactNode {
  // The label is announced to assistive technology, so an exam is identifiable
  // without relying on the colour that marks it.
  const kindKey = OCCURRENCE_KIND_LABEL[occurrence.kind];
  // The time opens the line and the words follow, taking as many lines as
  // they need (R179 §1/§6; the row grows with them).
  /**
   * **R97 — online is marked; in-person is not** (§18).
   *
   * A month cell is the most crowded surface in the platform, so the calendar
   * stays discreet: the *exception* is marked and the norm is silent, which is
   * the same choice the chip already makes about recurrence. Marking both would
   * put six characters on every class in every cell for no information.
   *
   * It is a **word**, not a colour or an icon (rule AV): «عن بُعد» reads to a
   * screen reader and to a reader who cannot distinguish the tint.
   */
  const online = occurrence.delivery_mode === 'online' ? deliveryLabel(occurrence) : null;

  /**
   * **R110 (Owner, 2026-09-02) — a عطلة is not an activity.**
   *
   * `kind` says `'event'` for both, because both are stored as an `Event`; the
   * structural kind is what tells them apart, and it is read from the row
   * rather than matched against an Arabic name — the catalogue's names are the
   * administration's to change (§4.4b).
   *
   * Marked the way this chip marks everything else: **a word first** (rule AV),
   * the type's own name, so a reader who cannot distinguish the tint still sees
   * that nothing is delivered that day. The wash follows the word; it never
   * carries the meaning alone.
   */
  const holiday = occurrence.structural_kind === 'holiday';

  /* Announced as what it IS: «نشاط» would be wrong for a عطلة. */
  const announced =
    holiday && occurrence.scheduling_type_name ? occurrence.scheduling_type_name : t(kindKey);

  /**
   * **R179 §1/§6 (Owner, 2026-09-29) — everything the cell shows is readable
   * without opening it, and it shows everything the occurrence brings.** The
   * one-line chip once cut «أحكام التجويد — الحلقة…»; now the Subject, its
   * Surah, the circle or group, the Level, who leads and the branch flow in
   * one text that WRAPS only when a line is full (`calendar.css`), each after
   * « — » as the composed title spells them, and never ends in an ellipsis.
   * What the surface's filters already say is left out (`chipText`): under
   * «الفرع: مقر أمرشيش» no chip repeats the branch.
   */
  const text = chipText(occurrence, hidden, taxonomy);

  const inner = (
    <>
      <span className="event-chip__title">
        {/* The time OPENS the line (R179 §6): inline, so a wrapped chip keeps
            its full width for the words instead of reserving a column for a
            five-character clock. `dir="ltr"` so the value is not reordered by
            the RTL context. Hidden on a phone (`calendar.css`). */}
        {occurrence.start_time ? (
          <>
            <time className="event-chip__time" dir="ltr">
              {occurrence.start_time}
            </time>{' '}
          </>
        ) : null}
        {text.head}
        {/* `--{part}` lets a phone keep the essentials and leave the Surah
            and the teacher to the dialog (R179 §10, `calendar.css`). */}
        {text.details.map((detail, index) => (
          <span key={`${index}-${detail.text}`} className={`event-chip__detail event-chip__detail--${detail.part}`}>
            {' — '}
            {detail.text}
          </span>
        ))}
      </span>
      {holiday && occurrence.scheduling_type_name ? (
        <span className="event-chip__tag">{occurrence.scheduling_type_name}</span>
      ) : null}
      {online ? <span className="event-chip__delivery">{online}</span> : null}
    </>
  );

  const className = `event-chip event-chip--${occurrence.kind}${
    holiday ? ' event-chip--holiday' : ''
  }`;
  if (!onOpen) {
    return (
      <span className={className}>
        <span className="visually-hidden">{announced}: </span>
        {inner}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={`${className} event-chip--interactive`}
      aria-label={[announced, occurrence.title, online, occurrence.start_time, t('calendar.openDetails')].filter(Boolean).join(' — ')}
      onClick={(event) => {
        // The cell behind is itself a button; without this, opening an event
        // would also re-select the day underneath it.
        event.stopPropagation();
        onOpen(occurrence);
      }}
    >
      <span className="visually-hidden">
        {announced}: {t('calendar.openDetails')} —{' '}
      </span>
      {inner}
    </button>
  );
}
