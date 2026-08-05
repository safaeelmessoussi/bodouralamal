import type { ReactNode } from 'react';

import { ModulePending } from '../../components/portal/nav-item.js';
import { TeacherLayout } from '../../components/teacher/teacher-layout.js';
import { t } from '../../i18n/index.js';
import { teacherModuleForPath } from '../../lib/teacher-modules.js';

/**
 * Teacher-portal routing.
 *
 * The same resolver shape the back office uses, reading the teacher registry:
 * a route cannot exist without a navigation entry or a permission, because the
 * three are the same list.
 *
 * **Every teaching module is currently `blocked`, and each says why.** That is
 * not a placeholder for its own sake — §14.4 forbids the blank page, and naming
 * what is missing is what stops the same investigation being repeated. The
 * schedules entry in particular names a real gap rather than unbuilt UI: §14.1
 * defines the screen, and **TD-3 documents no endpoint a Teacher may call for
 * it** (`GET /admin/course-schedules` requires Admin in the service, and §20
 * rule 16 forbids inventing a route). Which endpoint serves it is a TD-2 /
 * TD-3.12 decision for the Document Owner.
 */
export function TeacherRouter(): ReactNode {
  const module = teacherModuleForPath(window.location.pathname);
  if (!module) return <TeacherNotFound />;

  return (
    <TeacherLayout title={t(module.labelKey)}>
      <ModulePending module={module} />
    </TeacherLayout>
  );
}

function TeacherNotFound(): ReactNode {
  return (
    <TeacherLayout title={t('admin.notFound')}>
      <div className="state" role="status">
        <p>{t('admin.notFoundBody')}</p>
        <a className="btn btn--secondary" href="/teacher">
          {t('teacher.nav.dashboard')}
        </a>
      </div>
    </TeacherLayout>
  );
}
