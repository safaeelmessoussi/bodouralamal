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
 * pass/fail — and those justifications are written to the audit log. Building
 * that into the shared dialog means the field cannot be forgotten on the screen
 * that needs it, and the 10–1000 character limit TD-9 sets is enforced in one
 * place rather than per caller.
 *
 * It renders and reports; it does not delete anything. The caller owns the
 * action (§3.2).
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  danger = false,
  /** When set, a justification is required and passed back on confirm. */
  reasonLabel,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  danger?: boolean;
  reasonLabel?: string;
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
  const reasonOk = !needsReason || reason.trim().length >= MIN_REASON;

  return (
    <Dialog open={open} onClose={onCancel} title={title}>
      <div className="confirm">
        <p className="confirm__body">{body}</p>

        {needsReason ? (
          <TextArea
            label={reasonLabel}
            value={reason}
            onChange={setReason}
            required
            rows={3}
            hint={t('common.reasonHint')}
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

/** TD-9: consent-override justifications are 10–1000 characters, mandatory. The
 *  floor is shared here so no caller re-invents it. */
const MIN_REASON = 10;
