import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  createBranch,
  createRoom,
  deleteBranch,
  deleteRoom,
  listBranches,
  listRooms,
  reorderBranches,
  updateBranch,
  updateRoom,
  type Branch,
  type BranchInput,
  type Room,
} from '../../adapters/branches-admin.js';
import { AdminLayout } from '../../components/admin/admin-layout.js';
import { Button } from '../../components/ui/button.js';
import { ConfirmDialog } from '../../components/ui/confirm-dialog.js';
import { BlockedNotice } from '../../components/ui/blocked-notice.js';
import { classifyDeletion, deletionNotice } from '../../lib/deletion-outcome.js';
import {
  DataTable,
  type Column,
  type RowAction,
  type SortState,
  type TableStatus,
} from '../../components/ui/data-table.js';
import { Dialog } from '../../components/ui/dialog.js';
import { FormDialog } from '../../components/ui/form-dialog.js';
import { isDirty } from '../../lib/form-dirty.js';
import { useUnsavedGuard } from '../../lib/use-unsaved-guard.js';
import {
  DateField,
  SearchInput,
  TextArea,
  TextField,
} from '../../components/ui/field.js';
import { useSession } from '../../contexts/session.js';
import { useActiveRole } from '../../contexts/active-role.js';
import { t } from '../../i18n/index.js';
import { formatDate } from '../../lib/format-date.js';
import { ApiError } from '../../lib/api.js';
import { Feedback } from '../../components/ui/feedback.js';

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
  const { accessToken } = useSession();
  const { activeRoles } = useActiveRole();
  // R60 — the ACTIVE role. A Super Admin working as مؤطِّرة must not be offered
  // a control the server will refuse: the affordance follows the authority.
  const canWrite = (activeRoles).includes('super_admin');

  const [rows, setRows] = useState<Branch[]>([]);
  const [status, setStatus] = useState<TableStatus>('loading');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Branch | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Branch | null>(null);
  const [rooms, setRooms] = useState<Branch | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** The refusal that turns the confirm into an explanation (TD-5). */
  const [blocked, setBlocked] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  /**
   * `null` is BR-19's own order — and the **canonical** one, which is the only
   * state in which dragging is offered (R76.8): under a column sort the visible
   * sequence is not the business order, so dropping into it would persist a
   * position the reader never intended.
   */
  const [sort, setSort] = useState<SortState | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const result = await listBranches(accessToken, page, sort);
      setRows(result.data);
      setTotal(result.meta.total);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [accessToken, page, sort]);

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
      [row.name, row.address, row.phone, row.phone_secondary, row.email]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(needle)),
    );
  }, [rows, query]);

  const columns: Column<Branch>[] = [
    {
      key: 'name',
      header: t('admin.branches.colName'),
      // R76.1 — the ENDPOINT's field name. The server refuses anything outside
      // its own allow-list, so a wrong value here fails loudly at the API rather
      // than sorting by something unintended.
      sortKey: 'name',
      cell: (r) => r.name,
    },
    {
      key: 'address',
      header: t('admin.branches.colAddress'),
      secondary: true,
      cell: (r) => r.address ?? <span className="muted">{t('common.notSet')}</span>,
    },
    {
      key: 'start',
      header: t('admin.branches.colStart'),
      // The other thing an administrator scans a branch list for.
      sortKey: 'operational_start_date',
      secondary: true,
      cell: (r) =>
        r.operational_start_date ? (
          <time dateTime={r.operational_start_date}>{formatDate(r.operational_start_date)}</time>
        ) : (
          <span className="muted">{t('common.notSet')}</span>
        ),
    },
    /**
     * **The four fields `BranchInput` collects and this table used not to show.**
     *
     * §14.2 calls its column list *"the minimum set"*, which is a floor and was
     * read as a ceiling: an administrator who entered a phone number, an email,
     * opening hours and a map link could not see any of them again without
     * opening the editor, so the screen could not answer *is this branch's
     * contact information complete* — the question a public directory makes
     * worth asking (Revision 35 publishes exactly these to anonymous visitors).
     *
     * The rule now applied to every management table: **a table shows every
     * field its own form collects**, minus operational metadata (`version`,
     * timestamps, `deleted_*`) which belongs to the mechanism rather than the
     * entity. See `docs/architecture/frontend.md`.
     */
    {
      key: 'phone',
      header: t('admin.branches.phone'),
      secondary: true,
      cell: (r) => r.phone ?? <span className="muted">{t('common.notSet')}</span>,
    },
    {
      /**
       * **NEW I — its own column, not appended to the first.**
       *
       * Packing both numbers into one cell would make the value unreadable as a
       * phone number and unusable as a link, which is the same reason the
       * database gives it its own column rather than overloading `phone`.
       */
      key: 'phone_secondary',
      header: t('admin.branches.phoneSecondary'),
      cell: (r) =>
        r.phone_secondary ?? <span className="muted">{t('common.notSet')}</span>,
    },
    {
      key: 'email',
      header: t('admin.branches.email'),
      secondary: true,
      cell: (r) => r.email ?? <span className="muted">{t('common.notSet')}</span>,
    },
    {
      key: 'hours',
      header: t('admin.branches.openingHours'),
      secondary: true,
      cell: (r) => r.opening_hours_ar ?? <span className="muted">{t('common.notSet')}</span>,
    },
    {
      // A URL is unreadable as text and useful as a link, so the cell renders
      // the affordance rather than 90 characters of query string.
      key: 'map',
      header: t('admin.branches.mapsUrl'),
      secondary: true,
      cell: (r) =>
        r.google_maps_url ? (
          <a href={r.google_maps_url} target="_blank" rel="noreferrer noopener">
            {t('admin.branches.mapOpen')}
          </a>
        ) : (
          <span className="muted">{t('common.notSet')}</span>
        ),
    },
    /* **No «الترتيب» column** (R76.8). A persisted order is expressed by
       DRAGGING a row, not by reading a number out of a cell and typing it into a
       form — and the number was never meaningful to a reader anyway. The
       `display_order` field itself is untouched: it is what the drag writes. */
  ];

  // Hidden entirely for an Admin, rather than shown disabled: §14.2 gates the
  // action by role, and a permanently dead control teaches nothing.
  //
  // **Rooms is the exception and is offered to an Admin too**, because an Admin
  // reads this screen precisely because scheduling depends on knowing which
  // rooms exist. The dialog gates its own write controls, and the server
  // enforces the matrix regardless.
  const actions: RowAction<Branch>[] = [
    { label: t('admin.branches.rooms'), onSelect: (r) => setRooms(r) },
    ...(canWrite
      ? [
          { label: t('common.edit'), onSelect: (r: Branch) => setEditing(r) },
          { label: t('common.delete'), danger: true, onSelect: (r: Branch) => setDeleting(r) },
        ]
      : []),
  ];

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
      /**
       * TD-5: deletion is PROHIBITED while anything still references the
       * branch — and the dialog **stays open to say so**.
       *
       * It used to close and drop a one-line notice at the top of the page,
       * guessing «قاعات أو حلقات» while the actual blockers were a group and a
       * schedule. From the reader's seat the confirm simply vanished, which is
       * why this was reported as *«deleting does nothing»*.
       */
      const outcome = classifyDeletion(error);
      if (outcome.kind === 'blocked') {
        setBlocked(error);
      } else {
        // `already-gone` reloads and says so: the row is gone, which is what
        // was asked for, and reporting a failure for it is what made Delete
        // read as unreliable on a page left open.
        if (outcome.kind === 'already-gone') await load();
        setNotice(deletionNotice(outcome));
        setDeleting(null);
      }
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
          <Button variant="add" onClick={() => setEditing('new')}>
            {t('admin.branches.create')}
          </Button>
        ) : null
      }
    >
      {notice ? (
        <Feedback>
          {notice}
        </Feedback>
      ) : null}

      <DataTable
        caption={t('admin.branches.tableCaption')}
        columns={columns}
        rows={visible}
        rowKey={(r) => r.id}
        status={status}
        actions={actions}
        onRetry={() => void load()}
        sort={sort}
        onSort={(next) => {
          setSort(next);
          // Back to page 1: row 26 of the old order is not row 26 of the new one,
          // and leaving the reader on a page that no longer means anything is
          // worse than moving them.
          setPage(1);
        }}
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
        {...(canWrite
          ? {
              /* The search box filters CLIENT-side, so `visible` can be a
                 subset of the live set the reorder contract requires. Nothing
                 here has to say so: the table compares what it is showing
                 against `total` and blocks the gesture itself — which is the
                 whole reason that rule lives there and not in each page. */
              onReorder: async (ids: string[]) => reorderBranches(ids, accessToken).then(load),
            }
          : {})}
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

      {rooms ? (
        <RoomsDialog branch={rooms} canWrite={canWrite} onClose={() => setRooms(null)} />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        title={t('admin.branches.deleteTitle')}
        body={t('admin.branches.deleteBody').replace('{name}', deleting?.name ?? '')}
        {...(blocked
          ? { blocked: <BlockedNotice error={blocked} item={t('admin.branches.thisBranch')} /> }
          : {})}
        confirmLabel={t('common.delete')}
        danger
        busy={busy}
        onConfirm={() => void confirmDelete()}
        onCancel={() => {
          setDeleting(null);
          setBlocked(null);
        }}
      />
    </AdminLayout>
  );
}

/**
 * The rooms of one branch (§5.6 *"Branches & Rooms"*, §14.1).
 *
 * **A dialog behind the branch row rather than a sibling screen**, because a
 * room has no meaning apart from its branch — §14.1 names one node, not two, and
 * a `/admin/rooms` list would have to repeat the branch on every line to be
 * readable at all.
 *
 * **Reads for an Admin, writes for a Super Admin** (TD-2 R26). An Admin opens
 * this because scheduling depends on knowing which rooms exist; the server
 * enforces the write rule regardless, so the hidden controls are UX rather than
 * the boundary.
 *
 * **Deletion is refused while a schedule or a session books the room** (TD-5).
 * That is reported as its own reason: the remedy — move or delete the bookings —
 * is nothing like the remedy for a failed request.
 */
function RoomsDialog({
  branch,
  canWrite,
  onClose,
}: {
  branch: Branch;
  canWrite: boolean;
  onClose: () => void;
}): ReactNode {
  const { accessToken } = useSession();
  const [rows, setRows] = useState<Room[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<Room | null>(null);
  /** Deleting a room is destructive and confirms, like **every** other
   *  destructive action in the back office (§14.2). It did not, which was an
   *  inconsistency rather than a decision: a stray click removed a room with no
   *  way back short of the Trash runbook. A native `<dialog>` stacks in the top
   *  layer, so this confirms above the rooms dialog rather than replacing it. */
  const [confirming, setConfirming] = useState<Room | null>(null);

  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * **The room name being typed is unsaved work too.**
   *
   * This dialog is a list with an inline add/rename field rather than a single
   * submit, so it cannot become a `FormDialog` — but the rule is about typing,
   * not about which component renders it. `useUnsavedGuard` is exactly why the
   * behaviour was extracted: a dialog of a different shape adopts the same rule
   * instead of cloning an approximation of it.
   *
   * A draft that is only whitespace is not a change worth protecting.
   */
  const guard = useUnsavedGuard({
    open: true,
    dirty: draft.trim() !== '',
    busy,
    onCancel: onClose,
  });

  const load = useCallback(async () => {
    try {
      setRows((await listRooms(branch.id, accessToken)).data);
      setState('ready');
    } catch {
      setState('error');
    }
  }, [branch.id, accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(): Promise<void> {
    const name = draft.trim();
    if (name === '') return;
    setBusy(true);
    setNotice(null);
    try {
      if (editing) await updateRoom(editing.id, editing.version, name, accessToken);
      else await createRoom(branch.id, name, accessToken);
      setDraft('');
      setEditing(null);
      await load();
    } catch (error) {
      // A stale version is someone else's edit; reloading is the only correct
      // response, never a silent overwrite (TD-15).
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

  async function remove(): Promise<void> {
    if (!confirming) return;
    setBusy(true);
    setNotice(null);
    try {
      await deleteRoom(confirming.id, accessToken);
      await load();
      setNotice(t('common.deleted'));
    } catch (error) {
      // TD-5: refused while a schedule or a session books the room. Saying which
      // is more useful than "failed" — the remedy is entirely different.
      const blocked = error instanceof ApiError && error.status === 409;
      setNotice(t(blocked ? 'admin.branches.roomBlocked' : 'common.deleteFailed'));
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  }

  return (
    <Dialog
      open
      onClose={guard.requestClose}
      dismissible={guard.dismissible}
      title={t('admin.branches.roomsTitle').replace('{branch}', branch.name)}
    >
      {notice ? (
        <Feedback>
          {notice}
        </Feedback>
      ) : null}

      {state === 'loading' ? <p className="state">{t('common.loading')}</p> : null}
      {state === 'error' ? (
        <p className="state" role="alert">
          {t('common.loadFailed')}
        </p>
      ) : null}

      {state === 'ready' ? (
        <>
          {rows.length === 0 ? (
            // A named state, not an empty box: a branch with no rooms cannot
            // host a schedule that names one, and saying so here is cheaper
            // than discovering it as a refusal on the schedules screen.
            <p className="state" role="status">
              {t('admin.branches.roomsEmpty')}
            </p>
          ) : (
            <ul className="admin-list">
              {rows.map((room) => (
                <li key={room.id}>
                  <span>{room.name}</span>
                  {canWrite ? (
                    <>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setEditing(room);
                          setDraft(room.name);
                        }}
                      >
                        {t('common.edit')}
                      </Button>
                      <Button variant="secondary" disabled={busy} onClick={() => setConfirming(room)}>
                        {t('common.delete')}
                      </Button>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {canWrite ? (
            <div className="form">
              <TextField
                label={t(editing ? 'admin.branches.roomRename' : 'admin.branches.roomAdd')}
                value={draft}
                onChange={setDraft}
              />
              <div className="form__actions">
                {editing ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setEditing(null);
                      setDraft('');
                    }}
                  >
                    {t('common.cancel')}
                  </Button>
                ) : null}
                <Button variant="primary" disabled={busy || draft.trim() === ''} onClick={() => void submit()}>
                  {t(editing ? 'common.save' : 'admin.branches.roomAdd')}
                </Button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {guard.confirmation}

      <ConfirmDialog
        open={confirming !== null}
        title={t('admin.branches.roomDeleteTitle')}
        body={t('admin.branches.roomDeleteBody').replace('{name}', confirming?.name ?? '')}
        confirmLabel={t('common.delete')}
        danger
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setConfirming(null)}
      />
    </Dialog>
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
  /**
   * **The values this form opened with**, as their own expression so `isDirty`
   * compares against the record rather than a captured moment. That is what
   * makes *typed a change and undid it* correctly pristine again, and what
   * stops an edit dialog reporting itself dirty the instant it hydrates.
   */
  const pristine = {
    name: branch?.name ?? '',
    address: branch?.address ?? '',
    phone: branch?.phone ?? '',
    phoneSecondary: branch?.phone_secondary ?? '',
    email: branch?.email ?? '',
    openingHours: branch?.opening_hours_ar ?? '',
    mapsUrl: branch?.google_maps_url ?? '',
    start: branch?.operational_start_date ?? '',
  };
  const [form, setForm] = useState(pristine);
  const [touched, setTouched] = useState(false);
  // A validation error is not a change; only user-modified data is.
  const dirty = isDirty(form, pristine);

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
      phone_secondary: trimmed(form.phoneSecondary) ?? null,
      email: trimmed(form.email) ?? null,
      ...(trimmed(form.openingHours) ? { opening_hours_ar: trimmed(form.openingHours)! } : {}),
      google_maps_url: trimmed(form.mapsUrl) ?? null,
      operational_start_date: trimmed(form.start) ?? null,
    });
  }

  return (
    <FormDialog
      open
      onCancel={onCancel}
      onSubmit={submit}
      title={t(branch ? 'admin.branches.editTitle' : 'admin.branches.create')}
      wide
      busy={busy}
      // NOT `disabled={!valid}`: `submit` marks the form touched and surfaces
      // which field is wrong. A disabled button would hide the reason.
      dirty={dirty}
    >
      <>
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
          <TextField
            label={t('admin.branches.phoneSecondary')}
            type="tel"
            value={form.phoneSecondary}
            onChange={set('phoneSecondary')}
            hint={t('admin.branches.phoneSecondaryHint')}
          />
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
        {/* **No «الترتيب» field** (R76.8). The column left the table in the
            previous slice and the field follows it here: the two together were
            a number *and* a sequence claiming to state the same fact, and the
            drag is the one a reader can act on. Omitting it on save preserves
            the stored position; a new branch arrives with NULL, which sorts
            last, and is dragged from the end. */}
        <DateField
          label={t('admin.branches.colStart')}
          value={form.start}
          onChange={set('start')}
          hint={t('admin.branches.startHint')}
        />
      </>
    </FormDialog>
  );
}
