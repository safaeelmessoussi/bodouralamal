import type { ReactNode } from 'react';

import { ApplicationHeader } from '../components/header/application-header.js';
import { SiteFooter } from '../components/site-footer.js';
import { Container } from '../components/ui/container.js';
import { t } from '../i18n/index.js';

/**
 * `/privacy` and `/terms` — the two legal pages (NEW P).
 *
 * ## They describe what the platform ACTUALLY does
 *
 * That is why the brief made them wait for R111: a privacy policy cannot
 * describe a retention model that has not been decided. Every statement here is
 * traceable to something the code does — the Google scopes it requests, the data
 * §4.1 collects, what deletion keeps and what it removes.
 *
 * ## What is NOT here, and why it is marked rather than written
 *
 * Registration numbers, the legal entity's formal name, postal addresses, CNDP
 * references and governing law are **the Owner's and the association's lawyer's**.
 * Each is rendered as a visible **«معلومة مطلوبة من الجمعية»** marker rather than
 * invented, because a plausible-looking legal detail is worse than an obviously
 * missing one: the first is trusted and wrong, the second asks to be filled in.
 *
 * ## Public and unauthenticated, deliberately
 *
 * Google's OAuth policy (verified against Google's own documentation, 2026-08-28)
 * requires the privacy policy to be **hosted on the domain that hosts the
 * homepage** and **linked from that homepage** so users can find it easily. A
 * policy behind a login satisfies neither.
 */
function LegalPage({
  titleKey,
  ledeKey,
  sections,
}: {
  titleKey: string;
  ledeKey: string;
  sections: { heading: string; body: string[] }[];
}): ReactNode {
  return (
    <>
      <ApplicationHeader />
      <main id="main" className="section">
        <Container narrow>
          <h1>{t(titleKey)}</h1>
          <p className="lede">{t(ledeKey)}</p>

          {sections.map((section) => (
            <section key={section.heading} className="legal__section">
              <h2>{section.heading}</h2>
              {section.body.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </section>
          ))}

          <p className="muted">{t('legal.pendingNote')}</p>
        </Container>
      </main>
      <SiteFooter />
    </>
  );
}

export function PrivacyPage(): ReactNode {
  return (
    <LegalPage
      titleKey="legal.privacyTitle"
      ledeKey="legal.privacyLede"
      sections={[
        {
          heading: t('legal.privacyWhoHeading'),
          body: [t('legal.privacyWhoBody'), t('legal.ownerInput')],
        },
        {
          // The Google scopes, named exactly as the code requests them.
          heading: t('legal.privacyGoogleHeading'),
          body: [t('legal.privacyGoogleBody'), t('legal.privacyGoogleLimited')],
        },
        {
          heading: t('legal.privacyCollectHeading'),
          body: [t('legal.privacyCollectBody'), t('legal.privacyChildrenBody')],
        },
        {
          heading: t('legal.privacyUseHeading'),
          body: [t('legal.privacyUseBody'), t('legal.privacyNoSaleBody')],
        },
        {
          // R111's model, which is why this page had to wait for it.
          heading: t('legal.privacyRetentionHeading'),
          body: [
            t('legal.privacyRetentionBody'),
            t('legal.privacyDeletionBody'),
            t('legal.privacyRetentionPending'),
          ],
        },
        {
          heading: t('legal.privacyRightsHeading'),
          body: [t('legal.privacyRightsBody'), t('legal.ownerInput')],
        },
      ]}
    />
  );
}

export function TermsPage(): ReactNode {
  return (
    <LegalPage
      titleKey="legal.termsTitle"
      ledeKey="legal.termsLede"
      sections={[
        {
          heading: t('legal.termsWhoHeading'),
          body: [t('legal.termsWhoBody'), t('legal.ownerInput')],
        },
        {
          heading: t('legal.termsAccountsHeading'),
          body: [t('legal.termsAccountsBody'), t('legal.termsApprovalBody')],
        },
        {
          heading: t('legal.termsUseHeading'),
          body: [t('legal.termsUseBody'), t('legal.termsContentBody')],
        },
        {
          heading: t('legal.termsEndHeading'),
          body: [t('legal.termsEndBody')],
        },
        {
          heading: t('legal.termsLawHeading'),
          body: [t('legal.ownerInput')],
        },
      ]}
    />
  );
}
