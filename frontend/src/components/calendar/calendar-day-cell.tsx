import type { ReactNode } from 'react';

import type { Occurrence } from '../../adapters/calendar.js';
import { toIsoDate } from '../../lib/dates.js';
import { t } from '../../i18n/index.js';
import { EventChip } from './event-chip.js';

/**
 * One day in the month grid.
 *
 * A `<button>` rather than a styled `<div>`: selecting a day is an action, and
 * the element has to match it for keyboard and screen-reader users. Padding
 * cells render as an inert `<td>` so the grid keeps its shape without offering
 * a control that does nothing.
 */
export function CalendarDayCell({
  date,
  occurrences,
  isToday,
  isSelected,
  onSelect,
}: {
  date: Date | null;
  occurrences: Occurrence[];
  isToday: boolean;
  isSelected: boolean;
  onSelect: (date: Date) => void;
}): ReactNode {
  if (!date) return <td className="cal-cell cal-cell--blank" aria-hidden="true" />;

  const iso = toIsoDate(date);
  const shown = occurrences.slice(0, 2);
  const hidden = occurrences.length - shown.length;

  return (
    <td className="cal-cell" role="gridcell" aria-selected={isSelected}>
      <button
        type="button"
        className={[
          'cal-day',
          isToday ? 'is-today' : '',
          isSelected ? 'is-selected' : '',
          occurrences.length > 0 ? 'has-events' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={() => onSelect(date)}
        // The visible number alone would read as a bare digit; the full date and
        // the activity count are what make the cell meaningful when announced.
        aria-label={`${iso}${occurrences.length ? ` — ${t('calendar.eventCount')}: ${occurrences.length}` : ''}`}
      >
        <span className="cal-day__number" aria-hidden="true">
          {date.getDate()}
        </span>
        <span className="cal-day__events">
          {shown.map((occurrence) => (
            <EventChip key={`${occurrence.kind}-${occurrence.id}-${occurrence.date}`} occurrence={occurrence} />
          ))}
          {hidden > 0 ? <span className="cal-day__more">+{hidden}</span> : null}
        </span>
      </button>
    </td>
  );
}
