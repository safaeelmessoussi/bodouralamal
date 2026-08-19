import type { ReactNode } from 'react';

import { ModulePending } from '../../components/portal/nav-item.js';
import { TeacherLayout } from '../../components/teacher/teacher-layout.js';
import { NotificationList } from '../../components/notifications/notification-list.js';
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
        return <TeacherDashboard />;
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
 * **The مؤطرة's own screen** (R83.4, R83.5).
 *
 * It was `blocked` because there was nothing to put on it. There is now: what
 * the platform has told her, and her own week — the **same** notification list
 * and the **same** calendar components the beneficiary's dashboard renders, so
 * neither surface can drift from the other.
 *
 * **She is offered the Subject filter and no more.** She teaches several and
 * *which class* is the question she asks of her own week; a branch or level
 * control would offer a scope §4.4c does not give her, and the server would
 * refuse to widen it anyway (rule O).
 */
function TeacherDashboard(): ReactNode {
  const { accessToken } = useSession();
  return (
    <TeacherLayout title={t('teacher.nav.dashboard')}>
      <NotificationList token={accessToken} />
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
