import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { listCategories, type Category } from '../../adapters/taxonomy.js';
import {
  assignSurah,
  listLevelSurahs,
  listLevels,
  listQuranSurahs,
  unassignSurah,
  type Level,
  type LevelSurahRef,
} from '../../adapters/taxonomy.js';
import { AdminLayout } from '../../components/admin/admin-layout.js';
import { levelLabel } from '../../components/scope/level-select.js';
import {
  DataTable,
  type Column,
  type RowAction,
  type TableStatus,
} from '../../components/ui/data-table.js';
import { FormDialog } from '../../components/ui/form-dialog.js';
import { SearchInput, SelectField } from '../../components/ui/field.js';
import { MultiSelectField } from '../../components/ui/multi-select.js';
import { useSession } from '../../contexts/session.js';
import { useActiveRole } from '../../contexts/active-role.js';
import { isDirty } from '../../lib/form-dirty.js';
import { t } from '../../i18n/index.js';
import { ApiError } from '../../lib/api.js';
import { Feedback } from '../../components/ui/feedback.js';

/**
 * `/admin/level-surahs` — **مقرر الحفظ** (§4.5, §7, BR-11; M4c).
 *
 * ## The syllabus, and what reads it
 *
 * `LevelSurah` is the **Quran-side curriculum join** (R43), and BR-11 reads it to
 * decide completion: *"coverage 100% and, only if a final exam is configured for
 * that level, that exam passed."* Configuring a Level here is therefore
 * configuring what finishing it means.
 *
 * ## It is a table, not an accordion (2026-08-17)
 *
 * Every accessible Level is listed **with its configured Surahs already
 * visible**, so *"what is the syllabus"* is answered by reading the page rather
 * than by expanding Levels one at a time. The syllabus per Level is a cheap read
 * and is fetched for every Level on load.
 *
 * **Completion is still per-Level and still lazy**, and that is not an
 * inconsistency: it resolves coverage per student per Surah through §4.5's
 * engine, so loading it for every Level on arrival would be a request storm for
 * data nobody has asked to see. It is what the row's action opens.
 *
 * ## Authorization
 *
 * **Super Admin writes; Admin reads** — R26's reference-versus-operational split,
 * the same rule `LevelSubject` follows. The controls follow the **active** role
 * (R60) and the server enforces both regardless.
 *
 * ## BR-11 is reported, never recomputed
 *
 * The percentages come from §4.5's engine through the completion read. This
 * screen computes no coverage of its own, and `complete: null` is rendered as its
 * own state: a Level with no syllabus cannot be completed **or** failed, and
 * showing 100% there would let an unconfigured Level mark everybody finished.
 */
interface Row {
  level: Level;
  surahs: LevelSurahRef[];
}

export function LevelSurahsPage({ levelId }: { levelId: string | null }): ReactNode {
  const { accessToken } = useSession();
  const { activeRoles } = useActiveRole();
  const canWrite = activeRoles.includes('super_admin');

  const [rows, setRows] = useState<Row[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [status, setStatus] = useState<TableStatus>('loading');
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [editing, setEditing] = useState<Row | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const [levels, categoryList] = await Promise.all([
        listLevels(accessToken),
        listCategories(accessToken).catch(() => [] as Category[]),
      ]);
      // One syllabus read per Level, in parallel. The association has a few
      // dozen Levels and each read is a small join, so this is one round of
      // requests rather than the per-student-per-Surah resolution completion
      // needs — which is why that one stays behind an action.
      const withSurahs = await Promise.all(
        levels.map(async (level) => ({
          level,
          surahs: await listLevelSurahs(level.id, accessToken).catch(() => [] as LevelSurahRef[]),
        })),
      );
      setRows(withSurahs);
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
   * **`?level=` opens that Level's syllabus editor** — focus, never a gate: the
   * table is rendered either way, and a caller arriving without the parameter
   * sees every Level.
   *
   * It used to open a completion view, which left this page with two
   * responsibilities. With completion gone (see the note on `actions`) the
   * parameter points at the one thing this page does, which is also what the row
   * action does — so the deep link and the click land in the same place instead
   * of the link quietly meaning something else.
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
        (needle === '' || levelLabel(r.level).toLowerCase().includes(needle)),
    );
  }, [rows, query, categoryFilter]);

  const columns: Column<Row>[] = [
    { key: 'level', header: t('admin.levelSurahs.colLevel'), cell: (r) => levelLabel(r.level) },
    {
      key: 'surahs',
      header: t('admin.levelSurahs.colSurahs'),
      cell: (r) =>
        r.surahs.length === 0 ? (
          // A Level with no syllabus is ordinary, not broken — and BR-11 cannot
          // be asked of it, which is why this is a statement and not a blank.
          <span className="muted">{t('admin.levelSurahs.noneYet')}</span>
        ) : (
          // Named in the cell rather than counted there: the question a reader
          // brings to this page is *which surahs*, and a number would send them
          // to a second screen for the answer they came for.
          r.surahs.map((s) => s.name_arabic).join(' · ')
        ),
    },
    /* **No «العدد» column** (Owner decision, 2026-08-17). The cell beside it
       already NAMES every item, so a count of the same list is the same fact
       twice — and the shorter of the two is the one a reader has to translate
       back into the answer they wanted. Removed rather than replaced: a
       different count would be the same redundancy under another heading. */
  ];

  /**
   * **«إتمام المستفيدات» left this page** (Owner decision, 2026-08-17).
   *
   * This screen answers one question — **which Surahs are prescribed for which
   * Level** — and per-student completion is a different one. It belongs to the
   * Quran-progress surfaces that already own it: `/teacher/quran` for a مؤطرة and
   * `/dashboard/student/quran` for the مستفيدة herself.
   *
   * **The engine is untouched.** `levelCompletion`, BR-11, the `complete: null`
   * third state and R10's self-heal all remain, tested, on
   * `GET /admin/levels/{id}/completion`. This removes a *presentation* of them
   * from a curriculum page — and with it the only reason this screen needed a
   * detail view at all, which is why `?level=` no longer opens one.
   */
  const actions: RowAction<Row>[] = canWrite
    ? // R26 — curriculum is Super Admin. The affordance follows the ACTIVE role
      // (R60); the server enforces it regardless.
      [{ label: t('admin.levelSurahs.configure'), onSelect: (r: Row) => setEditing(r) }]
    : [];

  return (
    <AdminLayout
      title={t('admin.nav.levelSurahs')}
      lede={t('admin.levelSurahs.lede')}
      /**
       * **No primary action, and that is not an omission.** This page configures
       * an existing Level's syllabus; it creates no Level and no Surah. Levels
       * are created on `المستويات` and the 114 Surahs are seeded reference data
       * (§4.5 calls that table the definitive denominator), so a create control
       * here would have to invent one of the two.
       *
       * The «كل المستويات» button went with the detail view it returned from —
       * there is one view now.
       */
      actions={null}
    >
      {notice ? (
        <Feedback>
          {notice}
        </Feedback>
      ) : null}

      <DataTable
          caption={t('admin.levelSurahs.caption')}
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
                placeholder={t('admin.levelSurahs.searchPlaceholder')}
              />
              <SelectField
                label={t('admin.levelSurahs.filterCategory')}
                value={categoryFilter}
                onChange={setCategoryFilter}
                placeholder={t('admin.levelSurahs.allCategories')}
                options={categories.map((c) => ({ value: c.id, label: c.name }))}
              />
            </>
          }
      />

      {editing ? (
        <SyllabusDialog
          level={editing.level}
          current={editing.surahs}
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
 * **`CompletionView` was removed with the responsibility it carried**
 * (2026-08-17).
 *
 * It rendered one Level's syllabus above a table of its enrolled مستفيدات and
 * their BR-11 completion — accurate, and on the wrong page: this screen answers
 * *which Surahs are prescribed for which Level*, and per-student progress belongs
 * to the surfaces that own it (`/teacher/quran`, `/dashboard/student/quran`).
 *
 * **`levelCompletion`, BR-11, the `complete: null` third state and R10's
 * self-heal are all untouched** on `GET /admin/levels/{id}/completion`, with
 * their integration tests. A presentation was removed; no engine was.
 */

/**
 * Choosing the Level's Surahs.
 *
 * Uses the shared multi-select, so 114 options are a searchable list rather than
 * a page of checkboxes — which is exactly the control that component was
 * extracted for.
 */
function SyllabusDialog({
  level,
  current,
  token,
  onCancel,
  onDone,
}: {
  level: Level;
  current: LevelSurahRef[];
  token: string | null;
  onCancel: () => void;
  onDone: (message: string) => void;
}): ReactNode {
  const [selected, setSelected] = useState<string[]>(current.map((s) => String(s.surah_id)));
  const [all, setAll] = useState<LevelSurahRef[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // The seeded lookup, not a hardcoded list: §4.5 calls that table the
  // definitive denominator, and a copy of the names here would be a second
  // source of truth for reference data.
  useEffect(() => {
    void (async () => {
      try {
        setAll(await listQuranSurahs(token));
      } catch {
        setAll([]);
      }
    })();
  }, [token]);

  // Sorted on both sides: a Surah set is unordered, so a different ORDER of the
  // same ids is not a change — comparing the raw arrays would report one.
  const dirty = isDirty(
    [...selected].sort(),
    current.map((s) => String(s.surah_id)).sort(),
  );

  return (
    <FormDialog
      open
      title={t('admin.levelSurahs.configureTitle')}
      notice={notice}
      busy={busy}
      dirty={dirty}
      onSubmit={() => {
        void (async () => {
          setBusy(true);
          setNotice(null);
          try {
            const before = new Set(current.map((s) => s.surah_id));
            const after = new Set(selected.map(Number));
            // Only the difference is written: re-asserting an existing row would
            // be refused as a duplicate, and re-writing every one would make an
            // audit trail of changes nobody made.
            for (const id of after) if (!before.has(id)) await assignSurah(level.id, id, token);
            for (const id of before) if (!after.has(id)) await unassignSurah(level.id, id, token);
            onDone(t('admin.levelSurahs.saved'));
          } catch (error) {
            setNotice(
              error instanceof ApiError && error.status === 403
                ? t('admin.levelSurahs.superAdminOnly')
                : t('common.saveFailed'),
            );
          } finally {
            setBusy(false);
          }
        })();
      }}
      onCancel={onCancel}
    >
      <p className="lede">{levelLabel(level)}</p>
      <MultiSelectField
        label={t('admin.levelSurahs.syllabus')}
        options={all.map((s) => ({ value: String(s.surah_id), label: `${s.surah_id}. ${s.name_arabic}` }))}
        selected={selected}
        onChange={setSelected}
        hint={t('admin.levelSurahs.configureHint')}
      />
    </FormDialog>
  );
}
