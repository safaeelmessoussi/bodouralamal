import type { ReactNode } from 'react';

import { ModulePending } from '../../components/portal/nav-item.js';
import { TeacherLayout } from '../../components/teacher/teacher-layout.js';
import { ButtonLink } from '../../components/ui/button.js';
import { t } from '../../i18n/index.js';
import { TEACHER_HOME, TEACHER_REDIRECTS, teacherModuleForPath } from '../../lib/teacher-modules.js';
import { ContentPage } from '../content.js';
import { TeacherAssessmentsPage } from './assessments.js';
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
  // R256 — the withdrawn home and the old calendar address lead to «الجدولة».
  if (TEACHER_REDIRECTS.has(window.location.pathname.replace(/\/+$/, ''))) {
    window.location.replace(`${TEACHER_HOME}${window.location.search}`);
    return null;
  }
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
      /**
       * **One surface, two paths** (merged 2026-08-20).
       *
       * `تقويمي` and `الجدولة` were two menu entries onto the same operational
       * question, so a مؤطرة had to know which of the two held what she wanted.
       * The menu now offers **الجدولة** alone; the old path still renders the
       * merged page rather than 404ing, because links and bookmarks to it exist
       * and breaking them would be a second, quieter defect.
       */
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
        // R70 — the marking half. The paper is the node below (R124).
        return <TeacherExamsPage />;
      case '/teacher/assessments':
        /**
         * R124 — the same builder BODY the back office renders (`AssessmentsView`),
         * inside **this portal's own frame**, as `/teacher/exams` reuses the grade
         * sheet (R70.1). Routing straight to the back-office page dragged its
         * sidebar in with it. `?exam=` opens one paper; absent, the page offers
         * «اختبار جديد». Authorization is the server's: her scope is
         * `assertExamInTeacherScope`, and this route grants nothing.
         */
        return (
          <TeacherAssessmentsPage
            examId={new URLSearchParams(window.location.search).get('exam')}
          />
        );
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
        <ButtonLink variant="secondary" href={TEACHER_HOME}>
          {t('teacher.nav.schedules')}
        </ButtonLink>
      </div>
    </TeacherLayout>
  );
}
