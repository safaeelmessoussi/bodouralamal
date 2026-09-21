import type { ReactNode } from 'react';

import type { Navigation } from '../../hooks/use-navigation.js';
import { InstallAppButton } from '../install/install-app-button.js';
import { NavigationMenu } from './navigation-menu.js';
import { RoleSwitcher } from './role-switcher.js';
import { AccountButton, DashboardButton, SignInButton, SignOutButton } from './auth-buttons.js';

/**
 * The small-screen sheet.
 *
 * It renders the **same** navigation model and the same switcher components as
 * the bar — only the arrangement differs. Nothing about which links exist or
 * who sees them is decided twice.
 *
 * The switchers render `inline`, because a popover inside an expanded sheet
 * would be a layer on a layer with nowhere to go on a 360 px screen.
 */
export function MobileMenu({
  navigation,
  pathname,
  roles,
  onSignOut,
  onNavigate,
}: {
  navigation: Navigation;
  pathname: string;
  /** The ACTIVE role's list, passed down from the header (R60) — never the
   *  account's full set. One resolution, one place. */
  roles: string[];
  onSignOut: () => void | Promise<void>;
  onNavigate: () => void;
}): ReactNode {
  return (
    <div className="mobile-menu" id="mobile-menu">
      <div className="container">
        <NavigationMenu
          links={navigation.links}
          pathname={pathname}
          className="mobile-menu__list"
          onNavigate={onNavigate}
        />

        {/* R167 §4 — «تثبيت التطبيق», where a phone user will look for it. */}
        <div className="mobile-menu__actions mobile-menu__actions--install">
          <InstallAppButton block />
        </div>

        {navigation.isAuthenticated ? (
          <div className="mobile-menu__actions">
            {/* One switcher, as on desktop (R62.9). */}
            <RoleSwitcher inline />
            <DashboardButton roles={roles} block />
            {/* «حسابي» — present on desktop inside `UserMenu`'s popover
                (R65); the sheet has no popover, so it is its own row here,
                matching `SignOutButton` right below it. */}
            <AccountButton block />
            <SignOutButton onSignOut={onSignOut} block />
          </div>
        ) : (
          <div className="mobile-menu__actions">
            <SignInButton block />
          </div>
        )}
      </div>
    </div>
  );
}
