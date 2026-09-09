import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ActiveRoleProvider } from '../contexts/active-role.js';
import { SessionContext, type Me } from '../contexts/session.js';
import { Hero } from './landing.js';
import LANDING_SOURCE from './landing.tsx?raw';

/**
 * **The landing page's own CTA, not only the header's** (Owner, 2026-09-05;
 * revised R138 item 9, 2026-09-08).
 *
 * `application-header.test.tsx` already proves the header switches between
 * Sign in and Dashboard. This is the OTHER control the reported defect named:
 * the hero's big login button used to be hard-coded regardless of session
 * state, so a signed-in visitor landing on `/` saw the header correctly say
 * «لوحة التحكم» and the hero, one screen-length below it, still say «تسجيل
 * الدخول» — two controls on one page disagreeing about whether she was
 * signed in. The first fix replaced it with the hero's OWN «لوحة التحكم» —
 * functionally correct, but still a second control repeating what the header
 * a screen-length above it already said and already offered. R138 item 9
 * removed it entirely: an authenticated visitor now sees no hero CTA at all.
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

describe('an already-authenticated visitor — R138 item 9: no hero CTA at all', () => {
  it('never sees «تسجيل الدخول» in the hero', () => {
    const html = render('authenticated', person());
    expect(html).not.toContain('تسجيل الدخول');
    expect(html).not.toContain('/api/v1/auth/google');
  });

  it('does NOT see «لوحة التحكم» either — the header above already offers it', () => {
    const html = render('authenticated', person({ roles: ['student'] }));
    expect(html).not.toContain('لوحة التحكم');
    expect(html).not.toContain('href="/dashboard/student"');
  });

  it('renders no hero__actions block at all, for any role', () => {
    // Not merely "no visible button" — the Owner's instruction is that no
    // replacement CTA exists, so the wrapper itself must be absent too.
    for (const roles of [['student'], ['teacher'], ['admin'], []]) {
      const html = render('authenticated', person({ roles }));
      expect(html).not.toContain('hero__actions');
    }
  });

  it('an Active account with no role is consistent with every other case — still nothing', () => {
    const html = render('authenticated', person({ roles: [] }));
    expect(html).not.toContain('لوحة التحكم');
    expect(html).not.toContain('تسجيل الدخول');
  });
});

/**
 * **R138 item 10 — مسالك التعليم and كيف تنضمّين removed entirely, not
 * replaced.** `Landing` itself fetches `BranchesSection`/`PartnersSection`'s
 * own data, which is exactly why `Hero` above is tested separately rather
 * than through the whole page — so this reads the SOURCE instead, the same
 * way `scheduling-parity.test.tsx` pins composition it cannot render.
 */
describe('R138 item 10 — the two removed homepage sections stay removed', () => {
  it('no longer renders the stages or how-to-join sections', () => {
    expect(LANDING_SOURCE).not.toContain('id="stages"');
    expect(LANDING_SOURCE).not.toContain('id="how"');
    expect(LANDING_SOURCE).not.toContain('landing.stagesTitle');
    expect(LANDING_SOURCE).not.toContain('landing.howTitle');
  });

  it('still renders البحث عن فرع and الشركاء, unchanged in identity', () => {
    expect(LANDING_SOURCE).toContain('<BranchesSection');
    expect(LANDING_SOURCE).toContain('<PartnersSection');
  });
});
