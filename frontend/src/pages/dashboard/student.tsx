import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { fetchOccurrences, type Occurrence } from '../../adapters/calendar.js';
import { fetchStudentIdentity, type StudentIdentity } from '../../adapters/students.js';
import { ApplicationHeader } from '../../components/header/application-header.js';
import { NotificationList } from '../../components/notifications/notification-list.js';
import { SiteFooter } from '../../components/site-footer.js';
import { ButtonLink } from '../../components/ui/button.js';
import { EmptyState, ErrorState, LoadingState } from '../../components/states.js';
import { Container } from '../../components/ui/container.js';
import { useActiveChild } from '../../contexts/active-child.js';
import { useActiveRole } from '../../contexts/active-role.js';
import { useSession } from '../../contexts/session.js';
import { t } from '../../i18n/index.js';
import { ApiError } from '../../lib/api.js';

/**
 * `/dashboard/student` — the minimal Student Dashboard (§5.3, R62.10).
 *
 * **One route, two contexts.** It renders the caller's own record when they act
 * as a student, and the active child's when they act as a parent — because
 * `GET /students/me` resolves the *acting* student server-side (§4.3, R63). The
 * client sends the child header and reads whatever comes back; it never decides
 * whose data this is.
 *
 * **A persistent banner names whose data is shown** (R62.10). Not a toast and
 * not a subtitle: a parent who is looking at the wrong child's attendance must
 * find that out by reading the screen, not by noticing something is off.
 *
 * **Scope is R62.10's and stops there:** the identity block, today's and
 * upcoming sessions, and nothing else. Quran progress, grades and exams are
 * later milestones and are not stubbed here — an empty section promising a
 * feature is a §14.4 problem, not a placeholder.
 */
const UPCOMING_DAYS = 14;

export function StudentDashboard(): ReactNode {
  const { accessToken, status } = useSession();
  const { activeRole } = useActiveRole();
  const { activeChild, activeChildId, children } = useActiveChild();

  const [identity, setIdentity] = useState<StudentIdentity | null>(null);
  const [sessions, setSessions] = useState<Occurrence[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<{ requestId?: string } | null>(null);

  // A parent acts FOR a child, so the request must name one. Acting as a
  // student, the header is absent and the server uses the JWT `sub` — sending
  // a child id in that case would be asking for someone else's record.
  const asParent = activeRole === 'parent';
  const childHeader = asParent ? activeChildId : null;

  const load = useCallback(async () => {
    if (status !== 'authenticated') return;
    setLoading(true);
    setFailure(null);
    try {
      const block = await fetchStudentIdentity(accessToken, childHeader);
      setIdentity(block);

      // Today and the fortnight after it — "today's and upcoming" (R62.10)
      // bounded, because an unbounded window is a growing request nobody
      // asked for. Narrowed to the student's own Level so the list is theirs
      // rather than the whole institute's.
      const today = new Date().toISOString().slice(0, 10);
      const until = new Date(Date.now() + UPCOMING_DAYS * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const result = await fetchOccurrences({
        from: today,
        to: until,
        levelId: block.enrollments[0]?.level.id ?? null,
        token: accessToken,
      });
      setSessions(result.occurrences);
    } catch (error) {
      setIdentity(null);
      setFailure({
        ...(error instanceof ApiError && error.requestId
          ? { requestId: error.requestId }
          : {}),
      });
    } finally {
      setLoading(false);
    }
  }, [accessToken, childHeader, status]);

  useEffect(() => {
    void load();
  }, [load]);

  // A parent who has not chosen a child yet: the request would be refused with
  // a 400, so it is not made. Said plainly rather than rendered as an error —
  // nothing has gone wrong, a choice is simply outstanding.
  const awaitingChild = asParent && activeChildId === null;

  return (
    <>
      <ApplicationHeader />
      <main id="main" className="section">
        <Container>
          <h1>{t('studentDashboard.title')}</h1>

          {/* §14.1 lists *My Quran Progress* and *My Grades & Exams* under this
              dashboard. M4b built the first with nothing linking to it and
              nothing built the second at all — the same defect R69 and R70.1
              each fixed once: a screen that exists and cannot be reached.

              **These are the dashboard's own children, not a duplicate menu.**
              A student portal has no sidebar, so this is the only navigation
              these two nodes have — which is what makes it a hierarchy rather
              than a second access path to a sibling. */}
          <nav className="admin__actions" aria-label={t('studentDashboard.sections')}>
            {/* The shared button rendered as a link — it emits an `<a>` when
                `href` is present, so middle-click and "open in new tab" keep
                working while the affordance matches every other action. */}
            <ButtonLink href="/dashboard/student/quran" variant="secondary">
              {t('student.quran.title')}
            </ButtonLink>
            <ButtonLink href="/dashboard/student/grades" variant="secondary">
              {t('student.grades.title')}
            </ButtonLink>
          </nav>

          {/* R62.10 — persistent, and the first thing under the heading. */}
          {asParent ? (
            <p className="state" role="status">
              {activeChild
                ? t('studentDashboard.viewingChild').replace('{name}', activeChild.label)
                : t('studentDashboard.chooseChild')}
            </p>
          ) : null}

          {awaitingChild ? (
            <EmptyState />
          ) : loading ? (
            <LoadingState />
          ) : failure ? (
            <ErrorState
              {...(failure.requestId ? { requestId: failure.requestId } : {})}
              onRetry={() => void load()}
            />
          ) : identity ? (
            <>
              <IdentityBlock identity={identity} />
              {/* **Above the sessions, deliberately** (R77.8): a cancellation is
                  news about the list below it, and a reader who saw the timetable
                  first would have already drawn the wrong conclusion from it.
                  Renders nothing at all when there is nothing to say. */}
              <NotificationList token={accessToken} />
              <UpcomingSessions sessions={sessions} />
            </>
          ) : null}

          {/* R65 — registering a child is NOT a student's act, so no link to it
              lives here. It belongs to the person, in the personal section
              (`/profile`), reachable whatever role the account is working as. */}
          {asParent && children.length === 0 ? (
            <p className="state" role="status">
              {t('studentDashboard.noChildren')}
            </p>
          ) : null}
        </Container>
      </main>
      <SiteFooter />
    </>
  );
}

/** R62.10's identity block: name, reference code, Category, Level, branch. */
function IdentityBlock({ identity }: { identity: StudentIdentity }): ReactNode {
  const enrolment = identity.enrollments[0];
  return (
    <section className="card" aria-labelledby="identity-heading">
      <h2 id="identity-heading">{identity.name_arabic}</h2>
      <dl className="detail-list">
        {/* R62.6 — how a parent quotes a child without speaking a name aloud.
            Absent for an adult student, and the row disappears rather than
            rendering an empty value. */}
        {identity.reference_code ? (
          <>
            <dt>{t('studentDashboard.referenceCode')}</dt>
            <dd>{identity.reference_code}</dd>
          </>
        ) : null}
        {enrolment ? (
          <>
            <dt>{t('studentDashboard.category')}</dt>
            <dd>{enrolment.category.name}</dd>
            <dt>{t('studentDashboard.level')}</dt>
            <dd>{enrolment.level.name}</dd>
            <dt>{t('studentDashboard.branch')}</dt>
            <dd>{enrolment.branch.name}</dd>
          </>
        ) : null}
      </dl>
      {/* Honest about a student the administration has not placed yet, rather
          than rendering three blank rows. */}
      {enrolment ? null : <p className="muted">{t('studentDashboard.notPlaced')}</p>}
      {/* The list is plural in the contract because the model permits it; the
          block renders the first and says so instead of discarding the rest. */}
      {identity.enrollments.length > 1 ? (
        <p className="muted">
          {t('studentDashboard.moreEnrollments').replace(
            '{count}',
            String(identity.enrollments.length - 1),
          )}
        </p>
      ) : null}
    </section>
  );
}

function UpcomingSessions({ sessions }: { sessions: Occurrence[] }): ReactNode {
  return (
    <section aria-labelledby="upcoming-heading">
      <h2 id="upcoming-heading">{t('studentDashboard.upcoming')}</h2>
      {sessions.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="detail-list">
          {sessions.map((occurrence) => (
            <li key={`${occurrence.kind}-${occurrence.id}`}>
              <a href={`/calendar/sessions/${occurrence.id}`}>{occurrence.title}</a>
              {' — '}
              {occurrence.date}
              {occurrence.start_time ? ` · ${occurrence.start_time}` : ''}
              {occurrence.room_name ? ` · ${occurrence.room_name}` : ''}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
