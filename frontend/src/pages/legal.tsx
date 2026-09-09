import { useEffect, useState, type ReactNode } from 'react';

import {
  fetchActiveLegalDocument,
  type LegalDocumentKind,
} from '../adapters/legal-documents.js';
import { ApplicationHeader } from '../components/header/application-header.js';
import { SiteFooter } from '../components/site-footer.js';
import { ErrorState } from '../components/states.js';
import { Container } from '../components/ui/container.js';
import { t } from '../i18n/index.js';
import { ApiError } from '../lib/api.js';
import { formatDate } from '../lib/format-date.js';

/**
 * `/privacy` and `/terms` — the two legal pages (NEW P; versioned since R138
 * §12/§13).
 *
 * ## Dynamic now, not hardcoded JSX
 *
 * Both pages used to be static React content pulled from `i18n/ar.ts`, with
 * no relationship between what shipped and what a Super Admin approved — the
 * exact defect R119 already fixed for the registration consent wording (see
 * `legal-consent-text.service.ts`'s own doc comment). §12/§13 apply the same
 * fix here: the text is now a `LegalDocument` row, drafted and PUBLISHED
 * through `/superadmin/settings` rather than deployed, and this page shows
 * whichever version is currently active.
 *
 * ## No content is invented on this screen either
 *
 * Nothing here is seeded in production, on the same reasoning
 * `legal-consent-text`'s own migration states for consent wording and
 * `production.ts` states for `PARTNERS`: a plausible-looking legal document
 * fabricated by a deploy script is worse than an honestly absent one. Until a
 * Super Admin activates a version of each kind, this renders the same kind of
 * clear, non-alarming "not yet published" state `BranchesSection` already
 * uses for its own genuinely-absent case — never a blank page, never invented
 * text (§14.4).
 *
 * ## Public and unauthenticated, deliberately
 *
 * Google's OAuth policy (verified against Google's own documentation,
 * 2026-08-28) requires the privacy policy to be hosted on the domain that
 * hosts the homepage and linked from it, so a visitor can find it without
 * signing in. A policy behind a login satisfies neither, which is also why
 * `GET /legal-documents/{kind}` is anonymous.
 */
type State =
  | { kind: 'loading' }
  | { kind: 'ready'; body: string; activatedAt: string | null }
  | { kind: 'not_published' }
  | { kind: 'error'; error: unknown };

function useActiveDocument(kind: LegalDocumentKind): State {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    void (async () => {
      try {
        const row = await fetchActiveLegalDocument(kind);
        if (!cancelled) {
          setState({ kind: 'ready', body: row.body_arabic, activatedAt: row.activated_at });
        }
      } catch (error) {
        if (cancelled) return;
        if (
          error instanceof ApiError &&
          error.status === 503 &&
          error.details['reason'] === 'LEGAL_DOCUMENT_NOT_CONFIGURED'
        ) {
          setState({ kind: 'not_published' });
        } else {
          setState({ kind: 'error', error });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind]);

  return state;
}

function LegalPage({
  kind,
  titleKey,
}: {
  kind: LegalDocumentKind;
  titleKey: string;
}): ReactNode {
  const state = useActiveDocument(kind);

  return (
    <>
      <ApplicationHeader />
      <main id="main" className="section">
        <Container narrow>
          <h1>{t(titleKey)}</h1>

          {state.kind === 'loading' ? (
            <div className="skeleton" aria-live="polite" />
          ) : state.kind === 'error' ? (
            <ErrorState error={state.error} />
          ) : state.kind === 'not_published' ? (
            // §14.4 — declared as a state, not a blank page. Honest rather
            // than showing invented text: see the file's own doc comment.
            <p className="muted" role="status">
              {t('legal.notPublished')}
            </p>
          ) : (
            <>
              {state.activatedAt ? (
                <p className="muted">
                  {t('legal.publishedOn').replace('{date}', formatDate(state.activatedAt))}
                </p>
              ) : null}
              {/* The exact text, verbatim — the same reason
                  `white-space: pre-line` renders the admin editor's own
                  preview this way: paragraph breaks are part of what was
                  approved, not something this page re-flows. */}
              <div className="legal__body">{state.body}</div>
            </>
          )}
        </Container>
      </main>
      <SiteFooter />
    </>
  );
}

export function PrivacyPage(): ReactNode {
  return <LegalPage kind="privacy_policy" titleKey="legal.privacyTitle" />;
}

export function TermsPage(): ReactNode {
  return <LegalPage kind="terms_of_use" titleKey="legal.termsTitle" />;
}
