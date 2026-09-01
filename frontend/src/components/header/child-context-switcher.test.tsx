import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ActiveChildProvider } from '../../contexts/active-child.js';
import { ActiveRoleProvider } from '../../contexts/active-role.js';
import { SessionContext, type Me } from '../../contexts/session.js';
import { ChildContextSwitcher } from './child-context-switcher.js';

/**
 * The `ولي الأمر` group inside the account switcher (R62.9).
 *
 * Rendered directly rather than through the header, because a `Menu` panel only
 * exists while it is open and static markup never opens it — so a header-level
 * assertion could only ever prove the trigger, which is not where this rule
 * lives.
 */
const me = (links: { id: string; display_name: string }[]): Me => ({
  id: 'p1',
  is_platform_owner: false,
  account_status: 'active',
  roles: ['parent'],
  role_scopes: [{ role: 'parent', branches: null }],
  active_role: 'parent',
  approved_child_links: links,
  teaches_quran: false,
});

function render(links: { id: string; display_name: string }[]): string {
  return renderToStaticMarkup(
    <SessionContext.Provider
      value={{
        status: 'authenticated',
        me: me(links),
        accessToken: null,
        setAccessToken: () => undefined,
      }}
    >
      <ActiveRoleProvider>
        <ActiveChildProvider>
          <ChildContextSwitcher onSelectChild={() => undefined} />
        </ActiveChildProvider>
      </ActiveRoleProvider>
    </SessionContext.Provider>,
  );
}

describe('the ولي الأمر group (R62.9)', () => {
  it('names each approved child, rather than numbering them', () => {
    // The defect this replaced: labels were «طفل مرتبط ١، ٢» built from the
    // array index, so a parent of three could not tell which child they were
    // about to act for, and the numbering shifted when a link was revoked.
    const html = render([
      { id: 'c1', display_name: 'مريم بنعلي' },
      { id: 'c2', display_name: 'سلمى بنعلي' },
    ]);
    expect(html).toContain('مريم بنعلي');
    expect(html).toContain('سلمى بنعلي');
    expect(html).not.toContain('طفل مرتبط');
  });

  it('R64: registering a child is NOT here — a switcher lists contexts, not tasks', () => {
    // The action used to live in this group, so an account with the role and no
    // approved children opened a menu containing one item that was not a
    // context at all — and the dialog it opened could only carry a subset of
    // the fields the public form collects, which is how the two registration
    // paths diverged. It is a page now (§14.1).
    expect(render([])).not.toContain('تسجيل طفل');
    expect(render([{ id: 'c1', display_name: 'مريم بنعلي' }])).not.toContain('تسجيل طفل');
  });

  it('offers a child as a single-choice option, not a link', () => {
    // Selecting sets the active role AND the active child in one action and
    // then navigates; a bare anchor would navigate without either.
    const html = render([{ id: 'c1', display_name: 'مريم بنعلي' }]);
    expect(html).toContain('menuitemradio');
    expect(html).not.toContain('<a ');
  });
});
