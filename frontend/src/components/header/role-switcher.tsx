import { useState, type ReactNode } from 'react';

import { t } from '../../i18n/index.js';
import { Menu, MenuOption } from './menu.js';

/**
 * Role switcher (§2.1: *"a single person may hold multiple roles concurrently
 * … switching context via an account switcher in the header"*).
 *
 * Presentation only. The switch changes which role's surfaces the client
 * offers; it grants nothing, because TD-2 is enforced server-side on every
 * request and the JWT already carries every role the caller holds. Rendered
 * only when there is genuinely a choice — a single-role account gets no control
 * that does nothing.
 */
export function RoleSwitcher({
  roles,
  inline = false,
}: {
  roles: string[];
  inline?: boolean;
}): ReactNode {
  const [active, setActive] = useState(roles[0] ?? '');
  if (roles.length < 2) return null;

  return (
    <Menu label={t('roles.switcherHint')} triggerLabel={roleLabel(active)} inline={inline}>
      {(close) => (
        <>
          <p className="menu__group-label">{t('roles.switcherLabel')}</p>
          {roles.map((role) => (
            <MenuOption
              key={role}
              label={roleLabel(role)}
              selected={role === active}
              onSelect={() => {
                setActive(role);
                close();
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
