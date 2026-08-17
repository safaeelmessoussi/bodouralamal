import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { listSubjects, type SubjectRef } from '../../adapters/reference-data.js';
import {
  assignSubject,
  listCategories,
  listLevelSubjects,
  listLevels,
  unassignSubject,
  type Category,
  type Level,
} from '../../adapters/taxonomy.js';
import { AdminLayout } from '../../components/admin/admin-layout.js';
import { levelLabel } from '../../components/scope/level-select.js';
import {
  DataTable,
  type Column,
  type RowAction,
  type TableStatus,
} from '../../components/ui/data-table.js';
import { SearchInput, SelectField } from '../../components/ui/field.js';
import { FormDialog } from '../../components/ui/form-dialog.js';
import { MultiSelectField } from '../../components/ui/multi-select.js';
import { useSession } from '../../contexts/session.js';
import { useActiveRole } from '../../contexts/active-role.js';
import { isDirty } from '../../lib/form-dirty.js';
import { t } from '../../i18n/index.js';
import { ApiError } from '../../lib/api.js';

/**
 * `/admin/level-subjects` — **مواد المستوى** (§4.4b, TD-3 extension 2026-08-05;
 * R69 gave it this node).
 *
 * ## The gate is gone (2026-08-17)
 *
 * R69 gave this screen a menu node and, because a menu entry cannot carry an id,
 * had it ask for a Level in the page — so it opened as a dropdown over
 * *"choose a level to see the subjects taught in it"* with nothing beneath. That
 * was a reasonable step and it is the wrong end state: it is the same shape
 * `نقاط الامتحانات` and `حلقات المواد` were both rebuilt out of, and the reason
 * is the same each time. **A management page shows the data it manages
 * immediately; filters narrow it.**
 *
 * Every accessible Level is now listed **with the Subjects it teaches already
 * visible**, so *"which Levels teach nothing"* — the question that made
 * `SUBJECT_NOT_IN_LEVEL` mysterious — is answered by reading the page. `?level=`
 * still opens one Level's editor and remains R69's deep link.
 *
 * ## What this screen is for, and what it deliberately is not
 *
 * **This screen is the fix for `SUBJECT_NOT_IN_LEVEL`.** The platform shipped
 * with zero `LevelSubject` rows and nothing that could create one, so every
 * attempt to create a Teaching Group was refused.
 *
 * **A Subject with no Teaching Groups is taught to the whole Level.** Assigning
 * it here is what makes it *taught*; splitting it into circles is a separate,
 * optional decision taken on `حلقات المواد`. Those are different questions and
 * the screens keep them apart (R69.5).
 *
 * **Removal is refused while Teaching Groups exist** for the pair, and the
 * refusal is reported as what it is: those circles split a Subject the Level
 * would no longer teach, leaving their members holding seats in a subject that is
 * not offered.
 *
 * Assignment is Super Admin (R43.3 — curriculum structure); an Admin reads the
 * list and may still open `حلقات المواد`, where placing students is their job.
 * The server enforces both.
 */
interface Row {
  level: Level;
  subjects: SubjectRef[];
}

export function LevelSubjectsPage({ levelId }: { levelId: string | null }): ReactNode {
  const { accessToken } = useSession();
  const { activeRoles } = useActiveRole();
  // R60 — the ACTIVE role. A Super Admin working as مؤطِّرة must not be offered a
  // control the server will refuse: the affordance follows the authority.
  const canWrite = activeRoles.includes('super_admin');

  const [rows, setRows] = useState<Row[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [all, setAll] = useState<SubjectRef[]>([]);
  const [status, setStatus] = useState<TableStatus>('loading');
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [editing, setEditing] = useState<Row | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const [levels, every, categoryList] = await Promise.all([
        listLevels(accessToken),
        listSubjects(accessToken),
        listCategories(accessToken).catch(() => [] as Category[]),
      ]);
      // One `LevelSubject` read per Level, in parallel — a small join each, and
      // the whole point is that the answer is on the page rather than one
      // dropdown selection away.
      const withSubjects = await Promise.all(
        levels.map(async (level) => ({
          level,
          subjects: await listLevelSubjects(level.id, accessToken).catch(() => [] as SubjectRef[]),
        })),
      );
      setRows(withSubjects);
      setAll(every);
      setCategories(categoryList);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * **`?level=` opens that Level's editor** — focus, never a gate: the table is
   * rendered either way, and arriving without the parameter shows every Level.
   *
   * R69 introduced this parameter because a menu entry cannot carry an id. It now
   * lands where the row action lands, so the deep link and the click mean the same
   * thing instead of one of them opening a view the other does not.
   */
  useEffect(() => {
    if (!levelId || !canWrite) return;
    const row = rows.find((r) => r.level.id === levelId);
    if (row) setEditing(row);
  }, [levelId, canWrite, rows]);

  /** Client-side narrowing of a list already loaded in full. */
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (categoryFilter === '' || r.level.category_id === categoryFilter) &&
        (needle === '' ||
          levelLabel(r.level).toLowerCase().includes(needle) ||
          r.subjects.some((s) => s.name.toLowerCase().includes(needle))),
    );
  }, [rows, query, categoryFilter]);

  const columns: Column<Row>[] = [
    { key: 'level', header: t('admin.levelSubjects.colLevel'), cell: (r) => levelLabel(r.level) },
    {
      key: 'subjects',
      header: t('admin.levelSubjects.colSubjects'),
      cell: (r) =>
        r.subjects.length === 0 ? (
          // Not an error — a named state. A Level that teaches nothing cannot
          // have a circle or a schedule, and saying so on this row is what stops
          // it being discovered as a refusal three screens later.
          <span className="muted">{t('admin.levelSubjects.noneYet')}</span>
        ) : (
          r.subjects.map((s) => s.name).join(' · ')
        ),
    },
    /* **No «العدد» column** (Owner decision, 2026-08-17). The cell beside it
       already NAMES every item, so a count of the same list is the same fact
       twice — and the shorter of the two is the one a reader has to translate
       back into the answer they wanted. Removed rather than replaced: a
       different count would be the same redundancy under another heading. */
  ];

  /**
   * **«تعديل المواد» opens a dialog, not a second view** (Owner decision,
   * 2026-08-17).
   *
   * It used to navigate to an in-page editor built from an inline
   * `<section className="form">` — a `SelectField`, an add button, and a `<ul>`
   * with a remove button per row. Functionally fine and **architecturally the
   * odd one out**: every other edit on the platform is a `FormDialog`, so this
   * one screen taught a different interaction for the same act, and its spacing,
   * its buttons and its validation came from nothing shared.
   *
   * It is now the same `FormDialog` + `MultiSelectField` shape `مقرر الحفظ` uses
   * for exactly the same concept — *assign a set of reference items to a Level* —
   * which is the atomic answer: one concept, one component, and a future change
   * to either reaches both.
   */
  const actions: RowAction<Row>[] = canWrite
    ? [{ label: t('admin.levelSubjects.manage'), onSelect: (r: Row) => setEditing(r) }]
    : [];

  return (
    <AdminLayout
      // **The title stays the page's own**, whichever Level is open — the same
      // rule `نقاط الامتحانات` follows. The Level is named in the block below,
      // once. It used to replace the heading, so a reader who arrived from the
      // menu found a title that did not match the item they had clicked.
      //
      // **And no breadcrumb.** The removed trail read `المستويات › مواد مستوى X`.
      // `المستويات` is a sibling node in the menu, not this page's parent, so the
      // crumb was a second access path to a screen one click away.
      title={t('admin.nav.levelSubjects')}
      lede={t('admin.levelSubjects.lede')}
      /**
       * **No primary action.** This page pairs existing Levels with existing
       * Subjects; it creates neither. Levels are created on `المستويات` and
       * Subjects on `المواد`, so a create control here would have to invent one
       * of the two (§20 rule 16).
       *
       * The «كل المستويات» button went with the in-page editor it returned from —
       * the editor is a dialog now, so there is one view and nothing to go back
       * from.
       */
      actions={null}
    >
      {notice ? (
        <p className="admin-notice" role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}

      <DataTable
          caption={t('admin.levelSubjects.caption')}
          columns={columns}
          rows={visible}
          rowKey={(r) => r.level.id}
          status={status}
          actions={actions}
          onRetry={() => void load()}
          filtered={query.trim() !== '' || categoryFilter !== ''}
          onClearFilters={() => {
            setQuery('');
            setCategoryFilter('');
          }}
          toolbar={
            <>
              <SearchInput
                value={query}
                onChange={setQuery}
                placeholder={t('admin.levelSubjects.searchPlaceholder')}
              />
              <SelectField
                label={t('admin.levelSubjects.filterCategory')}
                value={categoryFilter}
                onChange={setCategoryFilter}
                placeholder={t('admin.levelSubjects.allCategories')}
                options={categories.map((c) => ({ value: c.id, label: c.name }))}
              />
            </>
          }
      />

      {editing ? (
        <SubjectsDialog
          row={editing}
          all={all}
          token={accessToken}
          onCancel={() => setEditing(null)}
          onDone={(message) => {
            setEditing(null);
            setNotice(message);
            void load();
          }}
        />
      ) : null}

    </AdminLayout>
  );
}

/**
 * **Which Subjects a Level teaches, as a set.**
 *
 * Deliberately the **same shape** `مقرر الحفظ`'s `SyllabusDialog` uses, because
 * it is the same concept — *assign a set of reference items to a Level* — and one
 * concept gets one interaction. `FormDialog` + `MultiSelectField`, the difference
 * written rather than the whole set, and the refusals reported by name.
 *
 * ## Only the difference is written
 *
 * Re-asserting a pairing that already exists would be refused as a duplicate, and
 * re-writing every one would put changes nobody made into the audit trail. So the
 * dialog diffs its selection against what the Level had and issues one call per
 * actual change.
 *
 * **Removals are the interesting half.** `unassignSubject` is refused with a
 * `409` while Teaching Groups exist for the pair — those circles split a Subject
 * the Level would no longer teach, leaving their members holding seats in a
 * subject that is not offered. That refusal is surfaced **naming the Subject**,
 * because *"one of your removals was refused"* is not actionable and this is a
 * set-at-a-time control where several could be.
 *
 * ## Authorization
 *
 * Super Admin writes (R43.3 — curriculum structure). The dialog is only opened
 * for a caller whose **active** role admits it (R60), and the server enforces it
 * regardless: a `403` is reported as a refusal rather than pre-empted.
 */
function SubjectsDialog({
  row,
  all,
  token,
  onCancel,
  onDone,
}: {
  row: Row;
  /** Every live Subject — the caller already holds the list. */
  all: SubjectRef[];
  token: string | null;
  onCancel: () => void;
  onDone: (message: string) => void;
}): ReactNode {
  const pristine = row.subjects.map((s) => s.id);
  const [selected, setSelected] = useState<string[]>(pristine);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Sorted on both sides: the pairing is a set, so a different order of the same
  // ids is not a change.
  const dirty = isDirty([...selected].sort(), [...pristine].sort());

  async function submit(): Promise<void> {
    setBusy(true);
    setNotice(null);
    const before = new Set(pristine);
    const after = new Set(selected);
    const blocked: string[] = [];
    try {
      for (const id of after) {
        if (!before.has(id)) await assignSubject(row.level.id, id, token);
      }
      for (const id of before) {
        if (!after.has(id)) {
          try {
            await unassignSubject(row.level.id, id, token);
          } catch (error) {
            // A `409` here is `SCHEDULES_EXIST`/circles — a real refusal about a
            // specific Subject, not a failed request. Collected and named.
            if (error instanceof ApiError && error.status === 409) {
              blocked.push(all.find((s) => s.id === id)?.name ?? id);
            } else {
              throw error;
            }
          }
        }
      }
      onDone(
        blocked.length > 0
          ? t('admin.levelSubjects.removeBlockedNamed').replace('{names}', blocked.join('، '))
          : t('admin.levelSubjects.saved'),
      );
    } catch (error) {
      setNotice(
        error instanceof ApiError && error.status === 403
          ? t('admin.levelSubjects.superAdminOnly')
          : t('common.saveFailed'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormDialog
      open
      title={t('admin.levelSubjects.manageTitle')}
      notice={notice}
      busy={busy}
      dirty={dirty}
      onSubmit={() => void submit()}
      onCancel={onCancel}
    >
      <p className="lede">{levelLabel(row.level)}</p>
      <MultiSelectField
        label={t('admin.levelSubjects.colSubjects')}
        options={all.map((s) => ({ value: s.id, label: s.name }))}
        selected={selected}
        onChange={setSelected}
        hint={t('admin.levelSubjects.addHint')}
        emptyLabel={t('admin.levelSubjects.noneYet')}
      />
      {/* The circles hand-off, kept: this dialog pairs Subjects with a Level and
          does not split them into circles (R69.5). It names the screen that does,
          which is a cross-hierarchy hand-off rather than duplicate navigation. */}
      {row.subjects.length > 0 ? (
        <p className="field__hint">
          {t('admin.levelSubjects.organiseHint')}{' '}
          <a href={`/admin/teaching-groups?level=${row.level.id}`}>
            {t('admin.nav.teachingGroups')}
          </a>
        </p>
      ) : null}
    </FormDialog>
  );
}
