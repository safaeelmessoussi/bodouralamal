import type { ReactNode } from 'react';

import { useActiveChild } from '../../contexts/active-child.js';
import { t } from '../../i18n/index.js';
import { MenuAction, MenuOption } from './menu.js';

/**
 * The `ولي الأمر` group inside the account switcher (§4.3, §14.3, R62.9).
 *
 * **It used to be a second, separate menu in the header**, beside the role
 * switcher: a parent picked the `parent` role in one dropdown and then a child
 * in another. R62.9 makes selecting a child **one action** that sets the active
 * role and the active child together, so the two menus become one — and this
 * component becomes the group rendered *inside* the role switcher rather than a
 * dropdown of its own. §14.3 still names it, and it still does the same job:
 * choose which linked child the parent is acting for.
 *
 * Choosing grants nothing. The id is carried on every later request as
 * `X-Active-Child-ID` and verified server-side against an approved
 * `FamilyLink`; §4.3 is explicit that client-side switching is presentation and
 * server-side verification is the enforcement. Only approved links reach here,
 * because `GET /me` returns only those.
 *
 * **The «＋ تسجيل طفل» action is persistent** (R62.9): a parent holding the role
 * with no approved children still sees this group, containing only that action.
 * A group that vanished when it was empty would leave such a parent no way to
 * register anybody.
 */
export function ChildContextSwitcher({
  onSelectChild,
  onRegisterChild,
}: {
  onSelectChild: (childId: string) => void;
  onRegisterChild: () => void;
}): ReactNode {
  const { children, activeChildId } = useActiveChild();

  return (
    <>
      <p className="menu__group-label">{t('roles.parent')}</p>
      {children.map((child) => (
        <MenuOption
          key={child.id}
          label={child.label}
          selected={child.id === activeChildId}
          onSelect={() => onSelectChild(child.id)}
        />
      ))}
      <MenuAction label={t('child.register')} onSelect={onRegisterChild} />
    </>
  );
}
