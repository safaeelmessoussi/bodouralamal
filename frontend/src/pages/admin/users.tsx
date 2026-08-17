import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { listBranches, type Branch } from '../../adapters/branches-admin.js';
import {
  ACCOUNT_STATUSES,
  ROLES,
  reactivateUser,
  searchUsers,
  setUserRoles,
  suspendUser,
  updateUser,
  type RoleAssignment,
  type UserSummary,
} from '../../adapters/users.js';
import { AdminLayout } from '../../components/admin/admin-layout.js';
import { Button } from '../../components/ui/button.js';
import { ConfirmDialog } from '../../components/ui/confirm-dialog.js';
import { DataTable, type Column, type RowAction, type TableStatus } from '../../components/ui/data-table.js';
import { Dialog } from '../../components/ui/dialog.js';
import { SearchInput, SelectField, TextField } from '../../components/ui/field.js';
import { useSession } from '../../contexts/session.js';
import { useActiveRole } from '../../contexts/active-role.js';
import { t } from '../../i18n/index.js';
import { ApiError } from '../../lib/api.js';

/**
 * `/admin/users` — User Management (§5.6, §14.2, TD-2, TD-12).
 *
 * **Every capability §5.6 lists, and no more:** search, filter, list, create by
 * pre-provisioning against a Google address, edit, deactivate, and
 * role/branch-scope assignment. Approve and reject live on the §5.6 approval
 * queue, which is a separate surface with a separate scoping rule; consent
 * records live behind the student's own screens (§4.1a).
 *
 * **Suspension is a separate control from edit**, mirroring the API exactly: the
 * transition revokes every live session in the same transaction (TD-4.15), so it
 * asks for a reason and confirms, while the edit form quietly saves fields. A
 * form offering `account_status` as a dropdown would teach the wrong model of
 * what suspension *is*.
 *
 * **Roles are edited as a set, not one at a time**, because the endpoint
 * replaces the set — one decision, one audit row, and no window in which a
 * person holds half of an intended change.
 *
 * **Search is server-side** (TD-10, minimum two characters), never a filter over
 * a fetched page: the list is paginated, and narrowing what has already arrived
 * would silently search one page of a larger set.
 *
 * **The published display identity is never rendered here.** §20 rule 21
 * resolves it server-side through one function, and this screen shows the
 * staff-facing legal name; the adapter therefore does not carry the raw value at
 * all, which `check-display-identity.sh` enforces across the frontend.
 */
export function UsersPage(): ReactNode {
  const { accessToken } = useSession();
  const { me } = useSession();
  const { activeRoles } = useActiveRole();
  // R60 — the ACTIVE role. A Super Admin working as مؤطِّرة must not be offered
  // a control the server will refuse: the affordance follows the authority.
  const roles = activeRoles;
  const isSuperAdmin = roles.includes('super_admin');

  const [rows, setRows] = useState<UserSummary[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [status, setStatus] = useState<TableStatus>('loading');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [editing, setEditing] = useState<UserSummary | null>(null);
  const [assigning, setAssigning] = useState<UserSummary | null>(null);
  const [suspending, setSuspending] = useState<UserSummary | null>(null);
  const [reactivating, setReactivating] = useState<UserSummary | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      // TD-10 sets a two-character floor; a shorter query is a scan, not a
      // search, and the server refuses it. Sending it would turn a deliberate
      // limit into an error message mid-typing.
      const trimmed = query.trim();
      const result = await searchUsers(
        accessToken,
        {
          ...(trimmed.length >= 2 ? { q: trimmed } : {}),
          ...(roleFilter ? { role: roleFilter } : {}),
          ...(statusFilter ? { status: statusFilter } : {}),
        },
        page,
      );
      setRows(result.data);
      setTotal(result.meta.total);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [accessToken, query, roleFilter, statusFilter, page]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    // Needed to name a branch scope. A failure leaves the list working and only
    // the scope picker empty — a reference list must not take a screen down.
    void listBranches(accessToken, 1)
      .then((p) => setBranches(p.data))
      .catch(() => setBranches([]));
  }, [accessToken]);

  /** Any filter change re-queries from the first page: staying on page 4 of a
   *  narrower result set shows an empty table that looks like "no users". */
  function refilter(apply: () => void): void {
    apply();
    setPage(1);
  }

  const columns: Column<UserSummary>[] = [
    { key: 'name', header: t('admin.users.colName'), cell: (r) => r.name_arabic },
    {
      key: 'email',
      header: t('admin.users.colEmail'),
      // The identifier an administrator actually recognises a person by, and
      // the one they are given when somebody reports a problem. Absent for a
      // minor student, who has no account of their own (§4.3) — rendered as a
      // stated absence rather than a blank cell.
      cell: (r) => r.email ?? <span className="muted">{t('admin.users.noEmail')}</span>,
    },
    {
      key: 'nickname',
      header: t('admin.users.colNickname'),
      secondary: true,
      cell: (r) => r.nickname ?? <span className="muted">{t('common.notSet')}</span>,
    },
    {
      key: 'roles',
      header: t('admin.users.colRoles'),
      cell: (r) =>
        r.roles.length === 0 ? (
          // Load-bearing rather than cosmetic: an approved account with no role
          // can sign in and reach nothing, and this list is where that is
          // visible before the person reports it.
          <span className="muted">{t('admin.users.noRoles')}</span>
        ) : (
          r.roles.map((a) => roleLabel(a)).join('، ')
        ),
    },
    {
      key: 'branches',
      header: t('admin.users.colBranches'),
      // **§14.2 lists Branch scope as a column of this table and it was
      // missing.** The data was already on every row — each assignment carries
      // its branch — so the screen was hiding the answer to *where does this
      // person work*, which is the question a scoped Admin opens the list with.
      cell: (r) => {
        if (r.roles.length === 0) return <span className="muted">{t('common.notSet')}</span>;
        // `branch_id: null` is **all branches for that assignment** (§7, R24),
        // never *no branch* — collapsing the two is how an unscoped Super Admin
        // reads as having no access at all.
        const names = [
          ...new Set(r.roles.map((a) => a.branch_name ?? t('admin.users.allBranches'))),
        ];
        return names.join('، ');
      },
    },
    {
      key: 'status',
      header: t('admin.users.colStatus'),
      // Announced as a word, never as colour alone (§14.4).
      cell: (r) => t(`admin.users.status.${r.account_status}`),
    },
    {
      key: 'phone',
      header: t('admin.users.colPhone'),
      secondary: true,
      cell: (r) => r.phone ?? <span className="muted">{t('common.notSet')}</span>,
    },
  ];

  const actions: RowAction<UserSummary>[] = [
    { label: t('common.edit'), onSelect: (r) => setEditing(r) },
    { label: t('admin.users.assignRoles'), onSelect: (r) => setAssigning(r) },
    // Offered only where TD-1 allows the transition, rather than shown and
    // refused: a control that exists only to fail teaches nothing (§14.2).
    {
      label: t('admin.users.suspend'),
      danger: true,
      onSelect: (r) => setSuspending(r),
      available: (r) => r.account_status === 'active' && r.id !== me?.id,
    },
    {
      label: t('admin.users.reactivate'),
      onSelect: (r) => setReactivating(r),
      available: (r) => r.account_status === 'suspended',
    },
  ];

  /** One place where every write reports its outcome, so a `409` never reads as
   *  a generic failure — the remedies differ completely. */
  async function run(action: () => Promise<unknown>, okKey: string): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      setEditing(null);
      setAssigning(null);
      setSuspending(null);
      setReactivating(null);
      await load();
      setNotice(t(okKey));
    } catch (error) {
      setNotice(t(messageFor(error)));
      if (error instanceof ApiError && error.status === 409) {
        // Someone else changed this row, or the state moved on. Reloading is the
        // only correct response — never a retry with a stale version.
        setEditing(null);
        setAssigning(null);
        setSuspending(null);
        setReactivating(null);
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminLayout
      title={t('admin.nav.users')}
      lede={t('admin.users.lede')}
      /**
       * **No create button, by the Document Owner's decision (2026-08-17).**
       *
       * An account comes into existence through §4.1's registration and its
       * approval — the applicant states who they are, consent is captured
       * against the text version in force at submission (§4.1a, R62.3), and an
       * administrator decides. A staff-composed account skips all of that, and
       * two ways of creating an account is how the two field sets diverge, which
       * is the exact failure R64 was written to repair on the child path.
       *
       * **`POST /admin/users` and `createUser` are deliberately UNTOUCHED.**
       * They serve pre-provisioning (§4.1b step 4b — a staff account that binds
       * its Google identity on first login) and are covered by their own tests.
       * Removing a capability because its button was removed would be removing a
       * rule nobody decided to change; this removes an entry point.
       *
       * **And no alternative account-creation UI is added anywhere else.** That
       * would be this same button under another name.
       */
      actions={null}
    >
      {notice ? (
        <p className="admin-notice" role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}

      <DataTable
        caption={t('admin.users.caption')}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        status={status}
        actions={actions}
        onRetry={() => void load()}
        filtered={query.trim() !== '' || roleFilter !== '' || statusFilter !== ''}
        onClearFilters={() =>
          refilter(() => {
            setQuery('');
            setRoleFilter('');
            setStatusFilter('');
          })
        }
        toolbar={
          <>
            <SearchInput
              value={query}
              onChange={(v) => refilter(() => setQuery(v))}
              label={t('common.search')}
              placeholder={t('admin.users.searchPlaceholder')}
              hint={t('admin.users.searchHint')}
            />
            <SelectField
              label={t('admin.users.colRoles')}
              value={roleFilter}
              onChange={(v) => refilter(() => setRoleFilter(v))}
              options={[
                { value: '', label: t('admin.users.allRoles') },
                ...ROLES.map((r) => ({ value: r, label: t(`admin.users.role.${r}`) })),
              ]}
            />
            <SelectField
              label={t('admin.users.colStatus')}
              value={statusFilter}
              onChange={(v) => refilter(() => setStatusFilter(v))}
              options={[
                { value: '', label: t('admin.users.allStatuses') },
                ...ACCOUNT_STATUSES.map((s) => ({
                  value: s,
                  label: t(`admin.users.status.${s}`),
                })),
              ]}
            />
          </>
        }
        pagination={{ page, pageSize: 25, total, onPage: setPage }}
      />

      {editing ? (
        <ProfileDialog
          user={editing}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={(input) =>
            void run(() => updateUser(editing.id, editing.version, input, accessToken), 'common.saved')
          }
        />
      ) : null}

      {assigning ? (
        <RolesDialog
          user={assigning}
          branches={branches}
          canGrantAdmin={isSuperAdmin}
          busy={busy}
          onCancel={() => setAssigning(null)}
          onSave={(assignments) =>
            void run(() => setUserRoles(assigning.id, assignments, accessToken), 'admin.users.rolesSaved')
          }
        />
      ) : null}

      {suspending ? (
        <SuspendDialog
          user={suspending}
          busy={busy}
          onCancel={() => setSuspending(null)}
          onConfirm={(reason) =>
            void run(
              () => suspendUser(suspending.id, suspending.version, reason, accessToken),
              'admin.users.suspended',
            )
          }
        />
      ) : null}

      <ConfirmDialog
        open={reactivating !== null}
        title={t('admin.users.reactivateTitle')}
        body={t('admin.users.reactivateBody').replace('{name}', reactivating?.name_arabic ?? '')}
        confirmLabel={t('admin.users.reactivate')}
        busy={busy}
        onConfirm={() =>
          void run(
            () => reactivateUser(reactivating!.id, reactivating!.version, accessToken),
            'admin.users.reactivated',
          )
        }
        onCancel={() => setReactivating(null)}
      />
    </AdminLayout>
  );
}

/** `null` scope reads as *all branches* (§7 R24), never as *no branch*. */
function roleLabel(a: RoleAssignment): string {
  const role = t(`admin.users.role.${a.role}`);
  return a.branch_name ? `${role} (${a.branch_name})` : `${role} (${t('admin.users.allBranches')})`;
}

/**
 * Maps a failure to the one sentence that names its remedy.
 *
 * `STATE_CONFLICT` carries a `reason` precisely because the remedies differ
 * completely — appointing another Super Admin is nothing like asking a colleague
 * to reload — so a single generic message would hide the only useful part.
 */
function messageFor(error: unknown): string {
  if (!(error instanceof ApiError)) return 'common.saveFailed';
  const reason = error.details?.['reason'] as string | undefined;
  if (reason === 'LAST_SUPER_ADMIN') return 'admin.users.lastSuperAdmin';
  if (reason === 'SELF_SUSPENSION') return 'admin.users.selfSuspension';
  if (reason === 'INVALID_TRANSITION') return 'admin.users.invalidTransition';
  if (error.status === 409) return 'common.conflict';
  if (error.status === 403) return 'admin.users.forbidden';
  if (error.status === 404) return 'admin.users.notFound';
  return 'common.saveFailed';
}

/**
 * The person's own fields.
 *
 * No status control and no email field: the first is a transition with
 * obligations (see `SuspendDialog`), and `pre_provisioned_email` authorises
 * *claiming* an account (§7 R15) — editing it would hand a half-registered
 * person's account to somebody else. The server refuses both.
 */
function ProfileDialog({
  user,
  busy,
  onSave,
  onCancel,
}: {
  user: UserSummary;
  busy: boolean;
  onSave: (input: { name_arabic: string; nickname: string | null; phone: string | null }) => void;
  onCancel: () => void;
}): ReactNode {
  const [name, setName] = useState(user.name_arabic);
  const [nickname, setNickname] = useState(user.nickname ?? '');
  const [phone, setPhone] = useState(user.phone ?? '');
  const [touched, setTouched] = useState(false);
  const error = name.trim() === '' ? t('common.required') : null;

  return (
    <Dialog open onClose={onCancel} title={t('admin.users.editTitle')}>
      <div className="form">
        <TextField
          label={t('admin.users.colName')}
          value={name}
          onChange={setName}
          required
          error={touched ? error : null}
        />
        <TextField label={t('admin.users.colNickname')} value={nickname} onChange={setNickname} />
        <TextField label={t('admin.users.colPhone')} type="tel" value={phone} onChange={setPhone} />
        <div className="form__actions">
          <Button variant="secondary" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => {
              setTouched(true);
              if (error) return;
              // An emptied optional field is `null` (clear it), never `''` —
              // a blank would read as set and render as nothing.
              onSave({
                name_arabic: name.trim(),
                nickname: nickname.trim() === '' ? null : nickname.trim(),
                phone: phone.trim() === '' ? null : phone.trim(),
              });
            }}
          >
            {t('common.save')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * **`CreateDialog` was removed with the button it opened** (2026-08-17).
 *
 * It composed the pre-provisioning form of §4.1b step 4b — name, the address
 * authorised to claim the account, an optional role and branch scope. The
 * Document Owner removed staff-composed account creation from this screen, so a
 * dialog nobody can open is dead code and is not kept "for later": if
 * pre-provisioning is given a home again it will be a decision with a screen of
 * its own, and a stale copy of this form would be the thing that diverges from
 * §4.1's field set in the meantime.
 *
 * **`POST /admin/users` and the `createUser` adapter are untouched**, tested,
 * and remain the way a pre-provisioned account is made.
 */
function RolesDialog({
  user,
  branches,
  canGrantAdmin,
  busy,
  onSave,
  onCancel,
}: {
  user: UserSummary;
  branches: Branch[];
  canGrantAdmin: boolean;
  busy: boolean;
  onSave: (assignments: { role: string; branch_id: string | null }[]) => void;
  onCancel: () => void;
}): ReactNode {
  const [rows, setRows] = useState<{ role: string; branch_id: string | null }[]>(
    user.roles.map((r) => ({ role: r.role, branch_id: r.branch_id })),
  );
  const [role, setRole] = useState('');
  const [branchId, setBranchId] = useState('');

  const offered = ROLES.filter(
    (r) => canGrantAdmin || (r !== 'admin' && r !== 'super_admin'),
  );
  const duplicate = rows.some((r) => r.role === role && r.branch_id === (branchId || null));

  return (
    <Dialog
      open
      onClose={onCancel}
      title={t('admin.users.rolesTitle').replace('{name}', user.name_arabic)}
    >
      <div className="form">
        {rows.length === 0 ? (
          // Not an empty box: an account with no assignment can sign in and
          // reach nothing, which is a state worth naming before it is saved.
          <p className="state" role="status">
            {t('admin.users.noRolesWarning')}
          </p>
        ) : (
          <ul className="admin-list">
            {rows.map((r) => (
              <li key={`${r.role}|${r.branch_id ?? ''}`}>
                <span>
                  {t(`admin.users.role.${r.role}`)}
                  {' — '}
                  {r.branch_id
                    ? (branches.find((b) => b.id === r.branch_id)?.name ?? r.branch_id)
                    : t('admin.users.allBranches')}
                </span>
                <Button
                  variant="secondary"
                  onClick={() =>
                    setRows((current) =>
                      current.filter((x) => !(x.role === r.role && x.branch_id === r.branch_id)),
                    )
                  }
                >
                  {t('common.delete')}
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="form__row">
          <SelectField
            label={t('admin.users.addRole')}
            value={role}
            onChange={setRole}
            options={[
              { value: '', label: t('common.choose') },
              ...offered.map((r) => ({ value: r, label: t(`admin.users.role.${r}`) })),
            ]}
          />
          <SelectField
            label={t('admin.users.branchScope')}
            value={branchId}
            onChange={setBranchId}
            options={[
              { value: '', label: t('admin.users.allBranches') },
              ...branches.map((b) => ({ value: b.id, label: b.name })),
            ]}
            hint={t('admin.users.branchScopeHint')}
          />
        </div>
        <Button
          variant="secondary"
          disabled={role === '' || duplicate}
          onClick={() => {
            setRows((current) => [...current, { role, branch_id: branchId || null }]);
            setRole('');
            setBranchId('');
          }}
        >
          {t('admin.users.addRole')}
        </Button>

        <div className="form__actions">
          <Button variant="secondary" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => onSave(rows)}>
            {t('common.save')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * Suspension asks for a reason and says what it does.
 *
 * The body states that every session ends immediately (TD-4.15) — that is the
 * part an administrator most needs to know before confirming, and it is the
 * reason this is not a dropdown on the edit form.
 */
function SuspendDialog({
  user,
  busy,
  onConfirm,
  onCancel,
}: {
  user: UserSummary;
  busy: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}): ReactNode {
  const [reason, setReason] = useState('');

  return (
    <Dialog
      open
      onClose={onCancel}
      title={t('admin.users.suspendTitle').replace('{name}', user.name_arabic)}
    >
      <div className="form">
        <p>{t('admin.users.suspendBody')}</p>
        <TextField
          label={t('admin.users.suspendReason')}
          value={reason}
          onChange={setReason}
          required
          hint={t('admin.users.suspendReasonHint')}
        />
        <div className="form__actions">
          <Button variant="secondary" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={busy || reason.trim() === ''}
            onClick={() => onConfirm(reason.trim())}
          >
            {t('admin.users.suspend')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
