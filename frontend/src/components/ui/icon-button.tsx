import type { ReactNode } from 'react';

import { Icon, type IconName } from './icon.js';

/**
 * A control with no visible label — its accessible name comes entirely from
 * `label`, through a `visually-hidden` span rather than `aria-label` (the
 * same convention every other icon-only control on the platform already
 * uses, e.g. `ApplicationHeader`'s own burger).
 *
 * **Extracted rather than drawn a second time** (constitution §2.4/§2.6):
 * `Dialog`'s own close button and the admin portal's nav-drawer close button
 * are the same concept — a small, bordered, icon-only dismiss control — and
 * the rule is explicit that a second consumer is promoted by MOVING the
 * first one's styling here, not by copying it under a new name that then
 * drifts from the original.
 */
export function IconButton({
  icon,
  label,
  onClick,
  className = '',
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  className?: string;
}): ReactNode {
  return (
    <button
      type="button"
      className={['icon-button', className].filter(Boolean).join(' ')}
      onClick={onClick}
    >
      <span className="visually-hidden">{label}</span>
      <Icon name={icon} size={20} />
    </button>
  );
}
