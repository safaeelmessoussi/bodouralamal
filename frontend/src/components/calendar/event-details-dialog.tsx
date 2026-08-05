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
 * **Only fields the backend actually sends are rendered**, and a field with no
 * value is **absent rather than shown empty** — an empty row claims the value
 * is blank, which is a different statement from "not recorded".
 *
 * Revision 36 made the occurrence self-sufficient, so opening an event costs no
 * further request. Instructor names arrive **already resolved** (Revision 36.1):
 * the backend decided which name is public, and this renders it verbatim. A
 * client-side `publicName || fullName` here would be a second source of truth
 * for which name a person agreed to publish, and the wrong branch leaks a legal
 * name.
 */
export function EventDetailsDialog({
  occurrence,
  branchNames,
  onClose,
}: {
  occurrence: Occurrence | null;
  /** id → name, from the public `GET /branches` the page already loads. Used
   *  only as a fallback: Revision 36 puts `branch_name` on the occurrence. */
  branchNames: Map<string, string>;
  onClose: () => void;
}): ReactNode {
  const months = tList('calendar.months');
  const date = occurrence ? new Date(`${occurrence.date}T00:00:00`) : null;
  const branch =
    occurrence?.branch_name ??
    (occurrence?.branch_id ? branchNames.get(occurrence.branch_id) : undefined);

  return (
    <Dialog
      open={occurrence !== null}
      onClose={onClose}
      title={occurrence?.title ?? t('calendar.detailsTitle')}
    >
      {occurrence && date ? (
        <>
          {/* The description leads, because it is prose the reader wants before
              a table of attributes — and it is the one field that cannot be
              scanned. */}
          {occurrence.description ? (
            <p className="details__description">{occurrence.description}</p>
          ) : null}

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
            <dd>{t(occurrence.kind === 'session' ? 'calendar.kindSession' : 'calendar.kindEvent')}</dd>

            {/* Recurrence is meaningful only when there is one; `none` is the
                default every event carries, so printing "لا يتكرر" on every
                single item would be noise. */}
            {occurrence.recurrence && occurrence.recurrence !== 'none' ? (
              <>
                <dt>{t('calendar.detailsRecurrence')}</dt>
                <dd>{recurrenceLabel(occurrence.recurrence)}</dd>
              </>
            ) : null}

            {occurrence.category_name ? (
              <>
                <dt>{t('calendar.detailsCategory')}</dt>
                <dd>{occurrence.category_name}</dd>
              </>
            ) : null}

            {occurrence.level_name ? (
              <>
                <dt>{t('calendar.detailsLevel')}</dt>
                <dd>{occurrence.level_name}</dd>
              </>
            ) : null}

            {branch ? (
              <>
                <dt>{t('calendar.detailsBranch')}</dt>
                <dd>{branch}</dd>
              </>
            ) : null}

            {occurrence.room_name ? (
              <>
                <dt>{t('calendar.detailsRoom')}</dt>
                <dd>{occurrence.room_name}</dd>
              </>
            ) : null}

            {occurrence.instructors.length > 0 ? (
              <>
                <dt>{t('calendar.detailsInstructors')}</dt>
                {/* Rendered exactly as returned — the backend already decided
                    which name is public (Revision 36.1, §20 rule 21). */}
                <dd>{occurrence.instructors.map((i) => i.display_name).join('، ')}</dd>
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

/**
 * The recurrence enum, translated. Same fallback discipline as visibility: a
 * pattern added server-side shows its raw value rather than vanishing.
 *
 * `biweekly_alternating` is the one §4.4 singles out as needing explicit
 * modelling and testing, so it gets a label that says what it actually means
 * rather than a transliteration.
 */
function recurrenceLabel(recurrence: string): string {
  const key = `calendar.recurrence.${recurrence}`;
  const label = t(key);
  return label === key ? recurrence : label;
}
