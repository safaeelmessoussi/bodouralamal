import type { ReactNode } from 'react';

import { AdminLayout } from '../../components/admin/admin-layout.js';
import { Icon } from '../../components/ui/icon.js';
import { ModulePending } from '../../components/portal/nav-item.js';
import { useActiveRole } from '../../contexts/active-role.js';
import { Button, ButtonLink } from '../../components/ui/button.js';
import { t } from '../../i18n/index.js';
import { moduleForPath, visibleModules, type AdminModule } from '../../lib/admin-modules.js';
import { ApprovalsPage } from './approvals.js';
import { BranchesPage } from './branches.js';
import { ContentPage } from '../content.js';
import { GroupsPage } from './groups.js';
import { HijriCalendarPage } from './hijri-calendar.js';
import { EnrollmentsPage } from './enrollments.js';
import { TeachersPage } from './teachers.js';
import { ExamGradesPage } from './exam-grades.js';
import { LevelSubjectsPage } from './level-subjects.js';
import { LevelSurahsPage } from './level-surahs.js';
import { AdminQuranPage } from './quran.js';
import { LevelsPage } from './levels.js';
import { ScheduleSessionsPage } from './schedule-sessions.js';
import { SchedulingPage } from './scheduling.js';
import { SettingsPage } from './settings.js';
import { TeachingStructurePage } from './teaching-structure.js';
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
  '/admin/enrollments',
  '/admin/teachers',
  '/admin/exam-grades',
  '/admin/level-subjects',
  '/admin/level-surahs',
  '/admin/quran',
  '/admin/teaching-groups',
  '/admin/categories',
  '/admin/subjects',
  '/admin/users',
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
/**
 * **R69 — the OLD paths, kept only to redirect.**
 *
 * `مواد المستوى` and `حلقات المواد` now have nodes of their own at
 * `/admin/level-subjects` and `/admin/teaching-groups`, with the ids as query
 * parameters — the pattern §14.1 already uses for `/resources`, and the only
 * one a menu entry can reach, since a menu cannot supply an id.
 *
 * These carried the ids as path segments, which is why the screens had no node
 * and why unrelated screens grew borrowed row actions to reach them. Bookmarks
 * and any link already in the wild still work: they land on the canonical URL.
 */
const LEGACY_SUBJECT_PATHS = /^\/admin\/levels\/([^/]+)\/subjects(?:\/([^/]+))?\/?$/;

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
  const { activeRole } = useActiveRole();
  const scheduleSessions = SCHEDULE_SESSIONS.exec(window.location.pathname);
  if (scheduleSessions) return <ScheduleSessionsPage scheduleId={scheduleSessions[1]!} />;

  const legacy = LEGACY_SUBJECT_PATHS.exec(window.location.pathname);
  if (legacy) {
    const [, levelId, subjectId] = legacy;
    const target =
      subjectId === undefined
        ? `/admin/level-subjects?level=${levelId!}`
        : `/admin/teaching-groups?level=${levelId!}&subject=${subjectId}`;
    // `replace`, not `assign`: the old URL should not sit in the history for
    // Back to return to, or a reader bounces between two addresses for one
    // screen.
    window.location.replace(target);
    return null;
  }

  const params = new URLSearchParams(window.location.search);
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  // R70.1 — the grade sheet, with the exam id as `?exam=` (the `/resources`
  // pattern). The page is a frame; the sheet itself is `GradeSheetView`, which
  // the teacher portal renders too — one implementation, two ways in.
  if (path === '/admin/exam-grades') {
    return <ExamGradesPage examId={params.get('exam')} />;
  }
  if (path === '/admin/quran') {
    // §C4 — `?student=` is the deep link, the same one `/teacher/quran` uses and
    // the `/resources?level=` precedent §14.1 sets. It opens; it never gates.
    return <AdminQuranPage studentId={params.get('student')} />;
  }
  if (path === '/admin/level-surahs') {
    // M4c — `?level=` opens that Level, as everywhere else; it never gates.
    return <LevelSurahsPage levelId={params.get('level')} />;
  }
  if (path === '/admin/level-subjects') {
    return <LevelSubjectsPage levelId={params.get('level')} />;
  }
  if (path === '/admin/teaching-groups') {
    // R69's node, rebuilt as a management overview: every accessible Level is
    // listed on load, and `?level=`/`?subject=` open and focus rather than gate.
    return (
      <TeachingStructurePage levelId={params.get('level')} subjectId={params.get('subject')} />
    );
  }

  const module = moduleForPath(window.location.pathname);
  if (!module) return <AdminNotFound />;

  // **§2.1 — the portal follows the ACTIVE role, not the role set.** A Super
  // Admin acting as مؤطِّرة who follows a bookmark into the back office is told
  // which role the page needs and offered the switch, rather than being shown a
  // back office they are not currently working in.
  //
  // This is presentation. TD-2 is enforced server-side from the JWT, which
  // carries every role held, so nothing here grants or removes authority — it
  // decides which surface the person is currently using.
  if (activeRole !== null && !module.roles.includes(activeRole)) {
    return (
      <AdminLayout title={t(module.labelKey)}>
        <WrongRole module={module} activeRole={activeRole} />
      </AdminLayout>
    );
  }

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
    // R56 — one screen for everything that appears on the calendar.
    case '/admin/schedules':
      return <SchedulingPage />;
    case '/admin/enrollments':
      // R74 — the Level view of the enrolment rows the roster shows per group.
      return <EnrollmentsPage />;
    // R88 correction — the teaching side of الشؤون التعليمية. التسجيلات above
    // places the people being taught; this manages the people doing the
    // teaching, and it is where the teaching profile lives now that the generic
    // account screen no longer offers it.
    case '/admin/teachers':
      return <TeachersPage />;
    case '/admin/groups':
      return <GroupsPage />;
    case '/admin/levels':
      return <LevelsPage />;
    // R55: two nodes, one implementation — the entity is a parameter, so the
    // two screens cannot drift apart the way duplicated CRUD always has here.
    case '/admin/categories':
      return <TaxonomyPage kind="category" />;
    case '/admin/subjects':
      return <TaxonomyPage kind="subject" />;
    case '/admin/users':
      return <UsersPage />;
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
 * **The cards this dashboard shows, for a given active role.**
 *
 * Exported so the order guard asserts the *code the page runs* rather than a
 * second copy of the rule — the failure mode `admin-modules.test.ts` exists to
 * prevent is two lists agreeing with each other and neither agreeing with
 * §14.1.
 *
 * **Every module the session may open, except this page itself.**
 *
 * It used to filter on `section !== null`, which excluded the dashboard because
 * the dashboard was the only ungrouped node. R105 made most of the menu
 * ungrouped, so that test would now hide eleven cards from a Super Admin and
 * **every** card from an Admin — a launcher that launches nothing. Excluding
 * this page BY PATH says what was always meant: a launcher does not link to
 * itself.
 *
 * The order is the registry's, so the cards and the sidebar are the same
 * sequence by construction rather than by two lists agreeing (§4, R105).
 */
export function dashboardCards(roles: readonly string[]): AdminModule[] {
  return visibleModules(roles).filter((m) => m.path !== '/admin');
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
  const { activeRole } = useActiveRole();
  // The role being worked as, not every role held: a Super Admin acting as
  // مؤطِّرة is offered the مؤطِّرة's modules.
  // See `dashboardCards` — the selection is exported so a test can assert it.
  const modules = dashboardCards(activeRole === null ? [] : [activeRole]);

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

/**
 * **You are working as a different role.**
 *
 * §14.4 forbids a blank page and forbids an unexplained refusal: this names the
 * role the page belongs to, names the role currently active, and offers the
 * switch — so the reader learns what to do rather than that something went
 * wrong. It is *not* a permission error, and it deliberately does not look like
 * one: the person may well hold the role, and telling them they may not is the
 * one thing that would be false.
 */
function WrongRole({
  module,
  activeRole,
}: {
  module: { labelKey: string; roles: readonly string[] };
  activeRole: string;
}): ReactNode {
  const { setActiveRole, switchableTo } = useActiveRole();
  // Only a role they actually hold is offered — the switcher's own rule, asked
  // by name so this screen never reads the full list itself (R60).
  const target = switchableTo(module.roles);

  return (
    <div className="admin-empty">
      <h2>{t('roles.wrongRoleTitle')}</h2>
      <p>
        {t('roles.wrongRoleBody')
          .replace('{module}', t(module.labelKey))
          .replace('{active}', t(`roles.${activeRole}`))}
      </p>
      {target === null ? (
        // They hold no role that opens it. Stated plainly rather than offering
        // a switch that would do nothing.
        <p className="muted">{t('roles.wrongRoleNoRole')}</p>
      ) : (
        <Button
          variant="primary"
          onClick={() => {
            setActiveRole(target);
            window.location.reload();
          }}
        >
          {t('roles.wrongRoleSwitch').replace('{role}', t(`roles.${target}`))}
        </Button>
      )}
    </div>
  );
}

function AdminNotFound(): ReactNode {
  return (
    <AdminLayout title={t('admin.notFound')}>
      <div className="state" role="status">
        <p>{t('admin.notFoundBody')}</p>
        <ButtonLink variant="secondary" href="/admin">
          {t('admin.nav.dashboard')}
        </ButtonLink>
      </div>
    </AdminLayout>
  );
}
