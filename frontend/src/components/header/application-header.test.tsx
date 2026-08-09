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
  account_status: 'active',
  roles: ['student'],
  role_scopes: [{ role: 'student', branches: null }],
  approved_child_links: [],
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
    const html = render('authenticated', person({ roles: ['parent', 'teacher'] }));
    expect(html).toContain('اختر الدور الذي تعمل به');
  });

  it('a parent with no approved link gets no child switcher', () => {
    expect(render('authenticated', person({ approved_child_links: [] }))).not.toContain(
      'اختر الطفل',
    );
  });

  it('a parent with an approved link gets one (§4.3)', () => {
    const html = render('authenticated', person({ roles: ['parent'], approved_child_links: ['c1'] }));
    expect(html).toContain('اختر الطفل الذي تتابع بياناته');
  });
});
