import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { SortState } from '../../components/ui/data-table.js';

import { listBranches, type Branch } from '../../adapters/branches-admin.js';
import {
  ACCOUNT_STATUSES,
  ROLES,
  reactivateUser,
  searchUsers,
  setUserRoles,
  suspendUser,
  updateUser,
  deleteUserAccount,
  type RoleAssignment,
  type UserProfileInput,
  type UserSummary,
} from '../../adapters/users.js';
import { PersonFields, type PersonForm } from '../../components/registration/person-fields.js';
import { AdminLayout } from '../../components/admin/admin-layout.js';
import { BranchScopeCell } from '../../components/admin/branch-scope-cell.js';
import { Button } from '../../components/ui/button.js';
import { BlockedNotice } from '../../components/ui/blocked-notice.js';
import { ConfirmDialog } from '../../components/ui/confirm-dialog.js';
import { DataTable, type Column, type RowAction, type TableStatus } from '../../components/ui/data-table.js';
import { Dialog } from '../../components/ui/dialog.js';
import { SearchInput, SelectField, TextField } from '../../components/ui/field.js';
import { useSession } from '../../contexts/session.js';
import { useActiveRole } from '../../contexts/active-role.js';
import { t } from '../../i18n/index.js';
import { isDirty } from '../../lib/form-dirty.js';
import { useUnsavedGuard } from '../../lib/use-unsaved-guard.js';
import { ApiError } from '../../lib/api.js';
import { Feedback } from '../../components/ui/feedback.js';

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
  const [sort, setSort] = useState<SortState | null>(null);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [editing, setEditing] = useState<UserSummary | null>(null);

  const [suspending, setSuspending] = useState<UserSummary | null>(null);
  const [deleting, setDeleting] = useState<UserSummary | null>(null);
  /** **Permanent is opt-in, per deletion.** The default is the recoverable
   *  three-day window, because a mistaken click must be undoable. */
  const [permanent, setPermanent] = useState(false);
  const [blocked, setBlocked] = useState<unknown>(null);
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
        sort,
      );
      setRows(result.data);
      setTotal(result.meta.total);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [accessToken, query, roleFilter, statusFilter, page, sort]);

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
    {
      key: 'name',
      header: t('admin.users.colName'),
      sortKey: 'name',
      cell: (r) => r.name_arabic,
    },
    {
      key: 'email',
      header: t('admin.users.colEmail'),
      // The identifier an administrator actually recognises a person by, and
      // the one they are given when somebody reports a problem. Absent for a
      // minor student, who has no account of their own (§4.3) — rendered as a
      // stated absence rather than a blank cell.
      /**
       * **«حساب بلا دخول» is not a product state** (Owner, 2026-08-28): every
       * account is created through registration with a Google address, and a
       * minor signs in through their guardian's. What a `null` here actually
       * means is the one remaining case — an account staff pre-provisioned that
       * nobody has signed into yet (§4.1b step 4b) — so the cell says that
       * instead of announcing a state the product does not have.
       */
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
      cell: (r) => <BranchScopeCell roles={r.roles} />,
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
    /**
     * **R111 — deleting somebody else's account. Super Admin only**, and the
     * server says so: the menu entry is not the enforcement.
     *
     * **Not offered on your own row.** Deleting yourself is a decision taken on
     * حسابي, where the copy explains what survives — an administrator clicking a
     * row action is not in that frame of mind, and the two are different acts.
     */
    {
      label: t('admin.users.deleteAccount'),
      danger: true,
      onSelect: (r) => {
        setPermanent(false);
        setDeleting(r);
      },
      available: (r) => r.id !== me?.id,
    },
    {
      // The de-identification R111 would reach after three days, performed now.
      // A separate action, because «sooner» is a different decision from
      // «delete» and must be chosen deliberately rather than by a checkbox.
      label: t('admin.users.deletePermanent'),
      danger: true,
      onSelect: (r) => {
        setPermanent(true);
        setDeleting(r);
      },
      available: (r) => r.id !== me?.id,
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
        <Feedback>
          {notice}
        </Feedback>
      ) : null}

      <DataTable
        caption={t('admin.users.caption')}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        status={status}
        actions={actions}
        onRetry={() => void load()}
        sort={sort}
        onSort={(next) => {
          setSort(next);
          // Back to page 1: row 26 of the old order is not row 26 of the new
          // one, and leaving the reader on a page that no longer means anything
          // is worse than moving them.
          setPage(1);
        }}
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
          branches={branches}
          canGrantAdmin={isSuperAdmin}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={(input, assignments) =>
            void run(async () => {
              // **One decision, in order.** The person's own fields carry the
              // TD-15 version, so they go first; the role set is a separate
              // endpoint by design (§5.6) and one audit row per decision.
              await updateUser(editing.id, editing.version, input, accessToken);
              await setUserRoles(editing.id, assignments, accessToken);
            }, 'common.saved')
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

      {/* R111 — two ACTIONS rather than one action with a switch.
          Each says what it does, and the destructive one cannot be reached by
          missing a checkbox. */}
      <ConfirmDialog
        open={deleting !== null}
        {...(blocked === null
          ? {}
          : { blocked: <BlockedNotice error={blocked} item={t('admin.users.thisAccount')} /> })}
        title={permanent ? t('admin.users.deletePermanentTitle') : t('admin.users.deleteTitle')}
        body={(permanent ? t('admin.users.deleteBodyPermanent') : t('admin.users.deleteBody'))
          .replace('{name}', deleting?.name_arabic ?? '')}
        confirmLabel={
          permanent ? t('admin.users.deletePermanent') : t('admin.users.deleteAccount')
        }
        danger
        busy={busy}
        onConfirm={() =>
          void run(async () => {
            setBlocked(null);
            try {
              await deleteUserAccount(deleting!.id, accessToken, permanent);
            } catch (error) {
              // A 409 naming what holds the deletion is not a generic failure —
              // it is the list of things to reassign, so it is shown in place.
              setBlocked(error);
              throw error;
            }
          }, 'admin.users.deleted')
        }
        onCancel={() => {
          setDeleting(null);
          setPermanent(false);
          setBlocked(null);
        }}
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
/**
 * **One form for the person and their roles** (Owner, 2026-08-28).
 *
 * الأدوار used to be a second dialog behind its own row action, so editing
 * somebody meant two forms, two saves and two chances to leave half a change
 * behind. They are one form now, saved as one decision.
 *
 * ## What the person half asks
 *
 * Exactly what registration asks, through the same `PersonFields` component:
 * الاسم الشخصي and العائلي, الجنس, the optional French pair, الكنية, الهاتف and
 * ملاحظات. It was a single «الاسم» box holding the **composed** display name —
 * so a staff member retyping it became the authority on how the name reads,
 * which §1.1 composes server-side to prevent, and the French name, the sex and
 * the notes could not be edited at all.
 *
 * ## Why the role list offers only what is missing
 *
 * A role is held **once** per account (Owner, 2026-08-28), enforced by the
 * partial unique index `user_branch_role_one_live_role_per_user` and refused by
 * the service before it. Filtering the dropdown is the courtesy; **neither is
 * the enforcement**, and the server refuses a forged request that names a role
 * twice.
 */
function ProfileDialog({
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
  onSave: (
    input: UserProfileInput,
    assignments: { role: string; branch_id: string | null }[],
  ) => void;
  onCancel: () => void;
}): ReactNode {
  /** Hydration from the persisted record IS the baseline — opening an edit
   *  form must never make it dirty. */
  const pristinePerson: PersonForm = {
    firstNameArabic: user.first_name_arabic ?? '',
    lastNameArabic: user.last_name_arabic ?? '',
    firstNameFrench: user.first_name_french ?? '',
    lastNameFrench: user.last_name_french ?? '',
    nickname: user.nickname ?? '',
    phone: user.phone ?? '',
    notes: user.notes ?? '',
    // R80.6 amended (Owner, 2026-08-28): this Super-Admin-only read publishes
    // `sex`, so the form hydrates it. R80.3/R80.4 still govern the write —
    // completing a missing value is allowed, changing a recorded one is refused.
    sex: (user.sex === 'female' || user.sex === 'male' ? user.sex : '') as PersonForm['sex'],
  };
  const pristineRoles = user.roles.map((r) => ({ role: r.role, branch_id: r.branch_id }));

  const [person, setPerson] = useState<PersonForm>(pristinePerson);
  const [rows, setRows] = useState(pristineRoles);
  const [role, setRole] = useState('');
  const [branchId, setBranchId] = useState('');
  const [touched, setTouched] = useState(false);

  const errors: Record<string, string> = {};
  if (person.firstNameArabic.trim() === '') errors['user.firstNameArabic'] = t('common.required');
  if (person.lastNameArabic.trim() === '') errors['user.lastNameArabic'] = t('common.required');
  if (person.sex === '') errors['user.sex'] = t('common.required');
  const valid = Object.keys(errors).length === 0;

  /**
   * **Only roles this account does not already hold.** A role carries one
   * scope, so a second row of the same role is not a wider grant — it is the
   * duplicate the database now refuses.
   */
  const offered = ROLES.filter(
    (r) =>
      (canGrantAdmin || (r !== 'admin' && r !== 'super_admin')) &&
      !rows.some((x) => x.role === r),
  );

  const guard = useUnsavedGuard({
    open: true,
    dirty:
      isDirty(person, pristinePerson) ||
      isDirty(rows, pristineRoles) ||
      role !== '' ||
      branchId !== '',
    onCancel,
  });

  return (
    <Dialog
      open
      onClose={guard.requestClose}
      dismissible={guard.dismissible}
      title={t('admin.users.editTitle')}
    >
      {guard.confirmation}
      <div className="form">
        <PersonFields value={person} onChange={setPerson} errors={touched ? errors : {}} prefix="user" />

        <h3>{t('admin.users.rolesHeading')}</h3>
        {rows.length === 0 ? (
          // Not an empty box: an account with no assignment can sign in and
          // reach nothing, which is a state worth naming before it is saved.
          <p className="state" role="status">
            {t('admin.users.noRolesWarning')}
          </p>
        ) : (
          <ul className="admin-list">
            {rows.map((r) => (
              <li key={r.role}>
                <span>
                  {t(`admin.users.role.${r.role}`)}
                  {' — '}
                  {r.branch_id
                    ? (branches.find((b) => b.id === r.branch_id)?.name ?? r.branch_id)
                    : t('admin.users.allBranches')}
                </span>
                <Button
                  variant="secondary"
                  onClick={() => setRows((current) => current.filter((x) => x.role !== r.role))}
                >
                  {t('common.delete')}
                </Button>
              </li>
            ))}
          </ul>
        )}

        {offered.length === 0 ? null : (
          <>
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
              disabled={role === ''}
              onClick={() => {
                setRows((current) => [...current, { role, branch_id: branchId || null }]);
                setRole('');
                setBranchId('');
              }}
            >
              {t('admin.users.addRole')}
            </Button>
          </>
        )}

        <div className="form__actions">
          <Button variant="secondary" onClick={guard.requestClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => {
              setTouched(true);
              if (!valid) return;
              // An emptied optional field is `null` (clear it), never `''` — a
              // blank would read as set and render as nothing.
              const orNull = (v: string): string | null => (v.trim() === '' ? null : v.trim());
              onSave(
                {
                  first_name_arabic: person.firstNameArabic.trim(),
                  last_name_arabic: person.lastNameArabic.trim(),
                  first_name_french: orNull(person.firstNameFrench),
                  last_name_french: orNull(person.lastNameFrench),
                  nickname: orNull(person.nickname),
                  phone: orNull(person.phone),
                  notes: orNull(person.notes),
                  // R80.3 completes a missing sex; the server refuses a change.
                  ...(person.sex === '' ? {} : { sex: person.sex }),
                },
                rows,
              );
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
