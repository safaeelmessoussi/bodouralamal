import type { ReactNode } from 'react';

import { t } from '../../i18n/index.js';

/** One step of the trail. The last one has no `href` — it is where you are. */
export type Crumb = { label: string; href?: string };

/**
 * The trail from a portal's own hierarchy down to the current screen.
 *
 * **Why this exists: the two hierarchies are not visible in the sidebar.**
 * Revision 69 gave `مواد المستوى` and `حلقات المواد` a navigation node each, so
 * they are reachable — but §14.1's menu is a flat list per section, and a flat
 * list cannot show that a Subject's circles live *inside* one Level's subjects,
 * which live inside a Level. The Owner asked the interface to make the two
 * hierarchies obvious (R69); the node answered *how do I get there* and this
 * answers *where am I*.
 *
 * **It links only to nodes that already exist**, carrying the `?level=` deep
 * link Revision 69.3 defines. §20 rule 16 forbids inventing navigation, and a
 * breadcrumb that could only be built by inventing a landing page would be
 * exactly that — which is why the trail is passed in by the page that knows its
 * own ids rather than derived from the URL here.
 *
 * **Rendered only where the trail is real.** A screen that has not been given a
 * Level yet is not *inside* anything, so it shows no trail rather than a
 * one-item one naming itself.
 */
export function Breadcrumb({ trail }: { trail: readonly Crumb[] }): ReactNode {
  if (trail.length < 2) return null;

  return (
    <nav className="breadcrumb" aria-label={t('common.breadcrumb')}>
      <ol className="breadcrumb__list">
        {trail.map((crumb, index) => {
          const last = index === trail.length - 1;
          return (
            <li key={crumb.href ?? crumb.label} className="breadcrumb__item">
              {crumb.href !== undefined && !last ? (
                <a href={crumb.href}>{crumb.label}</a>
              ) : (
                // The current page is named but not a link to itself, and
                // `aria-current` is what tells a screen reader which one it is.
                <span aria-current="page">{crumb.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
