import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  createBranch,
  deleteBranch,
  listBranches,
  updateBranch,
  type Branch,
  type BranchInput,
} from '../../adapters/branches-admin.js';
import { AdminLayout } from '../../components/admin/admin-layout.js';
import { Button } from '../../components/ui/button.js';
import { ConfirmDialog } from '../../components/ui/confirm-dialog.js';
import { DataTable, type Column, type RowAction, type TableStatus } from '../../components/ui/data-table.js';
import { Dialog } from '../../components/ui/dialog.js';
import {
  DateField,
  NumberField,
  SearchInput,
  TextArea,
  TextField,
} from '../../components/ui/field.js';
import { useSession } from '../../contexts/session.js';
import { t } from '../../i18n/index.js';
import { ApiError } from '../../lib/api.js';

/**
 * `/admin/branches` — Branches (§5.6, §14.2, Revision 26).
 *
 * **The first consumer of the platform's CRUD framework**, and the reason that
 * framework exists: `DataTable`, the field primitives and `ConfirmDialog` were
 * built here as capabilities, not as this page's widgets (constitution §0.1).
 * The next module configures them; it does not copy them.
 *
 * **Writing is Super Admin only** (Revision 26 — reference data). An Admin reads
 * this screen because Group management depends on it. The create/edit/delete
 * controls are therefore hidden for an Admin — and the **server enforces the
 * matrix regardless**, so this is a UX layer, not the boundary.
 *
 * Rooms live behind each branch rather than as a sibling list: a room has no
 * meaning apart from its branch, and §14.1 names the node *"Branches & Rooms"*.
 */
export function BranchesPage(): ReactNode {
  const { me, accessToken } = useSession();
  const canWrite = (me?.roles ?? []).includes('super_admin');

  const [rows, setRows] = useState<Branch[]>([]);
  const [status, setStatus] = useState<TableStatus>('loading');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Branch | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Branch | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const result = await listBranches(accessToken, page);
      setRows(result.data);
      setTotal(result.meta.total);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [accessToken, page]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Local narrowing of the page's own already-fetched rows — legitimate here,
   *  and distinct from filtering reference data a server owns (constitution
   *  §2.x / the calendar's category→level rule). */
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      [row.name, row.address, row.phone, row.email]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(needle)),
    );
  }, [rows, query]);

  const columns: Column<Branch>[] = [
    { key: 'name', header: t('admin.branches.colName'), cell: (r) => r.name },
    {
      key: 'address',
      header: t('admin.branches.colAddress'),
      secondary: true,
      cell: (r) => r.address ?? <span className="muted">{t('common.notSet')}</span>,
    },
    {
      key: 'start',
      header: t('admin.branches.colStart'),
      secondary: true,
      cell: (r) =>
        r.operationalStartDate ? (
          <time dateTime={r.operationalStartDate}>{r.operationalStartDate}</time>
        ) : (
          <span className="muted">{t('common.notSet')}</span>
        ),
    },
    {
      key: 'order',
      header: t('admin.branches.colOrder'),
      numeric: true,
      secondary: true,
      cell: (r) => (r.displayOrder ?? '—') as ReactNode,
    },
  ];

  // Hidden entirely for an Admin, rather than shown disabled: §14.2 gates the
  // action by role, and a permanently dead control teaches nothing.
  const actions: RowAction<Branch>[] = canWrite
    ? [
        { label: t('common.edit'), onSelect: (r) => setEditing(r) },
        { label: t('common.delete'), danger: true, onSelect: (r) => setDeleting(r) },
      ]
    : [];

  async function save(input: BranchInput, existing: Branch | null): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      if (existing) await updateBranch(existing.id, existing.version, input, accessToken);
      else await createBranch(input, accessToken);
      setEditing(null);
      await load();
      setNotice(t(existing ? 'common.saved' : 'common.created'));
    } catch (error) {
      // A stale `version` is the interesting failure (TD-15): someone else
      // edited this row. Reloading is the only correct response — never a
      // silent overwrite.
      const conflict = error instanceof ApiError && error.status === 409;
      setNotice(t(conflict ? 'common.conflict' : 'common.saveFailed'));
      if (conflict) {
        setEditing(null);
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete(): Promise<void> {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteBranch(deleting.id, accessToken);
      setDeleting(null);
      await load();
      setNotice(t('common.deleted'));
    } catch (error) {
      // TD-5: deletion is PROHIBITED while rooms or groups reference the branch.
      // Saying which is more useful than "failed".
      const blocked = error instanceof ApiError && error.status === 409;
      setNotice(t(blocked ? 'admin.branches.deleteBlocked' : 'common.deleteFailed'));
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminLayout
      title={t('admin.nav.branches')}
      lede={t('admin.branches.lede')}
      actions={
        canWrite ? (
          <Button variant="primary" onClick={() => setEditing('new')}>
            {t('admin.branches.create')}
          </Button>
        ) : null
      }
    >
      {notice ? (
        <p className="admin-notice" role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}

      <DataTable
        caption={t('admin.branches.tableCaption')}
        columns={columns}
        rows={visible}
        rowKey={(r) => r.id}
        status={status}
        actions={actions}
        onRetry={() => void load()}
        filtered={query.trim() !== ''}
        onClearFilters={() => setQuery('')}
        toolbar={
          <SearchInput
            value={query}
            onChange={setQuery}
            label={t('common.search')}
            placeholder={t('admin.branches.searchPlaceholder')}
          />
        }
        pagination={{ page, pageSize: 25, total, onPage: setPage }}
      />

      {editing ? (
        <BranchFormDialog
          branch={editing === 'new' ? null : editing}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={(input) => void save(input, editing === 'new' ? null : editing)}
        />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        title={t('admin.branches.deleteTitle')}
        body={t('admin.branches.deleteBody').replace('{name}', deleting?.name ?? '')}
        confirmLabel={t('common.delete')}
        danger
        busy={busy}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleting(null)}
      />
    </AdminLayout>
  );
}

/**
 * The branch form.
 *
 * Assembled entirely from the shared field components — **no hand-rolled
 * `<input>`** (constitution §4.3), so label association, error wiring and
 * required marking come from the primitives rather than from this file
 * remembering them.
 *
 * Validation here **mirrors** TD-9's limits for immediate feedback; the server
 * validates for correctness (§1.1). The two are not redundant: one is courtesy,
 * the other is the rule.
 */
function BranchFormDialog({
  branch,
  busy,
  onSave,
  onCancel,
}: {
  branch: Branch | null;
  busy: boolean;
  onSave: (input: BranchInput) => void;
  onCancel: () => void;
}): ReactNode {
  const [form, setForm] = useState({
    name: branch?.name ?? '',
    address: branch?.address ?? '',
    phone: branch?.phone ?? '',
    email: branch?.email ?? '',
    openingHours: branch?.openingHoursAr ?? '',
    mapsUrl: branch?.googleMapsUrl ?? '',
    start: branch?.operationalStartDate ?? '',
    order: branch?.displayOrder !== null && branch?.displayOrder !== undefined ? String(branch.displayOrder) : '',
  });
  const [touched, setTouched] = useState(false);

  const set = <K extends keyof typeof form>(key: K) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  // TD-9's limits, mirrored. `null` means "no complaint".
  const errors = {
    name: form.name.trim().length === 0 ? t('common.required') : null,
    address:
      form.address.trim().length > 0 && form.address.trim().length < 5
        ? t('admin.branches.addressShort')
        : null,
    mapsUrl:
      form.mapsUrl.trim().length > 0 && !form.mapsUrl.trim().startsWith('https://')
        ? t('admin.branches.urlHttps')
        : null,
  };
  const valid = Object.values(errors).every((e) => e === null);

  function submit(): void {
    setTouched(true);
    if (!valid) return;
    const trimmed = (v: string): string | undefined => (v.trim() === '' ? undefined : v.trim());
    onSave({
      name: form.name.trim(),
      ...(trimmed(form.address) ? { address: trimmed(form.address)! } : {}),
      // An emptied optional field is `null` (clear it); an untouched one is
      // absent (leave it) — the same absent-stays-absent rule the controller
      // applies on the way in.
      phone: trimmed(form.phone) ?? null,
      email: trimmed(form.email) ?? null,
      ...(trimmed(form.openingHours) ? { opening_hours_ar: trimmed(form.openingHours)! } : {}),
      google_maps_url: trimmed(form.mapsUrl) ?? null,
      operational_start_date: trimmed(form.start) ?? null,
      display_order: form.order.trim() === '' ? null : Number(form.order),
    });
  }

  return (
    <Dialog
      open
      onClose={onCancel}
      title={t(branch ? 'admin.branches.editTitle' : 'admin.branches.create')}
      wide
    >
      <div className="form">
        <TextField
          label={t('admin.branches.colName')}
          value={form.name}
          onChange={set('name')}
          required
          error={touched ? errors.name : null}
        />
        <TextField
          label={t('admin.branches.colAddress')}
          value={form.address}
          onChange={set('address')}
          error={touched ? errors.address : null}
          hint={t('admin.branches.addressHint')}
        />
        <div className="form__row">
          <TextField label={t('admin.branches.phone')} type="tel" value={form.phone} onChange={set('phone')} />
          <TextField label={t('admin.branches.email')} type="email" value={form.email} onChange={set('email')} />
        </div>
        <TextArea
          label={t('admin.branches.openingHours')}
          value={form.openingHours}
          onChange={set('openingHours')}
          rows={3}
          // §7: free multiline text, displayed verbatim and NEVER parsed. The
          // hint says so, because the next person to see this field will
          // otherwise wonder why it is not a weekday grid.
          hint={t('admin.branches.openingHoursHint')}
        />
        <TextField
          label={t('admin.branches.mapsUrl')}
          type="url"
          value={form.mapsUrl}
          onChange={set('mapsUrl')}
          error={touched ? errors.mapsUrl : null}
          hint={t('admin.branches.mapsUrlHint')}
        />
        <div className="form__row">
          <DateField
            label={t('admin.branches.colStart')}
            value={form.start}
            onChange={set('start')}
            hint={t('admin.branches.startHint')}
          />
          <NumberField
            label={t('admin.branches.colOrder')}
            value={form.order}
            onChange={set('order')}
            min={0}
            hint={t('admin.branches.orderHint')}
          />
        </div>

        <div className="form__actions">
          <Button variant="secondary" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={busy} onClick={submit}>
            {t('common.save')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
