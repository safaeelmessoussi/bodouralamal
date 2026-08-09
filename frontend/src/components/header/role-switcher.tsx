import type { ReactNode } from 'react';

import { useActiveRole } from '../../contexts/active-role.js';
import { t } from '../../i18n/index.js';
import { homeForRole } from '../../lib/role-home.js';
import { Menu, MenuOption } from './menu.js';

/**
 * Role switcher (§2.1: *"a single person may hold multiple roles concurrently …
 * switching context via an account switcher in the header"*).
 *
 * **It used to change nothing.** The selection lived in this component's own
 * `useState`, so picking a role re-labelled the trigger and left the person on
 * the same page, in the same portal, with the same navigation. The control was
 * documented as *"presentation only"* — but presentation that does not change
 * the presentation is a control that lies.
 *
 * Now it sets the shared active role and **navigates to that role's home**,
 * which is what makes the switch observable: §14.1 gives each role its own home
 * (`/admin`, `/teacher`, `/dashboard/parent`, `/dashboard/student`), and staying
 * put would leave a مؤطِّرة looking at the back office she just left.
 *
 * **A full page load, deliberately.** `main.tsx` routes on
 * `window.location.pathname` rather than through a router, so `assign` is how
 * this application navigates. It also guarantees every screen re-reads the new
 * active role rather than half of them keeping the old one.
 *
 * **What it does not do:** grant anything. TD-2 is enforced server-side on every
 * request from the JWT, which carries every role the caller holds. Switching
 * chooses a portal; it never widens or narrows authority.
 */
export function RoleSwitcher({ inline = false }: { inline?: boolean }): ReactNode {
  const { roles, activeRole, setActiveRole } = useActiveRole();
  if (roles.length < 2 || activeRole === null) return null;

  return (
    <Menu label={t('roles.switcherHint')} triggerLabel={roleLabel(activeRole)} inline={inline}>
      {(close) => (
        <>
          <p className="menu__group-label">{t('roles.switcherLabel')}</p>
          {roles.map((role) => (
            <MenuOption
              key={role}
              label={roleLabel(role)}
              selected={role === activeRole}
              onSelect={() => {
                close();
                if (role === activeRole) return;
                setActiveRole(role);

                // A role §14.1 gives no home stays where it is rather than
                // navigating nowhere. The context has still changed, so the
                // navigation and the portal follow on this page.
                const home = homeForRole(role);
                if (home !== null) window.location.assign(home);
              }}
            />
          ))}
        </>
      )}
    </Menu>
  );
}

/** Unknown roles fall back to their identifier rather than an empty label, so a
 *  role added server-side is visible rather than invisible. */
function roleLabel(role: string): string {
  const label = t(`roles.${role}`);
  return label === `roles.${role}` ? role : label;
}
