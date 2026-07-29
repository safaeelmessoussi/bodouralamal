import type { ReactNode } from 'react';

import type { Occurrence } from '../../adapters/calendar.js';
import { t, tList } from '../../i18n/index.js';
import { EventChip } from './event-chip.js';

/**
 * What is coming up, from today onward, within the range already loaded.
 *
 * Deliberately capped: this is an orientation aid beside the grid, not a second
 * listing of the month. The list is derived from the same occurrences the grid
 * uses — one fetch feeds both, so the two can never disagree.
 */
const MAX_UPCOMING = 6;

export function UpcomingEvents({
  occurrences,
  from,
}: {
  occurrences: Occurrence[];
  from: string;
}): ReactNode {
  const months = tList('calendar.months');
  const upcoming = occurrences
    .filter((occurrence) => occurrence.date >= from)
    .slice(0, MAX_UPCOMING);

  return (
    <article className="card cal-panel" aria-labelledby="upcoming-title">
      <h2 id="upcoming-title" className="card__title">
        {t('calendar.upcomingTitle')}
      </h2>

      {upcoming.length === 0 ? (
        <p className="muted">{t('calendar.upcomingEmpty')}</p>
      ) : (
        <ul className="cal-panel__list">
          {upcoming.map((occurrence) => {
            const day = new Date(`${occurrence.date}T00:00:00`);
            return (
              <li key={`${occurrence.kind}-${occurrence.id}-${occurrence.date}`}>
                <span className="cal-upcoming__date">
                  {day.getDate()} {months[day.getMonth()] ?? ''}
                </span>
                <EventChip occurrence={occurrence} />
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}
