import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { fetchOperationsStatus, type OperationsStatus } from '../../adapters/operations.js';
import { AdminLayout } from '../../components/admin/admin-layout.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { useSession } from '../../contexts/session.js';
import { t } from '../../i18n/index.js';
import { formatInstant } from '../../lib/morocco-time.js';

/**
 * `/admin/operations` — **«حالة النظام»** (SRS Revision 169 §11).
 *
 * TD-14/TD-16 promised the administrator would be TOLD when something fails
 * quietly — a recording that never reached the library, a file never removed, a
 * purge that did not run — and until now only whoever had SSH was. This page is
 * that telling, for the Super Admin.
 *
 * **It says what each number MEANS and what to do**, because a bare «3» next to
 * «late» helps nobody who is not an engineer; and **it says what it cannot see**
 * (the backup and the certificate are watched on the server itself), because a
 * page of zeros would otherwise read as «everything is fine», which it does not
 * know.
 *
 * Counts only. No payload, no error text, no key ever reaches this screen.
 */

/** Whether anything here needs a person. Pure, so it is testable and so the
 *  badge and the sentence cannot disagree. */
export function needsAttention(status: OperationsStatus): boolean {
  return (
    status.jobs.failed > 0 ||
    status.jobs.late > 0 ||
    status.storage_retirement.failed > 0 ||
    status.storage_retirement.late > 0 ||
    status.storage_retirement.copy_unknown > 0
  );
}

function Count({ label, value, hint }: { label: string; value: number; hint: string }): ReactNode {
  return (
    <li data-count={value}>
      <strong>{label}:</strong> <Badge tone={value > 0 ? 'warn' : 'ok'}>{String(value)}</Badge>
      <p className="field__hint">{hint}</p>
    </li>
  );
}

export function OperationsPage(): ReactNode {
  const { accessToken } = useSession();
  const [status, setStatus] = useState<OperationsStatus | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setStatus(await fetchOperationsStatus(accessToken));
    } catch {
      setFailed(true);
    }
  }, [accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AdminLayout title={t('admin.nav.operations')} lede={t('admin.operations.lede')}>
      {failed ? (
        <p className="state" role="alert">
          {t('common.loadFailed')}
        </p>
      ) : status === null ? (
        <p className="state" role="status">
          {t('common.loading')}
        </p>
      ) : (
        <div data-operations-status data-needs-attention={needsAttention(status)}>
          <p className="state" role="status">
            {t(needsAttention(status) ? 'admin.operations.attention' : 'admin.operations.quiet')}{' '}
            <span className="muted">
              {t('admin.operations.checkedAt').replace('{at}', formatInstant(status.checked_at))}
            </span>
          </p>

          <section className="card" aria-labelledby="ops-jobs">
            <h2 id="ops-jobs">{t('admin.operations.jobsTitle')}</h2>
            <ul className="detail-list">
              <Count
                label={t('admin.operations.jobsFailed')}
                value={status.jobs.failed}
                hint={t('admin.operations.jobsFailedHint')}
              />
              <Count
                label={t('admin.operations.jobsLate')}
                value={status.jobs.late}
                hint={t('admin.operations.jobsLateHint')}
              />
            </ul>
            {status.jobs.queues.length > 0 ? (
              <>
                <p className="field__hint">{t('admin.operations.queuesHint')}</p>
                <ul className="detail-list" data-queues>
                  {status.jobs.queues.map((queue) => (
                    <li key={queue.name}>
                      <code dir="ltr">{queue.name}</code> —{' '}
                      {t('admin.operations.queueCounts')
                        .replace('{failed}', String(queue.failed))
                        .replace('{late}', String(queue.late))}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>

          <section className="card" aria-labelledby="ops-storage">
            <h2 id="ops-storage">{t('admin.operations.storageTitle')}</h2>
            <ul className="detail-list">
              <Count
                label={t('admin.operations.storagePending')}
                value={status.storage_retirement.pending}
                hint={t('admin.operations.storagePendingHint')}
              />
              <Count
                label={t('admin.operations.storageFailed')}
                value={status.storage_retirement.failed + status.storage_retirement.late}
                hint={t('admin.operations.storageFailedHint')}
              />
              <Count
                label={t('admin.operations.storageUnknown')}
                value={status.storage_retirement.copy_unknown}
                hint={t('admin.operations.storageUnknownHint')}
              />
            </ul>
          </section>

          <section className="card" aria-labelledby="ops-host">
            <h2 id="ops-host">{t('admin.operations.hostTitle')}</h2>
            {/* Said, never implied: zeros above say nothing about these two. */}
            <p data-host-not-visible>{t('admin.operations.hostNotVisible')}</p>
          </section>

          <div className="form__actions">
            <Button variant="secondary" onClick={() => void load()}>
              {t('admin.operations.refresh')}
            </Button>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
