import type { ReactNode } from 'react';

import { AdminLayout } from '../../components/admin/admin-layout.js';
import { Icon } from '../../components/ui/icon.js';
import { useSession } from '../../contexts/session.js';
import { t } from '../../i18n/index.js';
import { moduleForPath, visibleModules, type AdminModule } from '../../lib/admin-modules.js';
import { ApprovalsPage } from './approvals.js';
import { BranchesPage } from './branches.js';
import { HijriCalendarPage } from './hijri-calendar.js';
import { SettingsPage } from './settings.js';

/**
 * Back-office routing and the module screens that are not yet implemented.
 *
 * **One resolver, driven by the registry.** `AdminRouter` asks the registry which
 * module a path belongs to and renders it, so a route cannot exist without a
 * navigation entry or a permission — the three are the same list.
 *
 * A module whose endpoints do not exist yet renders `ModulePending`, which
 * **names what is missing**. §14.4 forbids the blank page; naming the reason is
 * what stops the same investigation being repeated, and it is the honest signal
 * about where the back office actually stands.
 */
export function AdminRouter(): ReactNode {
  const module = moduleForPath(window.location.pathname);
  if (!module) return <AdminNotFound />;

  switch (module.path) {
    case '/admin':
      return <AdminDashboard />;
    case '/admin/branches':
      return <BranchesPage />;
    case '/admin/approvals':
      return <ApprovalsPage />;
    case '/superadmin/hijri-calendar':
      return <HijriCalendarPage />;
    case '/superadmin/settings':
      return <SettingsPage />;
    default:
      // Everything §14.1 lists but the backend cannot yet serve. The layout,
      // navigation, role gate and heading are real; only the content is pending.
      return (
        <AdminLayout title={t(module.labelKey)}>
          <ModulePending module={module} />
        </AdminLayout>
      );
  }
}

/**
 * The staff home (§5.6).
 *
 * Deliberately **not** a statistics dashboard: §5.6 asks for pending-approval
 * counts and overview stats, and no endpoint serves them. Inventing a number
 * would be worse than omitting one, so this is a launcher — the modules the
 * session may open, with the blocked ones marked. It becomes a dashboard when
 * there is something true to count.
 */
function AdminDashboard(): ReactNode {
  const { me } = useSession();
  const modules = visibleModules(me?.roles ?? []).filter((m) => m.section !== null);

  return (
    <AdminLayout title={t('admin.dashboard.title')} lede={t('admin.dashboard.lede')}>
      <ul className="level-grid">
        {modules.map((module) => (
          <li key={module.path}>
            <a className="level-card" href={module.path}>
              <span className="level-card__icon" aria-hidden="true">
                <Icon name="folder" size={22} />
              </span>
              <span className="level-card__title">{t(module.labelKey)}</span>
              {module.status === 'blocked' ? (
                <span className="level-card__description">{t('admin.soonLong')}</span>
              ) : null}
            </a>
          </li>
        ))}
      </ul>
    </AdminLayout>
  );
}

/**
 * The named "not built yet" state.
 *
 * It states the reason rather than apologising, because the reader is usually
 * the person who can act on it — and because "coming soon" tells nobody whether
 * the wait is a day or a milestone.
 */
export function ModulePending({ module }: { module: AdminModule }): ReactNode {
  return (
    <div className="state" role="status">
      <p>{t('admin.pendingTitle')}</p>
      {module.blockedReasonKey ? (
        <p className="muted">{t(module.blockedReasonKey)}</p>
      ) : null}
    </div>
  );
}

function AdminNotFound(): ReactNode {
  return (
    <AdminLayout title={t('admin.notFound')}>
      <div className="state" role="status">
        <p>{t('admin.notFoundBody')}</p>
        <a className="btn btn--secondary" href="/admin">
          {t('admin.nav.dashboard')}
        </a>
      </div>
    </AdminLayout>
  );
}
