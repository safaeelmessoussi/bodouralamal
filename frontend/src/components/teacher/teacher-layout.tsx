import type { ReactNode } from 'react';

import { useActiveRole } from '../../contexts/active-role.js';
import { t } from '../../i18n/index.js';
import {
  canAccess,
  teacherModuleForPath,
  visibleTeacherModules,
  type TeacherModule,
} from '../../lib/teacher-modules.js';
import { NavItem } from '../portal/nav-item.js';
import { PortalShell } from '../portal/portal-shell.js';

/**
 * The Teacher portal shell.
 *
 * Same frame as the back office — `PortalShell` owns the header, the titled main
 * region and the one role gate — with its own sidebar, because that is the part
 * that genuinely differs: §14.1 groups the back office into five sections, and
 * the teaching branch is a short flat list of workflow entries.
 */
export function TeacherLayout({
  title,
  lede,
  actions,
  children,
}: {
  title: string;
  lede?: string | null;
  actions?: ReactNode;
  children: ReactNode;
}): ReactNode {
  // The ACTIVE role, not the account's roles (R60) — see `admin-layout.tsx`.
  const { activeRoles: roles } = useActiveRole();
  const current = teacherModuleForPath(window.location.pathname);
  const permitted = current ? canAccess(current, roles) : false;

  return (
    <PortalShell
      title={title}
      lede={lede}
      actions={actions}
      permitted={permitted}
      sidebar={<TeacherSidebar roles={roles} current={current} />}
    >
      {children}
    </PortalShell>
  );
}

function TeacherSidebar({
  roles,
  current,
}: {
  roles: readonly string[];
  current: TeacherModule | null;
}): ReactNode {
  const modules = visibleTeacherModules(roles);
  return (
    <nav className="admin-nav" aria-label={t('teacher.nav.label')}>
      <ul className="admin-nav__list">
        {modules.map((module) => (
          <NavItem key={module.path} module={module} current={current} />
        ))}
      </ul>
    </nav>
  );
}
