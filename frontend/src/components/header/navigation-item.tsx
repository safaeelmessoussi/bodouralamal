import type { ReactNode } from 'react';

import { t } from '../../i18n/index.js';
import type { NavLink } from '../../hooks/use-navigation.js';

/**
 * One navigation link. The current page is marked with `aria-current="page"`,
 * which is also what the stylesheet keys its active state on — so the visual
 * and the announced state cannot disagree.
 */
export function NavigationItem({
  link,
  current,
  onNavigate,
}: {
  link: NavLink;
  current: boolean;
  onNavigate?: () => void;
}): ReactNode {
  return (
    <li>
      <a
        className="nav-item"
        href={link.href}
        {...(current ? { 'aria-current': 'page' as const } : {})}
        onClick={onNavigate}
      >
        {t(link.labelKey)}
      </a>
    </li>
  );
}
