import type { ReactNode } from 'react';

import { t } from '../i18n/index.js';
import { Container } from './ui/container.js';

/** The public footer. Kept alongside the header so every public page gets the
 *  same frame without restating it. */
export function SiteFooter(): ReactNode {
  const year = new Date().getFullYear();
  return (
    <footer className="site-footer">
      <Container>
        <div className="site-footer__row">
          <p>
            © {year} — {t('landing.footerRights')}
          </p>
          {/* `landing.footerCity` was removed on the Owner's instruction, key
              and all — unlike the mission strings, which are kept because that
              section was removed *for now*. The landing page's branch list
              carries each premises' real address, so one hardcoded city was
              both redundant and the kind of detail that goes stale the day a
              branch opens elsewhere. */}
        </div>
      </Container>
    </footer>
  );
}
