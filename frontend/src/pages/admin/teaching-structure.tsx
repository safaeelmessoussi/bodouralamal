import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { listAdministrativeGroups, type AdministrativeGroup } from '../../adapters/administrative-groups.js';
import { listSubjects, type SubjectRef } from '../../adapters/reference-data.js';
import { listCategories, listLevelSubjects, listLevels, type Category, type Level } from '../../adapters/taxonomy.js';
import {
  addMember,
  createTeachingGroup,
  deleteTeachingGroup,
  listCircles,
  reorderCircles,
  listMembers,
  readSubjectSplit,
  removeMember,
  updateTeachingGroup,
  type CircleMember,
  type SubjectSplit,
  type TeachingGroup,
  type TeachingGroupRow,
  type UnassignedStudent,
} from '../../adapters/teaching-groups.js';
import { AdminLayout } from '../../components/admin/admin-layout.js';
import { SubjectCircles } from '../../components/scope/subject-circles.js';
import { LevelSelect, levelLabel } from '../../components/scope/level-select.js';
import { Button } from '../../components/ui/button.js';
import { ConfirmDialog } from '../../components/ui/confirm-dialog.js';
import { Dialog } from '../../components/ui/dialog.js';
import {
  DataTable,
  type Column,
  type RowAction,
  type TableStatus,
} from '../../components/ui/data-table.js';
import { FormDialog } from '../../components/ui/form-dialog.js';
import { SearchInput, SelectField, TextField } from '../../components/ui/field.js';
import { SearchableSelect } from '../../components/ui/searchable-select.js';
import { useSession } from '../../contexts/session.js';
import type { SortState } from '../../components/ui/data-table.js';
import { useActiveRole } from '../../contexts/active-role.js';
import { isDirty } from '../../lib/form-dirty.js';
import { t } from '../../i18n/index.js';
import { ApiError } from '../../lib/api.js';

/**
 * `/admin/teaching-groups` — **حلقات المواد** (§14.1, §4.4c, BR-22, R43.3, R69).
 *
 * ## Two views, and the reason there are two
 *
 * **The list** answers *what circles exist* — every circle across every Level
 * and Subject the caller may see, in one paginated table, filterable and
 * searchable. **The Level view** answers *how is THIS Level organised* — its
 * groups, its subjects, their circles, and BR-22's unassigned alarm.
 *
 * Neither can be derived from the other, and the shape of the read is why. The
 * pair-addressed collection (`/admin/levels/{l}/subjects/{s}/teaching-groups`)
 * carries the unassigned list, which **must not be paginated**: a page boundary
 * drawn through an alarm about students receiving no teaching would put some of
 * them on page two. The flat collection (`GET /admin/teaching-groups`) *is*
 * paginated, because *"what circles exist"* has no natural bound. So the screen
 * has a list and a detail, each reading the collection shaped for its question.
 *
 * ## The principle both obey
 *
 * **A management page shows the data it manages immediately, and filters narrow
 * visible data rather than being the precondition for it appearing.** This screen
 * has now been rebuilt on that twice: R69 removed two empty dropdowns that gated
 * the whole page, and this pass replaced the accordion that succeeded them —
 * which showed its data but never as a list, so *what circles exist* was still
 * a question you answered by opening Levels one at a time.
 *
 * ## What the row deliberately does not show
 *
 * **No branch**, because a circle has none: it belongs to a Subject and a Level,
 * and a Level spans branches (§4.4b) — that absence is the structural reason
 * R43.3 split authority over circle *structure* from authority over its
 * *membership*. **No مؤطِّرة**, because staffing is a property of a
 * `CourseSchedule` and not of the audience it teaches (§4.4c). §20 rule 22
 * forbids conflating the organisational unit with its delivery, and a branch or
 * a teacher column on a circle is exactly that conflation. The screen says so in
 * words rather than leaving the absence to be read as an oversight.
 *
 * ## Authorization is unchanged and still the server's
 *
 * R43.3: circle **structure** is Super Admin, circle **membership** is Admin and
 * branch-scoped. The controls follow the **active** role (R60), and the server
 * enforces both regardless — this screen renders refusals rather than
 * reimplementing the rules.
 */
interface LevelDetail {
  groups: AdministrativeGroup[];
  subjects: SubjectRef[];
  splits: Record<string, SubjectSplit>;
  state: 'loading' | 'ready' | 'error';
}

export function TeachingStructurePage({
  levelId,
  subjectId,
}: {
  levelId: string | null;
  subjectId: string | null;
}): ReactNode {
  const { accessToken } = useSession();
  const { activeRoles } = useActiveRole();
  // R60 — the ACTIVE role, so a Super Admin working as مؤطِّرة is not offered a
  // control the server will refuse.
  const canManageGroups = activeRoles.includes('super_admin');
  const canPlace = activeRoles.some((r) => r === 'admin' || r === 'super_admin');

  // ── Reference lists, for the filters and the labels ──────────────────────
  const [levels, setLevels] = useState<Level[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [subjects, setSubjects] = useState<SubjectRef[]>([]);

  // ── The list ────────────────────────────────────────────────────────────
  const [rows, setRows] = useState<TeachingGroupRow[]>([]);
  const [status, setStatus] = useState<TableStatus>('loading');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [sort, setSort] = useState<SortState | null>(null);
  const [levelFilter, setLevelFilter] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');

  // ── The Level view, opened by `?level=` (R69.3's deep link) ─────────────
  const [detail, setDetail] = useState<Record<string, LevelDetail>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** The Subject a create/edit dialog is about, so one dialog serves the page. */
  const [editing, setEditing] = useState<
    { levelId: string; subjectId: string; group: TeachingGroup | null } | null
  >(null);
  const [deleting, setDeleting] = useState<{ levelId: string; group: TeachingGroup } | null>(null);
  /** The circle whose roster is open — the row action's target. */
  const [rosterOf, setRosterOf] = useState<TeachingGroupRow | null>(null);

  useEffect(() => {
    void (async () => {
      // Each independently recoverable: a reference list that failed to load
      // must not take the table down with it.
      const [levelList, categoryList, subjectList] = await Promise.all([
        listLevels(accessToken).catch(() => [] as Level[]),
        listCategories(accessToken).catch(() => [] as Category[]),
        listSubjects(accessToken).catch(() => [] as SubjectRef[]),
      ]);
      setLevels(levelList);
      setCategories(categoryList);
      setSubjects(subjectList);
    })();
  }, [accessToken]);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const result = await listCircles(
        accessToken,
        page,
        {
          ...(query.trim() ? { q: query.trim() } : {}),
          ...(categoryFilter ? { category_id: categoryFilter } : {}),
          ...(levelFilter ? { level_id: levelFilter } : {}),
          ...(subjectFilter ? { subject_id: subjectFilter } : {}),
        },
        sort,
      );
      setRows(result.data);
      setTotal(result.meta.total);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [accessToken, page, query, categoryFilter, levelFilter, subjectFilter, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Everything under one Level, fetched only when that Level is opened. */
  const loadLevel = useCallback(
    async (id: string) => {
      setDetail((d) => ({ ...d, [id]: { groups: [], subjects: [], splits: {}, state: 'loading' } }));
      try {
        const [groupPage, levelSubjects] = await Promise.all([
          listAdministrativeGroups(accessToken, 1, { level_id: id }),
          listLevelSubjects(id, accessToken),
        ]);
        // One split per Subject, in parallel — a Level teaches a handful, and
        // serialising them would make opening a Level feel broken.
        const splits: Record<string, SubjectSplit> = {};
        await Promise.all(
          levelSubjects.map(async (s) => {
            try {
              splits[s.id] = await readSubjectSplit(id, s.id, accessToken);
            } catch {
              // One Subject failing must not blank the whole Level.
            }
          }),
        );
        setDetail((d) => ({
          ...d,
          [id]: { groups: groupPage.data, subjects: levelSubjects, splits, state: 'ready' },
        }));
      } catch {
        setDetail((d) => ({ ...d, [id]: { groups: [], subjects: [], splits: {}, state: 'error' } }));
      }
    },
    [accessToken],
  );

  useEffect(() => {
    if (levelId && detail[levelId] === undefined) void loadLevel(levelId);
  }, [levelId, detail, loadLevel]);

  async function save(name: string): Promise<void> {
    if (!editing) return;
    setBusy(true);
    setNotice(null);
    try {
      if (editing.group) {
        await updateTeachingGroup(editing.group.id, editing.group.version, { name }, accessToken);
      } else {
        await createTeachingGroup(editing.levelId, editing.subjectId, { name }, accessToken);
      }
      const level = editing.levelId;
      setEditing(null);
      // Both views may be showing this circle, so both are refreshed. Refreshing
      // only the one in front of the reader is how a list comes to disagree with
      // the detail it was opened from.
      if (detail[level] !== undefined) await loadLevel(level);
      await load();
    } catch (error) {
      const reason = error instanceof ApiError ? error.details['reason'] : undefined;
      setNotice(
        reason === 'SUBJECT_NOT_IN_LEVEL'
          ? t('admin.subjectOrg.notInLevel')
          : t('common.saveFailed'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete(): Promise<void> {
    if (!deleting) return;
    setBusy(true);
    try {
      const result = await deleteTeachingGroup(deleting.group.id, accessToken);
      setNotice(t('admin.subjectOrg.deleted').replace('{n}', String(result.released_students)));
      if (detail[deleting.levelId] !== undefined) await loadLevel(deleting.levelId);
      await load();
    } catch (error) {
      const blocked = error instanceof ApiError && error.status === 409;
      setNotice(t(blocked ? 'admin.subjectOrg.refusedSchedules' : 'common.deleteFailed'));
    } finally {
      setBusy(false);
      setDeleting(null);
    }
  }

  async function place(level: string, groupId: string, studentId: string): Promise<void> {
    setNotice(null);
    try {
      await addMember(groupId, studentId, accessToken);
      await loadLevel(level);
      await load();
    } catch (error) {
      const clash = error instanceof ApiError && error.status === 409;
      setNotice(t(clash ? 'admin.subjectOrg.alreadySplit' : 'common.saveFailed'));
    }
  }

  const openLevel = levelId ? (levels.find((l) => l.id === levelId) ?? null) : null;

  const columns: Column<TeachingGroupRow>[] = [
    {
      key: 'name',
      header: t('admin.subjectOrg.colCircle'),
      sortKey: 'name',
      cell: (r) => r.name,
    },
    {
      key: 'level',
      header: t('admin.subjectOrg.colLevel'),
      sortKey: 'level',
      // The shared label, from the parts the server sent separately — the format
      // lives in one place and the server does not pre-join it.
      cell: (r) => levelLabel({ id: r.level_id, name: r.level_name, category_name: r.category_name }),
    },
    {
      key: 'subject',
      header: t('admin.subjectOrg.colSubject'),
      sortKey: 'subject',
      cell: (r) => r.subject_name,
    },
    {
      key: 'members',
      header: t('admin.subjectOrg.colMembers'),
      numeric: true,
      cell: (r) => r.member_count,
    },
  ];

  const actions: RowAction<TeachingGroupRow>[] = [
    {
      /**
       * **«المستفيدات» replaced «تفاصيل المستوى»** (Owner decision, 2026-08-17).
       *
       * The row is a **circle**, and its roster is what an administrator comes to
       * this table to manage — the same act `مستفيدات المجموعة` performs for an
       * Administrative Group. The old action navigated to the Level's whole
       * breakdown, which is a different question and one the reader had not asked;
       * that view is still reachable through `?level=`, which the Subject column's
       * own context and R69.3's deep links preserve.
       *
       * **The two relationships stay independent.** This dialog places a student
       * into a circle by `(student, circle)` — the circle already carries its
       * `(Subject, Level)` — and reads *nothing* about her Administrative Group.
       * §4.4c: *"nothing aligns them and nothing should try to."*
       */
      label: t('admin.subjectOrg.membersAction'),
      onSelect: (r) => setRosterOf(r),
    },
    ...(canManageGroups
      ? [
          {
            label: t('common.edit'),
            onSelect: (r: TeachingGroupRow) =>
              setEditing({ levelId: r.level_id, subjectId: r.subject_id, group: rowAsGroup(r) }),
          },
          {
            label: t('common.delete'),
            danger: true,
            onSelect: (r: TeachingGroupRow) =>
              setDeleting({ levelId: r.level_id, group: rowAsGroup(r) }),
          },
        ]
      : []),
  ];

  return (
    <AdminLayout
      title={t('admin.nav.teachingGroups')}
      lede={t('admin.subjectOrg.overviewLede')}
      actions={
        openLevel ? (
          <Button
            variant="secondary"
            onClick={() => (window.location.href = '/admin/teaching-groups')}
          >
            {t('admin.subjectOrg.backToCircles')}
          </Button>
        ) : canManageGroups ? (
          // **The page's primary action, at the top, where every other
          // management screen keeps it.** It used to exist only inside each
          // Subject block, so a reader who had opened no Level was offered no
          // way to add a circle at all. A circle needs a `(Level, Subject)`
          // pair, which is what the dialog asks for.
          <Button variant="add" onClick={() => setEditing({ levelId: '', subjectId: '', group: null })}>
            {t('admin.subjectOrg.create')}
          </Button>
        ) : null
      }
    >
      {notice ? (
        <p className="admin-notice" role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}

      {openLevel ? (
        <LevelView
          level={openLevel}
          info={detail[openLevel.id]}
          subjectId={subjectId}
          canManageGroups={canManageGroups}
          canPlace={canPlace}
          onCreate={(sid) => setEditing({ levelId: openLevel.id, subjectId: sid, group: null })}
          onEdit={(sid, group) => setEditing({ levelId: openLevel.id, subjectId: sid, group })}
          onDelete={(group) => setDeleting({ levelId: openLevel.id, group })}
          onPlace={(groupId, studentId) => void place(openLevel.id, groupId, studentId)}
        />
      ) : (
        <>
          <DataTable
            caption={t('admin.subjectOrg.caption')}
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
            {...(canManageGroups
              ? {
                  /**
                   * **R78.1 — circles order within their `(Level, Subject)`
                   * pairing** (§2.2), so the sequence is meaningful only once
                   * BOTH are chosen. `null` keeps the handle visible and
                   * disabled with an explanation rather than hiding a
                   * capability that exists.
                   */
                  onReorder:
                    levelFilter === '' || subjectFilter === ''
                      ? null
                      : async (ids: string[]) =>
                          reorderCircles(
                            { levelId: levelFilter, subjectId: subjectFilter },
                            ids,
                            accessToken,
                          ).then(load),
                }
              : {})}
            filtered={
              query.trim() !== '' ||
              categoryFilter !== '' ||
              levelFilter !== '' ||
              subjectFilter !== ''
            }
            onClearFilters={() => {
              setQuery('');
              setCategoryFilter('');
              setLevelFilter('');
              setSubjectFilter('');
              setPage(1);
            }}
            toolbar={
              <>
                <SearchInput
                  value={query}
                  onChange={(v) => {
                    setQuery(v);
                    setPage(1);
                  }}
                  placeholder={t('admin.subjectOrg.searchPlaceholder')}
                />
                <SelectField
                  label={t('admin.subjectOrg.filterCategory')}
                  value={categoryFilter}
                  onChange={(v) => {
                    setCategoryFilter(v);
                    setPage(1);
                  }}
                  placeholder={t('admin.subjectOrg.allCategories')}
                  options={categories.map((c) => ({ value: c.id, label: c.name }))}
                />
                {/* The shared Level selector, so a Level reads
                    `{Category} — {Level}` here as everywhere (§4.4b). */}
                <LevelSelect
                  levels={levels}
                  value={levelFilter}
                  onChange={(v) => {
                    setLevelFilter(v);
                    setPage(1);
                  }}
                  label={t('admin.subjectOrg.filterLevel')}
                  placeholder={t('admin.subjectOrg.allLevels')}
                />
                <SelectField
                  label={t('admin.subjectOrg.filterSubject')}
                  value={subjectFilter}
                  onChange={(v) => {
                    setSubjectFilter(v);
                    setPage(1);
                  }}
                  placeholder={t('admin.subjectOrg.allSubjects')}
                  options={subjects.map((s) => ({ value: s.id, label: s.name }))}
                />
              </>
            }
            pagination={{ page, pageSize: 25, total, onPage: setPage }}
          />
          {/* Two absent columns, explained where the reader would look for them.
              An unexplained absence reads as an oversight; a stated one is the
              model. */}
          <p className="field__hint">{t('admin.subjectOrg.columnsNote')}</p>
        </>
      )}

      <CircleDialog
        open={editing !== null}
        group={editing?.group ?? null}
        levelId={editing?.levelId ?? ''}
        subjectId={editing?.subjectId ?? ''}
        levels={levels}
        token={accessToken}
        notice={editing === null ? null : notice}
        busy={busy}
        onPair={(l, s) => setEditing((e) => (e ? { ...e, levelId: l, subjectId: s } : e))}
        onSave={(name) => void save(name)}
        onCancel={() => setEditing(null)}
      />

      <CircleRosterDialog
        circle={rosterOf}
        canPlace={canPlace}
        token={accessToken}
        onClose={() => setRosterOf(null)}
        onChanged={() => void load()}
      />

      <ConfirmDialog
        open={deleting !== null}
        title={t('admin.subjectOrg.deleteTitle')}
        body={t('admin.subjectOrg.deleteBody')}
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
 * A table row projected back into the shape the write endpoints take.
 *
 * `TeachingGroupRow` extends `TeachingGroup`, so this is a narrowing rather than
 * a conversion — written as a named function anyway, because passing the wider
 * row straight into an editor would let a future field travel somewhere it was
 * never meant to.
 */
function rowAsGroup(row: TeachingGroupRow): TeachingGroup {
  return {
    id: row.id,
    name: row.name,
    level_id: row.level_id,
    subject_id: row.subject_id,
    display_order: row.display_order,
    member_count: row.member_count,
    version: row.version,
  };
}

/**
 * One Level's organisation — its groups, its subjects, their circles, BR-22.
 *
 * **Groups are read-only here on purpose.** R69.5 gave each screen one
 * responsibility, and making a Group editable in two places is exactly what R69
 * spent a revision undoing. They are shown because *"is this Level subdivided"*
 * is context you need while reading its circles — not because this screen owns
 * them. The link to `مجموعات المستويات` is a **cross-hierarchy hand-off**, not a
 * duplicate access path: this block cannot act on a group, and names the screen
 * that can.
 */
function LevelView({
  level,
  info,
  subjectId,
  canManageGroups,
  canPlace,
  onCreate,
  onEdit,
  onDelete,
  onPlace,
}: {
  level: Level;
  info: LevelDetail | undefined;
  subjectId: string | null;
  canManageGroups: boolean;
  canPlace: boolean;
  onCreate: (subjectId: string) => void;
  onEdit: (subjectId: string, group: TeachingGroup) => void;
  onDelete: (group: TeachingGroup) => void;
  onPlace: (groupId: string, studentId: string) => void;
}): ReactNode {
  if (info === undefined || info.state === 'loading') {
    return <p className="state">{t('common.loading')}</p>;
  }
  if (info.state === 'error') {
    return (
      <p className="state" role="alert">
        {t('common.loadFailed')}
      </p>
    );
  }

  return (
    <section className="tree__level">
      <h2>{levelLabel(level)}</h2>

      <h3>{t('admin.nav.groups')}</h3>
      {info.groups.length === 0 ? (
        // R66 — an unsubdivided Level is ordinary, not a gap.
        <p className="state">{t('admin.subjectOrg.noGroups')}</p>
      ) : (
        <ul className="admin-list">
          {info.groups.map((g) => (
            <li key={g.id}>
              <span>{g.name}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="field__hint">
        {t('admin.subjectOrg.groupsElsewhere')}{' '}
        <a href={`/admin/groups?level=${level.id}`}>{t('admin.nav.groups')}</a>
      </p>

      <h3>{t('admin.nav.subjects')}</h3>
      {info.subjects.length === 0 ? (
        <p className="state">
          {t('admin.levelSubjects.empty')}{' '}
          <a href={`/admin/level-subjects?level=${level.id}`}>{t('admin.nav.levelSubjects')}</a>
        </p>
      ) : (
        info.subjects.map((subject) => (
          <section
            key={subject.id}
            className="tree__subject"
            // `?subject=` scrolls here rather than gating the page.
            id={`subject-${subject.id}`}
            aria-current={subject.id === subjectId ? 'true' : undefined}
          >
            <h4>{subject.name}</h4>
            {info.splits[subject.id] ? (
              <SubjectCircles
                split={info.splits[subject.id]!}
                canManageGroups={canManageGroups}
                canPlace={canPlace}
                onCreate={() => onCreate(subject.id)}
                onEdit={(group) => onEdit(subject.id, group)}
                onDelete={onDelete}
                onPlace={onPlace}
              />
            ) : (
              <p className="state" role="alert">
                {t('common.loadFailed')}
              </p>
            )}
          </section>
        ))
      )}
    </section>
  );
}

/**
 * Creating or renaming a circle.
 *
 * **The `(Level, Subject)` pair is asked for when it is not already known.**
 * Opened from a Subject block it is; opened from the page's own add button it is
 * not, and a create dialog that assumed it would have been a dialog that could
 * only be reached from inside a Level — which is the very limitation the flat
 * table removed.
 *
 * **The Subject list is the LEVEL's**, read through `listLevelSubjects`, not the
 * global Subject list. A Subject a Level does not teach is a pair the server
 * refuses with `SUBJECT_NOT_IN_LEVEL`, and offering it would be offering a
 * refusal — the same defect fixed once already on this screen.
 */
function CircleDialog({
  open,
  group,
  levelId,
  subjectId,
  levels,
  token,
  notice,
  busy,
  onPair,
  onSave,
  onCancel,
}: {
  open: boolean;
  group: TeachingGroup | null;
  levelId: string;
  subjectId: string;
  levels: Level[];
  token: string | null;
  notice: string | null;
  busy: boolean;
  onPair: (levelId: string, subjectId: string) => void;
  onSave: (name: string) => void;
  onCancel: () => void;
}): ReactNode {
  const [name, setName] = useState('');
  const [levelSubjects, setLevelSubjects] = useState<SubjectRef[]>([]);

  useEffect(() => {
    setName(group?.name ?? '');
  }, [group, open]);

  useEffect(() => {
    if (!open || levelId === '') {
      setLevelSubjects([]);
      return;
    }
    void (async () => {
      try {
        setLevelSubjects(await listLevelSubjects(levelId, token));
      } catch {
        setLevelSubjects([]);
      }
    })();
  }, [open, levelId, token]);

  // Renaming needs only a name; creating needs the pair as well.
  const needsPair = group === null;
  const complete = name.trim() !== '' && (!needsPair || (levelId !== '' && subjectId !== ''));

  // Creating opens with everything blank, so any answer is a change; editing
  // opens with the circle's own name.
  const dirty = isDirty(
    { name, levelId, subjectId },
    { name: group?.name ?? '', levelId: group ? levelId : '', subjectId: group ? subjectId : '' },
  );

  return (
    <FormDialog
      open={open}
      title={t(group ? 'admin.subjectOrg.editTitle' : 'admin.subjectOrg.create')}
      notice={notice}
      busy={busy}
      disabled={!complete}
      dirty={dirty}
      onSubmit={() => onSave(name)}
      onCancel={onCancel}
    >
      {needsPair ? (
        <>
          <LevelSelect
            levels={levels}
            value={levelId}
            // Changing the Level clears the Subject: a stale id left in state is
            // precisely what reaches the server as an impossible pair.
            onChange={(next) => onPair(next, '')}
          />
          <SelectField
            label={t('admin.nav.subjects')}
            value={subjectId}
            onChange={(next) => onPair(levelId, next)}
            placeholder={
              levelId === ''
                ? t('admin.subjectOrg.circlesPickLevelFirst')
                : levelSubjects.length === 0
                  ? t('admin.subjectOrg.noSubjects')
                  : t('common.choose')
            }
            disabled={levelId === '' || levelSubjects.length === 0}
            options={levelSubjects.map((s) => ({ value: s.id, label: s.name }))}
          />
        </>
      ) : null}
      <TextField label={t('admin.groups.colName')} value={name} onChange={setName} required />
    </FormDialog>
  );
}

/**
 * **Who is in one circle, and who could be** — the circle's roster.
 *
 * The counterpart of `مستفيدات المجموعة` for the *other*, independent placement.
 * Same shape deliberately: a searchable picker of eligible students above, the
 * current members below, one add and one remove.
 *
 * ## The two relationships are not coupled, and this is where that is easiest to
 * get wrong
 *
 * A circle is `(Subject, Level)` and an Administrative Group subdivides a Level;
 * **neither determines the other** (§4.4c, §20 rule 22). So the candidates come
 * from `readSubjectSplit`'s **`unassigned`** list — *enrolled in this Level, with
 * no seat in this Subject* — which is BR-22's own list and says nothing whatever
 * about anybody's group. A student in Administrative Group 1 and a student in no
 * group at all are equally offerable, which is the property R66's bug class was
 * about.
 *
 * ## Why `unassigned` is the right source
 *
 * The server refuses a second seat in the same Subject with a `409`, so a student
 * who already has one would be an option that can only fail. `unassigned` is
 * exactly the complement, computed by the service that owns the rule — the client
 * does not re-derive it, and cannot drift from it.
 *
 * **Options are shown on open and the search narrows them** — the platform's rule
 * for every picker; a typed-search workflow offers nothing to a reader who does
 * not already know the name.
 *
 * ## Authorization
 *
 * R43.3 — membership is Admin and above, scoped by the branch the **student** is
 * enrolled at. The controls follow the **active** role (R60) and the server
 * enforces it regardless; a refusal is rendered rather than pre-empted.
 */
function CircleRosterDialog({
  circle,
  canPlace,
  token,
  onClose,
  onChanged,
}: {
  circle: TeachingGroupRow | null;
  canPlace: boolean;
  token: string | null;
  onClose: () => void;
  /** The table shows `member_count`, so it is refreshed when this changes it. */
  onChanged: () => void;
}): ReactNode {
  const [members, setMembers] = useState<CircleMember[]>([]);
  const [candidates, setCandidates] = useState<UnassignedStudent[]>([]);
  const [picked, setPicked] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!circle) return;
    // The roster and the candidate list together: the dialog's question is *who
    // is in, and who could be*, and half an answer reads as a failed load.
    const [roster, split] = await Promise.all([
      listMembers(circle.id, token).catch(() => [] as CircleMember[]),
      readSubjectSplit(circle.level_id, circle.subject_id, token).catch(() => null),
    ]);
    setMembers(roster);
    setCandidates(split?.unassigned ?? []);
  }, [circle, token]);

  useEffect(() => {
    setNotice(null);
    setPicked('');
    void load();
  }, [load]);

  async function place(): Promise<void> {
    if (!circle || picked === '') return;
    setBusy(true);
    setNotice(null);
    try {
      await addMember(circle.id, picked, token);
      setPicked('');
      setNotice(t('admin.subjectOrg.memberAdded'));
      await load();
      onChanged();
    } catch (error) {
      const clash = error instanceof ApiError && error.status === 409;
      setNotice(t(clash ? 'admin.subjectOrg.alreadySplit' : 'common.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function release(studentId: string): Promise<void> {
    if (!circle) return;
    setBusy(true);
    setNotice(null);
    try {
      await removeMember(circle.id, studentId, token);
      setNotice(t('admin.subjectOrg.memberRemoved'));
      await load();
      onChanged();
    } catch {
      setNotice(t('common.deleteFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={circle !== null}
      onClose={onClose}
      title={t('admin.subjectOrg.membersTitle')}
      wide
    >
      {circle ? (
        <p className="lede">
          {circle.subject_name} — {circle.name}
          {' · '}
          {levelLabel({
            id: circle.level_id,
            name: circle.level_name,
            category_name: circle.category_name,
          })}
        </p>
      ) : null}

      {notice ? (
        <p className="admin-notice" role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}

      {canPlace ? (
        <>
          {/* The shared searchable single-select — the same control every large
              picker on the platform uses, opening with its options present. */}
          <SearchableSelect
            label={t('admin.subjectOrg.addMember')}
            options={candidates.map((c) => ({
              value: c.student_id,
              label: c.name ?? c.student_id,
            }))}
            value={picked}
            onChange={setPicked}
            hint={t('admin.subjectOrg.addMemberHint')}
            emptyLabel={t('admin.subjectOrg.noCandidates')}
            disabled={busy}
          />
          <div className="form__actions">
            <Button variant="add" disabled={picked === '' || busy} onClick={() => void place()}>
              {t('admin.groups.enrol')}
            </Button>
          </div>
        </>
      ) : null}

      <h3>{t('admin.subjectOrg.membersCurrent')}</h3>
      {members.length === 0 ? (
        <p className="state">{t('admin.subjectOrg.membersEmpty')}</p>
      ) : (
        <ul className="admin-list">
          {members.map((m) => (
            <li key={m.student_id}>
              <span>{m.name ?? m.student_id}</span>
              {canPlace ? (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void release(m.student_id)}
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
