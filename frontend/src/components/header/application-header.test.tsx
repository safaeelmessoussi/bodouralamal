import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ActiveRoleProvider } from '../../contexts/active-role.js';
import { ActiveChildProvider } from '../../contexts/active-child.js';
import { SessionContext } from '../../contexts/session.js';
import type { Me } from '../../contexts/session.js';
import { ApplicationHeader } from './application-header.js';

/**
 * The header, actually rendered, in both session states.
 *
 * The unit tests around `buildNavigation` prove the *model*; this proves the
 * **output**, which is where the reported defect actually lived — Dashboard
 * reaching a visitor. Rendering to static markup needs no browser and no new
 * dependency: `react-dom/server` ships with `react-dom`.
 */
function render(state: 'anonymous' | 'authenticated', me: Me | null): string {
  return renderToStaticMarkup(
    <SessionContext.Provider
      value={{ status: state, me, accessToken: null, setAccessToken: () => undefined }}
    >
      {/* The switcher reads the active role from context now — rendering the
          header without the provider throws, which is the point: a control that
          reports a role must be given one. */}
      <ActiveRoleProvider>
        <ActiveChildProvider>
          <ApplicationHeader />
        </ActiveChildProvider>
      </ActiveRoleProvider>
    </SessionContext.Provider>,
  );
}

const person = (over: Partial<Me> = {}): Me => ({
  id: 'u1',
  is_platform_owner: false,
  account_status: 'active',
  roles: ['student'],
  role_scopes: [{ role: 'student', branches: null }],
  active_role: null,
  approved_child_links: [],
  teaches_quran: false,
  self_attendance_allowed: false,
  ...over,
});

describe('anonymous visitor', () => {
  const html = render('anonymous', null);

  it('sees the three public sections', () => {
    expect(html).toContain('الرئيسية');
    expect(html).toContain('الجدول الزمني');
    expect(html).toContain('المحتوى التعليمي');
  });

  it('sees Sign in', () => {
    expect(html).toContain('تسجيل الدخول');
    expect(html).toContain('/api/v1/auth/google');
  });

  it('NEVER sees Dashboard — the reported defect', () => {
    expect(html).not.toContain('لوحة التحكم');
    expect(html).not.toContain('/dashboard');
  });

  it('sees no account controls at all', () => {
    expect(html).not.toContain('تسجيل الخروج');
    expect(html).not.toContain('الحساب');
  });
});

describe('authenticated user', () => {
  const html = render('authenticated', person());

  it('sees the same three public sections, and no more', () => {
    expect(html).toContain('الرئيسية');
    expect(html).toContain('الجدول الزمني');
    expect(html).toContain('المحتوى التعليمي');
  });

  it('sees Dashboard, as an account control, pointing at the ROLE home', () => {
    expect(html).toContain('لوحة التحكم');
    // The P0 regression: this used to be a literal `/dashboard`, which §14.1
    // does not define and the router did not serve — so pressing it rendered a
    // blank white page. Asserting the resolved path is what pins the fix; a
    // `toContain('/dashboard')` check passes either way, because
    // `/dashboard/student` contains it.
    expect(html).toContain('href="/dashboard/student"');
  });

  it('does NOT see Sign in', () => {
    // The sign-in entry is replaced, not added to.
    expect(html).not.toContain('/api/v1/auth/google');
  });

  it('offers the account menu that holds sign-out', () => {
    expect(html).toContain('الحساب');
  });

  it('shows Dashboard exactly once, not as both a link and a button', () => {
    expect(html.split('/dashboard').length - 1).toBe(1);
  });

  it('sends a staff caller to the back office instead', () => {
    const staff = render('authenticated', person({ roles: ['admin'] }));
    expect(staff).toContain('href="/admin"');
    expect(staff).not.toContain('/dashboard');
  });

  it('HIDES the button for an Active account with no role, rather than linking nowhere', () => {
    // §14.4 Revision 16: that account belongs on the no-permission state. A
    // button that cannot work teaches the reader less than no button.
    const roleless = render('authenticated', person({ roles: [] }));
    expect(roleless).not.toContain('لوحة التحكم');
  });
});

describe('the switchers appear only when they mean something', () => {
  it('a single-role account gets no role switcher', () => {
    expect(render('authenticated', person({ roles: ['student'] }))).not.toContain('الدور الحالي');
  });

  it('a multi-role account gets one (§2.1)', () => {
    const html = render(
      'authenticated',
      person({
        roles: ['parent', 'teacher'],
        approved_child_links: [{ id: 'c1', display_name: 'مريم بنعلي' }],
    teaches_quran: false,
  self_attendance_allowed: false,
      }),
    );
    expect(html).toContain('اختر الدور الذي تعمل به');
  });

  it('R64: ولي الأمر with no approved child is not a role you can switch into', () => {
    // The entry expands into the children and nothing else, so with none
    // approved it would open an empty menu — the same defect as a button that
    // renders a blank page. Here it leaves the account one usable role, and the
    // switcher disappears with it.
    const html = render(
      'authenticated',
      person({ roles: ['parent', 'teacher'], approved_child_links: [] }),
    );
    expect(html).not.toContain('اختر الدور الذي تعمل به');
  });

  it('R62.9: a parent-only account still gets the switcher — it is their only route to a child', () => {
    // The old rule hid it below two roles, which left a parent holding exactly
    // one role with no way to reach anybody. The children and «＋ تسجيل طفل»
    // live INSIDE this menu now, so hiding it hides the whole family surface.
    const html = render(
      'authenticated',
      person({ roles: ['parent'], approved_child_links: [{ id: 'c1', display_name: 'مريم بنعلي' }] }),
    );
    expect(html).toContain('اختر الدور الذي تعمل به');
  });

  it('R62.9: there is ONE switcher, not a second child dropdown beside it', () => {
    // Selecting a child sets the role and the child in one action; two menus
    // made that two actions and two places to be wrong about who is active.
    const html = render(
      'authenticated',
      person({ roles: ['parent'], approved_child_links: [{ id: 'c1', display_name: 'مريم بنعلي' }] }),
    );
    expect(html).not.toContain('اختر الطفل الذي تتابع بياناته');
    expect(html.match(/menu__trigger/g) ?? []).toHaveLength(2); // role switcher + account
  });
});
