import type { ReactNode } from 'react';

import type { Occurrence } from '../../adapters/calendar.js';
import { SelectedDayCard } from './selected-day-card.js';
import { UpcomingEvents } from './upcoming-events.js';

/**
 * The panel beside the grid. It stacks the two cards and decides nothing else,
 * so on a narrow screen the same two components simply flow beneath the grid.
 */
export function CalendarSidebar({
  selectedDate,
  selectedOccurrences,
  occurrences,
  today,
}: {
  selectedDate: Date;
  selectedOccurrences: Occurrence[];
  occurrences: Occurrence[];
  today: string;
}): ReactNode {
  return (
    <aside className="cal-sidebar">
      <SelectedDayCard date={selectedDate} occurrences={selectedOccurrences} />
      <UpcomingEvents occurrences={occurrences} from={today} />
    </aside>
  );
}
