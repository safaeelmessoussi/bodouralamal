import type { ReactNode } from 'react';

import type { Occurrence } from '../../adapters/calendar.js';
import { toIsoDate } from '../../lib/dates.js';
import { t, tList } from '../../i18n/index.js';
import { EventChip } from './event-chip.js';

/**
 * What happens on the day the visitor picked.
 *
 * The Hijri date is shown only when the backend supplies one: Revision 31 makes
 * the overlay official recorded data, and a month the Ministry has not yet
 * announced carries no label at all — so this renders the Gregorian date alone
 * rather than computing a guess.
 */
export function SelectedDayCard({
  date,
  occurrences,
  onOpenEvent,
}: {
  date: Date;
  occurrences: Occurrence[];
  onOpenEvent?: (occurrence: Occurrence) => void;
}): ReactNode {
  const months = tList('calendar.months');
  const heading = `${date.getDate()} ${months[date.getMonth()] ?? ''} ${date.getFullYear()}`;
  const hijri = occurrences.find((o) => o.hijri_date)?.hijri_date ?? null;

  return (
    <article className="card cal-panel" aria-labelledby="selected-day-title">
      <h2 id="selected-day-title" className="card__title">
        {t('calendar.selectedDayTitle')}
      </h2>

      <p className="cal-panel__date">
        <time dateTime={toIsoDate(date)}>{heading}</time>
        {hijri ? (
          <span className="cal-panel__hijri" dir="ltr">
            {hijri}
          </span>
        ) : null}
      </p>

      {occurrences.length === 0 ? (
        <p className="muted">{t('calendar.selectedDayEmpty')}</p>
      ) : (
        <ul className="cal-panel__list">
          {occurrences.map((occurrence) => (
            <li key={`${occurrence.kind}-${occurrence.id}`}>
              <EventChip occurrence={occurrence} {...(onOpenEvent ? { onOpen: onOpenEvent } : {})} />
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
