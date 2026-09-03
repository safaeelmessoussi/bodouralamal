import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { AdminLayout } from '../../components/admin/admin-layout.js';
import { ConfirmDialog } from '../../components/ui/confirm-dialog.js';
import {
  DataTable,
  type Column,
  type RowAction,
  type TableStatus,
} from '../../components/ui/data-table.js';
import { Feedback } from '../../components/ui/feedback.js';
import { FormDialog } from '../../components/ui/form-dialog.js';
import { TextArea } from '../../components/ui/field.js';
import { useSession } from '../../contexts/session.js';
import { t } from '../../i18n/index.js';
import {
  approveSelfManagedClaim,
  listPendingSelfManagedClaims,
  rejectSelfManagedClaim,
  type PendingSelfManagedClaim,
} from '../../adapters/self-managed-claims.js';

/**
 * `/admin/self-managed-claims` — طلبات الحساب المستقل (R132).
 *
 * **The association-side identity match, and nothing else.** Google has already
 * proved that somebody controls the address below; what only a person can
 * decide is whether that somebody is the beneficiary named beside it. So this
 * screen shows exactly the three things that decide it — who is claimed, which
 * record, and which address becomes her login — and the confirmation says in
 * words what approving does, because binding a credential to a person's record
 * is the most takeover-sensitive action the platform offers.
 *
 * **The Google provider subject is deliberately absent**, here and from the
 * contract behind it: it is a credential coordinate, not information a reviewer
 * needs or should be handling. The birth date is absent too — it decided
 * eligibility before the row existed, and re-showing it would put a personal
 * datum on a screen whose decision does not turn on it.
 */
export function SelfManagedClaimsPage(): ReactNode {
  const { accessToken } = useSession();
  const [rows, setRows] = useState<PendingSelfManagedClaim[]>([]);
  const [status, setStatus] = useState<TableStatus>('loading');
  const [notice, setNotice] = useState<string | null>(null);
  const [approving, setApproving] = useState<PendingSelfManagedClaim | null>(null);
  const [rejecting, setRejecting] = useState<PendingSelfManagedClaim | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      setRows(await listPendingSelfManagedClaims(accessToken));
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: Column<PendingSelfManagedClaim>[] = [
    {
      key: 'beneficiary',
      header: t('admin.selfManagedClaims.beneficiary'),
      cell: (row) => row.beneficiary_name,
    },
    {
      key: 'code',
      header: t('admin.selfManagedClaims.code'),
      cell: (row) => row.reference_code ?? '—',
    },
    {
      key: 'email',
      header: t('admin.selfManagedClaims.email'),
      cell: (row) => row.email,
    },
    {
      key: 'requested_at',
      header: t('admin.selfManagedClaims.requestedAt'),
      cell: (row) => row.created_at.slice(0, 10),
      secondary: true,
    },
  ];

  const actions: RowAction<PendingSelfManagedClaim>[] = [
    { label: t('admin.selfManagedClaims.approve'), onSelect: (r) => setApproving(r) },
    {
      label: t('admin.selfManagedClaims.reject'),
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
      await approveSelfManagedClaim(approving.id, accessToken);
      setApproving(null);
      await load();
      setNotice(t('admin.selfManagedClaims.approved'));
    } catch {
      // The server is the authority on every conflict — a claim decided by a
      // colleague, an account that grew a login, an address taken meanwhile.
      // Reloading is what makes the screen honest again.
      setNotice(t('admin.selfManagedClaims.failed'));
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function confirmReject(): Promise<void> {
    if (!rejecting || !reason.trim()) return;
    setBusy(true);
    try {
      await rejectSelfManagedClaim(rejecting.id, reason.trim(), accessToken);
      setRejecting(null);
      await load();
      setNotice(t('admin.selfManagedClaims.rejected'));
    } catch {
      setNotice(t('admin.selfManagedClaims.failed'));
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminLayout
      title={t('admin.selfManagedClaims.title')}
      lede={t('admin.selfManagedClaims.lede')}
    >
      {notice === null ? null : <Feedback>{notice}</Feedback>}

      <DataTable
        caption={t('admin.selfManagedClaims.title')}
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
          title={t('admin.selfManagedClaims.approveTitle')}
          body={t('admin.selfManagedClaims.approveBody').replace(
            '{name}',
            approving.beneficiary_name,
          )}
          confirmLabel={t('admin.selfManagedClaims.approve')}
          busy={busy}
          onConfirm={() => void confirmApprove()}
          onCancel={() => setApproving(null)}
        />
      )}

      {rejecting === null ? null : (
        <FormDialog
          title={t('admin.selfManagedClaims.rejectTitle')}
          open
          submitLabel={t('admin.selfManagedClaims.reject')}
          busy={busy}
          // A refusal carries a reason (TD-9), so the button waits for one.
          disabled={reason.trim().length === 0}
          // UX rule AY — a form holding text does not vanish on a stray click.
          dirty={reason.trim().length > 0}
          onSubmit={() => void confirmReject()}
          onCancel={() => setRejecting(null)}
        >
          <TextArea
            label={t('admin.selfManagedClaims.rejectReason')}
            value={reason}
            onChange={setReason}
            required
          />
        </FormDialog>
      )}
    </AdminLayout>
  );
}
