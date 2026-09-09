import type { ReactNode } from 'react';

import { Button } from '../ui/button.js';
import { Dialog } from '../ui/dialog.js';
import { t } from '../../i18n/index.js';
import type { ScheduleSession } from '../../adapters/sessions.js';

/**
 * **R138 §4.4 — the explicit preserve-vs-overwrite question**, asked whenever
 * an edit to a recurring class would otherwise touch a Session eligible for
 * forced resync. Two callers reach it — the series editor (تعديل العنصر,
 * `scheduling.tsx`) and the occurrence editor's *all sessions* / *this and
 * future* scopes (`schedule-sessions.tsx`) — because item 6 makes them behave
 * identically here: **"Do not maintain two competing implementations for
 * 'all Sessions.'"** One component, one wording, asked the same way from
 * either screen.
 *
 * **The decision is per Session, never per field** (item 4): a Session
 * overridden for one reason is either fully resynced with the rule or fully
 * spared — never partially, however narrow the reason it was overridden for.
 *
 * **Closing without choosing abandons the edit that triggered it.** The
 * caller has not sent anything yet when this opens, so there is a genuine
 * third way out here — unlike R83.3's notify question, asked only once the
 * change it concerns is already committed.
 */
export function ManualEditsDialog({
  count,
  busy,
  onOverwrite,
  onPreserve,
  onCancel,
}: {
  count: number;
  busy: boolean;
  onOverwrite: () => void;
  onPreserve: () => void;
  onCancel: () => void;
}): ReactNode {
  return (
    <Dialog open onClose={onCancel} title={t('admin.sessions.manualEditsTitle')}>
      <div className="form">
        <p>{t('admin.sessions.manualEditsBody')}</p>
        <p className="muted">
          {t('admin.sessions.manualEditsCount').replace('{n}', String(count))}
        </p>
        <div className="form__actions">
          <Button variant="secondary" disabled={busy} onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={busy} onClick={onPreserve}>
            {t('admin.sessions.manualEditsPreserve')}
          </Button>
          <Button variant="danger" disabled={busy} onClick={onOverwrite}>
            {t('admin.sessions.manualEditsOverwrite')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * **Which already-loaded Sessions a wider-scope edit would touch**, restricted
 * to Sessions actually eligible for a forced resync: protected for
 * `OVERRIDDEN` alone. A Session also `HAS_CONTENT`, `HAS_ATTENDANCE` or
 * `LIFECYCLE`-protected is never moved by this decision either way, so
 * counting it here would ask about a choice that changes nothing for it.
 *
 * `fromDate` narrows to a split's surviving half (`this_and_future`); omitted,
 * every row in range is considered — the whole-schedule case both the series
 * editor and the *all sessions* scope share.
 */
export function sessionsEligibleForOverwrite(
  rows: ScheduleSession[],
  fromDate?: string,
): ScheduleSession[] {
  return rows.filter((r) => {
    if (r.protected_reasons.length !== 1 || r.protected_reasons[0] !== 'OVERRIDDEN') {
      return false;
    }
    return fromDate === undefined ? true : r.date >= fromDate;
  });
}
