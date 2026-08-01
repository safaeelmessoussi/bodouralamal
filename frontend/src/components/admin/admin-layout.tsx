import type { ReactNode } from 'react';

import { useSession } from '../../contexts/session.js';
import { t } from '../../i18n/index.js';
import {
  ADMIN_SECTIONS,
  canAccess,
  moduleForPath,
  visibleModules,
  type AdminModule,
} from '../../lib/admin-modules.js';
import { ApplicationHeader } from '../header/application-header.js';
import { NoPermissionState } from '../states.js';

/**
 * The back-office shell: sidebar navigation beside the module's own content.
 *
 * **The navigation is generated from the module registry**, so the sidebar can
 * never list a route that does not exist, omit one that does, or show a module
 * the session may not open. §14.1 requires exactly its hierarchy with *"no
 * invented sections, no reshuffling"* — generating it is how that stays true
 * rather than being re-checked by eye.
 *
 * **Role gating happens here, once.** A module that a session's roles do not
 * admit renders the §14.4 no-permission state instead of its content — never a
 * blank page and never a crash. This is a **UX layer**: the server enforces the
 * TD-2 matrix on every endpoint regardless, and the URL prefix is not the
 * permission boundary.
 *
 * The sidebar is a `<nav>` landmark with its own accessible name, so a screen
 * reader can jump to it, and it is RTL-first like every other surface.
 */
export function AdminLayout({
  title,
  lede,
  actions,
  children,
}: {
  title: string;
  lede?: string | null;
  /** Page-level controls — a "create" button belongs here, beside the heading. */
  actions?: ReactNode;
  children: ReactNode;
}): ReactNode {
  const { me } = useSession();
  const roles = me?.roles ?? [];
  const current = moduleForPath(window.location.pathname);
  const permitted = current ? canAccess(current, roles) : false;

  return (
    <>
      <ApplicationHeader />
      <div className="admin">
        <AdminSidebar roles={roles} current={current} />
        <main id="main" className="admin__main">
          <div className="admin__head">
            <div>
              <h1 className="admin__title">{title}</h1>
              {lede ? <p className="lede">{lede}</p> : null}
            </div>
            {permitted && actions ? <div className="admin__actions">{actions}</div> : null}
          </div>

          {/* An `Active` account holding no role at all is reachable only through
              staff error, and §14.4 says it renders this rather than a dashboard
              — no endpoint would authorise one anyway. */}
          {permitted ? children : <NoPermissionState />}
        </main>
      </div>
    </>
  );
}

function AdminSidebar({
  roles,
  current,
}: {
  roles: readonly string[];
  current: AdminModule | null;
}): ReactNode {
  const modules = visibleModules(roles);
  const ungrouped = modules.filter((m) => m.section === null);

  return (
    <nav className="admin-nav" aria-label={t('admin.nav.label')}>
      {ungrouped.length > 0 ? (
        <ul className="admin-nav__list">
          {ungrouped.map((module) => (
            <NavItem key={module.path} module={module} current={current} />
          ))}
        </ul>
      ) : null}

      {ADMIN_SECTIONS.map((section) => {
        const inSection = modules.filter((m) => m.section === section);
        // A section whose every module is hidden by role renders nothing —
        // an empty group heading states that a section exists and is empty,
        // which is not what "you may not see this" means.
        if (inSection.length === 0) return null;
        return (
          <div key={section} className="admin-nav__group">
            <h2 className="admin-nav__group-title">{t(`admin.section.${section}`)}</h2>
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

function NavItem({
  module,
  current,
}: {
  module: AdminModule;
  current: AdminModule | null;
}): ReactNode {
  const isCurrent = current?.path === module.path;
  return (
    <li>
      <a
        className="admin-nav__item"
        href={module.path}
        // The programmatic "you are here", which a class alone does not convey.
        {...(isCurrent ? { 'aria-current': 'page' as const } : {})}
      >
        <span>{t(module.labelKey)}</span>
        {/* Marked in the menu as well as on the page: a reader deciding where to
            click deserves to know before the click, not after. */}
        {module.status === 'blocked' ? (
          <span className="admin-nav__badge">{t('admin.soon')}</span>
        ) : null}
      </a>
    </li>
  );
}
