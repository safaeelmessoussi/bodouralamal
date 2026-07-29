import type { ReactNode } from 'react';

import { useActiveChild } from '../../contexts/active-child.js';
import { t } from '../../i18n/index.js';
import { Menu, MenuOption } from './menu.js';

/**
 * Child context switcher (§4.3, §14.3).
 *
 * Sets which linked child the parent is acting for. The choice is carried on
 * every subsequent request as `X-Active-Child-ID` and verified server-side
 * against an **approved** `FamilyLink` matching both parties — this control
 * grants nothing on its own, and §4.3 says as much: client-side switching is
 * presentation, server-side verification is the enforcement.
 *
 * Only approved links reach here, because `GET /me` returns only those.
 */
export function ChildContextSwitcher({ inline = false }: { inline?: boolean }): ReactNode {
  const { children, activeChildId, setActiveChildId } = useActiveChild();
  if (children.length === 0) return null;

  const active = children.find((child) => child.id === activeChildId);
  return (
    <Menu
      label={t('child.switcherHint')}
      triggerLabel={active?.label ?? t('child.switcherLabel')}
      inline={inline}
    >
      {(close) => (
        <>
          <p className="menu__group-label">{t('child.switcherLabel')}</p>
          {children.map((child) => (
            <MenuOption
              key={child.id}
              label={child.label}
              selected={child.id === activeChildId}
              onSelect={() => {
                setActiveChildId(child.id);
                close();
              }}
            />
          ))}
        </>
      )}
    </Menu>
  );
}
