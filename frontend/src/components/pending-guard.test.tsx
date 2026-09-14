import { describe, expect, it } from 'vitest';

import PAGE from './pending-guard.tsx?raw';

/**
 * **A Pending user's screen must not be a dead end** (Owner-reported,
 * 2026-09-14). Before this fix the guard rendered only a bare `<main>` with a
 * title and a sentence — no header, no footer, no way to reach anything else
 * on the platform, not even the public pages an anonymous visitor already
 * reaches freely. `ApplicationHeader`'s navigation is exactly the three
 * public links (Home/Calendar/Resources) in every session state
 * (`hooks/use-navigation.ts`), so adding it here reaches no further than an
 * anonymous visitor already can — the server-side denial (TD-1: no endpoint
 * beyond `GET /me` and logout for a Pending session) is what actually
 * enforces the boundary, unchanged.
 *
 * Asserted against the source, matching this directory's established
 * precedent for a component whose defect is wiring rather than a value a
 * render test can see standalone: a rendered check would need `useSession`,
 * `useNavigation` and `useActiveRole` all faked with no existing harness for
 * any of the three.
 */
const source = PAGE.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

describe('the Pending screen is never a dead end', () => {
  it('renders the site header and footer around the pending message', () => {
    expect(source).toContain('<ApplicationHeader />');
    expect(source).toContain('<SiteFooter />');
    expect(source).toMatch(
      /<ApplicationHeader \/>[\s\S]*status-screen[\s\S]*<SiteFooter \/>/,
    );
  });

  it('still renders nothing but the header/footer/loading state before Pending is known — no flash of the wrong screen', () => {
    // The loading branch must return before the Pending check, unchanged.
    expect(source).toMatch(/status === 'loading'\)\s*return <LoadingState \/>;/);
  });
});
