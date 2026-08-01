import { describe, expect, it } from 'vitest';

import { ROLE_HOMES } from './role-home.js';
import { normalisePath, resolveRoute, type Route } from './route.js';

/**
 * The routing invariant, and the P0 it exists to prevent.
 *
 * `/dashboard` rendered a **blank white page**. The path switch's `default`
 * branch returned `null`, so any path §14.1 does not define produced nothing at
 * all — and the header's own Dashboard button pointed at exactly such a path,
 * which made it a defect every signed-in user could reach in one click.
 *
 * §14.4 is explicit: never a blank page, never a crash. A router that can
 * return "nothing" cannot satisfy that, so the rule is asserted directly here
 * rather than left as a property of a switch statement nobody re-reads.
 */

describe('every path resolves to a page — never to nothing', () => {
  const paths = [
    '/',
    '/login',
    '/register',
    '/calendar',
    '/resources',
    '/content-unavailable',
    '/pending-approval',
    '/account-deactivated',
    '/admin',
    '/admin/branches',
    '/admin/approvals',
    '/admin/groups/abc/roster',
    '/superadmin/hijri-calendar',
    '/teacher',
    '/dashboard/parent',
    '/dashboard/student',
    // The regression itself, plus the shapes that surround it.
    '/dashboard',
    '/dashboard/',
    '/nonsense',
    '/admin-not-really',
    '/a/b/c/d',
    '',
  ];

  it.each(paths)('resolves %j', (path) => {
    const route = resolveRoute(path);
    expect(route).toBeTruthy();
    expect(typeof route).toBe('string');
  });

  it('resolves the bare /dashboard to NOT FOUND, not to nothing', () => {
    // §14.1 lists /dashboard/student and /dashboard/parent. It does not list
    // /dashboard, so the honest answer is "no such page" — rendered as a real
    // page with a way back, never as an empty document.
    expect(resolveRoute('/dashboard')).toBe('not-found');
  });
});

describe('the §14.1 sitemap decides, not a second list', () => {
  it('sends every role home somewhere real', () => {
    // The invariant that would have caught the original defect: a link the
    // header can produce must resolve to a page. `/admin` is the back office;
    // the rest are defined nodes whose screens are later milestones.
    for (const { role, path } of ROLE_HOMES) {
      const route = resolveRoute(path);
      expect(['admin', 'screen-pending'] satisfies Route[]).toContain(route);
      expect(route, `${role} → ${path} must not be a dead link`).not.toBe('not-found');
    }
  });

  it('distinguishes "not built yet" from "does not exist"', () => {
    // Two different facts. Collapsing them would tell a teacher their home is
    // gone when it is merely unbuilt.
    expect(resolveRoute('/teacher')).toBe('screen-pending');
    expect(resolveRoute('/nonsense')).toBe('not-found');
  });

  it('lets the back office own its sub-paths', () => {
    expect(resolveRoute('/admin/branches')).toBe('admin');
    expect(resolveRoute('/admin/groups/abc/roster')).toBe('admin');
  });

  it('does not mistake a prefix for a match', () => {
    // `/admin-not-really` starts with `/admin` as a STRING but is not a
    // sub-path, and must not reach the back office.
    expect(resolveRoute('/admin-not-really')).toBe('not-found');
  });
});

describe('normalisePath', () => {
  it('treats a trailing slash as the same page', () => {
    expect(normalisePath('/calendar/')).toBe('/calendar');
    expect(resolveRoute('/calendar/')).toBe('calendar');
    expect(resolveRoute('/admin/branches/')).toBe('admin');
  });

  it('treats the empty path as the root', () => {
    expect(normalisePath('')).toBe('/');
    expect(normalisePath('/')).toBe('/');
  });
});
