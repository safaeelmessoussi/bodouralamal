import type { ReactNode } from 'react';

import { useActiveRole } from '../../contexts/active-role.js';
import { useSession, type Me } from '../../contexts/session.js';
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
 * region and the one role gate — with its own sidebar, because the *sections*
 * genuinely differ: the back office has §14.1's five, and the teaching branch
 * has three of its own. It is **grouped the same way**, though, which it was not
 * until 2026-08-17; see `TeacherSidebar`.
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
  const { me } = useSession();
  const current = teacherModuleForPath(window.location.pathname);
  const permitted = current ? canAccess(current, roles) : false;

  return (
    <PortalShell
      title={title}
      lede={lede}
      actions={actions}
      permitted={permitted}
      sidebar={<TeacherSidebar roles={roles} current={current} me={me} />}
    >
      {children}
    </PortalShell>
  );
}

/**
 * **One flat list (SRS Revision 106).**
 *
 * It was grouped into `التدريس`, `الجدولة` and `المحتوى` from 2026-08-17, to
 * make the two portals read alike. R105 then removed the back office's
 * decorative headings on a rule this menu failed just as plainly — **a section
 * exists only where the heading states a fact about permission** — and R106
 * applied it here. The two portals still read alike; they now do it with six
 * entries and no headings rather than with three groups that gated nothing.
 *
 * The grouping loop is **deleted rather than left running over an empty list**:
 * dead code that renders nothing still ships, and `t(\`teacher.section.${x}\`)`
 * kept a computed key alive against a namespace the catalogue no longer has —
 * which `i18n/resolves.test.ts` caught, exactly as it is meant to.
 */
function TeacherSidebar({
  roles,
  current,
  me,
}: {
  roles: readonly string[];
  current: TeacherModule | null;
  me: Me | null;
}): ReactNode {
  // **R87 §M** — what she actually teaches, as the server computed it. Without
  // it every capability-gated entry stays hidden, which is the safe direction.
  const modules = visibleTeacherModules(roles, { teachesQuran: me?.teaches_quran === true });

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
