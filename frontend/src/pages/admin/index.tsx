import type { ReactNode } from 'react';

import { AdminLayout } from '../../components/admin/admin-layout.js';
import { Icon } from '../../components/ui/icon.js';
import { ModulePending } from '../../components/portal/nav-item.js';
import { useSession } from '../../contexts/session.js';
import { t } from '../../i18n/index.js';
import { moduleForPath, visibleModules } from '../../lib/admin-modules.js';
import { ApprovalsPage } from './approvals.js';
import { BranchesPage } from './branches.js';
import { ContentPage } from '../content.js';
import { AdminCalendarPage } from './calendar.js';
import { GroupsPage } from './groups.js';
import { HijriCalendarPage } from './hijri-calendar.js';
import { LevelSubjectsPage } from './level-subjects.js';
import { LevelsPage } from './levels.js';
import { ScheduleSessionsPage } from './schedule-sessions.js';
import { SchedulesPage } from './schedules.js';
import { SettingsPage } from './settings.js';
import { SubjectOrganisationPage } from './subject-organisation.js';
import { TaxonomyPage } from './taxonomy.js';
import { TrashPage } from './trash.js';
import { UsersPage } from './users.js';

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
/**
 * Every module path this router actually renders a screen for.
 *
 * Exported so a test can assert it matches the registry's `ready` set. That
 * assertion is what keeps the sidebar's promise and the router's behaviour in
 * step — three modules once carried `ready` with no screen, so the badge said
 * available and the page said "being prepared".
 */
export const IMPLEMENTED_ADMIN_PATHS: readonly string[] = [
  '/admin',
  '/admin/branches',
  '/admin/approvals',
  '/admin/schedules',
  '/admin/groups',
  '/admin/levels',
  '/admin/taxonomy',
  '/admin/users',
  '/admin/calendar',
  '/admin/content',
  '/admin/trash',
  '/superadmin/hijri-calendar',
  '/superadmin/settings',
];

/**
 * The two views the Levels module owns beneath its own path.
 *
 * Matched by pattern rather than by registry entries, because the paths carry
 * ids: nothing can link to them from a menu, so they are not *navigation* nodes.
 * They are internal views a module owns — the same relationship
 * `/admin/groups/{id}/roster` has to its module.
 *
 * **The two are different questions and get different screens.** Without a
 * subject id: *which Subjects does this Level teach* (§4.4b — the assignment
 * whose absence made every teaching group fail with `SUBJECT_NOT_IN_LEVEL`).
 * With one: §14.1's Subject Organisation node — *how is that Subject split, and
 * who is unplaced* (§4.4c, BR-22). Collapsing them into one screen would put an
 * alarm about unplaced students behind a dropdown.
 */
const SUBJECT_ORG = /^\/admin\/levels\/([^/]+)\/subjects(?:\/([^/]+))?\/?$/;

/**
 * `/admin/schedules/{id}/sessions` — the occurrences of one recurring class, and
 * the screen SRS Revision 50's three scopes are chosen on.
 *
 * An internal view of the Schedules module, matched by pattern for the same
 * reason Subject Organisation is: the path carries an id, so nothing links to it
 * from a menu and §14.1 lists no such node.
 */
const SCHEDULE_SESSIONS = /^\/admin\/schedules\/([^/]+)\/sessions\/?$/;

export function AdminRouter(): ReactNode {
  const scheduleSessions = SCHEDULE_SESSIONS.exec(window.location.pathname);
  if (scheduleSessions) return <ScheduleSessionsPage scheduleId={scheduleSessions[1]!} />;

  const subjectOrg = SUBJECT_ORG.exec(window.location.pathname);
  if (subjectOrg) {
    const subjectId = subjectOrg[2];
    return subjectId === undefined ? (
      <LevelSubjectsPage levelId={subjectOrg[1]!} />
    ) : (
      <SubjectOrganisationPage levelId={subjectOrg[1]!} subjectId={subjectId} />
    );
  }

  const module = moduleForPath(window.location.pathname);
  if (!module) return <AdminNotFound />;

  // One decision, in one place: an unavailable module renders the SAME named
  // state whether the reader arrived from the sidebar, a bookmark or a link.
  if (module.status === 'blocked') {
    return (
      <AdminLayout title={t(module.labelKey)}>
        <ModulePending module={module} />
      </AdminLayout>
    );
  }

  switch (module.path) {
    case '/admin':
      return <AdminDashboard />;
    case '/admin/branches':
      return <BranchesPage />;
    case '/admin/approvals':
      return <ApprovalsPage />;
    case '/admin/schedules':
      return <SchedulesPage />;
    case '/admin/groups':
      return <GroupsPage />;
    case '/admin/levels':
      return <LevelsPage />;
    case '/admin/taxonomy':
      return <TaxonomyPage />;
    case '/admin/users':
      return <UsersPage />;
    case '/admin/calendar':
      return <AdminCalendarPage />;
    case '/admin/content':
      // The same screen the teacher portal renders (§5.5/§5.6). One capability,
      // two chromes — the difference between the audiences is what the SERVER
      // will accept (§4.9), not what the client offers.
      return <ContentPage portal="admin" />;
    case '/admin/trash':
      return <TrashPage />;
    case '/superadmin/hijri-calendar':
      return <HijriCalendarPage />;
    case '/superadmin/settings':
      return <SettingsPage />;
    default:
      // A `ready` module with no case here is a REGISTRY DEFECT, not a normal
      // state — the test on `IMPLEMENTED_ADMIN_PATHS` fails on it. Rendering
      // the pending state is the safe landing while that is fixed; §14.4
      // forbids the blank page regardless of whose mistake it was.
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
