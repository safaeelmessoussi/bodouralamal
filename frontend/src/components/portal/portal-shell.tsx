import type { ReactNode } from 'react';

import { ApplicationHeader } from '../header/application-header.js';
import { Breadcrumb, type Crumb } from './breadcrumb.js';
import { NoPermissionState } from '../states.js';

/**
 * The frame every portal shares: header, sidebar, titled main region.
 *
 * **Role gating happens here, once**, for whichever portal renders it. A module
 * a session's roles do not admit renders the §14.4 no-permission state instead
 * of its content — never a blank page and never a crash. This is a **UX layer**:
 * the server enforces the TD-2 matrix on every endpoint regardless, and the URL
 * prefix is not the permission boundary.
 *
 * The sidebar is passed in rather than derived, because that is the one part
 * that genuinely differs: the back office groups its entries into §14.1's five
 * sections, and the teacher portal is a flat list.
 */
export function PortalShell({
  title,
  lede,
  breadcrumb,
  actions,
  sidebar,
  permitted,
  children,
}: {
  title: string;
  lede?: string | null;
  /** The trail from the portal's hierarchy to this screen (R69 — see `Breadcrumb`). */
  breadcrumb?: readonly Crumb[];
  /** Page-level controls — a "create" button belongs here, beside the heading. */
  actions?: ReactNode;
  sidebar: ReactNode;
  /** Whether this session may open the current module (TD-2, UX layer). */
  permitted: boolean;
  children: ReactNode;
}): ReactNode {
  return (
    <>
      <ApplicationHeader />
      <div className="admin">
        {sidebar}
        <main id="main" className="admin__main">
          <div className="admin__head">
            <div>
              {/* Above the heading, and only for a session that may open the
                  module: a trail names a Level, which is not something the
                  no-permission state should disclose. */}
              {permitted && breadcrumb ? <Breadcrumb trail={breadcrumb} /> : null}
              <h1 className="admin__title">{title}</h1>
              {lede ? <p className="lede">{lede}</p> : null}
            </div>
            {permitted && actions ? <div className="admin__actions">{actions}</div> : null}
          </div>

          {/* An `Active` account holding no role at all is reachable only through
              staff error, and §14.4 says it renders this rather than a dashboard
              — no endpoint would authorise one anyway. */}
          {permitted ? children : <NoPermissionState />}
        </main>
      </div>
    </>
  );
}
