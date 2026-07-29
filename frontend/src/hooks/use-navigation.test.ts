import { describe, expect, it } from 'vitest';

import { PUBLIC_LINKS, buildNavigation, isCurrent } from './use-navigation.js';

/**
 * The navigation model (§14.1, §2.1).
 *
 * These exist because both of this file's rules were got wrong once: Dashboard
 * appeared as a navigation link — which also gave an authenticated user the
 * same destination twice — and the anonymous case is the one that must never
 * regress, because it is the public face of the site.
 */
const anonymous = { status: 'anonymous' as const, me: null };
const loading = { status: 'loading' as const, me: null };
const authed = (over: Partial<{ roles: string[]; children: string[] }> = {}) => ({
  status: 'authenticated' as const,
  me: {
    id: 'u1',
    account_status: 'active' as const,
    roles: over.roles ?? ['student'],
    role_scopes: (over.roles ?? ['student']).map((role) => ({ role, branches: null })),
    approved_child_links: over.children ?? [],
  },
});

describe('the navigation links', () => {
  it('offers exactly the three public sections to an anonymous visitor', () => {
    const nav = buildNavigation(anonymous.status, anonymous.me);
    expect(nav.links.map((l) => l.key)).toEqual(['home', 'calendar', 'resources']);
  });

  it('NEVER contains Dashboard — in any state', () => {
    // Dashboard is an account control, not a site section. It was a nav link
    // once; that is the regression this pins.
    for (const session of [anonymous, loading, authed()]) {
      const nav = buildNavigation(session.status, session.me);
      expect(nav.links.map((l) => l.key)).not.toContain('dashboard');
      expect(nav.links.map((l) => l.href)).not.toContain('/dashboard');
    }
  });

  it('shows an authenticated user the same three sections, not more', () => {
    expect(buildNavigation('authenticated', authed().me).links).toEqual(PUBLIC_LINKS);
  });
});

describe('who is authenticated', () => {
  it('an anonymous visitor is not authenticated', () => {
    expect(buildNavigation(anonymous.status, anonymous.me).isAuthenticated).toBe(false);
  });

  it('a session still loading is NOT treated as authenticated', () => {
    // Otherwise the header would flash account controls at a visitor who turns
    // out to be anonymous a moment later.
    expect(buildNavigation(loading.status, loading.me).isAuthenticated).toBe(false);
  });

  it('an authenticated session with a profile is authenticated', () => {
    expect(buildNavigation('authenticated', authed().me).isAuthenticated).toBe(true);
  });

  it('status without a profile is not enough', () => {
    expect(buildNavigation('authenticated', null).isAuthenticated).toBe(false);
  });
});

describe('the switcher conditions', () => {
  it('one role means no role switcher', () => {
    expect(buildNavigation('authenticated', authed({ roles: ['student'] }).me).hasMultipleRoles).toBe(
      false,
    );
  });

  it('two roles means a role switcher (§2.1)', () => {
    expect(
      buildNavigation('authenticated', authed({ roles: ['parent', 'student'] }).me).hasMultipleRoles,
    ).toBe(true);
  });

  it('no approved links means no child switcher', () => {
    expect(buildNavigation('authenticated', authed({ children: [] }).me).hasLinkedChildren).toBe(false);
  });

  it('an approved link means a child switcher (§4.3)', () => {
    expect(buildNavigation('authenticated', authed({ children: ['c1'] }).me).hasLinkedChildren).toBe(
      true,
    );
  });

  it('an anonymous visitor gets neither switcher', () => {
    const nav = buildNavigation(anonymous.status, anonymous.me);
    expect(nav.hasMultipleRoles).toBe(false);
    expect(nav.hasLinkedChildren).toBe(false);
  });
});

describe('current-page marking', () => {
  it('marks home only on the root', () => {
    expect(isCurrent('/', '/')).toBe(true);
    expect(isCurrent('/', '/calendar')).toBe(false);
  });

  it('marks a section on its own path and below it', () => {
    expect(isCurrent('/calendar', '/calendar')).toBe(true);
    expect(isCurrent('/calendar', '/calendar/2026-06')).toBe(true);
    expect(isCurrent('/calendar', '/resources')).toBe(false);
  });

  it('ignores a trailing slash', () => {
    expect(isCurrent('/', '///')).toBe(true);
    expect(isCurrent('/calendar', '/calendar/')).toBe(true);
  });
});
