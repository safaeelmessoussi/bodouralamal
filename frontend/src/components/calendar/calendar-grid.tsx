import type { ReactNode } from 'react';

import type { HijriDay, Occurrence } from '../../adapters/calendar.js';
import { monthGrid, toIsoDate } from '../../lib/dates.js';
import { t, tList } from '../../i18n/index.js';
import { CalendarDayCell } from './calendar-day-cell.js';

/**
 * The monthly grid — a real `<table>`, because a calendar month *is* tabular
 * data: seven weekday columns against week rows. Screen readers announce the
 * column header with each cell, which a grid of `<div>`s cannot do without
 * rebuilding that behaviour by hand.
 *
 * **Weeks start Monday** (BR-17), and the weekday list is ordered accordingly.
 */
export function CalendarGrid({
  month,
  byDate,
  hijriByDate,
  today,
  selected,
  onSelect,
  onOpenEvent,
}: {
  month: Date;
  byDate: Map<string, Occurrence[]>;
  /** Recorded official Hijri days, keyed by ISO date — absent for a month the
   *  Ministry has not yet announced (Revision 31). */
  hijriByDate: Map<string, HijriDay>;
  today: Date;
  selected: Date | null;
  onSelect: (date: Date) => void;
  onOpenEvent: (occurrence: Occurrence) => void;
}): ReactNode {
  const cells = monthGrid(month);
  const weeks: (Date | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  const weekdays = tList('calendar.weekdaysShort');

  return (
    <table className="cal-grid" role="grid" aria-label={t('calendar.gridLabel')}>
      <thead>
        <tr>
          {weekdays.map((day) => (
            <th key={day} scope="col" className="cal-grid__weekday">
              {day}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((week, index) => (
          <tr key={`week-${index}`} role="row">
            {week.map((date, dayIndex) => (
              <CalendarDayCell
                key={date ? toIsoDate(date) : `blank-${index}-${dayIndex}`}
                date={date}
                hijri={date ? (hijriByDate.get(toIsoDate(date)) ?? null) : null}
                occurrences={date ? (byDate.get(toIsoDate(date)) ?? []) : []}
                isToday={date ? toIsoDate(date) === toIsoDate(today) : false}
                isSelected={date && selected ? toIsoDate(date) === toIsoDate(selected) : false}
                onSelect={onSelect}
                onOpenEvent={onOpenEvent}
              />
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
