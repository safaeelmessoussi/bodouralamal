import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ActiveChildProvider } from '../../contexts/active-child.js';
import { ActiveRoleProvider } from '../../contexts/active-role.js';
import { SessionContext, type Me } from '../../contexts/session.js';
import { StudentLayout } from '../../components/student/student-layout.js';
import { t } from '../../i18n/index.js';

/**
 * **§7 — the student dashboard's lede appears exactly ONCE, rendered.**
 *
 * ## Why the defect happened, and why a source test would have missed it
 *
 * `studentDashboard.landing` was never duplicated in the catalogue — it has one
 * entry. It was duplicated in **rendering**: `StudentLayout` shows it as the
 * page's `lede`, and R86, when it emptied the page body, left the same string
 * behind as a `<p className="muted">` three lines lower. Each site read
 * perfectly well on its own, and neither file contained the sentence twice.
 *
 * So this asserts the **markup**, not the source. Counting occurrences in the
 * page file would have said "one" both before and after the fix.
 *
 * ## Rendered through the layout, deliberately
 *
 * The duplication was a composition defect — the layout's slot against the
 * page's body — so the assertion has to see both together. The dashboard's own
 * body renders nothing for an identified beneficiary (R85/R86), which is
 * exactly the state that made the stray paragraph the only thing there.
 */
/**
 * **A one-property `window` shim, and why it is not a mock of the page.**
 *
 * This project's component tests run with **no DOM** — deliberately: the
 * handbook records that they have no layout engine, which is why layout
 * properties are measured in a real browser instead. `PortalShell` reads
 * `window.location.pathname` to mark the current menu entry, so static
 * rendering needs that one value and nothing else.
 *
 * Stubbed here rather than adding jsdom to the project: a DOM dependency for a
 * single string would change how every test in the suite runs.
 */
if (!('window' in globalThis)) {
  (globalThis as unknown as { window: unknown }).window = {
    location: { pathname: '/dashboard/student', search: '', href: 'http://localhost/dashboard/student' },
  };
}

const me: Me = {
  id: 's1',
  is_platform_owner: false,
  account_status: 'active',
  roles: ['student'],
  role_scopes: [{ role: 'student', branches: null }],
  active_role: 'student',
  approved_child_links: [],
  teaches_quran: false,
  self_attendance_allowed: false,
};

function render(body: React.ReactNode): string {
  return renderToStaticMarkup(
    <SessionContext.Provider
      value={{ status: 'authenticated', me, accessToken: null, setAccessToken: () => undefined }}
    >
      <ActiveRoleProvider>
        <ActiveChildProvider>
          <StudentLayout title={t('studentDashboard.title')} lede={t('studentDashboard.landing')}>
            {body}
          </StudentLayout>
        </ActiveChildProvider>
      </ActiveRoleProvider>
    </SessionContext.Provider>,
  );
}

const LEDE = 'من القائمة تصلين إلى تقويمك ونقاط الامتحانات والمحتوى.';

/** How many times a string occurs in the rendered HTML. */
function occurrences(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

describe('§7 — the lede is rendered once', () => {
  it('is the catalogue sentence the Owner reported', () => {
    expect(t('studentDashboard.landing')).toBe(LEDE);
  });

  it('appears exactly once with the dashboard’s (empty) body', () => {
    // The real state: R85/R86 leave the body empty for an identified
    // beneficiary, so the page is its header plus nothing.
    expect(occurrences(render(null), LEDE)).toBe(1);
  });

  it('would CATCH the defect — a body repeating it makes two', () => {
    // The assertion above is only protection if it can fail. This reintroduces
    // exactly what R86 left behind and proves the count moves.
    expect(occurrences(render(<p className="muted">{t('studentDashboard.landing')}</p>), LEDE)).toBe(
      2,
    );
  });

  it('still renders the page heading beside it — nothing else was removed', () => {
    const html = render(null);
    expect(html).toContain(t('studentDashboard.title'));
  });
});

/**
 * **Every student page renders inside the portal shell** (2026-09-05).
 *
 * `assessments.tsx` shipped without `StudentLayout`. It was the only one, and
 * the cost was not cosmetic: the page had no header and no navigation, so a
 * beneficiary who opened اختباراتي had **no way back to the rest of her
 * portal** — and the route looked unfinished rather than empty.
 *
 * A source-level assertion rather than a render test, deliberately: each of
 * these pages needs a different set of providers and a different API stubbed to
 * render, and a guard that is expensive to extend is a guard the next page skips.
 * The shell is a structural fact about the file, and that is what is checked.
 */
describe('§14.4 — every student portal page renders inside StudentLayout', () => {
  const PAGES = import.meta.glob('./*.tsx', { eager: true, query: '?raw', import: 'default' }) as Record<
    string,
    string
  >;

  const portalPages = Object.entries(PAGES).filter(
    ([path]) => !path.includes('.test.') && !path.includes('landing'),
  );

  it('finds the pages it is meant to be guarding', () => {
    // Without this the loop below passes by matching nothing at all — the
    // failure mode a glob-driven guard has and a hand-written list does not.
    expect(portalPages.length).toBeGreaterThanOrEqual(5);
  });

  it('every one of them uses the shared shell', () => {
    /**
     * **`<StudentLayout`, not `StudentLayout`.** The first version matched the
     * bare word and therefore matched the doc comment that explains why the
     * shell is used — so the guard passed against a page whose JSX had been
     * stripped back to a `<section>`. It was proved by doing exactly that, and
     * this is the assertion that failed on the second attempt.
     */
    const bare = portalPages
      .filter(([, source]) => !source.includes('<StudentLayout'))
      .map(([path]) => path);
    expect(bare, `student pages rendering outside the portal shell: ${bare.join(', ')}`).toEqual([]);
  });
});
