import { t } from '../i18n/index.js';
import { ApiError } from './api.js';

/**
 * **The two consent-wording refusals, worded once** (R119).
 *
 * Both surfaces that record a consent — `/register` and `تسجيل طفل` — can meet
 * either, and each had its own partial copy of the mapping: one knew about a
 * missing version and the other did not, which is exactly the drift rule AH was
 * written about.
 *
 * Returns `null` for anything else, so a caller keeps its own generic message
 * rather than this module inventing one for failures it knows nothing about.
 */
export function consentFailure(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const reason = error.details['reason'];
  /**
   * A configuration gap, not a transient outage — waiting cannot fix it. The
   * older `CONSENT_TEXT_VERSION_MISSING` is still matched because it was the
   * child-application path's own code before the wordings were unified.
   */
  if (
    reason === 'CONSENT_TEXT_VERSION_NOT_CONFIGURED' ||
    reason === 'CONSENT_TEXT_VERSION_MISSING'
  ) {
    return t('register.consentVersionMissing');
  }
  /**
   * The wording changed while the form was open. **Not a retry**: the person
   * must read the new text and decide about *it*, which is why the message says
   * the wording was updated rather than that something failed.
   */
  if (reason === 'CONSENT_TEXT_SUPERSEDED') return t('register.consentTextSuperseded');
  return null;
}
