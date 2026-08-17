import type { ReactNode } from 'react';

import { ApplicationHeader } from '../components/header/application-header.js';
import { Logo } from '../components/ui/logo.js';
import { SiteFooter } from '../components/site-footer.js';
import { ButtonLink } from '../components/ui/button.js';
import { t } from '../i18n/index.js';

/**
 * Public pages (SRS §14.1 PUBLIC branch, §5.1).
 *
 * Only the nodes §14.1 defines exist here — §20 rule 16 forbids inventing
 * navigation. Content follows §5.1's enumeration: identity, mission, branch
 * list, read-only public calendar, unrestricted public resources, and the
 * login/register CTAs.
 */

/** §14.1 `/login` — Google OAuth entry only. No password fields exist (§4.1). */
export function Login(): ReactNode {
  const error = new URLSearchParams(window.location.search).get('error');
  const messageKey =
    error === 'user_denied'
      ? 'auth.errorUserDenied'
      : error === 'state_mismatch'
        ? 'auth.errorStateMismatch'
        : error === 'oauth_unavailable'
          ? 'auth.errorOauthUnavailable'
          : error === 'email_unverified'
            ? 'auth.errorEmailUnverified'
            : error === 'account_deactivated'
              ? 'auth.errorAccountDeactivated'
              : null;

  return (
    <main className="auth-page">
      <Logo showText={false} />
      <h1>{t('nav.login')}</h1>
      {/* §4.1b step 7: failures arrive as a redirect key and are rendered as a
          friendly i18n message with a retry affordance. */}
      {messageKey ? (
        <p className="error-banner" role="alert">
          {t(messageKey)}
        </p>
      ) : null}
      <ButtonLink variant="primary" href="/api/v1/auth/google">
        {t('landing.ctaLogin')}
      </ButtonLink>
    </main>
  );
}

/** §14.1 `/content-unavailable` — the friendly landing for a stale public link
 *  to now-private content (§3.1). Nginx redirects here on storage 403/404. */
export function ContentUnavailable(): ReactNode {
  return (
    <main className="auth-page" role="alert">
      <Logo showText={false} />
      <h1>{t('content.unavailableTitle')}</h1>
      <p>{t('content.unavailableBody')}</p>
    </main>
  );
}

/** §4.1 / Revision 16: one screen for rejected, suspended and soft-deleted. */
export function AccountDeactivated(): ReactNode {
  return (
    <main className="status-screen" role="alert">
      <Logo showText={false} />
      <h1>{t('auth.deactivatedTitle')}</h1>
      <p>{t('auth.deactivatedBody')}</p>
    </main>
  );
}

/**
 * A route that §14.1 defines but whose page is a later task.
 *
 * The header links to `/calendar` and `/resources` because those are real
 * navigation nodes; until their pages exist, following one lands here rather
 * than on a blank screen — §14.4 requires every surface to state which of its
 * states it is in, and "not yet" is one of them.
 */
export function NotBuiltYet(): ReactNode {
  return (
    <>
      <ApplicationHeader />
      <main id="main" className="status-screen">
        <h1>{t('states.notBuiltTitle')}</h1>
        <p className="lede">{t('states.notBuiltBody')}</p>
        <p>
          <ButtonLink variant="primary" href="/">
            {t('nav.home')}
          </ButtonLink>
        </p>
      </main>
      <SiteFooter />
    </>
  );
}

/**
 * The catch-all for a path the sitemap does not define (§14.4).
 *
 * **This page exists because of a P0 regression.** The router's `default`
 * branch used to render `null` for any unmatched path, so a typo'd URL — and,
 * far worse, the header's own Dashboard button, which pointed at a `/dashboard`
 * node §14.1 does not define — produced a **blank white page**. §14.4 is
 * explicit that a page is never blank and never a crash; a fallback that
 * renders nothing satisfies neither.
 *
 * It offers the way back rather than only stating the problem, because the
 * reader arrived here by following something that looked like a link.
 */
export function NotFound(): ReactNode {
  return (
    <main className="auth-page" role="alert">
      <Logo showText={false} />
      <h1>{t('states.notFoundTitle')}</h1>
      <p>{t('states.notFoundBody')}</p>
      <ButtonLink variant="primary" href="/">
        {t('nav.home')}
      </ButtonLink>
    </main>
  );
}

/**
 * A §14.1 node whose screen belongs to a later milestone.
 *
 * Distinct from `NotFound` on purpose: "this does not exist" and "this is not
 * built yet" are different facts, and the second is the honest answer for a
 * teacher or parent home the sitemap defines but no milestone has delivered.
 * The back office says the same thing through `ModulePending` — naming what is
 * missing beats "coming soon", which tells nobody whether the wait is a day or
 * a milestone.
 */
export function ScreenPending(): ReactNode {
  return (
    <main className="auth-page" role="status">
      <Logo showText={false} />
      <h1>{t('states.pendingScreenTitle')}</h1>
      <p>{t('states.pendingScreenBody')}</p>
      <ButtonLink variant="secondary" href="/">
        {t('nav.home')}
      </ButtonLink>
    </main>
  );
}
