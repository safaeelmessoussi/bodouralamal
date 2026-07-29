import type { ReactNode } from 'react';

import { isCurrent, type NavLink } from '../../hooks/use-navigation.js';
import { t } from '../../i18n/index.js';
import { NavigationItem } from './navigation-item.js';

/**
 * The list of navigation links, in either surface. Desktop and mobile differ
 * only by the class the list carries, so there is one implementation of "what
 * the menu contains and which item is current".
 */
export function NavigationMenu({
  links,
  pathname,
  className = 'nav-menu',
  onNavigate,
}: {
  links: NavLink[];
  pathname: string;
  className?: string;
  onNavigate?: () => void;
}): ReactNode {
  return (
    <ul className={className} aria-label={t('nav.primaryLabel')}>
      {links.map((link) => (
        <NavigationItem
          key={link.key}
          link={link}
          current={isCurrent(link.href, pathname)}
          {...(onNavigate ? { onNavigate } : {})}
        />
      ))}
    </ul>
  );
}
