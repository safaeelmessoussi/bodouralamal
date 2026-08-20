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
import { useActiveChild } from '../../contexts/active-child.js';

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
  const { activeRoles: roles, activeRole } = useActiveRole();

  /**
   * **A guardian acting for a linked child reaches this portal** (R96.1, §4.3).
   *
   * Both halves are required, and each rules out a different mistake:
   *
   * * `activeRole === 'parent'` — a person who is *also* a beneficiary and is
   *   working as one sees **her own** record, not her child's. The capacity
   *   decides, exactly as `role-home.ts` says it does.
   * * `activeChildId !== null` — a parent who has selected nobody has no
   *   subject, so there is nothing for this portal to show and she is not
   *   admitted. `ActiveChildProvider` reconciles the stored id against the
   *   approved links `/me` returns, so a revoked link leaves this `null` on the
   *   next load and access ends with it.
   *
   * **She gains no role and nothing is broadened.** The authority is the
   * approved `FamilyLink` the server verifies on every request; this only stops
   * the interface refusing a person the server would serve.
   */
  const { activeChildId } = useActiveChild();
  const actingForChild = activeRole === 'parent' && activeChildId !== null;

  const current = studentModuleForPath(window.location.pathname);
  const permitted = current ? canAccess(current, roles, { actingForChild }) : false;

  return (
    <PortalShell
      title={title}
      lede={lede}
      actions={actions}
      permitted={permitted}
      sidebar={<StudentSidebar roles={roles} current={current} actingForChild={actingForChild} />}
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
  actingForChild,
}: {
  roles: readonly string[];
  current: StudentModule | null;
  actingForChild: boolean;
}): ReactNode {
  const modules = visibleStudentModules(roles, { actingForChild });
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
