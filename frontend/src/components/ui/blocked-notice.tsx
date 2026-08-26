import type { ReactNode } from 'react';

import { blockingDependencies } from '../../lib/blocked-by.js';
import { referenceFor } from '../../lib/error-classes.js';
import { t } from '../../i18n/index.js';

/**
 * **Why this record cannot be deleted, and what to do about it** (TD-5).
 *
 * One renderer for all five reference-data deletions — Category, Subject,
 * Level, Branch, Room — because they raise the identical contract and a
 * per-screen sentence is how «قاعات أو حلقات» came to be guessed on one page
 * while the real blockers were a group and a schedule.
 *
 * It states three things, in the order a reader needs them:
 *
 *  1. **that the record is in use** — the answer to *why did nothing happen*;
 *  2. **exactly what uses it, and how many**, in the association's words;
 *  3. **that refreshing will not help**, said plainly, because the server's
 *     generic `STATE_CONFLICT` sentence advises exactly that and following it
 *     changes nothing.
 *
 * The support reference is kept (§2): a refusal is still a real response with a
 * `request_id`, and dropping it would make the one case somebody reports the
 * one case nobody can trace. **No raw envelope reaches the screen.**
 */
export function BlockedNotice({
  error,
  /** The record's own word — «هذا المقر», «هذه القاعة» — so the lead reads. */
  item,
}: {
  error: unknown;
  item: string;
}): ReactNode {
  const blocking = blockingDependencies(error);
  if (blocking === null) return null;
  // Never null — `referenceFor` falls back to a local id rather than
  // fabricating a server one, which §2 established.
  const reference = referenceFor(error);

  return (
    <div className="confirm__blocked" role="alert">
      <p className="confirm__body">{t('states.err.blockedLead').replace('{item}', item)}</p>

      <ul className="confirm__blocked-list">
        {blocking.map((dependency) => (
          <li key={dependency.label}>
            {dependency.label} ({dependency.count})
          </li>
        ))}
      </ul>

      <p className="muted">{t('states.err.blockedHint')}</p>

      <p className="error-panel__reference">
        {reference.kind === 'server' ? t('states.err.serverRef') : t('states.err.localRef')}:{' '}
        <code>{reference.value}</code>
      </p>
    </div>
  );
}
