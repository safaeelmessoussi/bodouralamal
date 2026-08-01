import { useCallback, useEffect, useState, type ReactNode } from 'react';

import {
  approveApproval,
  listApprovals,
  rejectApproval,
  type Approval,
  type ApprovalType,
  DECISION_REASON_MAX,
} from '../../adapters/approvals.js';
import { fetchBranches, type PublicBranch } from '../../adapters/branches.js';
import { AdminLayout } from '../../components/admin/admin-layout.js';
import { BranchSelector } from '../../components/ui/branch-selector.js';
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
 * **Both §14.2 filters are here (Revision 39).** `Type` and `Branch`. The
 * Branch filter became implementable when registration started capturing the
 * applicant's chosen branch — before R39 it had no data behind it at all, which
 * an end-to-end trace established and the Document Owner resolved by correcting
 * the workflow rather than the screen.
 *
 * **Branch FILTERS; it does not scope.** Visibility stays deliberately unscoped
 * (Revisions 25, 29, both retained), because a branch Admin must still be able
 * to see an applicant whose chosen branch is *wrong* — or absent — in order to
 * correct it. A family-link item carries no branch, so choosing one excludes
 * that type wholesale rather than matching none of it.
 */
export function ApprovalsPage(): ReactNode {
  const { accessToken } = useSession();

  const [rows, setRows] = useState<Approval[]>([]);
  const [status, setStatus] = useState<TableStatus>('loading');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [typeFilter, setTypeFilter] = useState<'' | ApprovalType>('');
  const [branchFilter, setBranchFilter] = useState<string | null>(null);
  const [branches, setBranches] = useState<PublicBranch[]>([]);
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
        ...(branchFilter ? { branchId: branchFilter } : {}),
      });
      setRows(result.data);
      setTotal(result.meta.total);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [accessToken, page, typeFilter, branchFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  // The same public endpoint the registration form and the landing page use —
  // one source for the branch list, so a new branch appears everywhere at once.
  useEffect(() => {
    void (async () => {
      try {
        setBranches(await fetchBranches());
      } catch {
        // A filter that cannot load is not worth failing the page over: the
        // queue itself is the point, and it renders unfiltered.
        setBranches([]);
      }
    })();
  }, []);

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
      key: 'branch',
      header: t('admin.approvals.colBranch'),
      secondary: true,
      // `null` is not "no branch" — it is *not stated*: a family-link item never
      // had one, and an account registered before R39 was never asked.
      cell: (r) =>
        r.branch ? r.branch.name : <span className="muted">{t('admin.approvals.branchNone')}</span>,
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
        filtered={typeFilter !== '' || branchFilter !== null}
        onClearFilters={() => {
          setTypeFilter('');
          setBranchFilter(null);
          setPage(1);
        }}
        toolbar={
          <>
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
            <BranchSelector
              branches={branches}
              value={branchFilter}
              label={t('admin.approvals.filterBranch')}
              emptyLabel={t('admin.approvals.filterAllBranches')}
              onChange={(value) => {
                setBranchFilter(value);
                setPage(1);
              }}
            />
          </>
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
