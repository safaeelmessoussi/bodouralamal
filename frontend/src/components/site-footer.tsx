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
          {/**
            * **NEW P — the legal links, in the footer of every public page.**
            *
            * Google's OAuth policy (verified against Google's own documentation,
            * 2026-08-28) requires the privacy policy to be **hosted on the domain
            * that hosts the homepage** and **linked from that homepage so users
            * can find it easily**. The footer is how every public page satisfies
            * that with one implementation rather than a link the landing page
            * remembers and the others forget.
            */}
          <nav className="site-footer__links" aria-label={t('legal.navLabel')}>
            <a href="/privacy">{t('legal.privacyTitle')}</a>
            <a href="/terms">{t('legal.termsTitle')}</a>
          </nav>
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
