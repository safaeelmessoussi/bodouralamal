import type { ReactNode } from 'react';

import { t } from '../../i18n/index.js';
import type { PortalModule } from '../../lib/portal-modules.js';

/**
 * One navigation entry, for any portal.
 *
 * It only ever needed a module's `path`, `labelKey` and `status`, which are the
 * shared fields — so it moved here rather than being copied into the teacher
 * shell. The back office's sections are what differ between portals; a link is
 * a link.
 */
export function NavItem({
  module,
  current,
}: {
  module: PortalModule;
  current: PortalModule | null;
}): ReactNode {
  const isCurrent = current?.path === module.path;
  return (
    <li>
      <a
        className="admin-nav__item"
        href={module.path}
        // The programmatic "you are here", which a class alone does not convey.
        {...(isCurrent ? { 'aria-current': 'page' as const } : {})}
      >
        <span>{t(module.labelKey)}</span>
        {/* Marked in the menu as well as on the page: a reader deciding where to
            click deserves to know before the click, not after. */}
        {module.status === 'blocked' ? (
          <span className="admin-nav__badge">{t('admin.soon')}</span>
        ) : null}
      </a>
    </li>
  );
}

/**
 * The named "not built yet" state, for any portal.
 *
 * §14.4 forbids the blank page, and naming *what* is missing is what stops the
 * same investigation being repeated — "coming soon" tells nobody whether the
 * wait is a day or a milestone.
 */
export function ModulePending({ module }: { module: PortalModule }): ReactNode {
  return (
    <div className="state" role="status">
      <p>{t('admin.pendingTitle')}</p>
      {module.blockedReasonKey ? <p className="muted">{t(module.blockedReasonKey)}</p> : null}
    </div>
  );
}
