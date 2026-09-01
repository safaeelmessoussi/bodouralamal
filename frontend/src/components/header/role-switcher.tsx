import type { ReactNode } from 'react';

import { useState } from 'react';

import { switchRole } from '../../adapters/auth.js';
import { useActiveChild } from '../../contexts/active-child.js';
import { useActiveRole } from '../../contexts/active-role.js';
import { storeActiveRole, useSession } from '../../contexts/session.js';
import { t } from '../../i18n/index.js';
import { homeForRole } from '../../lib/role-home.js';
import { ChildContextSwitcher } from './child-context-switcher.js';
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
 * (`/admin`, `/teacher`, `/dashboard/student`), and staying put would leave a
 * مؤطِّرة looking at the back office she just left.
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
 *
 * **R62.9 — `ولي الأمر` is not a destination, it is a group.** A parent's home
 * is a *child's* dashboard, so selecting the bare role would arrive somewhere
 * with nobody selected. The entry expands into the approved children, and
 * picking one sets the role and the child **in one action** — which is why the
 * separate child dropdown that used to sit beside this one is gone.
 *
 * **A role with nothing to switch into is not offered.** `ولي الأمر` is hidden
 * unless at least one child is approved: the group would otherwise be an empty
 * menu, and an entry that opens onto nothing is the same defect as a button
 * that renders a blank page. Registering a child is a *task* and lives on its
 * own page, not in a context switcher (§14.1).
 *
 * The rule is applied to the LIST, not inside the group, so the switcher itself
 * disappears for an account whose only remaining role is one it cannot use.
 */
export function RoleSwitcher({ inline = false }: { inline?: boolean }): ReactNode {
  const { roles, activeRole, setActiveRole } = useActiveRole();
  const { children, setActiveChildId } = useActiveChild();
  const { accessToken } = useSession();
  const [busy, setBusy] = useState(false);

  // `ولي الأمر` is a group of children; with none approved there is nothing to
  // switch into, so the role is not offered at all.
  const selectable = roles.filter((role) => role !== 'parent' || children.length > 0);

  // A person holding only `parent` still needs this control: it is the only
  // route to their children. So the "one role, nothing to switch" shortcut has
  // to make an exception for it, or that account gets no switcher at all — but
  // only once they HAVE a child, which `selectable` already decided.
  const isParentOnly = selectable.length === 1 && selectable[0] === 'parent';
  if ((selectable.length < 2 && !isParentOnly) || activeRole === null) return null;

  async function select(role: string, childId?: string): Promise<void> {
    setBusy(true);
    try {
      // The server decides. It refuses a role the live rows do not carry, which
      // is why this asks rather than assumes.
      const granted = role === activeRole ? role : (await switchRole(role, accessToken)).active_role;
      storeActiveRole(granted);
      setActiveRole(granted);
      // Stored BEFORE navigating: the switch is a full page load, and an
      // in-memory child would be destroyed by the navigation that carries it.
      // Every non-Parent selection clears the stale child coordinate. A person
      // who genuinely also holds Student must then act as self, not as the last
      // child they viewed while in the Parent context.
      setActiveChildId(granted === 'parent' ? (childId ?? null) : null);
      const home = homeForRole(granted);
      // A role §14.1 gives no home stays put; the context has still changed.
      window.location.assign(home ?? window.location.pathname);
    } catch {
      // Refused, or offline. The menu closes and nothing changed — the token in
      // hand is still the one that was working a moment ago.
      setBusy(false);
    }
  }

  return (
    <>
      <Menu label={t('roles.switcherHint')} triggerLabel={roleLabel(activeRole)} inline={inline}>
        {(close) => (
          <>
            <p className="menu__group-label">{t('roles.switcherLabel')}</p>
            {selectable.map((role) =>
              role === 'parent' ? (
                <ChildContextSwitcher
                  key="parent"
                  onSelectChild={(childId) => {
                    close();
                    if (busy) return;
                    void select('parent', childId);
                  }}
                />
              ) : (
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
              ),
            )}
          </>
        )}
      </Menu>
    </>
  );
}

/** Unknown roles fall back to their identifier rather than an empty label, so a
 *  role added server-side is visible rather than invisible. */
function roleLabel(role: string): string {
  const label = t(`roles.${role}`);
  return label === `roles.${role}` ? role : label;
}
