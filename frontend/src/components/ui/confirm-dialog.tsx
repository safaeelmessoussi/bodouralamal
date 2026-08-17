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
  danger = false,
  /** When set, a justification is required and passed back on confirm. */
  reasonLabel,
  reasonHint,
  reasonMin = CONSENT_REASON_MIN,
  reasonMax = CONSENT_REASON_MAX,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: string;
  details?: ReactNode;
  confirmLabel?: string;
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
        <p className="confirm__body">{body}</p>

        {details ?? null}

        {needsReason ? (
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
            {t('common.cancel')}
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            disabled={busy || !reasonOk}
            onClick={() => onConfirm(needsReason ? reason.trim() : undefined)}
          >
            {confirmLabel ?? t('common.confirm')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
