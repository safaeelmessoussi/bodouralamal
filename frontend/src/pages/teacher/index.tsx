import type { ReactNode } from 'react';

import { ModulePending } from '../../components/portal/nav-item.js';
import { TeacherLayout } from '../../components/teacher/teacher-layout.js';
import { ButtonLink } from '../../components/ui/button.js';
import { t } from '../../i18n/index.js';
import { teacherModuleForPath } from '../../lib/teacher-modules.js';
import { ContentPage } from '../content.js';
import { TeacherExamsPage } from './exams.js';
import { TeacherQuranPage } from './quran.js';
import { ScheduleSessionsPage } from '../admin/schedule-sessions.js';
import { TeacherAvailabilityPage } from './availability.js';
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
/**
 * `/teacher/schedules/{id}/sessions` — the occurrences of a class she staffs
 * (R106).
 *
 * Matched by pattern rather than by a registry entry, exactly as
 * `/admin/schedules/{id}/sessions` is: the path carries an id, so nothing can
 * link to it from a menu and §14.1 lists it beneath `الجدولة` rather than as a
 * node of its own.
 */
const TEACHER_SESSIONS = /^\/teacher\/schedules\/([^/]+)\/sessions\/?$/;

export function TeacherRouter(): ReactNode {
  const sessions = TEACHER_SESSIONS.exec(window.location.pathname);
  if (sessions) {
    // **The same page the back office renders**, in her chrome and with TD-2's
    // teacher verbs (R106.6a). One capability, two ways in — the R70.1 rule
    // that put one grade sheet behind two menus.
    return <ScheduleSessionsPage scheduleId={sessions[1]!} portal="teacher" />;
  }

  const module = teacherModuleForPath(window.location.pathname);
  if (!module) return <TeacherNotFound />;

  if (module.status === 'ready') {
    switch (module.path) {
      case '/teacher':
        return <TeacherHome />;
      /**
       * **One surface, two paths** (merged 2026-08-20).
       *
       * `تقويمي` and `الجدولة` were two menu entries onto the same operational
       * question, so a مؤطرة had to know which of the two held what she wanted.
       * The menu now offers **الجدولة** alone; the old path still renders the
       * merged page rather than 404ing, because links and bookmarks to it exist
       * and breaking them would be a second, quieter defect.
       */
      case '/teacher/calendar':
      case '/teacher/schedules':
        return <TeacherSchedulesPage />;
      case '/teacher/availability':
        // R106 — «إدخال متى أنا متاحة». The question R88.2 reserved, now taken:
        // her own `TeacherAvailability` ranges, and nothing else.
        return <TeacherAvailabilityPage />;
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
 * **`TeacherCalendar` was retired by the merge** (2026-08-20).
 *
 * It rendered `PersonalCalendar` on its own node; that calendar now sits at the
 * top of `TeacherSchedulesPage`, so this component would have been a second way
 * to reach one surface — which is the thing the merge removed. The projection it
 * read (`/me/calendar`, R82.8) is untouched and is what the merged page renders.
 */
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
