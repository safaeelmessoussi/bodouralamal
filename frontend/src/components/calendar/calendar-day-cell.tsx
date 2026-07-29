import type { ReactNode } from 'react';

import type { HijriDay, Occurrence } from '../../adapters/calendar.js';
import { toIsoDate } from '../../lib/dates.js';
import { t } from '../../i18n/index.js';
import { EventChip } from './event-chip.js';

/**
 * One day in the month grid, carrying **both calendars**.
 *
 *     ┌──────────────────────────┐
 *     │ ٢٣ (hijri)      23 (greg)│   ← green left, orange right
 *     │ ─────────────────────────│
 *     │ [ event ]                │
 *     │ [ event ]                │
 *     └──────────────────────────┘
 *
 * **The two numbers are a fixed header, not part of the scrolling list.** They
 * sit in their own row above an independently-scrolling event area, so a day
 * with twenty activities still shows its date — the alternative (numbers in
 * normal flow) pushes them out of view exactly when a busy day most needs
 * identifying.
 *
 * The Hijri number is rendered **only when the backend supplied one**. A month
 * the Ministry has not announced leaves the slot empty rather than showing a
 * computed guess or a placeholder dash (Revision 31, §20 rule 14).
 *
 * A `<button>` wraps the date rather than the whole cell: the cell now contains
 * event buttons, and nesting buttons is invalid HTML that breaks keyboard order.
 */
export function CalendarDayCell({
  date,
  hijri,
  occurrences,
  isToday,
  isSelected,
  onSelect,
  onOpenEvent,
}: {
  date: Date | null;
  hijri: HijriDay | null;
  occurrences: Occurrence[];
  isToday: boolean;
  isSelected: boolean;
  onSelect: (date: Date) => void;
  onOpenEvent: (occurrence: Occurrence) => void;
}): ReactNode {
  if (!date) return <td className="cal-cell cal-cell--blank" aria-hidden="true" />;

  const iso = toIsoDate(date);
  const count = occurrences.length;

  return (
    <td className="cal-cell" role="gridcell" aria-selected={isSelected}>
      <div
        className={[
          'cal-day',
          isToday ? 'is-today' : '',
          isSelected ? 'is-selected' : '',
          count > 0 ? 'has-events' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {/* Selecting the day opens the day dialog. The accessible name carries
            the full date and the activity count, because the visible content is
            two bare numerals. */}
        <button
          type="button"
          className="cal-day__select"
          onClick={() => onSelect(date)}
          aria-label={`${iso}${count ? ` — ${t('calendar.eventCount')}: ${count}` : ''}`}
        >
          {/* RTL: the Hijri number is written first so it lands on the LEFT,
              and the Gregorian on the right. Both are aria-hidden — the button
              label above already states the date properly. */}
          {hijri?.hijri_day != null ? (
            <span className="cal-day__hijri" aria-hidden="true">
              {hijri.hijri_day}
            </span>
          ) : (
            <span className="cal-day__hijri cal-day__hijri--absent" aria-hidden="true" />
          )}
          <span className="cal-day__gregorian" aria-hidden="true">
            {date.getDate()}
          </span>
        </button>

        {/* Every occurrence is rendered. The area scrolls rather than truncating
            at a fixed count, so "how many fit" is a matter of cell height
            instead of an arbitrary cap — which is what the taller cells buy. */}
        {count > 0 ? (
          <ul className="cal-day__events">
            {occurrences.map((occurrence) => (
              <li key={`${occurrence.kind}-${occurrence.id}-${occurrence.date}`}>
                <EventChip occurrence={occurrence} onOpen={onOpenEvent} />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </td>
  );
}
