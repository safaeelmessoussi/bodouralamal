import type { ReactNode } from 'react';

import { useActiveRole } from '../../contexts/active-role.js';
import { t } from '../../i18n/index.js';
import {
  canAccess,
  teacherModuleForPath,
  visibleTeacherModules,
  TEACHER_SECTIONS,
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

/**
 * **Grouped, like the back office** (2026-08-17).
 *
 * It was a flat list — the comment above said §14.1 *"groups the back office
 * into five sections, and the teaching branch is a short flat set"*, which is
 * true of §14.1 and was the wrong conclusion for the reader: a مؤطرة met the
 * same concepts under different words *and* in a different shape, so nothing
 * told her the two portals were one platform. The grouping is **presentation
 * only**; the modules, their roles and the server's scope resolution are
 * unchanged.
 *
 * A section whose every module is hidden by role renders nothing, exactly as the
 * back-office sidebar does — an empty group heading states that a section exists
 * and is empty, which is not what *"you may not see this"* means.
 */
function TeacherSidebar({
  roles,
  current,
}: {
  roles: readonly string[];
  current: TeacherModule | null;
}): ReactNode {
  const modules = visibleTeacherModules(roles);
  const ungrouped = modules.filter((m) => m.section === null);

  return (
    <nav className="admin-nav" aria-label={t('teacher.nav.label')}>
      {ungrouped.length > 0 ? (
        <ul className="admin-nav__list">
          {ungrouped.map((module) => (
            <NavItem key={module.path} module={module} current={current} />
          ))}
        </ul>
      ) : null}

      {TEACHER_SECTIONS.map((section) => {
        const inSection = modules.filter((m) => m.section === section);
        if (inSection.length === 0) return null;
        return (
          <div key={section} className="admin-nav__group">
            <h2 className="admin-nav__group-title">{t(`teacher.section.${section}`)}</h2>
            <ul className="admin-nav__list">
              {inSection.map((module) => (
                <NavItem key={module.path} module={module} current={current} />
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
