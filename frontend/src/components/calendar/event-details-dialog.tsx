import type { ReactNode } from 'react';

import type { Occurrence } from '../../adapters/calendar.js';
import { OCCURRENCE_KIND_BADGE, OCCURRENCE_KIND_LABEL } from '../../adapters/calendar.js';
import { t, tList } from '../../i18n/index.js';
import { ButtonLink } from '../ui/button.js';
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
            <dd>
              <span className={`badge badge--${OCCURRENCE_KIND_BADGE[occurrence.kind]}`}>
                {t(OCCURRENCE_KIND_LABEL[occurrence.kind])}
              </span>
            </dd>

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

          <OccurrenceMaterials occurrence={occurrence} />
        </>
      ) : null}
    </Dialog>
  );
}

/**
 * **The way from a class occurrence to its materials** (2026-08-17).
 *
 * ## What this replaced
 *
 * `EventResources`, a reserved area citing `EducationalContent.event_id` — a
 * foreign key **Revision 43 retired**: *"it expressed one relationship, in one
 * direction, to the wrong entity."* §7's deletion table states the consequence
 * outright: *"content no longer attaches to Events."* The seam promised a
 * relationship the model had deliberately removed, on exactly the question a
 * reader of this file comes here to ask — and a dormant seam for a deleted
 * relationship is an invitation to reinstate it by accident.
 *
 * **What R43 put in its place is `SessionContent`** — content referenced
 * many-to-many by a **Session**, the materialised occurrence of a Course
 * Schedule. That is where a class's materials and recordings live, and
 * `/calendar/sessions/{id}` already renders both.
 *
 * ## Why a link rather than the list itself
 *
 * The occurrence carries no content, and widening `GET /calendar` so every
 * occurrence ships its materials would make a month's read pay for data almost no
 * reader opens. The session page already exists, is already public-scoped, and is
 * already what the student dashboard links to — so this is a route into it rather
 * than a second rendering of it (rule P: expose, never duplicate).
 *
 * ## Only for a session
 *
 * An `activity` is an `Event`, and an Event has **no** content relationship
 * (R43); an exam has its own surfaces (§4.6). Offering this on either would be a
 * door to a room that does not exist, so the kind decides.
 *
 * **Whether an Event should regain a content relationship is an open Owner
 * decision** (2026-08-17). If it is taken, the list belongs here and the kind
 * check is what widens.
 */
function OccurrenceMaterials({ occurrence }: { occurrence: Occurrence }): ReactNode {
  if (occurrence.kind !== 'session') return null;
  return (
    <section className="details__section" aria-labelledby="details-materials">
      <h3 id="details-materials" className="details__section-title">
        {t('session.materials')}
      </h3>
      {/* The shared button as a link — it emits an `<a>`, so middle-click and
          "open in new tab" keep working while the affordance matches every other
          action on the platform. */}
      <ButtonLink variant="secondary" href={`/calendar/sessions/${occurrence.id}`}>
        {t('calendar.detailsOpenSession')}
      </ButtonLink>
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
