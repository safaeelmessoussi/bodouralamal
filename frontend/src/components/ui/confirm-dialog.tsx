import { useEffect, useState, type ReactNode } from 'react';

import { t } from '../../i18n/index.js';
import { Button } from './button.js';
import { Dialog } from './dialog.js';
import { TextArea } from './field.js';

/**
 * The one confirmation dialog. Every destructive or overriding action in the
 * platform goes through it (§14.3), so "are you sure" is asked the same way
 * everywhere — which is what makes §2.2's *every CRUD feels identical* true for
 * the moment it matters most.
 *
 * **`reason` is not decoration.** TD-8 requires a mandatory free-text
 * justification for some actions — lifting a consent gate, overriding a
 * pass/fail, rejecting an application — and those justifications are written to
 * the audit log. Building that into the shared dialog means the field cannot be
 * forgotten on the screen that needs it.
 *
 * **The bounds are configurable because TD-9 does not use one pair.** A consent
 * override is 10–1000 characters; an approval-queue rejection is 1–500 (§5.6).
 * The dialog originally hard-coded the consent floor, which would have silently
 * imposed a 10-character minimum on rejections that the server does not ask for
 * — a client refusing what the server accepts is a bug in the client (§1.1). The
 * defaults stay the consent values, so no existing caller changes behaviour.
 *
 * **`details` is how a consequential action explains itself** (2026-08-17).
 * `body` is one sentence and must stay one — *"are you sure"* is not the place
 * for a paragraph — but ending an enrolment is recoverable, releases circle
 * seats, and keeps grades and Quran logs, and a reader deciding on it deserves to
 * know which. So the shared dialog gained ONE optional slot rather than a second
 * dialog growing beside it: a screen that needed to explain a consequence would
 * otherwise hand-roll its own confirmation, and «are you sure» would stop being
 * asked the same way everywhere — the exact property this component exists for.
 *
 * It renders and reports; it does not delete anything. The caller owns the
 * action (§3.2).
 */

/** TD-9 consent-override justifications: 10–1000 characters, mandatory. */
export const CONSENT_REASON_MIN = 10;
export const CONSENT_REASON_MAX = 1000;

export function ConfirmDialog({
  open,
  title,
  body,
  /**
   * Optional consequence detail, under `body` and above any justification.
   *
   * For *what this action keeps and what it ends* — the two facts that decide
   * whether somebody proceeds. Deliberately a node, so a caller may render a
   * definition list rather than a run-on sentence; deliberately optional, so the
   * ordinary delete confirmation stays one sentence.
   */
  details,
  confirmLabel,
  /**
   * The wording of the way OUT, when «إلغاء» is not what declining means.
   *
   * R82.5's notice asks *shall I tell everyone concerned* — and the answer is
   * «بدون إشعار», a decision, not a cancellation of one. Defaulting to
   * `common.cancel` leaves every existing caller unchanged.
   */
  cancelLabel,
  danger = false,
  /** When set, a justification is required and passed back on confirm. */
  reasonLabel,
  reasonHint,
  reasonMin = CONSENT_REASON_MIN,
  reasonMax = CONSENT_REASON_MAX,
  /**
   * **The action was refused, and the dialog becomes the explanation** (TD-5).
   *
   * When set, the destructive button is withdrawn — there is nothing left to
   * confirm — and the only way out is «إغلاق». The dialog **stays open** rather
   * than closing onto a notice at the top of the page: that is what made a
   * blocked Branch deletion read as *«nothing happened»*, since the confirm
   * vanished and the explanation appeared somewhere the reader was not looking.
   *
   * Rule AH — a message belongs where its kind belongs, and this one belongs to
   * the action the reader just took.
   */
  blocked,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: string;
  details?: ReactNode;
  /** The refusal, rendered in place of the confirmation. */
  blocked?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  reasonLabel?: string;
  reasonHint?: string;
  reasonMin?: number;
  reasonMax?: number;
  busy?: boolean;
  onConfirm: (reason?: string) => void;
  onCancel: () => void;
}): ReactNode {
  const [reason, setReason] = useState('');

  // Reopening must not inherit the previous answer — a stale justification
  // attached to a different action would be written to the audit log.
  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  const needsReason = reasonLabel !== undefined;
  const length = reason.trim().length;
  const tooLong = length > reasonMax;
  const reasonOk = !needsReason || (length >= reasonMin && !tooLong);

  return (
    <Dialog open={open} onClose={onCancel} title={title}>
      <div className="confirm">
        {/* **Refused: the dialog explains instead of asking.** The question is
            withdrawn along with the button, because there is no longer anything
            to answer — and the reason for the answer stays where the reader
            just acted. */}
        {blocked ?? <p className="confirm__body">{body}</p>}

        {blocked ? null : (details ?? null)}

        {blocked === undefined && needsReason ? (
          <TextArea
            label={reasonLabel}
            value={reason}
            onChange={setReason}
            required
            rows={3}
            hint={reasonHint ?? t('common.reasonHint')}
            // Announced rather than merely disabling the button: a button that
            // will not press, with no stated reason, is the failure §14.4's
            // error rule exists to prevent.
            error={tooLong ? t('common.reasonTooLong').replace('{max}', String(reasonMax)) : null}
          />
        ) : null}

        <div className="confirm__actions">
          <Button variant="secondary" onClick={onCancel}>
            {blocked ? t('states.err.blockedClose') : (cancelLabel ?? t('common.cancel'))}
          </Button>
          {/* Withdrawn entirely rather than disabled: a greyed destructive
              button invites the reader to keep trying the thing that cannot
              work, which is the same failure as telling her to refresh. */}
          {blocked ? null : (
            <Button
              variant={danger ? 'danger' : 'primary'}
              disabled={busy || !reasonOk}
              onClick={() => onConfirm(needsReason ? reason.trim() : undefined)}
            >
              {confirmLabel ?? t('common.confirm')}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
