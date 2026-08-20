import { useContext, useEffect, useState, type ReactNode } from 'react';

import type { Occurrence, SessionPage } from '../../adapters/calendar.js';
import {
  fetchSessionPage,
  OCCURRENCE_KIND_BADGE,
  OCCURRENCE_KIND_LABEL,
} from '../../adapters/calendar.js';
import { SessionContext } from '../../contexts/session.js';
import { t, tList } from '../../i18n/index.js';
import { ButtonLink } from '../ui/button.js';
import { Dialog } from '../ui/dialog.js';
import { deliveryLabel, mediaLabel } from '../scheduling/delivery.js';

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

            {/**
              * **R97 — طريقة الحضور**, and only for the kinds that have one.
              *
              * `deliveryLabel` returns `null` for an Event and an Exam, which
              * carry no delivery model at all — so the row is absent for them
              * rather than asserting «حضوري» about something the row does not
              * say. Same discipline as every other field here.
              *
              * «دخول الحصة» now exists (R98) and is rendered below the list —
              * an action, not a field, so it does not sit in the definition
              * list beside the facts.
              */}
            {deliveryLabel(occurrence) ? (
              <>
                <dt>{t('delivery.label')}</dt>
                <dd>{deliveryLabel(occurrence)}</dd>
              </>
            ) : null}

            {mediaLabel(occurrence) ? (
              <>
                <dt>{t('delivery.mediaLabel')}</dt>
                <dd>{mediaLabel(occurrence)}</dd>
              </>
            ) : null}

            {/* An online occurrence holds no room at all (R97), so this is
                absent by construction rather than by a check here. */}
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

          <JoinAction occurrence={occurrence} />

          <OccurrenceMaterials occurrence={occurrence} />
        </>
      ) : null}
    </Dialog>
  );
}

/**
 * **«دخول الحصة» — offered only where it can mean something** (R98.19).
 *
 * Three conditions, and each excludes a case that would otherwise ship a door
 * to nowhere:
 *
 * 1. **A class**, not an Event or an Exam — neither has a delivery model at all
 *    (R97.10), so neither has a room.
 * 2. **Delivered عن بُعد.** An in-person occurrence has a room at a branch and
 *    joining it is a bus ride, not a button.
 * 3. **An authenticated reader.** The public calendar shows «عن بُعد» to
 *    anonymous visitors — it is a fact about the class — but a teaching room is
 *    never reachable without a Bodour identity, and offering a control that can
 *    only refuse would be a worse answer than offering none (R98.30).
 *
 * **It is a link, and authorization is NOT decided here** (rule O). Whether this
 * particular reader may enter — whether she is in the R92 audience, staffs it
 * under R91, or is a guardian of somebody who is — is answered by the server
 * when the classroom asks, and the classroom says so in her own words.
 *
 * Probing that answer at dialog-open time was rejected on two grounds: it would
 * cost an authorization request for every occurrence anybody merely *looked* at,
 * and it would be **stale by the time she clicked** — the join window opens
 * fifteen minutes before the class, so the honest answer changes while the
 * dialog is open.
 */
function JoinAction({ occurrence }: { occurrence: Occurrence }): ReactNode {
  const accessToken = useContext(SessionContext)?.accessToken ?? null;
  if (occurrence.kind !== 'session') return null;
  if (occurrence.delivery_mode !== 'online') return null;
  if (!accessToken) return null;

  return (
    <p className="details__action">
      <ButtonLink variant="primary" href={`/classroom/${occurrence.id}`}>
        {t('classroom.join')}
      </ButtonLink>
    </p>
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
/**
 * **The Session's own content, in the popup** (R86).
 *
 * It rendered a link — «فتح صفحة الحصة وموادها» — so answering *what was
 * recorded for this class* cost a navigation away from the calendar somebody was
 * reading. The content is now shown where the question is asked.
 *
 * **A focused read when the popup opens**, not a wider calendar payload: a month
 * carries dozens of occurrences and almost none of them are opened, so attaching
 * every session's content to the grid's response would fetch far more than any
 * reader uses. `GET /calendar/sessions/{id}` already exists and already answers
 * **at the caller's tier** (TD-3.4) — an anonymous visitor sees a public
 * session's materials and never its private recordings, and a signed-in reader
 * sees what her own authorisation allows. Nothing about visibility is decided
 * here; this renders what the server returned (rule O).
 *
 * The link survives as a secondary action, because the Session page also carries
 * what a popup should not grow: the full description and the staffing.
 */
function OccurrenceMaterials({ occurrence }: { occurrence: Occurrence }): ReactNode {
  /**
   * **The context directly, not `useSession()`** — which throws outside a
   * provider.
   *
   * This dialog is the one the **public** calendar opens, where there may be no
   * session at all, and it is rendered standalone in tests. A component that
   * must work for an anonymous reader cannot require the authenticated
   * container; `null` here means *ask anonymously*, which is exactly what the
   * public tier expects (TD-3.4).
   */
  const accessToken = useContext(SessionContext)?.accessToken ?? null;
  const [page, setPage] = useState<SessionPage | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    if (occurrence.kind !== 'session') return;
    let live = true;
    setState('loading');
    fetchSessionPage(occurrence.id, accessToken)
      .then((result) => {
        // The dialog can close before the read lands; writing state then would
        // be a warning and, worse, a render of the previous session's content.
        if (live) {
          setPage(result);
          setState('ready');
        }
      })
      .catch(() => {
        if (live) setState('error');
      });
    return () => {
      live = false;
    };
  }, [occurrence.id, occurrence.kind, accessToken]);

  if (occurrence.kind !== 'session') return null;

  const recordings = page?.recordings ?? [];
  const materials = page?.linked_content ?? [];

  return (
    <section className="details__section" aria-labelledby="details-materials">
      <h3 id="details-materials" className="details__section-title">
        {t('session.materials')}
      </h3>

      {state === 'loading' ? <p className="muted">{t('notifications.loading')}</p> : null}
      {state === 'error' ? <p className="muted">{t('calendar.error')}</p> : null}

      {/**
        * **Two sections, always both** (2026-08-20).
        *
        * The combined «لا تسجيلات ولا مواد مرفقة بهذه الحصة» collapsed two
        * different questions into one sentence, and then a heading repeated one
        * of them underneath. A reader looking for *is there a recording* had to
        * parse a sentence about something else as well.
        *
        * They are separate concepts and are rendered separately, each with its
        * own empty state — and **only after a successful read**: an error says
        * so instead of claiming there is nothing (§B8).
        */}
      {state === 'ready' ? (
        <>
          <h4 className="details__section-subtitle">{t('session.recordings')}</h4>
          {recordings.length === 0 ? (
            <p className="muted">{t('session.noRecordings')}</p>
          ) : (
            <ul className="details__list">
              {recordings.map((item) => (
                <li key={item.id}>
                  {/* The existing library flow, which is where the download
                      permission and the presigned URL live (TD-3.5) — never a
                      second viewer. */}
                  <a href={`/resources?content=${item.id}`}>{item.title}</a>
                </li>
              ))}
            </ul>
          )}

          <h4 className="details__section-subtitle">{t('session.attachments')}</h4>
          {materials.length === 0 ? (
            <p className="muted">{t('session.noAttachments')}</p>
          ) : (
            <ul className="details__list">
              {materials.map((item) => (
                <li key={item.id}>
                  <a href={`/resources?content=${item.id}`}>{item.title}</a>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}

      {/**
        * **No longer here** (2026-08-20). «فتح صفحة الحصة وموادها» was the way
        * to answer *what was recorded for this class*, so inspecting materials
        * cost a navigation away from the calendar being read. Both sections are
        * above; the Session page keeps its other uses and is reachable from the
        * library, but it is not the route to this answer any more.
        */}
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
