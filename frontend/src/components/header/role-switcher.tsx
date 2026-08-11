import type { ReactNode } from 'react';

import { useState } from 'react';

import { switchRole } from '../../adapters/auth.js';
import { useActiveRole } from '../../contexts/active-role.js';
import { storeActiveRole, useSession } from '../../contexts/session.js';
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
 * **R60 — it now changes AUTHORITY, not only presentation.** The server mints a
 * token narrowed to the chosen role, so a Super Admin working as مؤطِّرة is
 * refused Super Admin operations until they switch back. The request is stored
 * before navigating, because the next page re-acquires its token from
 * `/auth/refresh` and that is what makes the choice persist.
 *
 * **A safety mechanism, not containment** (§60.0): switching back is one click,
 * so this prevents accidents and makes testing-as-a-role truthful. It does not
 * defend against a Super Admin who intends harm.
 */
export function RoleSwitcher({ inline = false }: { inline?: boolean }): ReactNode {
  const { roles, activeRole, setActiveRole } = useActiveRole();
  const { accessToken } = useSession();
  const [busy, setBusy] = useState(false);
  if (roles.length < 2 || activeRole === null) return null;

  async function select(role: string): Promise<void> {
    setBusy(true);
    try {
      // The server decides. It refuses a role the live rows do not carry, which
      // is why this asks rather than assumes.
      const result = await switchRole(role, accessToken);
      storeActiveRole(result.active_role);
      setActiveRole(result.active_role);
      const home = homeForRole(result.active_role);
      // A role §14.1 gives no home stays put; the context has still changed.
      window.location.assign(home ?? window.location.pathname);
    } catch {
      // Refused, or offline. The menu closes and nothing changed — the token in
      // hand is still the one that was working a moment ago.
      setBusy(false);
    }
  }

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
                if (role === activeRole || busy) return;
                void select(role);
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
