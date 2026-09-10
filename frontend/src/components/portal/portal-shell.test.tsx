import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ActiveChildProvider } from '../../contexts/active-child.js';
import { ActiveRoleProvider } from '../../contexts/active-role.js';
import { SessionContext, type Me } from '../../contexts/session.js';
import { AdminLayout } from '../admin/admin-layout.js';
import { TeacherLayout } from '../teacher/teacher-layout.js';
import { StudentLayout } from '../student/student-layout.js';
import { t } from '../../i18n/index.js';
import { PortalShell } from './portal-shell.js';

/**
 * **R138 item 8 — the sidebar's collapse toggle, statically.**
 *
 * `PortalShell`'s own doc comment explains why the collapsed-vs-expanded
 * DEFAULT is decided entirely by CSS media queries and never by JS: there is
 * no viewport to read before the first render, and every navigation here is a
 * full document load, so a wrong first-frame guess would repeat on every
 * click. What CAN be pinned here, with no layout engine, is the STATIC
 * contract the toggle exposes: the control exists on every render, it names
 * itself correctly, and it points at a real, addressable sidebar.
 *
 * No DOM here — see `student-lede-once.test.tsx`'s note on why `window` is a
 * one-property stub rather than jsdom.
 */
if (!('window' in globalThis)) {
  (globalThis as unknown as { window: unknown }).window = {
    location: { pathname: '/admin', search: '', href: 'http://localhost/admin' },
  };
}

const me: Me = {
  id: 'a1',
  is_platform_owner: false,
  account_status: 'active',
  roles: ['admin'],
  role_scopes: [{ role: 'admin', branches: null }],
  active_role: 'admin',
  approved_child_links: [],
  teaches_quran: false,
  self_attendance_allowed: false,
};

function render(): string {
  return renderToStaticMarkup(
    <SessionContext.Provider
      value={{ status: 'authenticated', me, accessToken: null, setAccessToken: () => undefined }}
    >
      <ActiveRoleProvider>
        <ActiveChildProvider>
          <AdminLayout title={t('admin.dashboard.title')}>
            <p>محتوى</p>
          </AdminLayout>
        </ActiveChildProvider>
      </ActiveRoleProvider>
    </SessionContext.Provider>,
  );
}

/**
 * **R138 correction #3 — one session, any portal, any role.**
 *
 * The bug this section guards against: a layout that renders its own `<nav>`
 * UNCONDITIONALLY, even for a session whose final module list for that
 * portal came back empty, gives `PortalShell` nothing to tell "a real,
 * navigable sidebar" apart from "an empty shell" — so the toggle and drawer
 * render regardless, exactly `أقسامي` did on Staging for a session the
 * Student portal's own registry admits none of.
 *
 * `pathname` is mutated on the shared stub `window` (see the note above it)
 * because each portal's own module resolver reads it directly, the same way
 * the real app does on a full page load.
 */
function renderPortal(node: ReactNode, meOverrides: Partial<Me>, pathname: string): string {
  (window as unknown as { location: { pathname: string } }).location.pathname = pathname;
  return renderToStaticMarkup(
    <SessionContext.Provider
      value={{
        status: 'authenticated',
        me: { ...me, ...meOverrides },
        accessToken: null,
        setAccessToken: () => undefined,
      }}
    >
      <ActiveRoleProvider>
        <ActiveChildProvider>{node}</ActiveChildProvider>
      </ActiveRoleProvider>
    </SessionContext.Provider>,
  );
}

/** No `<nav>`/toggle/drawer markup of any shape survives in the output. */
function assertNoContextualNav(html: string): void {
  expect(html).not.toContain('admin-nav-toggle');
  expect(html).not.toContain('admin-nav-panel');
  expect(html).not.toContain('admin-nav-backdrop');
  expect(html).not.toContain('class="admin-nav"');
  // The reserved grid column is reclaimed too — not merely an empty nav
  // hidden inside an otherwise-unchanged two-column layout.
  expect(html).toMatch(/class="admin admin--no-nav"/);
  expect(html).not.toMatch(/admin--nav-(collapsed|overlay)/);
}

describe('the toggle and drawer render ONLY when the final module list is non-empty', () => {
  it('Admin: retains its control — §14.1\'s sections are never empty for an admin role', () => {
    const html = renderPortal(
      <AdminLayout title={t('admin.dashboard.title')}>
        <p>محتوى</p>
      </AdminLayout>,
      { roles: ['admin'], active_role: 'admin' },
      '/admin',
    );
    expect(html).toContain('admin-nav-toggle');
    expect(html).not.toContain('admin--no-nav');
  });

  it('Teacher: a genuine مؤطِّرة sees the control — her own role-only modules are never empty', () => {
    const html = renderPortal(
      <TeacherLayout title={t('teacher.nav.dashboard')}>
        <p>محتوى</p>
      </TeacherLayout>,
      { roles: ['teacher'], active_role: 'teacher' },
      '/teacher',
    );
    expect(html).toContain('admin-nav-toggle');
    expect(html).not.toContain('admin--no-nav');
  });

  it('Teacher: permission filtering removes every entry — treated identically to an empty list', () => {
    // Every `TEACHER_MODULES` entry requires the `teacher` role; a session
    // acting as a role the registry does not name a single node for ends up
    // with the SAME empty list a portal with no nav at all would.
    const html = renderPortal(
      <TeacherLayout title={t('teacher.nav.dashboard')}>
        <p>محتوى</p>
      </TeacherLayout>,
      { roles: ['parent'], active_role: 'parent' },
      '/teacher',
    );
    assertNoContextualNav(html);
  });

  it('Student: a genuine مستفيدة sees the control — the Owner-reported defect, now fixed', () => {
    // The exact scenario `أقسامي` opened empty on Staging for: a Student
    // portal render. With a real `student` role, `STUDENT_MODULES` is never
    // empty, so this is the control case proving the fix does not withhold
    // the toggle from a session that genuinely has somewhere to go.
    const html = renderPortal(
      <StudentLayout title={t('student.nav.dashboard')}>
        <p>محتوى</p>
      </StudentLayout>,
      { roles: ['student'], active_role: 'student' },
      '/dashboard/student',
    );
    expect(html).toContain('admin-nav-toggle');
    expect(html).not.toContain('admin--no-nav');
  });

  it('Student: zero visible links — no toggle, drawer, backdrop, heading, close control or reserved space', () => {
    // A session acting as a role `STUDENT_MODULES` admits none of, and not a
    // guardian actively acting for a linked child — the shape of the actual
    // Owner-reported regression: `أقسامي` opened on nothing.
    const html = renderPortal(
      <StudentLayout title={t('student.nav.dashboard')}>
        <p>محتوى</p>
      </StudentLayout>,
      { roles: ['admin'], active_role: 'admin' },
      '/dashboard/student',
    );
    assertNoContextualNav(html);
  });
});

/**
 * **The structural contract, isolated from any module registry.** `PortalShell`
 * itself never reads a role or a registry — it reads exactly one signal,
 * `sidebar === null` — so this pins that contract directly rather than only
 * through the three layouts above.
 */
describe('PortalShell renders nothing for the nav slot when sidebar is null', () => {
  function renderShell(sidebar: ReactNode, actions?: ReactNode): string {
    return renderPortal(
      <PortalShell title="عنوان" navLabel="أقسامي" permitted sidebar={sidebar} actions={actions}>
        <p>محتوى</p>
      </PortalShell>,
      { roles: ['admin'], active_role: 'admin' },
      '/admin',
    );
  }

  it('renders no toggle, drawer, heading, close control or backdrop', () => {
    assertNoContextualNav(renderShell(null));
  });

  it('renders no .admin__actions row at all when there is also no page action', () => {
    // An empty container is exactly the "reserved space for nothing" this
    // correction removes — not only the sidebar's own column.
    expect(renderShell(null)).not.toContain('admin__actions');
  });

  it('still renders a page action alone, without a toggle beside it', () => {
    const html = renderShell(null, <button type="button">إجراء</button>);
    expect(html).toContain('admin__actions');
    expect(html).not.toContain('admin-nav-toggle');
    expect(html).toContain('إجراء');
  });

  it('renders the toggle and (once opened) the drawer when sidebar is a real nav', () => {
    const html = renderShell(
      <nav className="admin-nav" id="admin-sidebar">
        <ul className="admin-nav__list">
          <li>
            <a className="admin-nav__item" href="/x">
              x
            </a>
          </li>
        </ul>
      </nav>,
    );
    expect(html).toContain('admin-nav-toggle');
    expect(html).not.toContain('admin--no-nav');
  });
});

/**
 * **R138 correction #2 (Owner, 2026-09-10)** — the toggle moved from a
 * floating, `position: fixed`, icon-only button into `.admin__head`'s own
 * `.admin__actions` row, carrying a distinct `sidebar` icon and a VISIBLE
 * Arabic label. The tests below replace the previous "icon-only, matching
 * ApplicationHeader's own burger" regression guard, which pinned exactly the
 * design this correction reverses — see `PortalShell`'s own doc comment for
 * why: an icon-only control next to the header's own icon-only burger read
 * as two identical hamburgers, which is the defect this correction exists
 * to remove.
 */
describe('the sidebar exposes ONE toggle, visually distinct from the header burger', () => {
  it('renders a real button carrying the sidebar-toggle class, not a link or a decorative span', () => {
    expect(render()).toMatch(/<button type="button" class="[^"]*\badmin-nav-toggle\b[^"]*"/);
  });

  it('names itself with the portal\'s OWN section noun, never the header\'s generic "menu"', () => {
    // `admin.nav.label` («أقسام الإدارة») is the SAME text AdminSidebar's own
    // `<nav aria-label>` already carries — one name for the menu, read from
    // three places (the landmark, the toggle, the opened drawer's header)
    // rather than a fourth word invented for this control.
    const html = render();
    expect(html).toContain(t('admin.nav.label'));
    // And never the header burger's own vocabulary, scoped to the TOGGLE's
    // own markup — `ApplicationHeader`'s real burger legitimately says
    // «فتح القائمة» elsewhere on the very same page, which is exactly why
    // this has to be scoped rather than a whole-page substring check.
    const match = /<button type="button" class="[^"]*\badmin-nav-toggle\b[^"]*"[^>]*>([\s\S]*?)<\/button>/.exec(
      html,
    );
    expect(match, 'the toggle button markup').not.toBeNull();
    expect(match![1]).not.toContain(t('nav.openMenu'));
    expect(match![1]).not.toContain(t('nav.closeMenu'));
  });

  it('states the exact desktop-expanded wording the Owner specified', () => {
    // No viewport exists during a static render, so `isWide` keeps its
    // default (`true`) and `override` stays `null` — the untouched desktop
    // resting default, where the sidebar already shows with nothing
    // pressed. That is the one state the Owner's own spec names a literal
    // sentence for: "إخفاء أقسام الإدارة", never a generic toggle word.
    expect(render()).toContain(t('nav.hideSections').replace('{label}', t('admin.nav.label')));
  });

  it('carries a `sidebar` panel icon — never `menu` or `close`, the header burger\'s own icons', () => {
    const html = render();
    const match = /<button type="button" class="[^"]*\badmin-nav-toggle\b[^"]*"[^>]*>([\s\S]*?)<\/button>/.exec(
      html,
    );
    expect(match, 'the toggle button markup').not.toBeNull();
    const inner = match![1]!;
    // The `sidebar` glyph — a rectangle with a vertical divider (`icon.tsx`).
    expect(inner).toContain('M4 4h16v16H4V4zM15 4v16');
    // Neither the hamburger's three lines nor the close X.
    expect(inner).not.toContain('M4 7h16M4 12h16M4 17h16');
    expect(inner).not.toContain('M6 6l12 12M18 6L6 18');
  });

  it('carries a VISIBLE label beside the icon — the reversal this correction makes', () => {
    const html = render();
    const match = /<button type="button" class="[^"]*\badmin-nav-toggle\b[^"]*"[^>]*>([\s\S]*?)<\/button>/.exec(
      html,
    );
    expect(match, 'the toggle button markup').not.toBeNull();
    const inner = match![1]!;
    // Strip the icon SVG and confirm real, non-empty text remains — the
    // opposite of the previous "is icon-only" guard this test replaces.
    const visibleText = inner.replace(/<svg[\s\S]*?<\/svg>/, '').trim();
    expect(visibleText.length).toBeGreaterThan(0);
  });

  it('points aria-controls at a sidebar that actually carries that id', () => {
    const html = render();
    const match = /class="[^"]*\badmin-nav-toggle\b[^"]*"[^>]*aria-controls="([^"]+)"/.exec(html);
    expect(match, 'the toggle names a target').not.toBeNull();
    const id = match![1]!;
    // And that id lands on the nav landmark itself, not some other element.
    expect(html).toContain(`<nav class="admin-nav" id="${id}"`);
  });

  it('states aria-expanded as an explicit true/false, never omitted', () => {
    expect(render()).toMatch(/class="[^"]*\badmin-nav-toggle\b[^"]*"[^>]*aria-expanded="(true|false)"/);
  });

  it('renders inside the shared page-header actions row, not floating over it', () => {
    // The "structurally reserved space" the correction asked for: the
    // toggle is a flex sibling of any page-specific action, inside the
    // SAME `.admin__actions` container — not a second styling surface with
    // its own coordinates.
    const html = render();
    // No `<div>` nests inside `.admin__actions` here (its only children are
    // buttons), so the next `</div>` closes the actions row itself.
    const match = /<div class="admin__actions">([\s\S]*?)<\/div>/.exec(html);
    expect(match, 'the actions row').not.toBeNull();
    expect(match![1]).toContain('admin-nav-toggle');
  });
});

describe('the opened drawer never renders unless the sidebar is actually opened', () => {
  it('renders no panel, backdrop or close button in the untouched default', () => {
    // Nothing has been pressed yet during a static render — `override` stays
    // `null` — so the drawer's own header/close-button markup must not
    // appear at all, only the plain, unwrapped sidebar.
    const html = render();
    expect(html).not.toContain('admin-nav-panel');
    expect(html).not.toContain('admin-nav-backdrop');
  });
});
