import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { fetchStudentIdentity, type StudentIdentity } from '../../adapters/students.js';
import { PersonalCalendar } from '../../components/calendar/personal-calendar.js';
import { StudentLayout } from '../../components/student/student-layout.js';
import { ButtonLink } from '../../components/ui/button.js';
import { EmptyState, ErrorState, LoadingState } from '../../components/states.js';
import { useActiveChild } from '../../contexts/active-child.js';
import { useActiveRole } from '../../contexts/active-role.js';
import { useSession } from '../../contexts/session.js';
import { t } from '../../i18n/index.js';
import { ApiError } from '../../lib/api.js';


export function StudentDashboard(): ReactNode {
  const { accessToken, status } = useSession();
  const { activeRole } = useActiveRole();
  const { activeChild, activeChildId, children } = useActiveChild();

  const [identity, setIdentity] = useState<StudentIdentity | null>(null);
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

      // **The upcoming-sessions fetch went with the section it fed** (R85):
      // those occurrences are in تقويمي, and one page asking for them twice was
      // a request whose answer nobody rendered.
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
    <StudentLayout title={t('studentDashboard.title')}>
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
              {/* **R86 — the Category, Level and Branch moved to حسابي.** They
                  are facts about her account, not about her day, and the Owner
                  asked that this page show nothing until it is designed. */}
              <p className="muted">{t('studentDashboard.landing')}</p>
              {/* **Deliberately nothing else here** (R85).
                  «حصص اليوم والقادمة» is removed: those occurrences are in
                  تقويمي, and showing them twice makes one of the two the wrong
                  place to look. The notification list moved to the top bar's
                  bell, reachable from every screen rather than only this one.
                  The rest of this page is left to be designed. */}
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
        </StudentLayout>
  );
}


/**
 * **تقويمي** — her own week (R82.8, R85).
 *
 * Its own node rather than a block on the dashboard: the landing page stays
 * minimal until it is designed, and a calendar somebody opens daily belongs one
 * click from the menu. The components are the shared ones — a personal calendar
 * is a narrower READ, never a different screen.
 */
export function StudentCalendarPage(): ReactNode {
  const { accessToken } = useSession();
  return (
    <StudentLayout title={t('student.nav.calendar')}>
      {/* **R84's student matrix.** She may hold enrolments in several Levels, so
          المستوى is hers to narrow by — with النوع, المادة, المجموعة and
          الحلقة, each restricted to her own occurrences by the server. **No
          الفرع and no الفئة**: her calendar is already hers, and either would
          offer a scope she does not have (rule O). */}
      <PersonalCalendar
        token={accessToken}
        fields={['levelId', 'type', 'subjectId', 'groupId', 'circleId']}
        columns={['kind', 'title', 'date', 'time', 'level', 'subject', 'room']}
        heading={t('studentDashboard.myCalendar')}
      />
    </StudentLayout>
  );
}
