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
    // NEW P — public and unauthenticated, as Google's OAuth policy requires.
    '/privacy',
    '/terms',
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
    '/profile',
    '/profile/register-child',
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
    // §14.1 lists /dashboard/student. It does not list /dashboard, so the
    // honest answer is "no such page" — rendered as a real page with a way
    // back, never as an empty document.
    expect(resolveRoute('/dashboard')).toBe('not-found');
  });

  it('R65: the personal section is role-independent, and both its paths resolve', () => {
    // §5.2 lists `/profile` under *Shared / Cross-Role* and it was never built,
    // which is why R64 hung child registration off `/dashboard/student` — and
    // left a مؤطِّرة who is nobody's student unable to register her own child.
    expect(resolveRoute('/profile')).toBe('profile');
    expect(resolveRoute('/profile/register-child')).toBe('register-child');
    // The role-shaped address R64 used is gone with it.
    expect(resolveRoute('/dashboard/student/register-child')).toBe('not-found');
  });

  it('R62: /dashboard/parent is NOT FOUND — the Family Dashboard was removed', () => {
    // It used to resolve to `screen-pending` ("not built yet"), which is a
    // promise. §5.4 removed the screen, so the honest answer changed with it:
    // this page is not coming.
    expect(resolveRoute('/dashboard/parent')).toBe('not-found');
  });
});

describe('the §14.1 sitemap decides, not a second list', () => {
  it('sends every role home somewhere real', () => {
    // The invariant that would have caught the original defect: a link the
    // header can produce must resolve to a page. `/admin` is the back office,
    // `/teacher` is the teacher portal, and the rest are defined nodes whose
    // screens are later milestones.
    for (const { role, path } of ROLE_HOMES) {
      const route = resolveRoute(path);
      expect(['admin', 'teacher', 'dashboard-student', 'screen-pending'] satisfies Route[]).toContain(route);
      expect(route, `${role} → ${path} must not be a dead link`).not.toBe('not-found');
    }
  });

  it('distinguishes "not built yet" from "does not exist"', () => {
    // Two different facts. Collapsing them would tell someone their home is
    // gone when it is merely unbuilt.
    //
    // `/teacher` is no longer one of them: it now resolves to its own portal,
    // which renders the teacher navigation with each entry naming what it is
    // waiting for. That is strictly more informative than the generic
    // "not built yet" page it used to get.
    expect(resolveRoute('/teacher')).toBe('teacher');
    // R62.10 delivered `/dashboard/student`, so it is no longer one of them
    // either — "not built yet" would now be a lie about a screen that exists.
    expect(resolveRoute('/dashboard/student')).toBe('dashboard-student');
    expect(resolveRoute('/nonsense')).toBe('not-found');
  });

  it('lets the back office own its sub-paths', () => {
    expect(resolveRoute('/admin/branches')).toBe('admin');
    expect(resolveRoute('/admin/groups/abc/roster')).toBe('admin');
  });

  it('lets the teacher portal own its sub-paths, without reaching the back office', () => {
    // Separate registries, separate applications: a teaching path must never
    // resolve into the administration shell.
    expect(resolveRoute('/teacher/schedules')).toBe('teacher');
    expect(resolveRoute('/teacher/exams')).toBe('teacher');
    expect(resolveRoute('/teacher-not-really')).toBe('not-found');
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

/**
 * M4b — §14.1's *My Quran Progress*. Pinned because the longer path must not be
 * swallowed by the bare dashboard route, and because the screen it opens is the
 * one place a student's own progress is readable.
 */
describe('the student’s Quran node (M4b)', () => {
  it('resolves its own route', () => {
    expect(resolveRoute('/dashboard/student/quran')).toBe('dashboard-student-quran');
  });

  it('does not swallow the dashboard itself', () => {
    expect(resolveRoute('/dashboard/student')).toBe('dashboard-student');
  });
});

/**
 * **NEW P — the legal pages are PUBLIC, and that is a requirement, not a
 * preference.**
 *
 * Google's OAuth policy, verified against Google's own documentation on
 * 2026-08-28, requires the privacy policy to be *"hosted within the domain that
 * hosts your homepage"* and *"linked on your homepage so that users can find
 * this information easily"*. A policy behind a login satisfies neither, so
 * routing either of these through an authenticated guard would break the OAuth
 * consent screen — a failure that would surface at Google's review rather than
 * in this repository.
 */
describe('the legal pages are reachable without signing in (NEW P)', () => {
  it('resolves /privacy and /terms to their own public routes', () => {
    expect(resolveRoute('/privacy')).toBe('privacy');
    expect(resolveRoute('/terms')).toBe('terms');
  });

  it('resolves them with a trailing slash too', () => {
    // A footer link that works and a pasted URL that does not would be the same
    // page failing for the one visitor who typed it.
    expect(resolveRoute('/privacy/')).toBe('privacy');
    expect(resolveRoute('/terms/')).toBe('terms');
  });
});
