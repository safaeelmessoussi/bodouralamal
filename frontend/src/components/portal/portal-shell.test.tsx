import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ActiveChildProvider } from '../../contexts/active-child.js';
import { ActiveRoleProvider } from '../../contexts/active-role.js';
import { SessionContext, type Me } from '../../contexts/session.js';
import { AdminLayout } from '../admin/admin-layout.js';
import { t } from '../../i18n/index.js';

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

describe('the sidebar exposes ONE collapse control, on every render', () => {
  it('renders a real button, not a link or a decorative span', () => {
    expect(render()).toContain('class="admin-nav-toggle"');
  });

  it('announces open/closed through the SAME words the header burger uses', () => {
    // Reusing `nav.openMenu`/`nav.closeMenu` rather than inventing sidebar-only
    // wording is the "one coherent responsive navigation system" the Owner
    // asked for, not two unrelated implementations that could say different
    // things for the same state.
    const html = render();
    expect(html.includes(t('nav.openMenu')) || html.includes(t('nav.closeMenu'))).toBe(true);
  });

  it('points aria-controls at a sidebar that actually carries that id', () => {
    const html = render();
    const match = /class="admin-nav-toggle"[^>]*aria-controls="([^"]+)"/.exec(html);
    expect(match, 'the toggle names a target').not.toBeNull();
    const id = match![1]!;
    // And that id lands on the nav landmark itself, not some other element.
    expect(html).toContain(`<nav class="admin-nav" id="${id}"`);
  });

  it('states aria-expanded as an explicit true/false, never omitted', () => {
    expect(render()).toMatch(/class="admin-nav-toggle"[^>]*aria-expanded="(true|false)"/);
  });
});
