import type { ReactNode } from 'react';

import { t } from '../i18n/index.js';
import { Button } from './ui/button.js';

/**
 * The §14.4 mandatory UI states, built once and reused (§14.3 forbids
 * duplicating a shared component per page). §14.4 names forgetting empty states
 * as the most common agent failure mode, so all of them live here from the
 * start rather than being added per screen.
 */

export function LoadingState(): ReactNode {
  // A skeleton, not a spinner, for tables (§14.4).
  return (
    <div className="state" role="status" aria-live="polite">
      <div className="skeleton" />
      <div className="skeleton" />
      <div className="skeleton" />
      <span className="visually-hidden">{t('states.loading')}</span>
    </div>
  );
}

export function EmptyState({ action }: { action?: ReactNode }): ReactNode {
  return (
    <div className="state">
      <p>{t('states.empty')}</p>
      {action}
    </div>
  );
}

export function ErrorState({ requestId, onRetry }: { requestId?: string; onRetry?: () => void }): ReactNode {
  return (
    <div className="state" role="alert">
      <p>{t('states.error')}</p>
      {/* §14.4: the request_id is shown discreetly so a user can quote it and
          it can be traced end to end (TD-14). */}
      {requestId ? (
        <p className="request-id">
          {t('states.requestId')}: <code>{requestId}</code>
        </p>
      ) : null}
      {onRetry ? (
        // The shared button, not a bare element. These states are the platform's
        // most-seen surfaces and were the only ones rendering an unstyled
        // browser control — which is what made them look like a different
        // product from the screens around them.
        <Button variant="secondary" onClick={onRetry}>
          {t('states.offlineRetry')}
        </Button>
      ) : null}
    </div>
  );
}

export function NoResultsState({ onClear }: { onClear?: () => void }): ReactNode {
  // Distinct from Empty (§14.4): "nothing here yet" and "nothing matches your
  // filters" need different answers.
  return (
    <div className="state">
      <p>{t('states.noResults')}</p>
      {onClear ? (
        <Button variant="secondary" onClick={onClear}>
          {t('states.clearFilters')}
        </Button>
      ) : null}
    </div>
  );
}

export function NoPermissionState(): ReactNode {
  // §14.4: never a blank page and never a crash.
  return (
    <div className="state" role="alert">
      <p>{t('states.noPermission')}</p>
    </div>
  );
}
