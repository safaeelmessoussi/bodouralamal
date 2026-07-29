import type { ReactNode } from 'react';

import type { Occurrence } from '../../adapters/calendar.js';
import { t } from '../../i18n/index.js';

/**
 * One occurrence, at its smallest — used inside a day cell and in the lists.
 *
 * A recurring group session and a one-off event are visually distinguished
 * because §4.4 treats them as different things: the group timetable is the
 * routine, events are the exception layer laid over it.
 */
export function EventChip({ occurrence }: { occurrence: Occurrence }): ReactNode {
  const kind = occurrence.kind === 'group' ? 'kindGroup' : 'kindEvent';
  return (
    <span className={`event-chip event-chip--${occurrence.kind}`}>
      <span className="visually-hidden">{t(`calendar.${kind}`)}: </span>
      {occurrence.start_time ? (
        // `dir="ltr"` so a clock value is not reordered by the RTL context.
        <time className="event-chip__time" dir="ltr">
          {occurrence.start_time}
        </time>
      ) : null}
      <span className="event-chip__title">{occurrence.title}</span>
    </span>
  );
}
