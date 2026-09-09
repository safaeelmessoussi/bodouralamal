import type { ReactNode } from 'react';

import { ApplicationHeader } from '../components/header/application-header.js';
import { SignInButton } from '../components/header/auth-buttons.js';
import { BranchesSection } from '../components/branches-section.js';
import { PartnersSection } from '../components/partners-section.js';
import { SiteFooter } from '../components/site-footer.js';
import { Container } from '../components/ui/container.js';
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

        {/* **مسالك التعليم and كيف تنضمّين were removed on the Owner's
            instruction (R138 item 10)**, both entirely — not replaced. The
            `landing.stages*`/`landing.how*`/`landing.step*` strings are kept in
            the catalogue on the same reasoning the mission section's own were:
            an unused key costs nothing, a deleted one has to be retyped if
            either section returns. `Card`, `Step` and `Section` are still used
            elsewhere on the platform (§14), so nothing about their own
            definitions changes — only this page's use of them. */}

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
 * `useNavigation` `ApplicationHeader` already reads for its own
 * Dashboard-vs-Sign-in switch — never a local flag this page invents, so the
 * hero cannot disagree with the header sitting directly above it. The
 * server-side fix at `GET /auth/google` means the OLD button would still have
 * landed her on her dashboard if clicked; this is the label catching up to
 * what the endpoint now actually does.
 *
 * **No replacement CTA once signed in** (Owner, R138 item 9). It used to show
 * `DashboardButton` here — a second «لوحة التحكم» directly under the header's
 * own — and the Owner's instruction is explicit: remove it entirely, offer NO
 * button at all, not a different one. She already reached the site signed in;
 * the header a screen-length above states exactly the same fact and already
 * offers the way in, so a second control repeating it lower on the same page
 * is not a smaller CTA, it is a redundant one.
 */
/** Exported for its own test — see `landing.test.tsx` — the same reasoning
 *  `hijri-calendar.tsx` exports `MonthRow` for: the defect this guards against
 *  (a stale CTA disagreeing with the header above it) lives in the rendered
 *  hero specifically, and testing the whole page would drag in
 *  `BranchesSection`/`PartnersSection`'s own data fetching for no reason. */
export function Hero(): ReactNode {
  const { isAuthenticated } = useNavigation();

  return (
    <section className="hero" aria-labelledby="hero-title">
      <Container>
        <div className="hero__inner">
          <div>
            <h1 id="hero-title" className="hero__title">
              {t('landing.heroTitle')}
            </h1>
            <p className="hero__lede">{t('landing.heroLede')}</p>
            {/* R138 item 9 — no button at all once signed in, not a smaller
                or differently-labelled one. See the doc comment above. */}
            {isAuthenticated ? null : (
              <div className="hero__actions">
                <SignInButton />
              </div>
            )}
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
