import type { ReactNode } from 'react';

import { ApplicationHeader } from '../components/header/application-header.js';
import { DashboardButton, SignInButton } from '../components/header/auth-buttons.js';
import { BranchesSection } from '../components/branches-section.js';
import { PartnersSection } from '../components/partners-section.js';
import { SiteFooter } from '../components/site-footer.js';
import { Card, Step } from '../components/ui/card.js';
import { Container, Section } from '../components/ui/container.js';
import { useActiveRole } from '../contexts/active-role.js';
import { useNavigation } from '../hooks/use-navigation.js';
import { t } from '../i18n/index.js';

/**
 * The public landing page (SRS §5.1, §14.1 PUBLIC branch).
 *
 * Every section is built from the shared primitives — `Section`, `Card`,
 * `Step`, `Button` — so this file is composition and copy, with no layout of
 * its own to drift from the rest of the platform.
 *
 * **The copy states only what is true of the association**: the three
 * educational stages that exist in the seeded reference data, the enrolment
 * path §4.1b actually implements, and the consent and progress guarantees the
 * SRS requires. No figures are claimed, because none are known — an invented
 * count of students would be a fabricated record on the public face of a
 * charity.
 */
export function Landing(): ReactNode {
  return (
    <>
      <ApplicationHeader />
      <main id="main">
        <Hero />

        {/* The mission section was removed on the Owner's instruction. Its
            substance now lives in the hero lede, which states the association's
            fields of work and its aim — so removing the section drops a
            restatement rather than the message. The `landing.mission*` strings
            are kept in the catalogue: the section may return, and an unused key
            costs nothing while a deleted one has to be rewritten. */}

        <Section
          id="stages"
          eyebrow={t('landing.stagesEyebrow')}
          title={t('landing.stagesTitle')}
          lede={t('landing.stagesLede')}
        >
          <div className="grid grid--3">
            <Card
              icon="book"
              title={t('landing.stageAdultTitle')}
              body={t('landing.stageAdultBody')}
              meta={t('landing.stageAdultMeta')}
            />
            <Card
              icon="user"
              title={t('landing.stageTeenTitle')}
              body={t('landing.stageTeenBody')}
              meta={t('landing.stageTeenMeta')}
            />
            <Card
              icon="shield"
              title={t('landing.stageChildTitle')}
              body={t('landing.stageChildBody')}
              meta={t('landing.stageChildMeta')}
            />
          </div>
        </Section>

        <Section
          id="how"
          eyebrow={t('landing.howEyebrow')}
          title={t('landing.howTitle')}
          lede={t('landing.howLede')}
          tint
        >
          {/* An ordered list because these steps genuinely happen in sequence
              (§4.1b); the numbering is generated from the DOM order. */}
          <ol className="steps">
            <Step title={t('landing.step1Title')} body={t('landing.step1Body')} />
            <Step title={t('landing.step2Title')} body={t('landing.step2Body')} />
            <Step title={t('landing.step3Title')} body={t('landing.step3Body')} />
          </ol>
        </Section>
        <BranchesSection />
        <PartnersSection />
      </main>
      <SiteFooter />
    </>
  );
}

/**
 * The hero states who the association is and what it does, then offers the two
 * real entry points. Both are full page loads: §4.1b step 1 is a server
 * redirect to Google, so client navigation would never leave the origin.
 *
 * **A signed-in visitor never sees «تسجيل الدخول» here** (Owner, 2026-09-05).
 * The check is the platform's own canonical session state — the same
 * `useNavigation`/`useActiveRole` pair `ApplicationHeader` already reads for
 * its Dashboard-vs-Sign-in switch — never a local flag this page invents, so
 * the hero cannot disagree with the header sitting directly above it. The
 * server-side fix at `GET /auth/google` means the OLD button would still have
 * landed her on her dashboard if clicked; this is the label catching up to
 * what the endpoint now actually does.
 */
/** Exported for its own test — see `landing.test.tsx` — the same reasoning
 *  `hijri-calendar.tsx` exports `MonthRow` for: the defect this guards against
 *  (a stale CTA disagreeing with the header above it) lives in the rendered
 *  hero specifically, and testing the whole page would drag in
 *  `BranchesSection`/`PartnersSection`'s own data fetching for no reason. */
export function Hero(): ReactNode {
  const { isAuthenticated } = useNavigation();
  const { activeRoles: roles } = useActiveRole();

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
              {isAuthenticated ? (
                <DashboardButton roles={roles} variant="primary" />
              ) : (
                <SignInButton />
              )}
            </div>
          </div>

          {/* Decorative: the association name is already the page heading, so
              an alt text here would only repeat it to a screen reader. */}
          <div className="hero__badge" aria-hidden="true">
            {/* The intrinsic size matches the asset, so the browser reserves the
                right box before it loads and the hero does not shift (CLS). It
                changed again when the artwork was replaced with a correctly
                matted cut-out (§3) — square now, where it used to be portrait. */}
            <img src="/logo-large.png" alt="" width={500} height={500} />
          </div>
        </div>
      </Container>
    </section>
  );
}
