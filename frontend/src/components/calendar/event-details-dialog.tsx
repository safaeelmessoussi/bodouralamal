import { useContext, useEffect, useState, type ReactNode } from 'react';

import type { Occurrence, SessionDetails } from '../../adapters/calendar.js';
import {
  fetchSessionDetails,
  OCCURRENCE_KIND_BADGE,
  OCCURRENCE_KIND_LABEL,
} from '../../adapters/calendar.js';
import { useActiveRoleOrNull } from '../../contexts/active-role.js';
import { SessionContext } from '../../contexts/session.js';
import { t, tList } from '../../i18n/index.js';
import { Button, ButtonLink } from '../ui/button.js';
import { levelLabel } from '../scope/level-select.js';
import { Dialog } from '../ui/dialog.js';
import { AttendancePanel } from './attendance-panel.js';
import { deliveryLabel, mediaLabel } from '../scheduling/delivery.js';

/** The roles that may reach الجدولة at all — the same set `AttendancePanel`
 *  already uses to decide who sees the staff sheet rather than one button. */
const STAFF_ROLES = ['admin', 'super_admin', 'teacher'];

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
                {occurrence.scheduling_type_name ?? t(OCCURRENCE_KIND_LABEL[occurrence.kind])}
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
                <dd>{levelLabel({ id: occurrence.level_id ?? '', name: occurrence.level_name, category_name: occurrence.category_name })}</dd>
              </>
            ) : null}

            {occurrence.subject_name ? (
              <><dt>{t('calendar.table.subject')}</dt><dd>{occurrence.subject_name}</dd></>
            ) : null}
            {occurrence.audience_label ? (
              <><dt>{t('calendar.table.audience')}</dt><dd>{occurrence.audience_label}</dd></>
            ) : null}
            {occurrence.status === 'cancelled' ? (
              <><dt>{t('calendar.detailsStatus')}</dt><dd role="status">{t('calendar.cancelled')}</dd></>
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
          <ExamAvailabilityAction occurrence={occurrence} />

          {/**
            * **R123 — الحضور, where the occurrence already is.**
            *
            * All four calendars open this dialog, so putting the register here
            * gives one entry point for a class, an activity and a sitting with
            * no new route and no menu node that would show nothing until a deep
            * link filled it (rule A). The panel decides nothing: staff get the
            * sheet because the server allows the read, a beneficiary gets one
            * button and never the roster, and a عطلة or a حفل renders neither.
            */}
          <AttendancePanel occurrence={occurrence} />

          <OccurrenceMaterials key={occurrence.id} occurrence={occurrence} />
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
 * **«بدء الاختبار» — R136 clause 16/17, calendar visibility and Student
 * access as two separate facts.**
 *
 * A remote exam occurrence appears on the calendar the moment it is
 * scheduled, exactly like a physical sitting (R109's tier, unchanged) —
 * `available_from` never hides the row. This is the OTHER fact: whether it
 * can be OPENED right now. Three states, each its own sentence rather than
 * one message straining to cover all three:
 *
 * 1. `available_from === null` — still on manual opening; an operator has
 *    not opened it yet, and no countdown exists to promise one (R136 clause
 *    17: manual opening is one-way and nothing here predicts it).
 * 2. A future instant — reachable, and says exactly when.
 * 3. `now >= available_from` — reachable now, and offers the door.
 *
 * **A physical sitting has no row here at all** — attending one was never
 * gated by this platform, and `available_from` is `null` by construction for
 * it (R136 clause 5).
 *
 * **Authorization is NOT decided here** (rule O, the same discipline
 * `JoinAction` states above): whether THIS reader may actually open THIS
 * paper is `eligible()`'s question, asked again — and enforced — the moment
 * `/dashboard/student/assessments` reads it. Probing that here would cost a
 * request for every occurrence anybody merely looked at and would still be
 * stale by the time she clicked.
 */
function ExamAvailabilityAction({ occurrence }: { occurrence: Occurrence }): ReactNode {
  if (occurrence.kind !== 'exam') return null;
  if (occurrence.delivery_mode !== 'online') return null;
  return <ExamAccessAction examId={occurrence.id} availableFrom={occurrence.available_from} />;
}

/**
 * **The three-state availability action, factored out so a linked exam
 * (R137, `SessionLinkedExams` below) reads exactly the same states an exam's
 * OWN occurrence dialog does** — one implementation of *is it open yet*,
 * not two that could quietly disagree.
 */
function ExamAccessAction({
  examId,
  availableFrom,
}: {
  examId: string;
  availableFrom: string | null;
}): ReactNode {
  const accessToken = useContext(SessionContext)?.accessToken ?? null;

  if (availableFrom === null) {
    return <p className="details__action muted">{t('calendar.examNotYetOpened')}</p>;
  }

  const opensAt = new Date(availableFrom);
  if (opensAt.getTime() > Date.now()) {
    return (
      <p className="details__action muted">
        {t('calendar.examOpensAt')}{' '}
        <time dateTime={availableFrom} dir="ltr">
          {opensAt.toLocaleString('ar', { dateStyle: 'medium', timeStyle: 'short' })}
        </time>
      </p>
    );
  }

  if (!accessToken) return null;

  return (
    <p className="details__action">
      <ButtonLink
        variant="primary"
        href={`/dashboard/student/assessments?exam=${encodeURIComponent(examId)}`}
      >
        {t('calendar.examStart')}
      </ButtonLink>
    </p>
  );
}

/** Focused SessionContent read at the caller's tier, only when opened.
 * The month payload remains self-sufficient for occurrence facts; materials
 * reuse the existing scoped API instead of widening every calendar response.
 * Events have no content relationship. No separate detail page exists.
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
  const activeRoles = useActiveRoleOrNull()?.activeRoles ?? [];
  const canLinkExam = activeRoles.some((role) => STAFF_ROLES.includes(role));
  const [page, setPage] = useState<SessionDetails | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (occurrence.kind !== 'session') return;
    let live = true;
    setState('loading');
    fetchSessionDetails(occurrence.id, accessToken)
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
  }, [occurrence.id, occurrence.kind, accessToken, attempt]);

  if (occurrence.kind !== 'session') return null;

  const recordings = page?.recordings ?? [];
  const materials = page?.linked_content ?? [];
  const linkedExams = page?.linked_exams ?? [];

  return (
    <>
      {/**
        * **R137 — a lesson may gain a quick test days later, without
        * pretending it happened today.** The Session's own date never
        * changes; whether the linked exam can be OPENED right now is a
        * separate fact, read exactly as an exam occurrence's own dialog
        * reads it (`ExamAccessAction`, shared).
        */}
      {state === 'ready' && (linkedExams.length > 0 || canLinkExam) ? (
        <section className="details__section" aria-labelledby="details-linked-exams">
          <h3 id="details-linked-exams" className="details__section-title">
            {t('session.linkedExams')}
          </h3>
          {linkedExams.length === 0 ? (
            <p className="muted">{t('session.noLinkedExams')}</p>
          ) : (
            <ul className="details__list">
              {linkedExams.map((exam) => (
                <li key={exam.id}>
                  <p>{exam.title}</p>
                  {exam.mode === 'online' ? (
                    <ExamAccessAction examId={exam.id} availableFrom={exam.available_from} />
                  ) : (
                    // A physical sitting is never "opened" online — attending
                    // one was never gated by this platform (R136 clause 5).
                    <p className="details__action muted">{t('session.linkedExamPhysical')}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
          {/**
            * **R137 — إضافة اختبار / ربط اختبار.** Routes to الجدولة, the
            * one canonical scheduling write (R136) — never a second form
            * here. The Session is prefilled as the target; which paper to
            * use is still the operator's own choice, made there. Rule O:
            * offered only to staff who could plausibly reach الجدولة at
            * all, never decided here — the route itself still refuses
            * anyone the server would.
            */}
          {canLinkExam ? (
            <p className="details__action">
              <ButtonLink
                variant="secondary"
                href={`/admin/schedules?kind=exam&new=1&target_kind=session&target_id=${encodeURIComponent(occurrence.id)}`}
              >
                {t('session.linkExam')}
              </ButtonLink>
            </p>
          ) : null}
        </section>
      ) : null}

    <section className="details__section" aria-labelledby="details-materials">
      <h3 id="details-materials" className="details__section-title">
        {t('session.materials')}
      </h3>

      {state === 'loading' ? <p className="muted">{t('notifications.loading')}</p> : null}
      {state === 'error' ? <><p className="muted">{t('calendar.error')}</p><Button onClick={() => setAttempt((n) => n + 1)}>{t('states.offlineRetry')}</Button></> : null}

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
                  <a href={`/resources?level=${item.level_id}&content=${item.id}`}>{item.title}</a>
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
                  <a href={`/resources?level=${item.level_id}&content=${item.id}`}>{item.title}</a>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </section>
    </>
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
