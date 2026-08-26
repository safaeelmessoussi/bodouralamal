import type { ReactNode } from 'react';

import { t } from '../i18n/index.js';
import { Button } from './ui/button.js';
import { ErrorPanel } from './ui/error-panel.js';
import { ApiError } from '../lib/api.js';

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

export function ErrorState({
  error,
  requestId,
  onRetry,
}: {
  /**
   * The failure itself, when the caller has it.
   *
   * Supplying it is what turns *«حدث خطأ»* into the right sentence and the
   * right next action — a 403 and a dropped connection need different words and
   * different buttons. A caller that genuinely has no error object still gets
   * the branded panel and a quotable reference; it simply cannot be told which
   * kind of failure it was.
   */
  error?: unknown;
  /** Legacy: a bare `request_id` from a caller that discarded the error. */
  requestId?: string;
  onRetry?: () => void;
}): ReactNode {
  /**
   * **One appearance for every failure**, so a reader meets the same thing
   * everywhere and support gets the same identifiers every time. This used to
   * render its own paragraph with no code, no class and no next step, which is
   * why nine screens had grown their own «فشل» strings around it.
   */
  return (
    <ErrorPanel
      error={error ?? (requestId ? new ApiError(500, {
        code: 'INTERNAL',
        message_key: 'errors.internal',
        message: '',
        details: {},
        request_id: requestId,
      }) : undefined)}
      variant="region"
      {...(onRetry ? { onRetry } : {})}
    />
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
