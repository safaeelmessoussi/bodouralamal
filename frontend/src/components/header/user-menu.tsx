import type { ReactNode } from 'react';

import { t } from '../../i18n/index.js';
import { Menu } from './menu.js';
import { SignOutButton } from './auth-buttons.js';

/**
 * The account menu. Groups the destinations and actions that belong to the
 * signed-in person rather than to the site, so the header bar stays a
 * navigation bar.
 *
 * **R65 — this is the entry to the personal section**, and it is the one place
 * in the header that never depends on a role. §5.2 lists `/profile` under
 * *Shared / Cross-Role*; the account menu is what makes that reachable from
 * every portal, so a مؤطِّرة working as a teacher can still open the acts that
 * concern her as a person — her details, and registering her own child.
 *
 * It held sign-out alone until then, which is why the child-registration page
 * ended up hanging off a role's dashboard: there was nowhere else to put it.
 */
export function UserMenu({
  onSignOut,
  inline = false,
}: {
  onSignOut: () => void | Promise<void>;
  inline?: boolean;
}): ReactNode {
  return (
    <Menu label={t('nav.account')} triggerLabel={t('nav.account')} inline={inline}>
      {() => (
        <>
          <a className="menu__option" href="/profile">
            <span className="menu__label">{t('profile.title')}</span>
          </a>
          {/* «＋ تسجيل طفل» is NOT repeated here. The personal section is one
              click away and carries the action with the context that explains
              it — who may use it, and the status of requests already made. A
              second entry point to the same page is a second thing to keep in
              step, and the header is where that goes unnoticed. */}
          <div className="menu__sep" />
          <SignOutButton onSignOut={onSignOut} block />
        </>
      )}
    </Menu>
  );
}
