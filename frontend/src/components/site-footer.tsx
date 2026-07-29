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
          <p>{t('landing.footerCity')}</p>
        </div>
      </Container>
    </footer>
  );
}
