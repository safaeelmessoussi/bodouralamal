import { useCallback, useEffect, useState, type ReactNode } from 'react';

import {
  approveAccountReturn,
  listPendingAccountReturns,
  rejectAccountReturn,
  type PendingAccountReturn,
} from '../../adapters/account-returns.js';
import { AdminLayout } from '../../components/admin/admin-layout.js';
import { ConfirmDialog } from '../../components/ui/confirm-dialog.js';
import {
  DataTable,
  type Column,
  type RowAction,
  type TableStatus,
} from '../../components/ui/data-table.js';
import { TextArea } from '../../components/ui/field.js';
import { Feedback } from '../../components/ui/feedback.js';
import { FormDialog } from '../../components/ui/form-dialog.js';
import { useSession } from '../../contexts/session.js';
import { t } from '../../i18n/index.js';

/**
 * `/admin/account-return-requests` — طلبات استعادة حساب (Owner, 2026-09-04).
 *
 * **The association-side identity match, for a closed record.** Google has
 * already proved that somebody controls an address; what only a person can
 * decide is whether that somebody is the beneficiary whose archive this is. The
 * screen therefore shows exactly what decides it — the name **she gives now**
 * and a contact number — and the confirmation says in words what approving does.
 *
 * **A separate screen from طلبات الحساب المستقل, deliberately.** That one
 * transitions a LIVE account to its adult; this one **reopens a closed
 * account**, which is a materially different and more consequential decision.
 * One queue carrying both would be a queue in which a reviewer cannot see which
 * she is taking.
 *
 * **The Google provider subject is absent**, here and from the contract behind
 * it: it is a credential coordinate, not information a reviewer needs or should
 * be handling. The reference code is absent too — she quoted it to find the
 * archive, it proves nothing, and printing it back would suggest that matching
 * it is the decision.
 */
export function AccountReturnsPage(): ReactNode {
  const { accessToken } = useSession();
  const [rows, setRows] = useState<PendingAccountReturn[]>([]);
  const [status, setStatus] = useState<TableStatus>('loading');
  const [notice, setNotice] = useState<string | null>(null);
  const [approving, setApproving] = useState<PendingAccountReturn | null>(null);
  const [rejecting, setRejecting] = useState<PendingAccountReturn | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      setRows(await listPendingAccountReturns(accessToken));
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const nameOf = (row: PendingAccountReturn): string =>
    `${row.first_name_arabic} ${row.last_name_arabic}`;

  const columns: Column<PendingAccountReturn>[] = [
    {
      key: 'name',
      header: t('admin.accountReturns.name'),
      cell: (row) => nameOf(row),
    },
    {
      key: 'phone',
      header: t('admin.accountReturns.phone'),
      cell: (row) => row.phone ?? '—',
    },
    {
      key: 'requested_at',
      header: t('admin.accountReturns.requestedAt'),
      cell: (row) => row.created_at.slice(0, 10),
      secondary: true,
    },
  ];

  const actions: RowAction<PendingAccountReturn>[] = [
    { label: t('admin.accountReturns.approve'), onSelect: (r) => setApproving(r) },
    {
      label: t('admin.accountReturns.reject'),
      danger: true,
      onSelect: (r) => {
        setReason('');
        setRejecting(r);
      },
    },
  ];

  async function confirmApprove(): Promise<void> {
    if (!approving) return;
    setBusy(true);
    try {
      await approveAccountReturn(approving.id, accessToken);
      setApproving(null);
      await load();
      setNotice(t('admin.accountReturns.approved'));
    } catch {
      // The server is the authority on every conflict — a request decided by a
      // colleague, an account that grew a login, an address taken meanwhile.
      // Reloading is what makes the screen honest again.
      setNotice(t('admin.accountReturns.failed'));
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function confirmReject(): Promise<void> {
    if (!rejecting || !reason.trim()) return;
    setBusy(true);
    try {
      await rejectAccountReturn(rejecting.id, reason.trim(), accessToken);
      setRejecting(null);
      await load();
      setNotice(t('admin.accountReturns.rejected'));
    } catch {
      setNotice(t('admin.accountReturns.failed'));
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminLayout title={t('admin.accountReturns.title')} lede={t('admin.accountReturns.lede')}>
      {notice === null ? null : <Feedback>{notice}</Feedback>}

      <DataTable
        caption={t('admin.accountReturns.title')}
        rows={rows}
        columns={columns}
        actions={actions}
        status={status}
        rowKey={(r) => r.id}
        onRetry={() => void load()}
      />

      {approving === null ? null : (
        <ConfirmDialog
          open
          title={t('admin.accountReturns.approveTitle')}
          body={t('admin.accountReturns.approveBody').replace('{name}', nameOf(approving))}
          confirmLabel={t('admin.accountReturns.approve')}
          busy={busy}
          onConfirm={() => void confirmApprove()}
          onCancel={() => setApproving(null)}
        />
      )}

      {rejecting === null ? null : (
        <FormDialog
          title={t('admin.accountReturns.rejectTitle')}
          open
          submitLabel={t('admin.accountReturns.reject')}
          busy={busy}
          // A refusal carries a reason (TD-9), so the button waits for one.
          disabled={reason.trim().length === 0}
          // UX rule AY — a form holding text does not vanish on a stray click.
          dirty={reason.trim().length > 0}
          onSubmit={() => void confirmReject()}
          onCancel={() => setRejecting(null)}
        >
          <TextArea
            label={t('admin.accountReturns.rejectReason')}
            value={reason}
            onChange={setReason}
            required
          />
        </FormDialog>
      )}
    </AdminLayout>
  );
}
