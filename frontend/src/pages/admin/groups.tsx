import { useCallback, useEffect, useState, type ReactNode } from 'react';

import {
  createAdministrativeGroup,
  deleteAdministrativeGroup,
  enrolStudent,
  listAdministrativeGroups,
  reorderAdministrativeGroups,
  listRoster,
  unenrolStudent,
  updateAdministrativeGroup,
  type AdministrativeGroup,
  type RosterEntry,
} from '../../adapters/administrative-groups.js';
import {
  fetchCalendarBootstrap,
  type BranchRef,
  type CategoryRef,
  type LevelRef,
} from '../../adapters/calendar.js';
import { searchUsers, type UserSummary } from '../../adapters/users.js';
import { AdminLayout } from '../../components/admin/admin-layout.js';
import { Button } from '../../components/ui/button.js';
import { ConfirmDialog } from '../../components/ui/confirm-dialog.js';
import {
  DataTable,
  type Column,
  type RowAction,
  type SortState,
  type TableStatus,
} from '../../components/ui/data-table.js';
import { Dialog } from '../../components/ui/dialog.js';
import { FormDialog } from '../../components/ui/form-dialog.js';
import { SelectField, TextField } from '../../components/ui/field.js';
import { SearchableSelect } from '../../components/ui/searchable-select.js';
import { useSession } from '../../contexts/session.js';
import { useActiveRole } from '../../contexts/active-role.js';
import {
  LevelSelect,
  levelLabel,
  withCategoryNames,
  type LevelOption,
} from '../../components/scope/level-select.js';
import { isDirty } from '../../lib/form-dirty.js';
import { t } from '../../i18n/index.js';
import { classifyDeletion, deletionNotice } from '../../lib/deletion-outcome.js';
import { BlockedNotice } from '../../components/ui/blocked-notice.js';
import { ScopeSelectors } from '../../components/scope/scope-selectors.js';
import { useScopeOptions } from '../../hooks/use-scope-options.js';
import { ApiError } from '../../lib/api.js';
import { Feedback } from '../../components/ui/feedback.js';

/**
 * `/admin/groups` — Administrative Groups and their rosters (§4.4c, §5.6).
 *
 * **The organisational unit, and nothing about delivery.** A group has no room,
 * no teacher and **no capacity** (BR-23) — those live on a Course Schedule, and
 * §20 rule 22 forbids re-conflating them. This screen therefore offers a name,
 * a Level, a Branch and an ordering, and no field that would imply a timetable.
 *
 * **Level and Branch are chosen at creation and never edited.** Moving a group
 * between them is a re-creation: a new Level would invalidate every enrolment
 * pointing here, and a new Branch would change where its students are recorded
 * as attending without anyone deciding that per student. The edit dialog
 * therefore offers only `name` and `display_order`, matching what the server
 * accepts rather than offering fields it refuses.
 *
 * **Where the Level list comes from, and why it is worth stating.** There is no
 * `/admin/levels` endpoint — §14.1 lists the node and TD-3 documents no route —
 * so the picker reads the **public calendar bootstrap**, which is reference data
 * by definition and already serves levels. That is a deliberate reuse rather
 * than an omission: inventing an admin levels endpoint would be a new public
 * contract (§20 rule 16). When `/admin/levels` ships, this picker changes source
 * and nothing else.
 */
/** A group is a roster **at a premises** (§4.4c), so both narrow the list. */
const GROUP_SCOPE = ['branchId', 'levelId'] as const;

export function GroupsPage(): ReactNode {
  const { accessToken } = useSession();
  const { activeRoles } = useActiveRole();
  // R60 — the ACTIVE role. A Super Admin working as مؤطِّرة must not be offered
  // a control the server will refuse: the affordance follows the authority.
  const canWrite = (activeRoles).some((r) => ['admin', 'super_admin'].includes(r));

  const [rows, setRows] = useState<AdministrativeGroup[]>([]);
  const [status, setStatus] = useState<TableStatus>('loading');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [levels, setLevels] = useState<LevelRef[]>([]);
  const [categories, setCategories] = useState<CategoryRef[]>([]);
  const [branches, setBranches] = useState<BranchRef[]>([]);
  /** One graph, shared with the schedules and content screens. */
  // A filter — `ScopeSelectors` below is `mode="filter"`, and the hook is told
  // the same thing so the two cannot disagree about what this row of controls is.
  const scope = useScopeOptions({ token: accessToken, fields: GROUP_SCOPE, mode: 'filter' });
  const levelFilter = scope.value.levelId;
  const branchFilter = scope.value.branchId;
  const [editing, setEditing] = useState<AdministrativeGroup | 'new' | null>(null);
  const [deleting, setDeleting] = useState<AdministrativeGroup | null>(null);
  /** The refusal itself, so the dialog can name what blocks it (rule AZ.1). */
  const [blocked, setBlocked] = useState<unknown>(null);
  const [rosterOf, setRosterOf] = useState<AdministrativeGroup | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sort, setSort] = useState<SortState | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const result = await listAdministrativeGroups(
        accessToken,
        page,
        {
          ...(levelFilter ? { level_id: levelFilter } : {}),
          ...(branchFilter ? { branch_id: branchFilter } : {}),
        },
        sort,
      );
      setRows(result.data);
      setTotal(result.meta.total);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [accessToken, page, levelFilter, branchFilter, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      // A narrow window: this call is for its reference lists, not its
      // occurrences, and asking for a wide range would fetch a calendar nobody
      // renders.
      const today = new Date().toISOString().slice(0, 10);
      try {
        const bootstrap = await fetchCalendarBootstrap({ from: today, to: today });
        setLevels(bootstrap.levels);
        // The Category NAMES, so the Level label reads `{Category} — {Level}`
        // like every other selector (§4.4b — Level names are not unique across
        // Categories). The bootstrap already returns them; this picker was
        // simply not joining them (2026-08-17).
        setCategories(bootstrap.categories);
        setBranches(bootstrap.branches);
      } catch {
        // The pickers stay empty and the page still lists groups. A reference
        // list that failed to load must not take the screen down with it.
      }
    })();
  }, []);

  const nameOf = (list: { id: string; name: string }[], id: string): string =>
    list.find((x) => x.id === id)?.name ?? id;

  /** Levels with their Category name joined on — see `withCategoryNames`. */
  const labelledLevels = withCategoryNames(levels, categories);

  const columns: Column<AdministrativeGroup>[] = [
    { key: 'name', header: t('admin.groups.colName'), sortKey: 'name', cell: (r) => r.name },
    {
      key: 'members',
      header: t('admin.groups.colMembers'),
      // Not sortable: the server sorts by stored columns (R76.1) and this one
      // is derived, so offering it would sort a page rather than the set.
      cell: (r) => String(r.member_count),
    },
    {
      key: 'level',
      header: t('admin.groups.colLevel'),
      // The shared label, so the column reads what the selector offers.
      cell: (r) => {
        const level = labelledLevels.find((l) => l.id === r.level_id);
        return level ? levelLabel(level) : r.level_id;
      },
    },
    {
      key: 'branch',
      header: t('admin.groups.colBranch'),
      secondary: true,
      cell: (r) => nameOf(branches, r.branch_id),
    },
    /* **No «الترتيب» column** (R76.8) — the order is the sequence of the rows,
       changed by dragging one within a Level. */
  ];

  const actions: RowAction<AdministrativeGroup>[] = [
    { label: t('admin.groups.roster'), onSelect: (r) => setRosterOf(r) },
    /**
     * **R69 — the Subject action is gone from here.**
     *
     * It existed because `مواد المستوى` had no navigation node: its path
     * carried a Level id, so no menu could reach it and unrelated screens grew
     * borrowed row actions instead. It has its own node now, so this screen
     * goes back to answering one question — *how is this Level subdivided, and
     * who is in each group* — and touches no Subject at all (R69.5).
     */
    ...(canWrite
      ? [
          { label: t('common.edit'), onSelect: (r: AdministrativeGroup) => setEditing(r) },
          {
            label: t('common.delete'),
            danger: true,
            onSelect: (r: AdministrativeGroup) => setDeleting(r),
          },
        ]
      : []),
  ];

  async function save(input: {
    name: string;
    level_id: string;
    branch_id: string;
  }): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      if (editing && editing !== 'new') {
        await updateAdministrativeGroup(
          editing.id,
          editing.version,
          // R76.8 — `display_order` is not sent: an edit must not overwrite a
          // position the administrator set by dragging.
          { name: input.name },
          accessToken,
        );
      } else {
        await createAdministrativeGroup(input, accessToken);
      }
      setEditing(null);
      await load();
      setNotice(t(editing === 'new' ? 'common.created' : 'common.saved'));
    } catch (error) {
      // A stale `version` means someone else edited this row (TD-15). Reloading
      // is the only correct response — never a silent overwrite.
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

  /**
   * **The platform's deletion outcomes, not this screen's** (2026-08-27).
   *
   * This screen read `details.reason` and translated `admin.groups.refused_*` —
   * a third vocabulary for a refusal every other reference deletion already
   * expressed as `blocked_by`. When the server was corrected to the shared
   * shape those keys stopped matching, and the screen would have fallen back to
   * *«تعذّر الحفظ»* on a **deletion**. `classifyDeletion` is the one classifier
   * now, so this page gains the named-dependency dialog and the already-gone
   * case it never had.
   */
  async function confirmDelete(): Promise<void> {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteAdministrativeGroup(deleting.id, accessToken);
      setDeleting(null);
      await load();
      setNotice(t('common.deleted'));
    } catch (error) {
      const outcome = classifyDeletion(error);
      if (outcome.kind === 'blocked') {
        // The dialog STAYS OPEN and names what blocks it (rule AZ.1): closing
        // onto a sentence loses the one thing she needs in order to act.
        setBlocked(error);
        setBusy(false);
        return;
      }
      // Everything else closes, and `already-gone` reloads — the row she asked
      // to remove is gone, which is the outcome she wanted.
      setDeleting(null);
      if (outcome.kind === 'already-gone') await load();
      setNotice(deletionNotice(outcome));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminLayout
      title={t('admin.nav.groups')}
      lede={t('admin.groups.lede')}
      // **The page's primary action lives in the layout's slot, not in the
      // table's toolbar.** The toolbar is for narrowing what is listed; creating
      // a record is not a filter, and mixing the two put the same button in two
      // different places depending on which screen you were on.
      actions={
        canWrite ? (
          <Button variant="add" onClick={() => setEditing('new')}>
            {t('admin.groups.create')}
          </Button>
        ) : null
      }
    >
      {/* The shared notice style every other back-office screen uses. This one
          rendered a bare `<p role="status">`, which carried none of the spacing
          or colour the rest of the platform gives a result message. */}
      {notice ? (
        <Feedback>
          {notice}
        </Feedback>
      ) : null}

      <DataTable
        caption={t('admin.groups.caption')}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        status={status}
        actions={actions}
        onRetry={() => void load()}
        sort={sort}
        onSort={(next) => {
          setSort(next);
          setPage(1);
        }}
        {...(canWrite
          ? {
              /* §2.2 scopes `AdministrativeGroup.display_order` to its Level, so
                 a sequence is only meaningful once one Level is selected. A
                 branch filter is orthogonal and does not enable or block it —
                 the server scopes the live set to the caller's branches either
                 way. */
              onReorder:
                levelFilter === ''
                  ? null
                  : async (ids: string[]) =>
                      reorderAdministrativeGroups(levelFilter, ids, accessToken).then(load),
            }
          : {})}
        filtered={levelFilter !== '' || branchFilter !== ''}
        onClearFilters={() => {
          scope.setMany({ levelId: '', branchId: '' });
          setPage(1);
        }}
        toolbar={
          <>
            {/* **The same selectors, in the same components, as every other
                screen.** This toolbar was hand-rolled `<label><select>` pairs in
                a bespoke `.toolbar` div — no label association, no hint or error
                slot, and spacing that matched nothing else (constitution §4.3).
                It is also why the filters were independent: a raw control has
                nowhere for a dependency to live. */}
            <ScopeSelectors scope={scope} fields={GROUP_SCOPE} mode="filter" />
          </>
        }
        pagination={{ page, pageSize: 25, total, onPage: setPage }}
      />

      <GroupDialog
        open={editing !== null}
        group={editing === 'new' ? null : editing}
        levels={labelledLevels}
        branches={branches}
        busy={busy}
        onSave={(input) => void save(input)}
        onCancel={() => setEditing(null)}
      />

      <RosterDialog
        group={rosterOf}
        canWrite={canWrite}
        onClose={() => setRosterOf(null)}
        token={accessToken}
      />

      <ConfirmDialog
        open={deleting !== null}
        {...(blocked
          ? { blocked: <BlockedNotice error={blocked} item={t('admin.groups.thisItem')} /> }
          : {})}
        title={t('admin.groups.deleteTitle')}
        body={t('admin.groups.deleteBody')}
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
 * Create and edit share one dialog, and the difference is which fields it
 * offers: Level and Branch are chosen once and then fixed, because the server
 * rejects changing them rather than dropping them.
 */
function GroupDialog({
  open,
  group,
  levels,
  branches,
  busy,
  onSave,
  onCancel,
}: {
  open: boolean;
  group: AdministrativeGroup | null;
  levels: LevelOption[];
  branches: BranchRef[];
  busy: boolean;
  onSave: (input: {
    name: string;
    level_id: string;
    branch_id: string;
  }) => void;
  onCancel: () => void;
}): ReactNode {
  const [name, setName] = useState('');
  const [levelId, setLevelId] = useState('');
  const [branchId, setBranchId] = useState('');
  useEffect(() => {
    setName(group?.name ?? '');
    setLevelId(group?.level_id ?? '');
    setBranchId(group?.branch_id ?? '');
  }, [group, open]);

  const complete = name.trim() !== '' && levelId !== '' && branchId !== '';

  /** The three fields the reset effect above writes — the same expressions. */
  const dirty = isDirty(
    { name, levelId, branchId },
    {
      name: group?.name ?? '',
      levelId: group?.level_id ?? '',
      branchId: group?.branch_id ?? '',
    },
  );

  return (
    /**
     * **`FormDialog`, not a hand-assembled `Dialog`** — this form was the last
     * one that had not adopted it, and it looked it: raw `<label><select>`
     * pairs instead of `SelectField`, so its labels, hints, required marking
     * and error wiring came from nothing, and a `dialog__actions` row of its
     * own rather than the shared one, so its Save button was not even the
     * emphasised action. Beside `إضافة مستوى` the difference was visible at a
     * glance and none of it was a decision anybody took.
     *
     * `FormDialog` exists precisely to end this drift (see its own doc comment,
     * which records the Events-versus-Sessions divergence that produced it).
     */
    <FormDialog
      open={open}
      title={t(group ? 'admin.groups.editTitle' : 'admin.groups.create')}
      busy={busy}
      disabled={!complete}
      dirty={dirty}
      onCancel={onCancel}
      onSubmit={() =>
        onSave({
          name,
          level_id: levelId,
          branch_id: branchId,
        })
      }
    >
      <TextField label={t('admin.groups.colName')} value={name} onChange={setName} required />

      {/* The shared primitive rather than a bare `<select>`: label association,
          the placeholder option, required marking and error announcement are
          `field.tsx`'s job, not this screen's to remember. */}
      <LevelSelect levels={levels} value={levelId} onChange={setLevelId} />

      <SelectField
        label={t('admin.groups.colBranch')}
        value={branchId}
        onChange={setBranchId}
        disabled={group !== null}
        placeholder={t('common.choose')}
        options={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
        required
      />

      {group ? <p className="muted">{t('admin.groups.fixedAfterCreate')}</p> : null}

      {/* **No «الترتيب» field** (R76.8) — the order is the sequence of the rows
          within the Level, set by dragging. */}
    </FormDialog>
  );
}

/**
 * The roster (§5.6 enrollment screen).
 *
 * ## The picker shows its candidates (2026-08-17)
 *
 * It used to be a **typed-search workflow**: `searchUsers` was called only once
 * two characters had been entered, so the dialog opened with an empty list and
 * no affordance saying why. A reader who did not already know the name they were
 * looking for had no way in at all — which is the platform-wide rule this pass
 * enforced everywhere: **search narrows what is offered; it is never what makes
 * options exist.**
 *
 * It is now the shared `SearchableSelect`, loaded on open.
 *
 * ## Who is offered, and why it is not filtered by role
 *
 * **Every active account, minus those already on this roster.** There is no
 * structural fact distinguishing a مستفيدة from any other account: minors hold
 * no role at all (§4.3), `intended_category_id` is unset on every live row, and
 * a مؤطرة may legitimately be enrolled — one of the association's accounts holds
 * both `teacher` and `student` today. Filtering by role would hide exactly the
 * students who most need enrolling. (Recorded as an open Owner decision — R64.7's
 * structural marker.)
 *
 * ## BR-21 is the interesting refusal, and it stays the server's
 *
 * A student already in another group of the **same Level** is a `409`, because
 * the intended action was almost certainly a move. The client cannot compute
 * that — it would need every group's roster in the Level — so the picker offers
 * the candidate and the message names the refusal, which is what the hint above
 * the control says before it happens.
 */
function RosterDialog({
  group,
  canWrite,
  onClose,
  token,
}: {
  group: AdministrativeGroup | null;
  canWrite: boolean;
  onClose: () => void;
  token: string | null;
}): ReactNode {
  const [entries, setEntries] = useState<RosterEntry[]>([]);
  const [candidates, setCandidates] = useState<UserSummary[]>([]);
  const [picked, setPicked] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!group) return;
    const result = await listRoster(group.id, token);
    setEntries(result.data);
  }, [group, token]);

  useEffect(() => {
    setNotice(null);
    setPicked('');
    void load();
  }, [load]);

  // **Loaded on open, not on keystroke.** One read of the accounts the server
  // lets this caller see; the control filters that list client-side.
  useEffect(() => {
    if (!group || !canWrite) {
      setCandidates([]);
      return;
    }
    void (async () => {
      try {
        setCandidates((await searchUsers(token, {})).data);
      } catch {
        setCandidates([]);
      }
    })();
  }, [group, canWrite, token]);

  /** Already on this roster — excluded, because offering them offers a refusal. */
  const onRoster = new Set(entries.map((e) => e.student_id));
  const offerable = candidates
    .filter((c) => !onRoster.has(c.id))
    .map((c) => ({ value: c.id, label: c.name_arabic }));

  async function enrol(studentId: string): Promise<void> {
    if (!group || studentId === '') return;
    setBusy(true);
    setNotice(null);
    try {
      await enrolStudent(group.id, studentId, token);
      setPicked('');
      await load();
    } catch (error) {
      const reason =
        error instanceof ApiError
          ? (error.details?.['reason'] as string | undefined)
          : undefined;
      setNotice(
        reason === 'ALREADY_ENROLLED_IN_LEVEL'
          ? t('admin.groups.alreadyInLevel')
          : t('common.saveFailed'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={group !== null} onClose={onClose} title={t('admin.groups.rosterTitle')} wide>
      {notice ? (
        <Feedback>
          {notice}
        </Feedback>
      ) : null}

      {canWrite ? (
        <>
          {/* The shared searchable single-select — the same control every large
              picker on the platform uses. It opens with its options present. */}
          <SearchableSelect
            label={t('admin.groups.findStudent')}
            options={offerable}
            value={picked}
            onChange={setPicked}
            hint={t('admin.groups.findStudentHint')}
            emptyLabel={t('admin.groups.noCandidates')}
            disabled={busy}
          />
          <div className="form__actions">
            <Button
              variant="add"
              disabled={picked === '' || busy}
              onClick={() => void enrol(picked)}
            >
              {t('admin.groups.enrol')}
            </Button>
          </div>
        </>
      ) : null}

      <h3>{t('admin.groups.rosterCurrent')}</h3>
      {entries.length === 0 ? (
        <p className="state">{t('admin.groups.rosterEmpty')}</p>
      ) : (
        <ul className="admin-list">
          {entries.map((e) => (
            <li key={e.id}>
              <span>{e.name ?? e.student_id}</span>
              {canWrite ? (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    void (async () => {
                      if (!group) return;
                      await unenrolStudent(group.id, e.student_id, token);
                      await load();
                    })();
                  }}
                >
                  {t('admin.groups.unenrol')}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
