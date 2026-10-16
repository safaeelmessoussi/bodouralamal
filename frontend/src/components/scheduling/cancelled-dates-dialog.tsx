import { useEffect, useState, type ReactNode } from 'react';

import {
  listCancelledActivityDates,
  restoreCancelledActivityDate,
  type CancelledActivityDate,
} from '../../adapters/scheduling.js';
import { t } from '../../i18n/index.js';
import { formatDateWithWeekday } from '../../lib/format-date.js';
import { Button } from '../ui/button.js';
import { Dialog } from '../ui/dialog.js';

/**
 * **SRS Revision 224 §2 — «التواريخ الملغاة» of one activity.** A holiday
 * cancels the activity's dates that fall in it, and the calendar does not show
 * them; here whoever may edit the activity sees them and gives one back with
 * «إعادة البرمجة» (the Owner: «as it does for classes»).
 */
export function CancelledDatesDialog({
  activity,
  token,
  onClose,
}: {
  activity: { id: string; title: string } | null;
  token: string | null;
  onClose: () => void;
}): ReactNode {
  const [rows, setRows] = useState<CancelledActivityDate[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (activity === null) return;
    setRows(null);
    setFailed(false);
    void listCancelledActivityDates(activity.id, token)
      .then(setRows)
      .catch(() => setFailed(true));
  }, [activity, token]);

  async function restore(date: string): Promise<void> {
    if (activity === null) return;
    setBusy(date);
    try {
      await restoreCancelledActivityDate(activity.id, date, token);
      setRows((current) => (current ?? []).map((r) => (r.date === date ? { ...r, restored: true } : r)));
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  }

  const pending = (rows ?? []).filter((r) => !r.restored);
  return (
    <Dialog
      open={activity !== null}
      onClose={onClose}
      title={t('scheduling.cancelledDates.title').replace('{title}', activity?.title ?? '')}
    >
      {failed ? (
        <p className="muted" role="status">{t('common.loadFailed')}</p>
      ) : rows === null ? (
        <p className="muted">{t('common.loading')}</p>
      ) : pending.length === 0 ? (
        <p className="muted">{t('scheduling.cancelledDates.none')}</p>
      ) : (
        <ul className="cancelled-dates">
          {pending.map((row) => (
            <li key={row.date} className="cancelled-dates__row">
              <span className="cancelled-dates__date">{formatDateWithWeekday(row.date)}</span>
              <span className="cancelled-dates__reason muted">{row.reason}</span>
              <Button variant="secondary" disabled={busy !== null} onClick={() => void restore(row.date)}>
                {busy === row.date ? t('common.loading') : t('admin.sessions.restore')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
