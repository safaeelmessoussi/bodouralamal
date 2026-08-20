import { type ReactNode } from 'react';

import type { Occurrence } from '../../adapters/calendar.js';
import { t } from '../../i18n/index.js';
import { venueLabel } from '../scheduling/delivery.js';

/**
 * **The قائمة view of a set of occurrences.**
 *
 * The same rows the grid holds, read as a sequence rather than as a month — which
 * is the view a reader wants when the question is *what is coming up* rather
 * than *what falls on the 24th*.
 *
 * It renders **exactly the occurrence projection it is handed** and resolves
 * nothing itself: the §4.4 tiers have already decided what is in the array by
 * the time it arrives, so this component cannot widen them. A cancelled
 * occurrence stays in the list and is marked — the calendar's job is to say a
 * class is not happening, not to hide that it was scheduled.
 */
export function OccurrenceList({
  occurrences,
  onOpen,
}: {
  occurrences: Occurrence[];
  onOpen?: (occurrence: Occurrence) => void;
}): ReactNode {
  if (occurrences.length === 0) {
    return <p className="muted cal-page__empty">{t('calendar.monthEmpty')}</p>;
  }

  const ordered = [...occurrences].sort(
    (a, b) =>
      a.date.localeCompare(b.date) || (a.start_time ?? '').localeCompare(b.start_time ?? ''),
  );

  return (
    <ul className="occurrence-list">
      {ordered.map((occurrence) => (
        <li
          key={`${occurrence.kind}-${occurrence.id}-${occurrence.date}`}
          className={
            occurrence.status === 'cancelled'
              ? 'occurrence-list__item is-cancelled'
              : 'occurrence-list__item'
          }
        >
          <p className="occurrence-list__when">
            <span className="occurrence-list__date">{occurrence.date}</span>
            {occurrence.start_time ? (
              <span className="occurrence-list__time">
                {occurrence.start_time}
                {occurrence.end_time ? ` – ${occurrence.end_time}` : ''}
              </span>
            ) : (
              <span className="occurrence-list__time">{t('calendar.allDay')}</span>
            )}
          </p>

          <p className="occurrence-list__title">
            {onOpen ? (
              <button type="button" className="link-button" onClick={() => onOpen(occurrence)}>
                {occurrence.title}
              </button>
            ) : (
              occurrence.title
            )}
            {/* Said as a WORD, never as a colour alone (§14.4) — and kept in the
                list rather than removed, because *this class is off* is the
                thing the reader most needs to see. */}
            {occurrence.status === 'cancelled' ? (
              <span className="occurrence-list__cancelled">{t('calendar.cancelled')}</span>
            ) : null}
          </p>

          {/* Only what the projection already carries at this reader's tier.
              Nothing is fetched and nothing is resolved here. */}
          {/* **The Branch stays for an online class** (R97): it is the
              administrative and educational scope, not the venue — a class
              delivered عن بُعد is still a Targa class. What changes is the
              second half, which `venueLabel` answers. */}
          <p className="occurrence-list__where muted">
            {[occurrence.branch_name, venueLabel(occurrence, { withMedia: true })]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </li>
      ))}
    </ul>
  );
}
