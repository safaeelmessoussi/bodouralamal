import type { ReactNode } from 'react';

import { ApplicationHeader } from '../components/header/application-header.js';
import { BranchesSection } from '../components/branches-section.js';
import { SiteFooter } from '../components/site-footer.js';
import { Card, Step } from '../components/ui/card.js';
import { ButtonLink } from '../components/ui/button.js';
import { Container, Section } from '../components/ui/container.js';
import { t } from '../i18n/index.js';

/**
 * The public landing page (SRS §5.1, §14.1 PUBLIC branch).
 *
 * Redesigned narrative: Institution-first approach presenting the association
 * as a trusted educational community, then explaining how to participate.
 * Technology is enabler, not product.
 *
 * Section order answers visitor questions in sequence:
 * 1. Who are you? (Hero)
 * 2. Why trust you? (Credibility)
 * 3. Why choose you? (Trust - professional approach)
 * 4. Who do you serve? (Community)
 * 5. How do you teach? (Educational approach)
 * 6. Where can I join? (Branches - backend driven)
 * 7. What happens now? (Calendar - backend driven)
 * 8. What materials exist? (Resources - backend driven)
 * 9. What should I do? (CTA - enrollment)
 */
export function Landing(): ReactNode {
  return (
    <>
      <ApplicationHeader />
      <main id="main">
        <Hero />

        {/* Section 1: Since 2011 — credibility & institutional status */}
        <Section
          id="credibility"
          eyebrow={t('landing.credibilityEyebrow')}
          title={t('landing.credibilityTitle')}
          lede={t('landing.credibilityLede')}
          tint
        >
          <div className="grid grid--3">
            <Card
              icon="signal"
              title={t('landing.credibilityYears')}
              body=""
            />
            <Card
              icon="user"
              title={t('landing.credibilityWomen')}
              body=""
            />
            <Card
              icon="shield"
              title={t('landing.credibilityChildren')}
              body=""
            />
          </div>
        </Section>

        {/* Section 2: Why trust us — professional approach & differentiators */}
        <Section
          id="trust"
          eyebrow={t('landing.trustEyebrow')}
          title={t('landing.trustTitle')}
          lede={t('landing.trustIntro')}
        >
          <div className="grid grid--2">
            <Card
              icon="check"
              title={t('landing.trustItem1Title')}
              body={t('landing.trustItem1Body')}
            />
            <Card
              icon="document"
              title={t('landing.trustItem2Title')}
              body={t('landing.trustItem2Body')}
            />
            <Card
              icon="shield"
              title={t('landing.trustItem3Title')}
              body={t('landing.trustItem3Body')}
            />
            <Card
              icon="user"
              title={t('landing.trustItem4Title')}
              body={t('landing.trustItem4Body')}
            />
          </div>
        </Section>

        {/* Section 3: Our community — who we serve */}
        <Section
          id="community"
          eyebrow={t('landing.communityEyebrow')}
          title={t('landing.communityTitle')}
          lede={t('landing.communityIntro')}
          tint
        >
          <div className="grid grid--3">
            <Card
              icon="user"
              title={t('landing.communityAdultTitle')}
              body={t('landing.communityAdultDesc')}
            />
            <Card
              icon="user"
              title={t('landing.communityTeenTitle')}
              body={t('landing.communityTeenDesc')}
            />
            <Card
              icon="shield"
              title={t('landing.communityChildTitle')}
              body={t('landing.communityChildDesc')}
            />
          </div>
        </Section>

        {/* Section 4: Educational approach — how we teach */}
        <Section
          id="approach"
          eyebrow={t('landing.approachEyebrow')}
          title={t('landing.approachTitle')}
          lede={t('landing.approachIntro')}
        >
          <div className="grid grid--3">
            <Card
              icon="book"
              title={t('landing.approachItem1Title')}
              body={t('landing.approachItem1Body')}
            />
            <Card
              icon="book"
              title={t('landing.approachItem2Title')}
              body={t('landing.approachItem2Body')}
            />
            <Card
              icon="check"
              title={t('landing.approachItem3Title')}
              body={t('landing.approachItem3Body')}
            />
          </div>
        </Section>

        {/* Section 5: Our branches (backend-driven) — where to join */}
        <Section
          id="branches-intro"
          eyebrow={t('landing.branchesEyebrow')}
          title={t('landing.branchesTitle')}
          lede={t('landing.branchesIntro')}
          tint
        />
        <BranchesSection />

        {/* Section 6: Enrollment pathway — how to join (original steps, reframed) */}
        <Section
          id="how"
          eyebrow={t('landing.ctaIntro')}
          title={t('landing.howTitle')}
          lede={t('landing.howLede')}
        >
          {/* Steps: Google OAuth, Registration form, Admin approval */}
          <ol className="steps">
            <Step title={t('landing.step1Title')} body={t('landing.step1Body')} />
            <Step title={t('landing.step2Title')} body={t('landing.step2Body')} />
            <Step title={t('landing.step3Title')} body={t('landing.step3Body')} />
          </ol>
        </Section>

        {/* Section 7: Final CTA — clear action buttons */}
        <section className="section section--tint" id="final-cta">
          <Container>
            <div className="cta-block">
              <h2>{t('landing.ctaTitle')}</h2>
              <div className="cta-buttons">
                <ButtonLink href="/api/v1/auth/google" variant="primary">
                  {t('landing.heroCta')}
                </ButtonLink>
              </div>
            </div>
          </Container>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

/**
 * The hero answers: What is Bodour Al Amal?
 *
 * Institutional positioning: "This is a trusted educational association."
 * Not: "This is a platform" or "This is a service."
 *
 * Both CTAs are full page loads: §4.1b step 1 is a server redirect to Google,
 * so client navigation would never leave the origin.
 */
function Hero(): ReactNode {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <Container>
        <div className="hero__inner">
          <div>
            <h1 id="hero-title" className="hero__title">
              {t('landing.heroTitle')}
            </h1>
            <p className="hero__lede">{t('landing.heroLede')}</p>
            <div className="hero__actions">
              <ButtonLink href="/api/v1/auth/google" variant="primary">
                {t('landing.heroCta')}
              </ButtonLink>
            </div>
          </div>

          {/* Decorative: the association name is already the page heading, so
              an alt text here would only repeat it to a screen reader. */}
          <div className="hero__badge" aria-hidden="true">
            <img src="/logo-large.png" alt="" width={552} height={480} />
          </div>
        </div>
      </Container>
    </section>
  );
}
