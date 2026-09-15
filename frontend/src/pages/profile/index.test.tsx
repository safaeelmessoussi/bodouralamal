import { describe, expect, it } from 'vitest';

import PAGE_SOURCE from './index.tsx?raw';
import STUDENT_MODULES_SOURCE from '../../lib/student-modules.ts?raw';
import ROUTE_SOURCE from '../../lib/route.ts?raw';

/**
 * `/dashboard/student/account` retired, merged into `/profile` (Owner,
 * 2026-09-15): the header's «حسابي» and the student portal's own «حسابي»
 * were the same word pointing at two different pages, one of which (the
 * portal's) carried her reference code, QR and enrolments that `/profile`
 * did not. Rather than delete that content, `/profile` gained a read-only
 * `ChildIdentitySection` — active only while acting for a linked child, and
 * never replacing the signed-in person's own editable section above it,
 * which is the exact "wrong card" risk the retired page's own docstring
 * named.
 *
 * Source-pinning: a live render needs a mocked `fetchStudentIdentity` call
 * and both the session and active-child providers to exercise meaningfully,
 * while the regression here is structural — that the merge happened at all,
 * and that it did not touch the always-the-signed-in-person sections.
 */
const pageSource = PAGE_SOURCE.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

describe('/profile absorbs the retired /dashboard/student/account', () => {
  it('fetches the active child’s identity, never in place of her own', () => {
    expect(pageSource).toContain('fetchStudentIdentity(accessToken, activeChildId)');
    // Her own profile load is untouched — still unconditional, never gated
    // on whether a child is active.
    expect(pageSource).toContain('fetchOwnProfile(accessToken)');
  });

  it('renders the child section only when acting for one, additively', () => {
    expect(pageSource).toMatch(/activeChild && childIdentity \? \(\s*<ChildIdentitySection/);
  });

  it('the child section is read-only — no save/delete control inside it', () => {
    const start = pageSource.indexOf('function ChildIdentitySection');
    const section = pageSource.slice(start, pageSource.indexOf('function ', start + 1));
    expect(section).not.toContain('onSaved');
    expect(section).not.toContain('deleteOwnAccount');
  });

  it('the student portal registry no longer lists /dashboard/student/account', () => {
    expect(STUDENT_MODULES_SOURCE).not.toContain("path: '/dashboard/student/account'");
  });

  it('the route resolver no longer maps /dashboard/student/account', () => {
    expect(ROUTE_SOURCE).not.toContain("'/dashboard/student/account'");
  });
});
