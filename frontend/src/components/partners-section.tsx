import { useEffect, useState, type ReactNode } from 'react';

import { fetchPartners, type PublicPartner } from '../adapters/partners.js';
import { t } from '../i18n/index.js';
import { Container } from './ui/container.js';

/**
 * «شركاؤنا» — the §5.1 partners section (NEW N).
 *
 * ## It renders NOTHING when no partner is visible
 *
 * That is the specified behaviour and not a degraded one, and it is why this
 * section differs from `BranchesSection` beside it. A branch list that comes
 * back empty is a **fault** — the association has premises, so an empty answer
 * means something went wrong and the section says so. **Having no partners is an
 * ordinary state**, so a heading over an empty area, or an *«لا شركاء بعد»*
 * message, would be the page reporting an absence nobody asked about.
 *
 * The same reasoning covers the failure case: a public page degrades by leaving
 * the section out, never by showing a broken frame.
 *
 * ## Data-driven, like the branches
 *
 * Everything comes from `GET /partners`, so a partner added in the back office
 * appears here with **no frontend change and no deployment** — which is the
 * whole reason this is a table rather than four lines of copy.
 */
type State =
  | { kind: 'loading' }
  | { kind: 'ready'; partners: PublicPartner[] }
  | { kind: 'error' };

export function PartnersSection(): ReactNode {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const partners = await fetchPartners();
        if (!cancelled) setState({ kind: 'ready', partners });
      } catch {
        if (!cancelled) setState({ kind: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // **Nothing at all** while loading, on failure, or when the set is empty.
  // Rendering the heading first and filling it in would make the page jump for
  // every visitor of an association that has no partners listed.
  if (state.kind !== 'ready' || state.partners.length === 0) return null;

  return (
    <section id="partners" className="section" aria-labelledby="partners-title">
      <Container>
        <div className="section__head">
          <span className="eyebrow">{t('partners.eyebrow')}</span>
          <h2 id="partners-title" className="section__title">
            {t('partners.title')}
          </h2>
          <p className="lede">{t('partners.lede')}</p>
        </div>

        {/* A plain list rather than a card grid: a partner is a name and,
            since 2026-08-28, a sentence. A card would frame each in a box with
            an empty corner that reads as a missing logo — reporting an absence
            the data does not have. */}
        <ul className="partner-list">
          {state.partners.map((partner) => (
            <li key={partner.id}>
              <strong>{partner.name}</strong>
              {/* The description when there is one — an absent one renders
                  nothing rather than an empty line under the name. */}
              {partner.description === null ? null : (
                <span className="partner-list__description">{partner.description}</span>
              )}
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
