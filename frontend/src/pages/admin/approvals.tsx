import { useCallback, useEffect, useState, type ReactNode } from 'react';

import {
  approveApproval,
  listApprovals,
  rejectApproval,
  type Approval,
  type ApprovalType,
  DECISION_REASON_MAX,
} from '../../adapters/approvals.js';
import { AdminLayout } from '../../components/admin/admin-layout.js';
import {
  ApplicantList,
  ApprovalTypeBadge,
  BundleSummary,
} from '../../components/ui/approval-card.js';
import { ConfirmDialog } from '../../components/ui/confirm-dialog.js';
import {
  DataTable,
  type Column,
  type RowAction,
  type TableStatus,
} from '../../components/ui/data-table.js';
import { SelectField } from '../../components/ui/field.js';
import { useSession } from '../../contexts/session.js';
import { t } from '../../i18n/index.js';
import { ApiError } from '../../lib/api.js';

/**
 * `/admin/approvals` — طلبات الانضمام, the approval queue (§5.6, §14.2).
 *
 * **Configuration of the CRUD framework, not a new one.** `DataTable`, the
 * field primitives and `ConfirmDialog` came from Branches; this screen passes
 * different columns and different actions. Two things were *improved* rather
 * than forked to make it fit (constitution §2.5): `ConfirmDialog` gained
 * configurable reason bounds, because TD-9 uses 10–1000 for a consent override
 * and 1–500 for a rejection, and `Badge` was extracted from the inline markup
 * the Hijri screen had been carrying.
 *
 * **Approve and reject are not symmetric, and the screen says so.** Approval is
 * atomic across the whole bundle (TD-4.2) and needs no justification; rejection
 * **requires a reason**, which the server enforces and TD-8 writes to the audit
 * log. Both are destructive of an expectation, so both confirm — but only one
 * asks you to explain yourself.
 *
 * ── ONE §14.2 FILTER IS NOT BUILT, DELIBERATELY ──────────────────────────────
 * §14.2's Approvals row lists filters **"Type, Branch"**. The Type filter is
 * here. **Branch is not, because an approval item has no branch to filter by:**
 * Revision 29 decided that "registration creates a pending applicant only" and
 * records no branch, and Revision 25 states the queue "is a separate surface and
 * is **not** scoped by this rule". A branch filter would therefore need a value
 * that does not exist — inventing one is exactly what §20 rule 20 forbids.
 * Reported to the Document Owner rather than resolved here.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function ApprovalsPage(): ReactNode {
  const { accessToken } = useSession();

  const [rows, setRows] = useState<Approval[]>([]);
  const [status, setStatus] = useState<TableStatus>('loading');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [typeFilter, setTypeFilter] = useState<'' | ApprovalType>('');
  const [deciding, setDeciding] = useState<{ row: Approval; approve: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      // The filter goes to the SERVER, unlike the Branches search which narrows
      // rows already fetched. A queue is paginated over the full set, so
      // filtering client-side would hide matches on later pages.
      const result = await listApprovals(accessToken, {
        page,
        ...(typeFilter ? { type: typeFilter } : {}),
      });
      setRows(result.data);
      setTotal(result.meta.total);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [accessToken, page, typeFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: Column<Approval>[] = [
    {
      key: 'applicants',
      header: t('admin.approvals.colApplicants'),
      cell: (r) => <ApplicantList applicants={r.applicants} />,
    },
    {
      key: 'type',
      header: t('admin.approvals.colType'),
      cell: (r) => <ApprovalTypeBadge type={r.type} />,
    },
    {
      key: 'bundle',
      header: t('admin.approvals.colBundle'),
      secondary: true,
      cell: (r) => <BundleSummary bundle={r.bundle} />,
    },
    {
      key: 'submitted',
      header: t('admin.approvals.colSubmitted'),
      secondary: true,
      // The instant is rendered as a date for reading, with the full value in
      // `dateTime` for machines. Formatting an already-fetched value is
      // presentation, which a client may do (§1.1).
      cell: (r) => <time dateTime={r.submitted_at}>{r.submitted_at.slice(0, 10)}</time>,
    },
  ];

  const actions: RowAction<Approval>[] = [
    { label: t('admin.approvals.approve'), onSelect: (row) => setDeciding({ row, approve: true }) },
    {
      label: t('admin.approvals.reject'),
      danger: true,
      onSelect: (row) => setDeciding({ row, approve: false }),
    },
  ];

  async function confirmDecision(reason?: string): Promise<void> {
    if (!deciding) return;
    const { row, approve } = deciding;
    setBusy(true);
    try {
      const result = approve
        ? await approveApproval(row.id, accessToken, reason)
        : await rejectApproval(row.id, reason ?? '', accessToken);
      setDeciding(null);
      await load();
      // What actually changed, not what was requested — `records_updated` is
      // why this can be a statement rather than an assumption (TD-4.2).
      setNotice(
        t(approve ? 'admin.approvals.approved' : 'admin.approvals.rejected').replace(
          '{n}',
          String(result.records_updated),
        ),
      );
    } catch (error) {
      // Someone else decided it first: the item is gone from the queue, so
      // reloading is the honest response — the administrator needs to see that
      // it is no longer theirs to decide.
      const gone = error instanceof ApiError && (error.status === 404 || error.status === 409);
      setNotice(t(gone ? 'admin.approvals.alreadyDecided' : 'admin.approvals.decisionFailed'));
      setDeciding(null);
      if (gone) await load();
    } finally {
      setBusy(false);
    }
  }

  const applicantNames = deciding?.row.applicants.map((a) => a.name).join('، ') ?? '';

  return (
    <AdminLayout title={t('admin.nav.approvals')} lede={t('admin.approvals.lede')}>
      {notice ? (
        <p className="admin-notice" role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}

      <DataTable
        caption={t('admin.approvals.tableCaption')}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        status={status}
        actions={actions}
        onRetry={() => void load()}
        filtered={typeFilter !== ''}
        onClearFilters={() => {
          setTypeFilter('');
          setPage(1);
        }}
        toolbar={
          <SelectField
            label={t('admin.approvals.filterType')}
            value={typeFilter}
            placeholder={t('admin.approvals.filterAll')}
            options={[
              { value: 'registration', label: t('admin.approvals.typeRegistration') },
              { value: 'family-link', label: t('admin.approvals.typeLink') },
            ]}
            onChange={(value) => {
              setTypeFilter(value as '' | ApprovalType);
              // A filter change with the page left at 3 shows an empty table on
              // a queue that has matches.
              setPage(1);
            }}
          />
        }
        pagination={{ page, pageSize: 25, total, onPage: setPage }}
      />

      <ConfirmDialog
        open={deciding !== null}
        title={t(
          deciding?.approve ? 'admin.approvals.approveTitle' : 'admin.approvals.rejectTitle',
        )}
        body={t(
          deciding?.approve ? 'admin.approvals.approveBody' : 'admin.approvals.rejectBody',
        ).replace('{names}', applicantNames)}
        confirmLabel={t(deciding?.approve ? 'admin.approvals.approve' : 'admin.approvals.reject')}
        danger={deciding?.approve === false}
        // §5.6: only rejection carries a reason. Passing no label is what makes
        // approval a plain confirmation rather than a form.
        {...(deciding?.approve === false
          ? {
              reasonLabel: t('admin.approvals.reasonLabel'),
              reasonHint: t('admin.approvals.reasonHint'),
              reasonMin: 1,
              reasonMax: DECISION_REASON_MAX,
            }
          : {})}
        busy={busy}
        onConfirm={(reason) => void confirmDecision(reason)}
        onCancel={() => setDeciding(null)}
      />
    </AdminLayout>
  );
}
