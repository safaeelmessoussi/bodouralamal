import type { ReactNode } from 'react';

import type { Occurrence } from '../../adapters/calendar.js';
import { t, tList } from '../../i18n/index.js';
import { Dialog } from '../ui/dialog.js';

/**
 * Event details.
 *
 * **A dialog rather than a panel below the calendar**, decided on the page's own
 * shape: the grid claims most of the viewport height, so a panel underneath
 * would open below the fold and make every click a scroll. The dialog keeps the
 * grid in place, works as a sheet on a phone, and scrolls internally as the
 * content grows.
 *
 * Rendered as a definition list, so each field is announced with its label
 * rather than as a run of unlabelled text.
 *
 * **Only fields the backend actually sends are rendered.** `GET /calendar`
 * returns `kind, id, title, date, start_time, end_time, visibility, branch_id`
 * and the Hijri overlay — so category, level, room, instructor, recurrence and
 * description have no source yet and are **absent rather than shown empty**.
 * Rows for them appear here the moment the contract carries them; inventing a
 * placeholder would be worse than an honest omission.
 *
 * The branch **name** is the one field resolved rather than displayed raw: the
 * page already holds the public branch directory, so the id is looked up rather
 * than re-fetched or hardcoded.
 */
export function EventDetailsDialog({
  occurrence,
  branchNames,
  onClose,
}: {
  occurrence: Occurrence | null;
  /** id → name, from the public `GET /branches` the page already loads. */
  branchNames: Map<string, string>;
  onClose: () => void;
}): ReactNode {
  const months = tList('calendar.months');
  const date = occurrence ? new Date(`${occurrence.date}T00:00:00`) : null;
  const branch = occurrence?.branch_id ? branchNames.get(occurrence.branch_id) : undefined;

  return (
    <Dialog
      open={occurrence !== null}
      onClose={onClose}
      title={occurrence?.title ?? t('calendar.detailsTitle')}
    >
      {occurrence && date ? (
        <>
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

            {branch ? (
              <>
                <dt>{t('calendar.detailsBranch')}</dt>
                <dd>{branch}</dd>
              </>
            ) : null}

            {occurrence.visibility ? (
              <>
                <dt>{t('calendar.detailsVisibility')}</dt>
                <dd>{visibilityLabel(occurrence.visibility)}</dd>
              </>
            ) : null}
          </dl>

          <EventResources />
        </>
      ) : null}
    </Dialog>
  );
}

/**
 * The reserved area for §4.9 educational content attached to an event
 * (`EducationalContent.event_id`).
 *
 * It renders nothing until there is something to render — an empty box would be
 * noise on every event that has no attachment, which is currently all of them.
 * The seam is the point: when the contract carries attachments, they become a
 * list here and the dialog's layout does not move.
 */
function EventResources({ resources = [] }: { resources?: { id: string; title: string }[] }): ReactNode {
  if (resources.length === 0) return null;
  return (
    <section className="details__section" aria-labelledby="details-resources">
      <h3 id="details-resources" className="details__section-title">
        {t('calendar.detailsResources')}
      </h3>
      <ul className="details__resources">
        {resources.map((resource) => (
          <li key={resource.id}>{resource.title}</li>
        ))}
      </ul>
    </section>
  );
}

/** Unknown tiers fall back to the raw value rather than an empty cell, so a
 *  tier added server-side is visible instead of invisible. */
function visibilityLabel(visibility: string): string {
  const key = `calendar.visibility${visibility.charAt(0).toUpperCase()}${visibility.slice(1)}`;
  const label = t(key);
  return label === key ? visibility : label;
}
