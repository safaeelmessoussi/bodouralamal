import type { ReactNode } from 'react';

import { useActiveRole } from '../../contexts/active-role.js';
import { t } from '../../i18n/index.js';
import {
  canAccess,
  studentModuleForPath,
  visibleStudentModules,
  type StudentModule,
} from '../../lib/student-modules.js';
import { NavItem } from '../portal/nav-item.js';
import { PortalShell } from '../portal/portal-shell.js';

/**
 * The beneficiary's frame — **the same one** the back office and the teaching
 * portal use.
 *
 * `PortalShell` owns the header, the sidebar's place, the titled main region,
 * the §14.4 no-permission state and R83's scroll restoration. Nothing about the
 * chrome is written again here: what differs between the three portals is the
 * LIST of modules, which is why only the list is passed.
 *
 * She had no sidebar at all — her screens were reachable by typing a URL or from
 * one dashboard — so this is what makes them findable, not new capability.
 */
export function StudentLayout({
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
  // **The ACTIVE role, not the account's roles** (R60) — a person working as a
  // beneficiary sees a beneficiary's menu even if she also teaches.
  const { activeRoles: roles } = useActiveRole();
  const current = studentModuleForPath(window.location.pathname);
  const permitted = current ? canAccess(current, roles) : false;

  return (
    <PortalShell
      title={title}
      lede={lede}
      actions={actions}
      permitted={permitted}
      sidebar={<StudentSidebar roles={roles} current={current} />}
    >
      {children}
    </PortalShell>
  );
}

/**
 * **Flat, and deliberately so.** The back office groups §14.1's five sections
 * because it has thirty entries; five entries grouped would be chrome around a
 * list short enough to read at once.
 */
function StudentSidebar({
  roles,
  current,
}: {
  roles: readonly string[];
  current: StudentModule | null;
}): ReactNode {
  const modules = visibleStudentModules(roles);
  return (
    <nav className="admin-nav" aria-label={t('student.nav.label')}>
      <ul className="admin-nav__list">
        {modules.map((module) => (
          <NavItem key={module.path} module={module} current={current} />
        ))}
      </ul>
    </nav>
  );
}
