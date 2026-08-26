import { useCallback, useEffect, useState, type ReactNode } from 'react';

import {
  approveApproval,
  decideChildApplication,
  CHILD_REJECTION_REASONS,
  type ChildRejectionReason,
  type PlacementBody,
  listApprovals,
  rejectApproval,
  type Approval,
  type ApprovalType,
  DECISION_REASON_MAX,
} from '../../adapters/approvals.js';
import { fetchBranches, type PublicBranch } from '../../adapters/branches.js';
import { AdminLayout } from '../../components/admin/admin-layout.js';
import { levelLabel } from '../../components/scope/level-select.js';
import { BranchSelector } from '../../components/ui/branch-selector.js';
import {
  ApplicantList,
  ApprovalTypeBadge,
  BundleSummary,
} from '../../components/ui/approval-card.js';
import { ConfirmDialog } from '../../components/ui/confirm-dialog.js';
import {
  type Column,
  DataTable,
  type RowAction,
  type SortState,
  type TableStatus,
} from '../../components/ui/data-table.js';
import { Button } from '../../components/ui/button.js';
import { Dialog } from '../../components/ui/dialog.js';
import { SelectField } from '../../components/ui/field.js';
import { ROLES } from '../../adapters/users.js';
import {
  listAdministrativeGroups,
  type AdministrativeGroup,
} from '../../adapters/administrative-groups.js';
import { listLevels, type Level } from '../../adapters/taxonomy.js';
import { useSession } from '../../contexts/session.js';
import { useActiveRole } from '../../contexts/active-role.js';
import { t } from '../../i18n/index.js';
import { isDirty } from '../../lib/form-dirty.js';
import { useUnsavedGuard } from '../../lib/use-unsaved-guard.js';
import { formatDate } from '../../lib/format-date.js';
import { ApiError } from '../../lib/api.js';
import { Feedback } from '../../components/ui/feedback.js';

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
  const { activeRoles } = useActiveRole();
  // R60 — the ACTIVE role. A Super Admin working as مؤطِّرة must not be offered
  // a control the server will refuse: the affordance follows the authority.
  const isSuperAdmin = (activeRoles).includes('super_admin');

  const [rows, setRows] = useState<Approval[]>([]);
  const [status, setStatus] = useState<TableStatus>('loading');
  const [page, setPage] = useState(1);
  /**
   * R76 — server-side. **This queue is a union of three independently
   * paginated sources**, so the sort orders each of them by the same field;
   * with a type filter active it is exact. See `approvalOrder` in the service.
   */
  const [sort, setSort] = useState<SortState | null>(null);
  const [total, setTotal] = useState(0);
  const [typeFilter, setTypeFilter] = useState<'' | ApprovalType>('');
  const [branchFilter, setBranchFilter] = useState<string | null>(null);
  const [branches, setBranches] = useState<PublicBranch[]>([]);
  const [deciding, setDeciding] = useState<{ row: Approval; approve: boolean } | null>(null);
  /** Approving a staff request is a different act from approving a family, so
   *  it gets its own dialog rather than a confirmation with a form bolted on. */
  const [staffApproval, setStaffApproval] = useState<Approval | null>(null);
  /** §4.1 (R43) — approving a registration IS the placement, so the queue
   *  cannot approve one without asking where the student goes. */
  const [placing, setPlacing] = useState<Approval | null>(null);
  /**
   * R62.2 — a child-registration request has **no bundle decision at all**: each
   * child is approved or refused on its own. So it gets its own dialog, and the
   * generic approve/reject path is never offered for it.
   */
  const [childDeciding, setChildDeciding] = useState<Approval | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      // The filter goes to the SERVER, unlike the Branches search which narrows
      // rows already fetched. A queue is paginated over the full set, so
      // filtering client-side would hide matches on later pages.
      const result = await listApprovals(accessToken, {
        ...(sort ? { sort } : {}),
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
      sortKey: 'applicants',
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
      key: 'requested',
      header: t('admin.approvals.colRequested'),
      // Revision 49 — what makes a staff request distinguishable at a glance.
      // A hint, never an authority: the role is granted by the assignment the
      // approver states, not by this cell.
      cell: (r) =>
        r.requested_role ? (
          t(`admin.users.role.${r.requested_role}`)
        ) : (
          <span className="muted">—</span>
        ),
    },
    {
      key: 'submitted',
      // A timestamp — chronological, never lexicographic.
      sortKey: 'submitted',
      header: t('admin.approvals.colSubmitted'),
      secondary: true,
      // The instant is rendered as a date for reading, with the full value in
      // `dateTime` for machines. Formatting an already-fetched value is
      // presentation, which a client may do (§1.1).
      cell: (r) => <time dateTime={r.submitted_at}>{formatDate(r.submitted_at)}</time>,
    },
  ];

  const actions: RowAction<Approval>[] = [
    {
      label: t('admin.approvals.approve'),
      onSelect: (row) =>
        // A request for a role needs a decision about that role; a family
        // registration does not. Sending both through one dialog would either
        // ask everyone about roles or nobody.
        // Three different acts behind one label. A staff request needs a role;
        // a registration needs a PLACEMENT, without which §4.1 refuses; a
        // family-link request needs neither.
        // Four different acts behind two labels. A staff request needs a role;
        // a registration needs a PLACEMENT, without which §4.1 refuses; a
        // family-link request needs neither; and a child-registration request
        // has **no bundle decision at all** (R62.2) — each child is decided
        // alone, so it opens its own dialog for both outcomes.
        row.type === 'child-application'
          ? setChildDeciding(row)
          : // R68 — approving means *the links stand*; nothing is created, so
            // it needs neither a placement nor a role decision.
            row.type === 'identity-review'
            ? setDeciding({ row, approve: true })
            : row.requested_role
            ? setStaffApproval(row)
            : row.type === 'registration'
              ? setPlacing(row)
              : setDeciding({ row, approve: true }),
    },
    {
      label: t('admin.approvals.reject'),
      danger: true,
      onSelect: (row) =>
        row.type === 'child-application'
          ? setChildDeciding(row)
          : setDeciding({ row, approve: false }),
    },
  ];

  async function confirmDecision(
    reason?: string,
    options?: {
      assignments?: { role: string; branch_id: string | null }[];
      enrollments?: ({ user_id: string } & PlacementBody)[];
      row?: Approval;
    },
  ): Promise<void> {
    const target = options?.row ?? deciding?.row;
    const approve = options?.row ? true : (deciding?.approve ?? false);
    if (!target) return;
    setBusy(true);
    try {
      const result = approve
        ? await approveApproval(target.id, accessToken, {
            ...(reason ? { reason } : {}),
            ...(options?.assignments ? { assignments: options.assignments } : {}),
            ...(options?.enrollments ? { enrollments: options.enrollments } : {}),
          })
        : await rejectApproval(target.id, reason ?? '', accessToken);
      setDeciding(null);
      setStaffApproval(null);
      setPlacing(null);
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
      // A refused privilege grant is its own message: an Admin cannot create an
      // administrator through approval any more than through the Users screen.
      const forbidden = error instanceof ApiError && error.status === 403;
      setNotice(
        t(
          forbidden
            ? 'admin.approvals.roleForbidden'
            : gone
              ? 'admin.approvals.alreadyDecided'
              : 'admin.approvals.decisionFailed',
        ),
      );
      setDeciding(null);
      setStaffApproval(null);
      setPlacing(null);
      if (gone) await load();
    } finally {
      setBusy(false);
    }
  }

  const applicantNames = deciding?.row.applicants.map((a) => a.name).join('، ') ?? '';

  return (
    <AdminLayout title={t('admin.nav.approvals')} lede={t('admin.approvals.lede')}>
      {notice ? (
        <Feedback>
          {notice}
        </Feedback>
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
                { value: 'child-application', label: t('admin.approvals.typeChild') },
                { value: 'identity-review', label: t('admin.approvals.typeIdentityReview') },
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
        sort={sort}
        onSort={setSort}
        pagination={{ page, pageSize: 25, total, onPage: setPage }}
      />

      {placing ? (
        <PlacementDialog
          row={placing}
          // The applicant enrols only when there is no child: a bundle with
          // children is a parent registering a family.
          students={
            placing.applicants.filter((a) => a.role === 'child').length > 0
              ? placing.applicants.filter((a) => a.role === 'child')
              : placing.applicants.filter((a) => a.role === 'applicant')
          }
          title={t('admin.approvals.placeTitle')}
          branches={branches}
          busy={busy}
          onCancel={() => setPlacing(null)}
          onConfirm={(placements) =>
            void confirmDecision(undefined, {
              // R66.5 — whichever shape the dialog produced travels through
              // unchanged; the server refuses a mixture rather than picking one.
              enrollments: placements.map(({ id, ...placement }) => ({
                user_id: id,
                ...placement,
              })),
              row: placing,
            })
          }
        />
      ) : null}

      {childDeciding ? (
        <ChildDecisionDialog
          row={childDeciding}
          branches={branches}
          busy={busy}
          onCancel={() => setChildDeciding(null)}
          onDone={async (message) => {
            setChildDeciding(null);
            await load();
            setNotice(message);
          }}
          onBusy={setBusy}
        />
      ) : null}

      {staffApproval ? (
        <StaffApprovalDialog
          row={staffApproval}
          branches={branches}
          canGrantAdmin={isSuperAdmin}
          busy={busy}
          onCancel={() => setStaffApproval(null)}
          onConfirm={(assignments) =>
            void confirmDecision(undefined, { assignments, row: staffApproval })
          }
        />
      ) : null}

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


/**
 * Approving a staff request — the activation **and** the role, in one act.
 *
 * §4.1 already calls approval *"a single administrative act that admits the
 * applicant"*, and an account that is active with no role is a person who can
 * sign in and reach nothing. Granting here means the platform never passes
 * through that state when the approver already knows what the account is for.
 *
 * **The requested role is a default, not a decision.** It is prefilled because
 * it is almost always right, and it is editable because it was written by the
 * applicant — the same relationship §4.1 gives the preselected first Level.
 *
 * **The branch scope defaults to the branch the applicant asked for** and is
 * separately editable, because those are two different questions: one is where
 * they want to teach, the other is the extent of their authority (TD-2).
 *
 * **Administrator roles are hidden for an Admin** rather than shown and refused
 * — approval must not become a weaker way to hand out authority than the Users
 * screen. The server enforces it with the same function either way.
 */
function StaffApprovalDialog({
  row,
  branches,
  canGrantAdmin,
  busy,
  onConfirm,
  onCancel,
}: {
  row: Approval;
  branches: PublicBranch[];
  canGrantAdmin: boolean;
  busy: boolean;
  onConfirm: (assignments: { role: string; branch_id: string | null }[]) => void;
  onCancel: () => void;
}): ReactNode {
  const [role, setRole] = useState(row.requested_role ?? 'teacher');
  const [branchId, setBranchId] = useState<string>(row.branch?.id ?? '');
  /** The requested role and branch are prefilled FROM THE REQUEST — that is
   *  hydration, not a change, so it is the baseline. */
  const staffGuard = useUnsavedGuard({
    open: true,
    dirty: isDirty(
      { role, branchId },
      { role: row.requested_role ?? 'teacher', branchId: row.branch?.id ?? '' },
    ),
    onCancel,
  });

  const offered = ROLES.filter((r) => canGrantAdmin || (r !== 'admin' && r !== 'super_admin'));

  return (
    <Dialog
      open
      onClose={staffGuard.requestClose}
      dismissible={staffGuard.dismissible}
      title={t('admin.approvals.staffTitle').replace(
        '{names}',
        row.applicants.map((a) => a.name).join('، '),
      )}
    >
      {staffGuard.confirmation}
      <div className="form">
        <p>
          {t('admin.approvals.staffBody').replace(
            '{role}',
            t(`admin.users.role.${row.requested_role ?? 'teacher'}`),
          )}
        </p>
        <SelectField
          label={t('admin.approvals.grantRole')}
          value={role}
          onChange={setRole}
          options={offered.map((r) => ({ value: r, label: t(`admin.users.role.${r}`) }))}
          hint={t('admin.approvals.grantRoleHint')}
        />
        <SelectField
          label={t('admin.users.branchScope')}
          value={branchId}
          onChange={setBranchId}
          options={[
            { value: '', label: t('admin.users.allBranches') },
            ...branches.map((b) => ({ value: b.id, label: b.name })),
          ]}
          hint={t('admin.approvals.grantScopeHint')}
        />
        <div className="form__actions">
          <Button variant="secondary" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          {/* Approving WITHOUT a role stays reachable: an applicant may have
              asked for something the approver does not agree to, and refusing
              the role is not the same decision as refusing the person. */}
          <Button variant="secondary" disabled={busy} onClick={() => onConfirm([])}>
            {t('admin.approvals.approveWithoutRole')}
          </Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => onConfirm([{ role, branch_id: branchId || null }])}
          >
            {t('admin.approvals.approveWithRole')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * Where each admitted student goes — **§4.1, Revision 43**.
 *
 * > *"Approval and every resulting `Enrollment` row are written in one
 * > transaction — an approved account with no enrollment is a person the
 * > platform admitted and then lost."*
 *
 * So this is not an optional extra step bolted onto a confirmation: it **is**
 * the approval. The screen cannot offer a plain "approve" for a registration,
 * because the server would refuse it.
 *
 * **One row per person the bundle admits as a student** — on a parent+child
 * registration that is the child, and the parent is deliberately absent: their
 * access comes through the family link, and offering to enrol them would invite
 * placing a parent in a Level.
 *
 * **Exactly one group per Level** (§4.1 step 2), and where a Level has a single
 * group it is chosen automatically — §4.1 asks for that explicitly, and a
 * dropdown with one option is a question nobody needs asked.
 *
 * **Teaching Groups are never offered here** (§4.1): at approval nobody yet
 * knows how each Subject will be split, and most Subjects are never split.
 *
 * **The first Level of the applicant's Category is preselected** (§4.1 step 1),
 * which became implementable when registration started recording a Category
 * (Revision 49). It is **a default, not a decision**, in the clause's own
 * words — the Level list is filtered to that Category for the same reason, and
 * *"any Category"* is one click away, because an applicant may have chosen the
 * wrong stage and correcting it is the approver's job.
 *
 * **An applicant registered before Revision 49 has no Category**, and that is
 * rendered as what it is — *not stated* — with no filter and nothing
 * preselected, rather than as a guess.
 */
function PlacementDialog({
  row,
  students,
  title,
  branches,
  busy,
  onConfirm,
  onCancel,
}: {
  row: Approval;
  /**
   * Who is being placed, as `{ id, name }`.
   *
   * **Passed in rather than derived from `row`, because the id means different
   * things on the two paths that need this picker** — a `User` id on a
   * registration bundle, a `ChildApplication` id on a child-registration
   * request, where no `User` exists yet. The Level/group logic is identical and
   * §4.1 step 1's preselection is identical, so the picker is shared and the
   * caller owns the meaning of the id.
   */
  students: { id: string; name: string }[];
  title: string;
  /** R66.5 — offered when the chosen Level has no group to inherit one from. */
  branches: PublicBranch[];
  busy: boolean;
  onConfirm: (placements: ({ id: string } & PlacementBody)[]) => void;
  onCancel: () => void;
}): ReactNode {
  const { accessToken } = useSession();
  const studentIds = students.map((s) => s.id);

  const [levels, setLevels] = useState<Level[]>([]);
  const [groups, setGroups] = useState<AdministrativeGroup[]>([]);
  /** R66.5 — a group, OR a branch when the Level has none. Never both. */
  const [choice, setChoice] = useState<
    Record<string, { levelId: string; groupId: string; branchId: string }>
  >({});
  const [loadFailed, setLoadFailed] = useState(false);
  /** §4.1 step 1 filters to the applicant's Category — and lets the approver
   *  leave it, because the applicant may have chosen the wrong stage. */
  const [categoryFilter, setCategoryFilter] = useState<string>(row.category?.id ?? '');
  /** A placement chosen but not yet decided is unsaved work; the Category
   *  prefilled from the request is not. */
  const placementGuard = useUnsavedGuard({
    open: true,
    dirty:
      isDirty(choice, null) ||
      isDirty(categoryFilter, row.category?.id ?? ''),
    onCancel,
  });

  useEffect(() => {
    void (async () => {
      try {
        const [lvls, grps] = await Promise.all([
          listLevels(accessToken),
          listAdministrativeGroups(accessToken, 1, {}),
        ]);
        setLevels(lvls);
        setGroups(grps.data);

        // §4.1 step 1: **the first Level of the applicant's Category is
        // preselected** — a DEFAULT, not a decision. Applied once, when the
        // lists arrive, so a later edit is never overwritten. The group follows
        // step 2: a Level with one group needs no interaction.
        const wanted = row.category?.id;
        if (wanted) {
          const first = lvls.find((l) => l.category_id === wanted);
          if (first) {
            const inLevel = grps.data.filter((g) => g.level_id === first.id);
            setChoice(
              Object.fromEntries(
                studentIds.map((id) => [
                  id,
                  {
                    levelId: first.id,
                    groupId: inLevel.length === 1 ? inLevel[0]!.id : '',
                    // R66.5 — with no group to inherit a branch from, the
                    // approver states it. Preselected from the request where
                    // one was made, exactly as the Level is.
                    branchId: inLevel.length === 0 ? (row.branch?.id ?? '') : '',
                  },
                ]),
              ),
            );
          }
        }
      } catch {
        // Without these the approval cannot be completed at all, so this is a
        // blocking failure rather than a degraded one.
        setLoadFailed(true);
      }
    })();
  }, [accessToken]);

  function pickLevel(studentId: string, levelId: string): void {
    const inLevel = groups.filter((g) => g.level_id === levelId);
    setChoice((c) => ({
      ...c,
      // §4.1 step 2: a Level with one group needs no interaction. R66.5: a
      // Level with NO group needs a branch instead, defaulted to the one the
      // applicant asked for.
      [studentId]: {
        levelId,
        groupId: inLevel.length === 1 ? inLevel[0]!.id : '',
        branchId: inLevel.length === 0 ? (row.branch?.id ?? '') : '',
      },
    }));
  }

  /**
   * A placement is complete when it names a group, or — for a Level nobody has
   * subdivided — a branch. R66.5 made the second shape possible; before it, a
   * group-less Level could never satisfy this and the confirm button stayed
   * disabled with no explanation.
   */
  const complete = students.every((s) => {
    const picked = choice[s.id];
    if (!picked?.levelId) return false;
    return groups.some((g) => g.level_id === picked.levelId)
      ? picked.groupId !== ''
      : picked.branchId !== '';
  });

  return (
    <Dialog
      open
      onClose={placementGuard.requestClose}
      dismissible={placementGuard.dismissible}
      title={title}
    >
      {placementGuard.confirmation}
      <div className="form">
        <p>{t('admin.approvals.placeBody')}</p>

        {loadFailed ? (
          <p className="state" role="alert">
            {t('common.loadFailed')}
          </p>
        ) : null}

        {/* The stage the applicant asked for, and an escape from it. §4.1 makes
            the preselection a default; an applicant who picked the wrong stage
            is exactly why the approver can widen this. */}
        <SelectField
          label={t('admin.approvals.colRequested')}
          value={categoryFilter}
          onChange={setCategoryFilter}
          options={[
            { value: '', label: t('admin.approvals.anyCategory') },
            ...[...new Map(levels.map((l) => [l.category_id, l.category_name])).entries()].map(
              ([id, name]) => ({ value: id, label: name }),
            ),
          ]}
          hint={
            row.category
              ? t('admin.approvals.categoryRequested').replace('{category}', row.category.name)
              : t('admin.approvals.categoryNotStated')
          }
        />

        {/* R66.5 — the "no assignable Level" notice is gone with the filter
            that made it necessary. Every Level can now be placed into: a group
            where the Level is subdivided, a branch where it is not. */}

        {students.map((s) => {
          const picked = choice[s.id];
          const inLevel = picked ? groups.filter((g) => g.level_id === picked.levelId) : [];
          return (
            <fieldset key={s.id}>
              <legend>{s.name}</legend>
              <SelectField
                label={t('admin.levels.colName')}
                value={picked?.levelId ?? ''}
                onChange={(v) => pickLevel(s.id, v)}
                required
                options={[
                  { value: '', label: t('common.choose') },
                  // Ordered by Category server-side (§2.2 scopes a Level's
                  // order within its Category), so the list reads as curricula
                  // rather than as one flat run.
                  /**
                   * **Every Level is offered again (R66.5).**
                   *
                   * They were excluded for one release, because picking a Level
                   * with no group left the confirm button `disabled` and
                   * pressing موافقة produced no network request at all. That was
                   * the honest workaround while §4.1's placement demanded a
                   * group and 18 of 20 live Levels had none.
                   *
                   * R66 removes the premise: a Level nobody has subdivided is
                   * ordinary, and the placement it needs is a **branch** rather
                   * than a group. So the filter goes, and the branch selector
                   * below appears exactly when there is no group to choose.
                   */
                  ...levels
                    .filter((l) => categoryFilter === '' || l.category_id === categoryFilter)
                    // The shared label rather than a third copy of its format —
                    // this was one of them, and the day the format changes it
                    // would have been the one that did not (2026-08-17).
                    .map((l) => ({ value: l.id, label: levelLabel(l) })),
                ]}
              />
              {picked && inLevel.length > 1 ? (
                <SelectField
                  label={t('admin.approvals.placeGroup')}
                  value={picked.groupId}
                  onChange={(v) =>
                    setChoice((c) => ({ ...c, [s.id]: { ...picked, groupId: v } }))
                  }
                  required
                  options={[
                    { value: '', label: t('common.choose') },
                    ...inLevel.map((g) => ({ value: g.id, label: g.name })),
                  ]}
                />
              ) : null}
              {picked && inLevel.length === 0 ? (
                // R66.5 — no subdivision, so the approver names the branch the
                // student is enrolled AT. It lands on `Enrollment.branch_id`,
                // which is what keeps every branch-scoped rule working for a
                // student who has no group.
                <SelectField
                  label={t('admin.approvals.placeBranch')}
                  value={picked.branchId}
                  onChange={(v) =>
                    setChoice((c) => ({ ...c, [s.id]: { ...picked, branchId: v } }))
                  }
                  required
                  options={[
                    { value: '', label: t('common.choose') },
                    ...branches.map((b) => ({ value: b.id, label: b.name })),
                  ]}
                  hint={t('admin.approvals.placeBranchHint')}
                />
              ) : null}
            </fieldset>
          );
        })}

        <div className="form__actions">
          <Button variant="secondary" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={busy || !complete}
            onClick={() =>
              onConfirm(
                students.map((s) => {
                  const picked = choice[s.id]!;
                  // Exactly one shape, chosen by whether the Level is
                  // subdivided — the server refuses a request carrying both.
                  return picked.groupId
                    ? { id: s.id, administrative_group_id: picked.groupId }
                    : { id: s.id, level_id: picked.levelId, branch_id: picked.branchId };
                }),
              )
            }
          >
            {t('admin.approvals.approve')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * **A child-registration request, decided one child at a time (R62.2).**
 *
 * TD-4.2 used to approve a parent, a child and their link atomically as a
 * bundle. R62 narrowed it to **one child**, for a reason this dialog exists to
 * express: an approver may admit one sibling and refuse another, and a bundle
 * decision could not say that. So there is no "approve this request" — the
 * server refuses that id by name (`DECIDE_PER_CHILD`), and this screen no
 * longer offers it.
 *
 * Each child is therefore its own row with its own outcome:
 *
 * * **Approve** carries a placement, because §4.1 (R43) is unchanged by R62 —
 *   *"an approved account with no enrollment is a person the platform admitted
 *   and then lost"*. The Level/group picker is `PlacementDialog`'s, shared
 *   rather than copied; only the meaning of the id differs.
 * * **Reject** carries a **bounded** reason (R62.8), never free text: it is the
 *   one thing the parent is told, and a free-text note would eventually carry a
 *   safeguarding judgement that must not reach them. The staff-only
 *   `internal_note` is where that belongs.
 *
 * **Each child is a separate request and a separate transaction**, so a failure
 * part-way leaves the earlier decisions standing — exactly what R62.2 says
 * happens. The result message reports what actually landed rather than what was
 * attempted.
 */
function ChildDecisionDialog({
  row,
  branches,
  busy,
  onCancel,
  onDone,
  onBusy,
}: {
  row: Approval;
  /** R66.5 — passed through to the placement step. */
  branches: PublicBranch[];
  busy: boolean;
  onCancel: () => void;
  onDone: (message: string) => Promise<void>;
  onBusy: (busy: boolean) => void;
}): ReactNode {
  const { accessToken } = useSession();
  const pending = row.children.filter((child) => child.status === 'pending');
  const [outcome, setOutcome] = useState<Record<string, 'approve' | 'reject'>>({});
  const [reason, setReason] = useState<Record<string, ChildRejectionReason | ''>>({});
  /** A rejection reason typed for any child is unsaved work. */
  const childGuard = useUnsavedGuard({
    open: true,
    dirty: Object.values(reason).some((v) => v !== ''),
    onCancel,
  });
  const [placeFor, setPlaceFor] = useState<{ application_id: string; name: string }[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const chosen = (id: string): 'approve' | 'reject' | undefined => outcome[id];
  const approving = pending.filter((c) => chosen(c.application_id) === 'approve');
  const rejecting = pending.filter((c) => chosen(c.application_id) === 'reject');
  const complete =
    approving.length + rejecting.length > 0 &&
    rejecting.every((c) => reason[c.application_id]);

  /** Runs the decisions one at a time and reports what actually landed. */
  async function apply(placements: Record<string, PlacementBody>): Promise<void> {
    onBusy(true);
    setFailure(null);
    let done = 0;
    try {
      for (const child of approving) {
        await decideChildApplication(
          child.application_id,
          // R66.5 — whichever shape the placement dialog produced.
          { approve: true, ...placements[child.application_id]! },
          accessToken,
        );
        done += 1;
      }
      for (const child of rejecting) {
        await decideChildApplication(
          child.application_id,
          { approve: false, rejection_reason: reason[child.application_id] as ChildRejectionReason },
          accessToken,
        );
        done += 1;
      }
      await onDone(t('admin.approvals.childDecided').replace('{n}', String(done)));
    } catch (error) {
      // Honest about a partial outcome: the decisions already committed are not
      // undone, and telling the approver otherwise would be worse than the
      // failure itself.
      setFailure(
        `${t('admin.approvals.childPartial').replace('{n}', String(done))} ${
          error instanceof ApiError ? error.message : ''
        }`.trim(),
      );
      setPlaceFor(null);
    } finally {
      onBusy(false);
    }
  }

  // Step two: where each approved child goes. Skipped entirely when nobody is
  // being approved — a request refused outright needs no Level.
  if (placeFor) {
    return (
      <PlacementDialog
        row={row}
        students={placeFor.map((c) => ({ id: c.application_id, name: c.name }))}
        title={t('admin.approvals.placeTitle')}
        branches={branches}
        busy={busy}
        onCancel={() => setPlaceFor(null)}
        onConfirm={(placements) =>
          void apply(Object.fromEntries(placements.map(({ id, ...rest }) => [id, rest])))
        }
      />
    );
  }

  return (
    <Dialog
      open
      onClose={childGuard.requestClose}
      dismissible={childGuard.dismissible}
      title={t('admin.approvals.childTitle')}
    >
      {childGuard.confirmation}
      <div className="form">
        <p>{t('admin.approvals.childBody')}</p>
        {failure ? (
          <p className="state" role="alert">
            {failure}
          </p>
        ) : null}

        {pending.map((child) => (
          <fieldset key={child.application_id}>
            <legend>{child.name}</legend>
            <SelectField
              label={t('admin.approvals.childOutcome')}
              value={chosen(child.application_id) ?? ''}
              onChange={(value) =>
                setOutcome((current) => ({
                  ...current,
                  [child.application_id]: value as 'approve' | 'reject',
                }))
              }
              options={[
                { value: '', label: t('admin.approvals.childUndecided') },
                { value: 'approve', label: t('admin.approvals.approve') },
                { value: 'reject', label: t('admin.approvals.reject') },
              ]}
            />
            {chosen(child.application_id) === 'reject' ? (
              <SelectField
                label={t('admin.approvals.childReason')}
                value={reason[child.application_id] ?? ''}
                onChange={(value) =>
                  setReason((current) => ({
                    ...current,
                    [child.application_id]: value as ChildRejectionReason,
                  }))
                }
                required
                options={[
                  { value: '', label: t('common.choose') },
                  ...CHILD_REJECTION_REASONS.map((value) => ({
                    value,
                    label: t(`admin.approvals.childReason_${value}`),
                  })),
                ]}
                hint={t('admin.approvals.childReasonHint')}
              />
            ) : null}
          </fieldset>
        ))}

        <div className="form__actions">
          <Button variant="secondary" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={busy || !complete}
            onClick={() =>
              approving.length > 0
                ? setPlaceFor(
                    approving.map((c) => ({ application_id: c.application_id, name: c.name })),
                  )
                : void apply({})
            }
          >
            {t('common.save')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
