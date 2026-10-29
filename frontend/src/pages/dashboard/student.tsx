import { useEffect, type ReactNode } from 'react';

import { PersonalCalendar } from '../../components/calendar/personal-calendar.js';
import { StudentLayout } from '../../components/student/student-layout.js';
import { useActiveChild } from '../../contexts/active-child.js';
import { useActiveRole } from '../../contexts/active-role.js';
import { useSession } from '../../contexts/session.js';
import { t } from '../../i18n/index.js';

/**
 * **R256 — «لوحة المستفيدة» is withdrawn** (the Owner: «remove the empty pages
 * … make تقويمي opened by default coming to the student dashboard»). It was
 * empty by the Owner's choice; its address, which links and the account
 * switcher may still carry, leads to «تقويمي».
 */
export function StudentDashboard(): ReactNode {
  useEffect(() => {
    window.location.replace(`/dashboard/student/calendar${window.location.search}`);
  }, []);
  return null;
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
  const { activeRole } = useActiveRole();
  const { activeChild, children } = useActiveChild();
  const asParent = activeRole === 'parent';
  return (
    <StudentLayout title={t('student.nav.calendar')}>
      {/* R62.10 — whose calendar, first under the heading; moved here from the
          withdrawn «لوحة المستفيدة» (R256), the page a parent used to land on. */}
      {asParent ? (
        <p className="state" role="status">
          {children.length === 0
            ? t('studentDashboard.noChildren')
            : activeChild
              ? t('studentDashboard.viewingChild').replace('{name}', activeChild.label)
              : t('studentDashboard.chooseChild')}
        </p>
      ) : null}
      {/* **R84's student matrix.** She may hold enrolments in several Levels, so
          المستوى is hers to narrow by — with النوع, المادة, المجموعة and
          الحلقة, each restricted to her own occurrences by the server. **No
          الفرع and no الفئة**: her calendar is already hers, and either would
          offer a scope she does not have (rule O). */}
      <PersonalCalendar
        as="student"
        token={accessToken}
        fields={['levelId', 'type', 'subjectId', 'groupId', 'circleId']}
        columns={['kind', 'title', 'date', 'time', 'level', 'subject', 'room']}
        heading={t('studentDashboard.myCalendar')}
        headingHidden
      />
    </StudentLayout>
  );
}
