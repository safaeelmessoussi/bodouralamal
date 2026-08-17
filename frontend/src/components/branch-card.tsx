import type { ReactNode } from 'react';

import type { PublicBranch } from '../adapters/branches.js';
import { t } from '../i18n/index.js';
import { Button, ButtonLink } from './ui/button.js';

/**
 * One branch, exactly as the backend describes it.
 *
 * Every field is optional in the contract except the name, so each is rendered
 * only when present — a card must never show an empty line or a placeholder
 * where the association simply has not recorded something yet.
 */
export function BranchCard({ branch }: { branch: PublicBranch }): ReactNode {
  return (
    <article className="card branch-card">
      <h3 className="card__title">{branch.name}</h3>

      {branch.address ? <p className="branch-card__address">{branch.address}</p> : null}

      <div className="branch-card__contact">
        {branch.phone ? (
          // `tel:` because on the phones §2.2 targets this is the difference
          // between reading a number and calling it.
          <a href={`tel:${branch.phone.replace(/\s+/g, '')}`} dir="ltr">
            {branch.phone}
          </a>
        ) : null}
        {branch.email ? <a href={`mailto:${branch.email}`} dir="ltr">{branch.email}</a> : null}
      </div>

      {branch.opening_hours_ar ? (
        // Free multiline Arabic text, displayed verbatim and never parsed (§7).
        // `white-space: pre-line` is what preserves the author's line breaks.
        <p className="branch-card__hours">{branch.opening_hours_ar}</p>
      ) : null}

      <div className="branch-card__action">
        {branch.google_maps_url ? (
          <ButtonLink href={branch.google_maps_url} variant="secondary">
            {t('branches.viewOnMap')}
          </ButtonLink>
        ) : (
          /*
           * No URL recorded. The button is shown disabled rather than hidden,
           * so the card keeps its shape across the row — and `aria-disabled`
           * with an explanatory title says *why* instead of leaving a dead
           * control. A fabricated map link would be worse than no link.
           */
          /* The shared button, disabled — not a `<span>` wearing its classes
             (2026-08-17). `<button disabled>` IS the semantics of *"this action
             exists here and is unavailable"*: it carries the role, the state and
             the accessible name, all of which a styled span withholds. */
          <Button variant="secondary" disabled title={t('branches.mapUnavailable')}>
            {t('branches.viewOnMap')}
          </Button>
        )}
      </div>
    </article>
  );
}
