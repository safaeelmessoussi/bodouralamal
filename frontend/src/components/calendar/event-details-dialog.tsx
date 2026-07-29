import type { ReactNode } from 'react';

import type { Occurrence } from '../../adapters/calendar.js';
import { t, tList } from '../../i18n/index.js';
import { Dialog } from '../ui/dialog.js';

/**
 * Event details.
 *
 * **A dialog rather than a panel below the calendar**, decided on the page's own
 * shape: the grid now claims most of the viewport height, so a panel underneath
 * would open reliably below the fold and make every click a scroll. A dialog
 * keeps the grid in place, works as a sheet on a phone, and scrolls internally
 * when the content grows — which it will: §4.4 gives an event a description,
 * recurrence, three visibility tiers and four-way scope, and §4.9 attaches
 * educational content to it. Those become rows here without the page moving.
 *
 * Rendered as a definition list, so each field is announced with its label
 * instead of as a run of unlabelled text.
 */
export function EventDetailsDialog({
  occurrence,
  onClose,
}: {
  occurrence: Occurrence | null;
  onClose: () => void;
}): ReactNode {
  const months = tList('calendar.months');
  const date = occurrence ? new Date(`${occurrence.date}T00:00:00`) : null;

  return (
    <Dialog
      open={occurrence !== null}
      onClose={onClose}
      title={occurrence?.title ?? t('calendar.detailsTitle')}
    >
      {occurrence && date ? (
        <dl className="details">
          <dt>{t('calendar.detailsDate')}</dt>
          <dd>
            <time dateTime={occurrence.date}>
              {date.getDate()} {months[date.getMonth()] ?? ''} {date.getFullYear()}
            </time>
            {/* Only when the backend supplied one — a month the Ministry has
                not announced carries no Hijri label at all (Revision 31). */}
            {occurrence.hijri_date ? (
              <span className="details__hijri" dir="ltr">
                {occurrence.hijri_date}
              </span>
            ) : null}
          </dd>

          {occurrence.start_time ? (
            <>
              <dt>{t('calendar.detailsTime')}</dt>
              <dd dir="ltr">
                {occurrence.start_time}
                {occurrence.end_time ? ` — ${occurrence.end_time}` : ''}
              </dd>
            </>
          ) : null}

          <dt>{t('calendar.detailsKind')}</dt>
          <dd>{t(occurrence.kind === 'group' ? 'calendar.kindGroup' : 'calendar.kindEvent')}</dd>

          {occurrence.visibility ? (
            <>
              <dt>{t('calendar.detailsVisibility')}</dt>
              <dd>{visibilityLabel(occurrence.visibility)}</dd>
            </>
          ) : null}
        </dl>
      ) : null}
    </Dialog>
  );
}

/** Unknown tiers fall back to the raw value rather than an empty cell, so a
 *  tier added server-side is visible instead of invisible. */
function visibilityLabel(visibility: string): string {
  const key = `calendar.visibility${visibility.charAt(0).toUpperCase()}${visibility.slice(1)}`;
  const label = t(key);
  return label === key ? visibility : label;
}
