import type { ReactNode } from 'react';

import type { Occurrence } from '../../adapters/calendar.js';
import { OCCURRENCE_KIND_LABEL } from '../../adapters/calendar.js';
import { t } from '../../i18n/index.js';
import { deliveryLabel } from '../scheduling/delivery.js';

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
}: {
  occurrence: Occurrence;
  onOpen?: (occurrence: Occurrence) => void;
}): ReactNode {
  // The label is announced to assistive technology, so an exam is identifiable
  // without relying on the colour that marks it.
  const kindKey = OCCURRENCE_KIND_LABEL[occurrence.kind];
  // Title first, time second — the priority order that matters when a cell is
  // scanned. Both live on ONE line: a two-line chip halves how many activities
  // a cell can show, and the time is short enough to sit beside the title.
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

  const inner = (
    <>
      <span className="event-chip__title">{occurrence.title}</span>
      {holiday && occurrence.scheduling_type_name ? (
        <span className="event-chip__tag">{occurrence.scheduling_type_name}</span>
      ) : null}
      {online ? <span className="event-chip__delivery">{online}</span> : null}
      {occurrence.start_time ? (
        // `dir="ltr"` so a clock value is not reordered by the RTL context.
        <time className="event-chip__time" dir="ltr">
          {occurrence.start_time}
        </time>
      ) : null}
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
