import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { listExams, type Exam } from '../../adapters/exams.js';
import { listLevels, type Level } from '../../adapters/taxonomy.js';
import { AdminLayout } from '../../components/admin/admin-layout.js';
import { GradeSheetView } from '../../components/grading/grade-sheet.js';
import { LevelSelect, levelLabel } from '../../components/scope/level-select.js';
import { Button, ButtonLink } from '../../components/ui/button.js';
import {
  DataTable,
  type Column,
  type RowAction,
  type TableStatus,
} from '../../components/ui/data-table.js';
import { SearchInput } from '../../components/ui/field.js';
import { useSession } from '../../contexts/session.js';
import { t } from '../../i18n/index.js';
import { formatDate } from '../../lib/format-date.js';

/**
 * `/admin/exam-grades` — **نقاط الامتحانات** (§4.6, R70.1).
 *
 * ## The principle this screen was rebuilt on (2026-08-17)
 *
 * **A management page shows the data it manages immediately.** It used to open
 * as a single dropdown over «اختاري امتحانًا» with an empty page beneath it: the
 * only way to learn which exams existed was to open the dropdown, and the only
 * way to learn one had no grades yet was to pick it. That is the same defect
 * `حلقات المواد` was rebuilt to remove, one screen over — a page whose primary
 * data is hidden behind a control.
 *
 * Every exam the caller's scope reaches is now listed on arrival. The Level
 * selector and the search box **narrow** that list; neither is what makes it
 * appear.
 *
 * ## The title does not change when a sheet opens
 *
 * `نقاط الامتحانات` is what this page is, whichever exam is open — so the exam's
 * name is **context inside the page**, rendered once by `GradeSheetView`'s
 * summary block. It used to become the page's `<h1>`, which meant the exam was
 * named twice three lines apart *and* that a reader who navigated here from the
 * menu found a heading that did not match the menu item they had clicked.
 *
 * ## It owns no creation, and says where creation lives
 *
 * An exam is scheduled on `/admin/schedules` (R56/R58 — one node for everything
 * that appears on the calendar). Inventing a second exam-authoring form here
 * would be a second implementation of §4.6's sitting, so the primary action is a
 * **link** to the screen that owns it. §20 rule 16: no invented capability, and
 * no page pretending to own data it does not.
 *
 * ## No breadcrumb
 *
 * The removed trail read `الجدولة › {exam}`. `الجدولة` is a sibling node in the
 * menu, not this page's parent, so the crumb was a second access path to a
 * screen already one click away — and it implied a hierarchy §14.1 does not
 * define. A single `كل الامتحانات` control returns from the sheet to the list,
 * which is a real relationship inside this page.
 */
export function ExamGradesPage({ examId }: { examId: string | null }): ReactNode {
  const { accessToken } = useSession();
  const [exams, setExams] = useState<Exam[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);
  const [status, setStatus] = useState<TableStatus>('loading');
  const [query, setQuery] = useState('');
  const [levelFilter, setLevelFilter] = useState<string | null>(null);
  /** **This exam's** maximum, reported by the sheet once one is open (R81).
   *  `null` until then: there is no platform default to stand in for it. */
  const [maxGrade, setMaxGrade] = useState<number | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      // The same role-scoped list the scheduling screen reads: an Admin sees
      // their branches' exams, a Super Admin every one. No second contract.
      const [examPage, levelList] = await Promise.all([
        listExams(accessToken),
        listLevels(accessToken).catch(() => [] as Level[]),
      ]);
      setExams(examPage.data);
      setLevels(levelList);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const current = exams.find((e) => e.id === examId) ?? null;

  /**
   * **Client-side narrowing of an already-loaded list, not a second read.**
   *
   * `GET /exams` is not paginated and returns the caller's whole scope, so
   * filtering here narrows exactly what the server authorised — it cannot widen
   * it. The moment that endpoint gains pagination this moves to the query
   * string; until then a round trip per keystroke would be a request for data
   * the page already holds.
   */
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return exams.filter(
      (e) =>
        (levelFilter === null || e.level_id === levelFilter) &&
        (needle === '' || e.title.toLowerCase().includes(needle)),
    );
  }, [exams, query, levelFilter]);

  const columns: Column<Exam>[] = [
    { key: 'title', header: t('admin.grades.exam'), cell: (e) => e.title },
    { key: 'date', header: t('admin.grades.colDate'), cell: (e) => formatDate(e.date) },
    {
      key: 'level',
      // The shared label — `{Category} — {Level}` — so a Level reads the same
      // here as in every selector (§4.4b: names are not unique across
      // Categories).
      header: t('admin.nav.levels'),
      cell: (e) => {
        const known = levels.find((l) => l.id === e.level_id);
        // `Exam.level_name` is nullable in the contract, so the Level list is
        // the better source when it has loaded — and `levelLabel` degrades to a
        // bare name rather than an em dash with nothing before it.
        const name = known?.name ?? e.level_name;
        return name === null
          ? '—'
          : levelLabel({ id: e.level_id, name, category_name: known?.category_name ?? null });
      },
    },
    {
      key: 'subject',
      header: t('admin.schedules.subject'),
      secondary: true,
      cell: (e) => e.subject_name ?? '—',
    },
    {
      key: 'audience',
      header: t('admin.grades.colAudience'),
      secondary: true,
      // R58 — a named group, or the whole Level at the exam's branch. Saying
      // which is what makes an empty sheet legible later.
      cell: (e) => e.administrative_group_name ?? t('admin.grades.wholeLevel'),
    },
  ];

  const actions: RowAction<Exam>[] = [
    {
      label: t('admin.grades.open'),
      // `?exam=` is R70.1's deep link — the `/resources?level=` pattern §14.1
      // sets. A second path segment would be a node §14.1 does not list.
      onSelect: (e) => {
        window.location.href = `/admin/exam-grades?exam=${e.id}`;
      },
    },
  ];

  return (
    <AdminLayout
      title={t('admin.nav.examGrades')}
      // **The list has no scale to name** (R81): each exam carries its own, so
      // the lede states the maximum only while a sheet is open and describes the
      // page plainly otherwise.
      lede={
        maxGrade === null
          ? t('admin.grades.ledeList')
          : t('admin.grades.lede').replace('{scale}', String(maxGrade))
      }
      actions={
        current ? (
          <Button variant="secondary" onClick={() => (window.location.href = '/admin/exam-grades')}>
            {t('admin.grades.backToList')}
          </Button>
        ) : (
          // A LINK, not a dialog: this page does not own exam creation. Rendered
          // through the shared add variant so it carries the platform's `＋`
          // like every other create action.
          <ButtonLink href="/admin/schedules?kind=exam&new=1" variant="add">
            {t('admin.grades.scheduleExam')}
          </ButtonLink>
        )
      }
    >
      {current ? (
        <GradeSheetView examId={current.id} onMaxGrade={setMaxGrade} />
      ) : examId !== null && status === 'ready' ? (
        // A deep link to an exam outside the caller's scope, or a stale
        // bookmark. Named rather than silently falling back to the list, which
        // would leave the reader wondering whether the link had worked.
        <p className="state" role="alert">
          {t('admin.grades.outOfScope')}
        </p>
      ) : (
        <DataTable
          caption={t('admin.grades.caption')}
          columns={columns}
          rows={visible}
          rowKey={(e) => e.id}
          status={status}
          actions={actions}
          onRetry={() => void load()}
          filtered={query.trim() !== '' || levelFilter !== null}
          onClearFilters={() => {
            setQuery('');
            setLevelFilter(null);
          }}
          toolbar={
            <>
              <SearchInput
                value={query}
                onChange={setQuery}
                placeholder={t('admin.grades.searchPlaceholder')}
              />
              {/* A filter, not a gate: the table above is already loaded. */}
              <LevelSelect
                levels={levels}
                value={levelFilter}
                onChange={(next) => setLevelFilter(next === '' ? null : next)}
                label={t('admin.grades.filterLevel')}
                placeholder={t('admin.grades.allLevels')}
              />
            </>
          }
        />
      )}
    </AdminLayout>
  );
}
