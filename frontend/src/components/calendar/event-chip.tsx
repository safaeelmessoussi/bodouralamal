import type { ReactNode } from 'react';

import type { Occurrence } from '../../adapters/calendar.js';
import { t } from '../../i18n/index.js';

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
  const kindKey = occurrence.kind === 'group' ? 'calendar.kindGroup' : 'calendar.kindEvent';
  // Title first, time second — the priority order that matters when a cell is
  // scanned. Both live on ONE line: a two-line chip halves how many activities
  // a cell can show, and the time is short enough to sit beside the title.
  const inner = (
    <>
      <span className="event-chip__title">{occurrence.title}</span>
      {occurrence.start_time ? (
        // `dir="ltr"` so a clock value is not reordered by the RTL context.
        <time className="event-chip__time" dir="ltr">
          {occurrence.start_time}
        </time>
      ) : null}
    </>
  );

  const className = `event-chip event-chip--${occurrence.kind}`;
  if (!onOpen) {
    return (
      <span className={className}>
        <span className="visually-hidden">{t(kindKey)}: </span>
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
        {t(kindKey)}: {t('calendar.openDetails')} —{' '}
      </span>
      {inner}
    </button>
  );
}
