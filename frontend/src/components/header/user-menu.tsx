import type { ReactNode } from 'react';

import { t } from '../../i18n/index.js';
import { Menu } from './menu.js';
import { SignOutButton } from './auth-buttons.js';

/**
 * The account menu. Groups the destinations and actions that belong to the
 * signed-in person rather than to the site, so the header bar stays a
 * navigation bar.
 *
 * It holds sign-out today; profile and the other §14.1 account nodes join it
 * when those pages exist, without the header changing.
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
          <div className="menu__sep" />
          <SignOutButton onSignOut={onSignOut} block />
        </>
      )}
    </Menu>
  );
}
