import { useCallback, useEffect, useState, type ReactNode } from 'react';

import {
  createAdministrativeGroup,
  deleteAdministrativeGroup,
  enrolStudent,
  listAdministrativeGroups,
  listRoster,
  unenrolStudent,
  updateAdministrativeGroup,
  type AdministrativeGroup,
  type RosterEntry,
} from '../../adapters/administrative-groups.js';
import { fetchCalendarBootstrap, type BranchRef, type LevelRef } from '../../adapters/calendar.js';
import { searchUsers, type UserSummary } from '../../adapters/users.js';
import { AdminLayout } from '../../components/admin/admin-layout.js';
import { Button } from '../../components/ui/button.js';
import { ConfirmDialog } from '../../components/ui/confirm-dialog.js';
import {
  DataTable,
  type Column,
  type RowAction,
  type TableStatus,
} from '../../components/ui/data-table.js';
import { Dialog } from '../../components/ui/dialog.js';
import { FormDialog } from '../../components/ui/form-dialog.js';
import { NumberField, SearchInput, SelectField, TextField } from '../../components/ui/field.js';
import { useSession } from '../../contexts/session.js';
import { useActiveRole } from '../../contexts/active-role.js';
import { t } from '../../i18n/index.js';
import { ScopeSelectors } from '../../components/scope/scope-selectors.js';
import { useScopeOptions } from '../../hooks/use-scope-options.js';
import { ApiError } from '../../lib/api.js';

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
  const [branches, setBranches] = useState<BranchRef[]>([]);
  /** One graph, shared with the schedules and content screens. */
  const scope = useScopeOptions({ token: accessToken, fields: GROUP_SCOPE });
  const levelFilter = scope.value.levelId;
  const branchFilter = scope.value.branchId;
  const [editing, setEditing] = useState<AdministrativeGroup | 'new' | null>(null);
  const [deleting, setDeleting] = useState<AdministrativeGroup | null>(null);
  const [rosterOf, setRosterOf] = useState<AdministrativeGroup | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const result = await listAdministrativeGroups(accessToken, page, {
        ...(levelFilter ? { level_id: levelFilter } : {}),
        ...(branchFilter ? { branch_id: branchFilter } : {}),
      });
      setRows(result.data);
      setTotal(result.meta.total);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [accessToken, page, levelFilter, branchFilter]);

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
        setBranches(bootstrap.branches);
      } catch {
        // The pickers stay empty and the page still lists groups. A reference
        // list that failed to load must not take the screen down with it.
      }
    })();
  }, []);

  const nameOf = (list: { id: string; name: string }[], id: string): string =>
    list.find((x) => x.id === id)?.name ?? id;

  const columns: Column<AdministrativeGroup>[] = [
    { key: 'name', header: t('admin.groups.colName'), cell: (r) => r.name },
    {
      key: 'level',
      header: t('admin.groups.colLevel'),
      cell: (r) => nameOf(levels, r.level_id),
    },
    {
      key: 'branch',
      header: t('admin.groups.colBranch'),
      secondary: true,
      cell: (r) => nameOf(branches, r.branch_id),
    },
    {
      key: 'order',
      header: t('admin.groups.colOrder'),
      numeric: true,
      secondary: true,
      cell: (r) => (r.display_order ?? '—') as ReactNode,
    },
  ];

  const actions: RowAction<AdministrativeGroup>[] = [
    { label: t('admin.groups.roster'), onSelect: (r) => setRosterOf(r) },
    {
      /**
       * **The destination is right; the LABEL was wrong.**
       *
       * It borrowed the *next* screen's title, `admin.subjectOrg.title`, and
       * promised «حلقات مادة» while navigating to «مواد المستوى». Two ids are
       * needed to reach a Subject's circles — `TeachingGroup` is scoped to
       * `(subject_id, level_id)` — and a group names only the Level, so the
       * Subject list is not a detour on the way there: **it is the step where
       * the second id is chosen.** The label now says what the click does.
       *
       * It had also started rendering a literal `{subject}` placeholder, since
       * that title gained an interpolation earlier today — a borrowed string is
       * a string that changes underneath you.
       *
       * `admin.levels.manageSubjects` is reused rather than a second key added:
       * the Levels table's row action goes to the same screen, and two names
       * for one destination is how a hierarchy stops being obvious.
       */
      label: t('admin.levels.manageSubjects'),
      onSelect: (r) => {
        window.location.href = `/admin/levels/${r.level_id}/subjects`;
      },
    },
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
    display_order: number | null;
  }): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      if (editing && editing !== 'new') {
        await updateAdministrativeGroup(
          editing.id,
          editing.version,
          { name: input.name, display_order: input.display_order },
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

  async function confirmDelete(): Promise<void> {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteAdministrativeGroup(deleting.id, accessToken);
      setDeleting(null);
      await load();
      setNotice(t('common.deleted'));
    } catch (error) {
      // The three refusals are the interesting outcome, not a generic failure:
      // enrolments exist, a schedule targets the group, or it is the last group
      // in its Level (§4.4b). The server names which in `details.reason`.
      const reason =
        error instanceof ApiError
          ? (error.details?.['reason'] as string | undefined)
          : undefined;
      setNotice(reason ? t(`admin.groups.refused_${reason}`) : t('common.saveFailed'));
      setDeleting(null);
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
          <Button variant="primary" onClick={() => setEditing('new')}>
            {t('admin.groups.create')}
          </Button>
        ) : null
      }
    >
      {/* The shared notice style every other back-office screen uses. This one
          rendered a bare `<p role="status">`, which carried none of the spacing
          or colour the rest of the platform gives a result message. */}
      {notice ? (
        <p className="admin-notice" role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}

      <DataTable
        caption={t('admin.groups.caption')}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        status={status}
        actions={actions}
        onRetry={() => void load()}
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
        levels={levels}
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
        title={t('admin.groups.deleteTitle')}
        body={t('admin.groups.deleteBody')}
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
  levels: LevelRef[];
  branches: BranchRef[];
  busy: boolean;
  onSave: (input: {
    name: string;
    level_id: string;
    branch_id: string;
    display_order: number | null;
  }) => void;
  onCancel: () => void;
}): ReactNode {
  const [name, setName] = useState('');
  const [levelId, setLevelId] = useState('');
  const [branchId, setBranchId] = useState('');
  // Held as a string like every other NumberField on the platform: '' and 0
  // are different answers, and a numeric state collapses them.
  const [order, setOrder] = useState('');

  useEffect(() => {
    setName(group?.name ?? '');
    setLevelId(group?.level_id ?? '');
    setBranchId(group?.branch_id ?? '');
    setOrder(
      group?.display_order !== null && group?.display_order !== undefined
        ? String(group.display_order)
        : '',
    );
  }, [group, open]);

  const complete = name.trim() !== '' && levelId !== '' && branchId !== '';

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
      onCancel={onCancel}
      onSubmit={() =>
        onSave({
          name,
          level_id: levelId,
          branch_id: branchId,
          display_order: order.trim() === '' ? null : Number(order),
        })
      }
    >
      <TextField label={t('admin.groups.colName')} value={name} onChange={setName} required />

      {/* The shared primitive rather than a bare `<select>`: label association,
          the placeholder option, required marking and error announcement are
          `field.tsx`'s job, not this screen's to remember. */}
      <SelectField
        label={t('admin.groups.colLevel')}
        value={levelId}
        onChange={setLevelId}
        disabled={group !== null}
        placeholder={t('common.choose')}
        options={levels.map((level) => ({ value: level.id, label: level.name }))}
        required
      />

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

      <NumberField label={t('admin.groups.colOrder')} value={order} onChange={setOrder} />
    </FormDialog>
  );
}

/**
 * The roster (§5.6 enrollment screen).
 *
 * **BR-21 is the interesting refusal**: a student already in another group of
 * the same Level is a `409` naming that group, because the intended action was
 * almost certainly a move. The message says so rather than reporting a generic
 * failure.
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
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<UserSummary[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!group) return;
    const result = await listRoster(group.id, token);
    setEntries(result.data);
  }, [group, token]);

  useEffect(() => {
    setNotice(null);
    setQuery('');
    setCandidates([]);
    void load();
  }, [load]);

  async function search(value: string): Promise<void> {
    setQuery(value);
    if (value.trim().length < 2) {
      setCandidates([]);
      return;
    }
    const result = await searchUsers(token, { q: value.trim() });
    setCandidates(result.data);
  }

  async function enrol(studentId: string): Promise<void> {
    if (!group) return;
    setNotice(null);
    try {
      await enrolStudent(group.id, studentId, token);
      setQuery('');
      setCandidates([]);
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
    }
  }

  return (
    <Dialog open={group !== null} onClose={onClose} title={t('admin.groups.rosterTitle')} wide>
      {notice ? <p role="status">{notice}</p> : null}

      {canWrite ? (
        <>
          <SearchInput
            label={t('admin.groups.findStudent')}
            value={query}
            onChange={(v) => void search(v)}
          />
          <ul>
            {candidates.map((c) => (
              <li key={c.id}>
                {c.name_arabic}{' '}
                <Button variant="secondary" onClick={() => void enrol(c.id)}>
                  {t('admin.groups.enrol')}
                </Button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {entries.length === 0 ? (
        <p>{t('admin.groups.rosterEmpty')}</p>
      ) : (
        <ul>
          {entries.map((e) => (
            <li key={e.id}>
              {e.name ?? e.student_id}
              {canWrite ? (
                <Button
                  variant="secondary"
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
