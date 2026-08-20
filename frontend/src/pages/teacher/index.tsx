import type { ReactNode } from 'react';

import { ModulePending } from '../../components/portal/nav-item.js';
import { TeacherLayout } from '../../components/teacher/teacher-layout.js';
import { PersonalCalendar } from '../../components/calendar/personal-calendar.js';
import { useSession } from '../../contexts/session.js';
import { ButtonLink } from '../../components/ui/button.js';
import { t } from '../../i18n/index.js';
import { teacherModuleForPath } from '../../lib/teacher-modules.js';
import { ContentPage } from '../content.js';
import { TeacherExamsPage } from './exams.js';
import { TeacherQuranPage } from './quran.js';
import { TeacherSchedulesPage } from './schedules.js';

/**
 * Teacher-portal routing.
 *
 * The same resolver shape the back office uses, reading the teacher registry:
 * a route cannot exist without a navigation entry or a permission, because the
 * three are the same list.
 *
 * **A module still `blocked` says why**, specifically — §14.4 forbids the blank
 * page, and naming what is missing is what stops the same investigation being
 * repeated.
 *
 * `/teacher/schedules` is live and consumes **the same endpoint the back office
 * does**: the Document Owner decided (2026-08-05) to role-scope
 * `GET /admin/course-schedules` internally rather than add a teacher route
 * returning the identical representation.
 */
export function TeacherRouter(): ReactNode {
  const module = teacherModuleForPath(window.location.pathname);
  if (!module) return <TeacherNotFound />;

  if (module.status === 'ready') {
    switch (module.path) {
      case '/teacher':
        return <TeacherHome />;
      case '/teacher/calendar':
        return <TeacherCalendar />;
      case '/teacher/schedules':
        return <TeacherSchedulesPage />;
      case '/teacher/quran':
        // R73.1 — `?student=` is the deep link, not a second node.
        return (
          <TeacherQuranPage
            studentId={new URLSearchParams(window.location.search).get('student')}
          />
        );
      case '/teacher/exams':
        // R70 — the marking half. The online paper builder stays out (§4.6).
        return <TeacherExamsPage />;
      case '/teacher/content':
        // The same screen the back office renders. The capability is identical;
        // only the chrome and what the server will accept differ (§4.9).
        return <ContentPage portal="teacher" />;
      default:
        // A `ready` module with no case here is a REGISTRY DEFECT: the
        // navigation promises a screen the router cannot render. Falling
        // through to the named pending state is the honest failure.
        break;
    }
  }

  return (
    <TeacherLayout title={t(module.labelKey)}>
      <ModulePending module={module} />
    </TeacherLayout>
  );
}

/**
 * **مساحة التدريس — deliberately minimal, for now.**
 *
 * The Owner asked that this stay empty until the dashboard is designed: cards
 * invented before the questions they answer are decided become the thing the
 * design has to work around. The navigation beside it is the real answer for
 * now, and every workflow is one click from it.
 */
function TeacherHome(): ReactNode {
  return (
    // **Nothing but the title and the lede** (2026-08-20). The placeholder
    // «ستُضاف لوحة مختصرة هنا لاحقاً» promised a screen nobody had designed and
    // occupied the page telling the reader to use the menu beside it — which
    // the lede already says. Future-placeholder copy is removed rather than
    // restyled; the string is gone from the catalogue too, so nothing can pick
    // it up again.
    <TeacherLayout title={t('teacher.nav.dashboard')} lede={t('teacher.homeLede')}>
      {null}
    </TeacherLayout>
  );
}

/**
 * **The مؤطرة's own calendar** (R83.4, R83.5).
 *
 * Its own node now, rather than the dashboard's content: the landing page stays
 * minimal until it is designed, and the **same** calendar components the
 * beneficiary's page renders are used here, so neither can drift from the other.
 *
 * **Notifications are not here any more** — they moved to the top bar's bell,
 * reachable from every screen rather than only from the one she happened to
 * land on.
 */
function TeacherCalendar(): ReactNode {
  const { accessToken } = useSession();
  return (
    <TeacherLayout title={t('teacher.nav.calendar')}>
      {/* **R84's مؤطرة matrix**: everything the back office offers, because she
          works across branches and levels — and every option is restricted to
          her legitimate scope by the server, so the dropdown itself never
          becomes a way to enumerate branches she does not teach at (rule O). */}
      <PersonalCalendar
        token={accessToken}
        fields={['branchId', 'categoryId', 'levelId', 'type', 'subjectId', 'groupId', 'circleId']}
        columns={['kind', 'title', 'date', 'time', 'level', 'subject', 'audience', 'branch', 'room']}
        heading={t('teacher.myCalendar')}
      />
    </TeacherLayout>
  );
}

function TeacherNotFound(): ReactNode {
  return (
    <TeacherLayout title={t('admin.notFound')}>
      <div className="state" role="status">
        <p>{t('admin.notFoundBody')}</p>
        <ButtonLink variant="secondary" href="/teacher">
          {t('teacher.nav.dashboard')}
        </ButtonLink>
      </div>
    </TeacherLayout>
  );
}
