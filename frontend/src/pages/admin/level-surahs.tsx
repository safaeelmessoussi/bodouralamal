import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { listCategories, type Category } from '../../adapters/taxonomy.js';
import {
  assignSurah,
  fetchLevelCompletion,
  listLevelSurahs,
  listLevels,
  listQuranSurahs,
  unassignSurah,
  type Level,
  type LevelCompletionRow,
  type LevelSurahRef,
} from '../../adapters/taxonomy.js';
import { AdminLayout } from '../../components/admin/admin-layout.js';
import { levelLabel } from '../../components/scope/level-select.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
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
import { t } from '../../i18n/index.js';
import { ApiError } from '../../lib/api.js';

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

  /** Completion for the one Level a reader has opened — never for all of them. */
  const [completion, setCompletion] = useState<{
    rows: LevelCompletionRow[];
    state: 'loading' | 'ready' | 'error';
  } | null>(null);

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

  const loadCompletion = useCallback(
    async (id: string) => {
      setCompletion({ rows: [], state: 'loading' });
      try {
        setCompletion({ rows: await fetchLevelCompletion(id, accessToken), state: 'ready' });
      } catch {
        setCompletion({ rows: [], state: 'error' });
      }
    },
    [accessToken],
  );

  // `?level=` opens that Level's completion on arrival — focus, never a gate:
  // the table above is rendered either way.
  useEffect(() => {
    if (levelId) void loadCompletion(levelId);
    else setCompletion(null);
  }, [levelId, loadCompletion]);

  /** Client-side narrowing of a list already loaded in full. */
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (categoryFilter === '' || r.level.category_id === categoryFilter) &&
        (needle === '' || levelLabel(r.level).toLowerCase().includes(needle)),
    );
  }, [rows, query, categoryFilter]);

  const open = levelId ? (rows.find((r) => r.level.id === levelId) ?? null) : null;

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
    {
      key: 'count',
      header: t('admin.levelSurahs.colCount'),
      numeric: true,
      secondary: true,
      cell: (r) => r.surahs.length,
    },
  ];

  const actions: RowAction<Row>[] = [
    {
      label: t('admin.levelSurahs.viewCompletion'),
      onSelect: (r) => {
        window.location.href = `/admin/level-surahs?level=${r.level.id}`;
      },
    },
    // R26 — curriculum is Super Admin. The affordance follows the ACTIVE role
    // (R60); the server enforces it regardless.
    ...(canWrite
      ? [{ label: t('admin.levelSurahs.configure'), onSelect: (r: Row) => setEditing(r) }]
      : []),
  ];

  return (
    <AdminLayout
      title={t('admin.nav.levelSurahs')}
      lede={t('admin.levelSurahs.lede')}
      actions={
        // **No add button, and that is not an omission.** This page configures an
        // existing Level's syllabus; it creates no Level and no Surah. Levels are
        // created on `المستويات` and the 114 Surahs are seeded reference data
        // (§4.5 calls that table the definitive denominator). A create control
        // here would have to invent one of the two.
        open ? (
          <Button
            variant="secondary"
            onClick={() => (window.location.href = '/admin/level-surahs')}
          >
            {t('admin.levelSurahs.backToLevels')}
          </Button>
        ) : null
      }
    >
      {notice ? (
        <p className="admin-notice" role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}

      {open ? (
        <CompletionView level={open.level} surahs={open.surahs} completion={completion} />
      ) : (
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
      )}

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

/** One Level's syllabus and its enrolled مستفيدات' completion (BR-11). */
function CompletionView({
  level,
  surahs,
  completion,
}: {
  level: Level;
  surahs: LevelSurahRef[];
  completion: { rows: LevelCompletionRow[]; state: 'loading' | 'ready' | 'error' } | null;
}): ReactNode {
  const columns: Column<LevelCompletionRow>[] = [
    { key: 'student', header: t('admin.enrollments.student'), cell: (r) => r.student_name },
    {
      key: 'covered',
      header: t('admin.levelSurahs.covered'),
      numeric: true,
      cell: (r) => `${r.completed_surahs}/${r.configured_surahs}`,
    },
    {
      key: 'status',
      header: t('admin.levelSurahs.status'),
      cell: (r) =>
        r.complete === null ? (
          // BR-11 cannot be asked without a syllabus, and saying "incomplete"
          // would be an answer nobody is entitled to give.
          <span className="muted">{t('admin.levelSurahs.notConfigured')}</span>
        ) : (
          <Badge tone={r.complete ? 'ok' : 'neutral'}>
            {t(r.complete ? 'admin.levelSurahs.complete' : 'admin.levelSurahs.incomplete')}
          </Badge>
        ),
    },
  ];

  return (
    <>
      <section className="admin-notice" aria-label={t('admin.levelSurahs.syllabus')}>
        <strong>{levelLabel(level)}</strong>
        {' — '}
        {surahs.length === 0
          ? t('admin.levelSurahs.noSurahs')
          : surahs.map((s) => `${s.name_arabic} (${s.total_ayahs})`).join(' · ')}
      </section>

      <h2>{t('admin.levelSurahs.completion')}</h2>
      {/* The shared table, so the completion list has the platform's own
          loading, error and empty states rather than three of its own. */}
      <DataTable
        caption={t('admin.levelSurahs.completion')}
        columns={columns}
        rows={completion?.rows ?? []}
        rowKey={(r) => r.student_id}
        status={completion === null ? 'loading' : completion.state}
      />
    </>
  );
}

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

  return (
    <FormDialog
      open
      title={t('admin.levelSurahs.configureTitle')}
      notice={notice}
      busy={busy}
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
