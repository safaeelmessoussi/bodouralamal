import type { ReactNode } from 'react';

import { Button, ButtonLink } from './button.js';
import { t } from '../../i18n/index.js';
import { ApiError } from '../../lib/api.js';
import {
  classifyError,
  isRetryable,
  PUBLIC_CODE,
  referenceFor,
  type ErrorClass,
} from '../../lib/error-classes.js';

/**
 * **The one place a failure is shown to a person.**
 *
 * ## What it replaces
 *
 * Every screen said its own version of *"something went wrong"* — nine
 * different `t('…Failed')` strings, a bare `ErrorState` with no code and no
 * next step, and in the worst case the TD-3.8 envelope reaching the reader as
 * JSON. None of those tells somebody what to do next, and none of them gives
 * them anything to quote when they report it.
 *
 * ## What it shows, and what it will never show
 *
 * | Shown | Never shown |
 * |---|---|
 * | What happened, in Arabic | a stack trace |
 * | What to do next | SQL, a table or column name |
 * | A **stable public code** (`BA-403`) | a filesystem path |
 * | The server's `request_id`, exactly as received | an exception class or message |
 * | The server's own `code`, when there is one | a secret, a token, an internal id |
 *
 * The server never sends any of the right-hand column (TD-3.8, and
 * `middleware/request-context.ts` is unconditional about it) — and this
 * component never invents them either. It renders only what the envelope
 * carried plus copy chosen from the class.
 *
 * ## The reference, and why there are two kinds
 *
 * A `request_id` exists **only** when the request reached the server. When it
 * did not — offline, DNS, a dropped connection — there is nothing in any log to
 * find, so fabricating an identifier would send somebody searching for a
 * request that never happened. In that case a clearly-labelled **local**
 * reference is shown instead, with a line saying what it is.
 *
 * ## Page or inline — the caller's decision, not this component's
 *
 * `variant="page"` replaces the content of a screen that could not load.
 * `variant="inline"` sits beside the controls of an action that failed, because
 * replacing a whole screen because one save failed is more disruptive than the
 * failure. **Neither is right for an expected response**: the anonymous
 * `/auth/refresh` 401 at startup is control flow, not a failure, and is handled
 * where it happens without reaching this component at all.
 */
export interface ErrorPanelProps {
  error: unknown;
  /**
   * Three, because layout and announcement are different questions.
   *
   * - `page` — the screen could not load; takes the reading measure, announced.
   * - `region` — a section's content could not load (a table, a card). Sits in
   *   the flow, but **still announced**: it replaces something the reader asked
   *   for, and a polite update would let them stare at an empty table.
   * - `inline` — an action failed beside the controls that triggered it. Polite,
   *   because interrupting somebody mid-form to re-read a message they can see
   *   is worse than the failure.
   */
  variant?: 'page' | 'region' | 'inline';
  /** Offered only where retrying could plausibly succeed. */
  onRetry?: (() => void) | undefined;
  /** Offered on a page-level failure that a reader can back out of. */
  onBack?: (() => void) | undefined;
}

const TITLE: Record<ErrorClass, string> = {
  unauthenticated: 'states.err.unauthenticatedTitle',
  forbidden: 'states.err.forbiddenTitle',
  not_found: 'states.err.notFoundTitle',
  conflict: 'states.err.conflictTitle',
  rate_limited: 'states.err.rateLimitedTitle',
  unavailable: 'states.err.unavailableTitle',
  offline: 'states.err.offlineTitle',
  server: 'states.err.serverTitle',
  unknown: 'states.err.unknownTitle',
};

const BODY: Record<ErrorClass, string> = {
  unauthenticated: 'states.err.unauthenticatedBody',
  forbidden: 'states.err.forbiddenBody',
  not_found: 'states.err.notFoundBody',
  conflict: 'states.err.conflictBody',
  rate_limited: 'states.err.rateLimitedBody',
  unavailable: 'states.err.unavailableBody',
  offline: 'states.err.offlineBody',
  server: 'states.err.serverBody',
  unknown: 'states.err.unknownBody',
};

export function ErrorPanel({
  error,
  variant = 'page',
  onRetry,
  onBack,
}: ErrorPanelProps): ReactNode {
  const kind = classifyError(error);
  const reference = referenceFor(error);
  // The server's own code, when it sent one. Shown BESIDE the public code, not
  // instead of it: this says which rule refused, the public one says which kind
  // of situation the reader is in.
  const serverCode = error instanceof ApiError ? error.code : null;

  return (
    <div
      className={`error-panel error-panel--${variant}`}
      // A failure is announced, not merely displayed. `alert` for a page the
      // reader has just landed on; `status` inline, where a polite announcement
      // does not interrupt what they were typing.
      role={variant === 'inline' ? 'status' : 'alert'}
      aria-live={variant === 'inline' ? 'polite' : 'assertive'}
    >
      <p className="error-panel__title">{t(TITLE[kind])}</p>
      <p className="error-panel__body">{t(BODY[kind])}</p>

      <p className="error-panel__code">
        {t('states.err.code')}: <code>{PUBLIC_CODE[kind]}</code>
        {serverCode ? (
          <>
            {' · '}
            <code>{serverCode}</code>
          </>
        ) : null}
      </p>

      <p className="error-panel__reference">
        {reference.kind === 'server' ? t('states.err.serverRef') : t('states.err.localRef')}:{' '}
        <code>{reference.value}</code>
      </p>
      {/* The hint explains why there is no `request_id` — which is only TRUE
          when the request never reached the server. A caller that simply had no
          error object to hand still gets a quotable reference, but must not be
          told something about the network that nobody established. */}
      {reference.kind === 'local' && kind === 'offline' ? (
        <p className="error-panel__hint">{t('states.err.localRefHint')}</p>
      ) : null}

      <div className="error-panel__actions">
        {onRetry && isRetryable(kind) ? (
          <Button variant="secondary" onClick={onRetry}>
            {t('states.err.retry')}
          </Button>
        ) : null}
        {kind === 'unauthenticated' ? (
          // The only action that can resolve it. Offering *retry* here would
          // invite pressing a button against a session that is already gone.
          <ButtonLink variant="primary" href="/login">
            {t('states.err.signIn')}
          </ButtonLink>
        ) : null}
        {onBack ? (
          <Button variant="secondary" onClick={onBack}>
            {t('states.err.back')}
          </Button>
        ) : null}
        {variant !== 'inline' && kind !== 'unauthenticated' ? (
          <ButtonLink variant="secondary" href="/">
            {t('states.err.home')}
          </ButtonLink>
        ) : null}
      </div>
    </div>
  );
}
