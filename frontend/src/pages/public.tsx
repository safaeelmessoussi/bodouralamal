import type { ReactNode } from 'react';

import { t } from '../i18n/index.js';

/**
 * Public pages (SRS §14.1 PUBLIC branch, §5.1).
 *
 * Only the nodes §14.1 defines exist here — §20 rule 16 forbids inventing
 * navigation. Content follows §5.1's enumeration: identity, mission, branch
 * list, read-only public calendar, unrestricted public resources, and the
 * login/register CTAs.
 */

function Logo({ large = false }: { large?: boolean }): ReactNode {
  return (
    <img
      src={large ? '/logo-large.png' : '/logo.png'}
      alt={t('app.logoAlt')}
      className={large ? 'logo logo-large' : 'logo'}
      width={large ? 552 : 184}
      height={large ? 480 : 160}
    />
  );
}

export function Landing(): ReactNode {
  return (
    <main className="landing">
      <header className="hero">
        <Logo large />
        <h1>{t('app.name')}</h1>
        <p className="tagline">{t('app.tagline')}</p>
        <nav className="cta">
          {/* Full page loads, not client navigation: the OAuth entry is a
              server redirect to Google (§4.1b step 1). */}
          <a className="button primary" href="/api/v1/auth/google">
            {t('landing.ctaLogin')}
          </a>
          <a className="button" href="/register">
            {t('landing.ctaRegister')}
          </a>
        </nav>
      </header>

      {/* §5.1 sections. Their data arrives with the calendar (M3), the resources
          directory (M6) and branch listing — each renders its §14.4 states then. */}
      <section>
        <h2>{t('landing.missionTitle')}</h2>
      </section>
      <section>
        <h2>{t('landing.branchesTitle')}</h2>
      </section>
      <section>
        <h2>{t('landing.calendarTitle')}</h2>
      </section>
      <section>
        <h2>{t('landing.resourcesTitle')}</h2>
      </section>
    </main>
  );
}

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
      <Logo />
      <h1>{t('nav.login')}</h1>
      {/* §4.1b step 7: failures arrive as a redirect key and are rendered as a
          friendly i18n message with a retry affordance. */}
      {messageKey ? (
        <p className="error-banner" role="alert">
          {t(messageKey)}
        </p>
      ) : null}
      <a className="button primary" href="/api/v1/auth/google">
        {t('landing.ctaLogin')}
      </a>
    </main>
  );
}

/** §14.1 `/content-unavailable` — the friendly landing for a stale public link
 *  to now-private content (§3.1). Nginx redirects here on storage 403/404. */
export function ContentUnavailable(): ReactNode {
  return (
    <main className="auth-page" role="alert">
      <Logo />
      <h1>{t('content.unavailableTitle')}</h1>
      <p>{t('content.unavailableBody')}</p>
    </main>
  );
}

/** §4.1 / Revision 16: one screen for rejected, suspended and soft-deleted. */
export function AccountDeactivated(): ReactNode {
  return (
    <main className="status-screen" role="alert">
      <Logo />
      <h1>{t('auth.deactivatedTitle')}</h1>
      <p>{t('auth.deactivatedBody')}</p>
    </main>
  );
}
