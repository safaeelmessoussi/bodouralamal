import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ActiveRoleProvider } from '../contexts/active-role.js';
import { SessionContext, type Me } from '../contexts/session.js';
import { Hero } from './landing.js';

/**
 * **The landing page's own CTA, not only the header's** (Owner, 2026-09-05).
 *
 * `application-header.test.tsx` already proves the header switches between
 * Sign in and Dashboard. This is the OTHER control the reported defect named:
 * the hero's big login button used to be hard-coded regardless of session
 * state, so a signed-in visitor landing on `/` saw the header correctly say
 * «لوحة التحكم» and the hero, one screen-length below it, still say «تسجيل
 * الدخول» — two controls on one page disagreeing about whether she was
 * signed in. Functionally the old button still worked (the server-side fix at
 * `GET /auth/google` would have redirected her correctly either way); this is
 * the label catching up to what the endpoint actually does.
 */
function render(state: 'anonymous' | 'authenticated', me: Me | null): string {
  return renderToStaticMarkup(
    <SessionContext.Provider
      value={{ status: state, me, accessToken: null, setAccessToken: () => undefined }}
    >
      <ActiveRoleProvider>
        <Hero />
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

describe('an anonymous visitor', () => {
  it('sees «تسجيل الدخول», pointing at the real OAuth entry', () => {
    const html = render('anonymous', null);
    expect(html).toContain('تسجيل الدخول');
    expect(html).toContain('/api/v1/auth/google');
  });
});

describe('an already-authenticated visitor — the fix', () => {
  it('never sees «تسجيل الدخول» in the hero', () => {
    const html = render('authenticated', person());
    expect(html).not.toContain('تسجيل الدخول');
    expect(html).not.toContain('/api/v1/auth/google');
  });

  it('sees «لوحة التحكم» instead, resolved to her actual role home', () => {
    const html = render('authenticated', person({ roles: ['student'] }));
    expect(html).toContain('لوحة التحكم');
    expect(html).toContain('href="/dashboard/student"');
  });

  it('a staff caller is sent to the back office, not hard-coded to one destination', () => {
    const html = render('authenticated', person({ roles: ['teacher'] }));
    expect(html).toContain('href="/teacher"');
  });

  it('an Active account with no role shows no dangling CTA, consistent with the header', () => {
    // §14.4 Revision 16 — the same fallback `DashboardButton` already applies
    // in the header; the hero must not invent a second rule for this case.
    const html = render('authenticated', person({ roles: [] }));
    expect(html).not.toContain('لوحة التحكم');
    expect(html).not.toContain('تسجيل الدخول');
  });
});
