import type { ReactNode } from 'react';

import type { Navigation } from '../../hooks/use-navigation.js';
import { NavigationMenu } from './navigation-menu.js';
import { RoleSwitcher } from './role-switcher.js';
import { ChildContextSwitcher } from './child-context-switcher.js';
import { DashboardButton, SignInButton, SignOutButton } from './auth-buttons.js';

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

        {navigation.isAuthenticated ? (
          <div className="mobile-menu__actions">
            {navigation.hasMultipleRoles ? <RoleSwitcher roles={roles} inline /> : null}
            {navigation.hasLinkedChildren ? <ChildContextSwitcher inline /> : null}
            <DashboardButton roles={roles} block />
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
