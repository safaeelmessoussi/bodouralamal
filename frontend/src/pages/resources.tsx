import { useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  fetchLibraryEntries,
  fetchCategoryWideContent,
  fetchLevelContent,
  type ContentItem,
  type LevelContent,
} from '../adapters/content.js';
import { fetchCalendarBootstrap } from '../adapters/calendar.js';
import type { LibraryEntry } from '../adapters/content.js';
import { normalizeArabic } from '../components/content/content-filters.js';
import { ContentCard } from '../components/content/content-card.js';
import {
  applyFilters,
  ContentFilters,
  EMPTY_FILTERS,
  hasActiveFilters,
  type ContentFilterState,
} from '../components/content/content-filters.js';
import { ContentPreviewDialog } from '../components/content/content-preview-dialog.js';
import { byTitle, SurahLibrary } from '../components/content/surah-library.js';
import { HumanityTimeline } from '../components/history/humanity-timeline.js';
import { Button } from '../components/ui/button.js';
import { useActiveChild } from '../contexts/active-child.js';
import { useSession } from '../contexts/session.js';
import { ApplicationHeader } from '../components/header/application-header.js';
import { SiteFooter } from '../components/site-footer.js';
import { EmptyState, ErrorState, NoResultsState } from '../components/states.js';
import { Container } from '../components/ui/container.js';
import { Icon } from '../components/ui/icon.js';
import { levelLabel } from '../components/scope/level-select.js';
import { t } from '../i18n/index.js';
import { counted } from '../lib/arabic-years.js';

/**
 * `/resources` — the educational library (§5.2, §4.9).
 *
 * **Two views on one navigation node.** §14.1's sitemap defines exactly one
 * resources node, and §5.2 describes it as a *drilling folder system* with a
 * "Level List" and a "Level Resources View". Those two views are therefore
 * implemented as one route with a `?level=` parameter rather than a second path:
 * a new path segment would be a navigation node §14.1 does not list, and §20
 * rule 16 forbids inventing one. The parameter keeps the view shareable and
 * bookmarkable, and becomes a path the day the sitemap says so.
 *
 * **The hierarchy is Category → Level → Academic Year → Branch → Contents.**
 * §5.2 additionally specifies a **Subject** tier beneath Branch; it is rendered
 * here as a *badge on the card* rather than a fourth grouping level — see the
 * note in the level view. That is a divergence, and it is reported rather than
 * silently resolved.
 *
 * **Real data since TD-3.13 landed.** `GET /library` backs both views. The index
 * is derived from the complete bounded page set, so only Levels with visible
 * content appear and their counts are real rather than inferred from page one.
 * No item names a teacher because `EducationalContent` records no uploader.
 *
 * **Nothing here filters by visibility.** The server returns what this caller
 * may see — tiers, the BR-2 consent gate and the own-branch-first ordering are
 * all applied before a row arrives. A client that filtered would be a second
 * implementation of a permission rule.
 */
type Load<T> =
  | { kind: 'loading' }
  | { kind: 'ready'; data: T }
  | { kind: 'error' };

export function ResourcesPage(): ReactNode {
  // Read once at mount: this is a full page load, not client-side routing, so
  // the value cannot change without the page changing with it.
  const levelId = useMemo(
    () => new URLSearchParams(window.location.search).get('level'),
    [],
  );
  // R167 §5 — «كل مستويات الفئة»: the shelf of what was made for every Level
  // of one Category. The same view; only what it asks the server for differs.
  const categoryId = useMemo(
    () => new URLSearchParams(window.location.search).get('category'),
    [],
  );
  const contentId = useMemo(
    () => new URLSearchParams(window.location.search).get('content'),
    [],
  );
  // A deep link to an item still opens on its own shelf (rule AB); a deep link
  // to a Level or a Category preselects the filter on the whole library.
  if (contentId && levelId) return <LevelView shelf={{ kind: 'level', id: levelId }} />;
  if (contentId && categoryId) return <LevelView shelf={{ kind: 'whole_category', id: categoryId }} />;
  return <LibraryPage levelId={levelId} categoryId={categoryId} />;
}

/**
 * **R196 — two ways to read the library, «حسب السورة» first.** A visitor who
 * only wants to study a Surah lands on the Surah view; «حسب المستوى» is the
 * Category → Level → Year view as it was. The view is `?view=` (a parameter,
 * not a navigation node — §20 rule 16), and a link naming a Level or a
 * Category opens the Level view, as it always did.
 */
type LibraryMode = 'history' | 'surah' | 'level';

function LibraryPage({ levelId, categoryId }: { levelId: string | null; categoryId: string | null }): ReactNode {
  const [mode, setMode] = useState<LibraryMode>(() => {
    const param = new URLSearchParams(window.location.search).get('view');
    if (param === 'levels' || levelId !== null || categoryId !== null) return 'level';
    if (param === 'history') return 'history';
    return 'surah';
  });
  // R207 — «نظرة شاملة» is public, like the rest of the library (R43): every
  // visitor has the three tabs; «حسب السورة» stays the default (R196).
  const shown: LibraryMode = mode;
  const tabs = <ModeTabs mode={shown} onMode={setMode} />;
  if (shown === 'history') return <HistoryView tabs={tabs} />;
  return shown === 'surah' ? (
    <SurahView tabs={tabs} />
  ) : (
    <LibraryView initialLevel={levelId} initialCategory={categoryId} tabs={tabs} />
  );
}

function ModeTabs({
  mode,
  onMode,
}: {
  mode: LibraryMode;
  onMode: (next: LibraryMode) => void;
}): ReactNode {
  const modes: LibraryMode[] = ['history', 'surah', 'level'];
  return (
    <div className="cal-segmented content-modes" role="tablist" aria-label={t('content.views.label')}>
      {modes.map((m) => (
        <Button
          key={m}
          variant="ghost"
          className={mode === m ? 'is-active' : undefined}
          role="tab"
          aria-selected={mode === m}
          onClick={() => {
            onMode(m);
            const url = new URL(window.location.href);
            url.searchParams.delete('node');
            if (m === 'level') url.searchParams.set('view', 'levels');
            else if (m === 'history') url.searchParams.set('view', 'history');
            else url.searchParams.delete('view');
            window.history.replaceState(null, '', url);
          }}
        >
          <Icon name={m === 'surah' ? 'book' : m === 'history' ? 'calendar' : 'folder'} size={16} />
          {t(m === 'surah' ? 'content.views.bySurah' : m === 'history' ? 'content.views.history' : 'content.views.byLevel')}
        </Button>
      ))}
    </div>
  );
}

/** R203 — «نظرة شاملة» (R204): the path of humanity, read from the general to the particular.
 *  No lede under the tabs (R204): the timeline and the eras' cards fit one laptop view. */
function HistoryView({ tabs }: { tabs: ReactNode }): ReactNode {
  // R205 — «اليوم» lists today's schedule at this reader's visibility.
  const { accessToken } = useSession();
  return (
    <Shell title={t('content.title')} lede={null} tabs={tabs}>
      <HumanityTimeline token={accessToken} />
    </Shell>
  );
}

/** R196 — the Surah view: the same rows, read by Surah (`surah-library.tsx`). */
function SurahView({ tabs }: { tabs: ReactNode }): ReactNode {
  const { accessToken } = useSession();
  const { activeChildId } = useActiveChild();
  const [load, setLoad] = useState<Load<LibraryEntry[]>>({ kind: 'loading' });
  const [open, setOpen] = useState<ContentItem | null>(null);
  const initialSurah = useMemo(() => {
    const raw = Number(new URLSearchParams(window.location.search).get('surah'));
    return Number.isInteger(raw) && raw >= 1 && raw <= 114 ? raw : null;
  }, []);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await fetchLibraryEntries(accessToken);
        if (!cancelled) setLoad({ kind: 'ready', data: rows });
      } catch {
        if (!cancelled) setLoad({ kind: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accessToken]);
  return (
    <Shell title={t('content.title')} lede={t('content.bySurah.pageLede')} tabs={tabs}>
      {load.kind === 'loading' ? <YearSkeletons /> : null}
      {load.kind === 'error' ? <ErrorState /> : null}
      {load.kind === 'ready' ? (
        <SurahLibrary
          entries={load.data}
          initialSurah={initialSurah}
          accessToken={accessToken}
          activeChildId={activeChildId}
          onOpen={setOpen}
        />
      ) : null}
      <ContentPreviewDialog item={open} onClose={() => setOpen(null)} accessToken={accessToken} activeChildId={activeChildId} />
    </Shell>
  );
}

/* ── Page 1 — the library index ──────────────────────────────────────────── */

/**
 * **R188 §2 — the Super Admin's own order, never a list in code.** The
 * Categories and the Levels of the library's filters and shelves follow
 * «الفئات» and «المستويات» exactly as the public calendar bootstrap orders
 * them (a Level's order is scoped within its Category, §2.2); a row the
 * bootstrap does not know sorts last rather than being dropped. This replaced
 * a name list (`المرأة / اليافعات / الطفل`, R121), which was itself hardcoded
 * and which the Owner did not want.
 */
interface Ranking {
  category: Map<string, number>;
  level: Map<string, number>;
  // R198 §5 — «الفروع» and «المواد» in their order too, never alphabetical.
  branch: Map<string, number>;
  subject: Map<string, number>;
}
const NO_RANKING: Ranking = { category: new Map(), level: new Map(), branch: new Map(), subject: new Map() };
const rankOf = (map: Map<string, number>, id: string): number => map.get(id) ?? Number.MAX_SAFE_INTEGER;

/** The whole library, filtered on every axis (the Owner, 2026-09-25). */
interface LibraryFilter {
  categoryId: string;
  shelfKey: string;
  yearId: string;
  branchId: string;
  subjectId: string;
  /** R177 §7 — items about one Surah; `''` is «الكل». */
  surahId: string;
  kind: string;
  query: string;
}
/** Does an entry pass the filter, every field but `ignored` (R198 §3)? */
function matchesFilter(e: LibraryEntry, filter: LibraryFilter, ignored: readonly (keyof LibraryFilter)[]): boolean {
  const on = (field: keyof LibraryFilter): boolean => !ignored.includes(field) && filter[field] !== '';
  const q = normalizeArabic(filter.query.trim());
  return (
    (!on('categoryId') || e.category_id === filter.categoryId) &&
    (!on('shelfKey') || e.shelf_key === filter.shelfKey) &&
    (!on('yearId') || e.academic_year_id === filter.yearId) &&
    (!on('branchId') || (e.branch_id ?? GLOBAL_BRANCH) === filter.branchId) &&
    (!on('subjectId') || (e.subject_id || NO_SUBJECT) === filter.subjectId) &&
    (!on('surahId') || String(e.surah_id ?? '') === filter.surahId) &&
    (!on('kind') || e.item.kind === filter.kind) &&
    (q === '' || normalizeArabic(e.item.title).includes(q) || normalizeArabic(e.item.description ?? '').includes(q))
  );
}

const NO_FILTER: LibraryFilter = { categoryId: '', shelfKey: '', yearId: '', branchId: '', subjectId: '', surahId: '', kind: '', query: '' };
const GLOBAL_BRANCH = '__global__';
const NO_SUBJECT = '__none__';

function LibraryView({
  initialLevel,
  initialCategory,
  tabs,
}: {
  initialLevel: string | null;
  initialCategory: string | null;
  tabs: ReactNode;
}): ReactNode {
  const { accessToken } = useSession();
  const { activeChildId } = useActiveChild();
  const [load, setLoad] = useState<Load<LibraryEntry[]>>({ kind: 'loading' });
  const [filter, setFilter] = useState<LibraryFilter>({
    ...NO_FILTER,
    ...(initialLevel ? { shelfKey: initialLevel } : {}),
    ...(initialCategory ? { shelfKey: `category:${initialCategory}` } : {}),
  });
  const [open, setOpen] = useState<ContentItem | null>(null);
  // R188 §2 — the Super Admin's order for the Categories and Levels, from
  // the public bootstrap (one small cached read); without it, names order.
  const [ranking, setRanking] = useState<Ranking>(NO_RANKING);
  useEffect(() => {
    let cancelled = false;
    const day = new Date().toISOString().slice(0, 10);
    void fetchCalendarBootstrap({ from: day, to: day })
      .then((bootstrap) => {
        if (cancelled) return;
        setRanking({
          category: new Map(bootstrap.categories.map((c, i) => [c.id, i])),
          level: new Map(bootstrap.levels.map((l, i) => [l.id, i])),
          branch: new Map(bootstrap.branches.map((b, i) => [b.id, i])),
          subject: new Map(bootstrap.subjects.map((x, i) => [x.id, i])),
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await fetchLibraryEntries(accessToken);
        if (!cancelled) setLoad({ kind: 'ready', data: rows });
      } catch {
        if (!cancelled) setLoad({ kind: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accessToken]);
  const entries = load.kind === 'ready' ? load.data : [];

  /**
   * The options are what EXISTS, so no filter offers an empty answer — and
   * since R198 §3 what exists GIVEN THE OTHER FILTERS: each list is drawn from
   * the entries every other filter keeps, so choosing a Subject narrows the
   * Levels and the Surahs, a Surah the Levels and the Subjects, and so on.
   * The Category list ignores the Level (choosing another Category is how a
   * Level is changed), and a Level chosen sets its Category.
   */
  const options = useMemo(() => {
    const cats = new Map<string, string>();
    const shelves = new Map<string, { label: string; categoryId: string }>();
    const years = new Map<string, string>();
    const branches = new Map<string, string>();
    const subjects = new Map<string, string>();
    const surahs = new Map<string, string>();
    const kinds = new Set<string>();
    const keeps = (e: LibraryEntry, ...ignored: (keyof LibraryFilter)[]): boolean =>
      matchesFilter(e, filter, ignored);
    for (const e of entries) {
      if (e.surah_id !== null && keeps(e, 'surahId')) surahs.set(String(e.surah_id), e.surah_name ?? String(e.surah_id));
      if (keeps(e, 'categoryId', 'shelfKey')) cats.set(e.category_id, e.category_name);
      if (keeps(e, 'yearId')) years.set(e.academic_year_id, e.academic_year_label);
      if (keeps(e, 'branchId')) branches.set(e.branch_id ?? GLOBAL_BRANCH, e.branch_name ?? t('content.globalScope'));
      // R199 §2 — «بدون» is the list's word for no element.
      if (keeps(e, 'subjectId')) subjects.set(e.subject_id || NO_SUBJECT, e.subject_name ?? t('common.noneChosen'));
      if (keeps(e, 'kind')) kinds.add(e.item.kind);
      if (!keeps(e, 'shelfKey')) continue;
      shelves.set(e.shelf_key, {
        // The shared label owns the «{Category} — {Level}» format (rule D).
        label: levelLabel({
          id: e.shelf_key,
          name: e.shelf_kind === 'whole_category' ? t('content.wholeCategory.title') : e.level_name,
          category_name: e.category_name,
        }),
        categoryId: e.category_id,
      });
    }
    // A chosen value stays in its own list, even when a typed search leaves
    // none of its items — a select must show what it holds.
    const chosen = entries.find((e) => e.academic_year_id === filter.yearId);
    if (filter.yearId !== '' && chosen && !years.has(filter.yearId)) years.set(filter.yearId, chosen.academic_year_label);
    const chosenSubject = entries.find((e) => (e.subject_id || NO_SUBJECT) === filter.subjectId);
    if (filter.subjectId !== '' && chosenSubject && !subjects.has(filter.subjectId)) subjects.set(filter.subjectId, chosenSubject.subject_name ?? t('content.noSubject'));
    const chosenBranch = entries.find((e) => (e.branch_id ?? GLOBAL_BRANCH) === filter.branchId);
    if (filter.branchId !== '' && chosenBranch && !branches.has(filter.branchId)) branches.set(filter.branchId, chosenBranch.branch_name ?? t('content.globalScope'));
    const chosenSurah = entries.find((e) => String(e.surah_id ?? '') === filter.surahId);
    if (filter.surahId !== '' && chosenSurah && !surahs.has(filter.surahId)) surahs.set(filter.surahId, chosenSurah.surah_name ?? filter.surahId);
    const chosenCategory = entries.find((e) => e.category_id === filter.categoryId);
    if (filter.categoryId !== '' && chosenCategory && !cats.has(filter.categoryId)) cats.set(filter.categoryId, chosenCategory.category_name);
    const chosenShelf = entries.find((e) => e.shelf_key === filter.shelfKey);
    if (filter.shelfKey !== '' && chosenShelf && !shelves.has(filter.shelfKey))
      shelves.set(filter.shelfKey, {
        label: levelLabel({
          id: chosenShelf.shelf_key,
          name: chosenShelf.shelf_kind === 'whole_category' ? t('content.wholeCategory.title') : chosenShelf.level_name,
          category_name: chosenShelf.category_name,
        }),
        categoryId: chosenShelf.category_id,
      });
    const byName = (a: [string, string], b: [string, string]) => a[1].localeCompare(b[1], 'ar');
    const byCategory = (a: string, b: string): number =>
      rankOf(ranking.category, a) - rankOf(ranking.category, b);
    return {
      categories: [...cats].sort((a, b) => byCategory(a[0], b[0]) || byName(a, b)),
      shelves: [...shelves]
        // Its Category's place, then — a Category's own shelf first — the Level's.
        .sort(
          (a, b) =>
            byCategory(a[1].categoryId, b[1].categoryId) ||
            Number(b[0].startsWith('category:')) - Number(a[0].startsWith('category:')) ||
            rankOf(ranking.level, a[0]) - rankOf(ranking.level, b[0]) ||
            a[1].label.localeCompare(b[1].label, 'ar'),
        ),
      years: [...years].sort((a, b) => b[1].localeCompare(a[1])),
      branches: [...branches].sort(
        (a, b) => Number(b[0] === GLOBAL_BRANCH) - Number(a[0] === GLOBAL_BRANCH) || rankOf(ranking.branch, a[0]) - rankOf(ranking.branch, b[0]) || byName(a, b),
      ),
      subjects: [...subjects].sort((a, b) => rankOf(ranking.subject, a[0]) - rankOf(ranking.subject, b[0]) || byName(a, b)),
      // Mushaf order, never alphabetical: a reader knows where البقرة is.
      surahs: [...surahs].sort((a, b) => Number(a[0]) - Number(b[0])),
      kinds,
    };
  }, [entries, filter, ranking]);

  const filtered = useMemo(() => entries.filter((e) => matchesFilter(e, filter, [])), [entries, filter]);

  // Category → shelf (the Category's own shelf first) → year (newest first)
  // → branch (بدون فرع first) → subject → items.
  const tree = useMemo(() => {
    // R177 §7 — within a Subject, the items about one Surah stand under it,
    // in Mushaf order; those about none come first, unlabelled.
    type SurahG = { id: number; name: string; items: ContentItem[] };
    type SubjectG = { key: string; name: string; items: ContentItem[]; surahs: SurahG[] };
    type BranchG = { key: string; name: string; subjects: SubjectG[] };
    type YearG = { id: string; label: string; branches: BranchG[] };
    type ShelfG = { key: string; kind: 'level' | 'whole_category'; name: string; years: YearG[]; count: number };
    type CatG = { id: string; name: string; shelves: ShelfG[] };
    const cats = new Map<string, CatG>();
    const seen = new Set<string>();
    const counted = new Set<string>();
    for (const e of filtered) {
      const dedupe = `${e.shelf_key}|${e.branch_id ?? GLOBAL_BRANCH}|${e.item.id}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      let cat = cats.get(e.category_id);
      if (!cat) cats.set(e.category_id, (cat = { id: e.category_id, name: e.category_name, shelves: [] }));
      let shelf = cat.shelves.find((x) => x.key === e.shelf_key);
      if (!shelf) cat.shelves.push((shelf = { key: e.shelf_key, kind: e.shelf_kind, name: e.level_name, years: [], count: 0 }));
      // An item filed for several branches is ONE item on its shelf (R198 §2).
      if (!counted.has(`${e.shelf_key}|${e.item.id}`)) {
        counted.add(`${e.shelf_key}|${e.item.id}`);
        shelf.count += 1;
      }
      let year = shelf.years.find((y) => y.id === e.academic_year_id);
      if (!year) shelf.years.push((year = { id: e.academic_year_id, label: e.academic_year_label, branches: [] }));
      const bkey = e.branch_id ?? GLOBAL_BRANCH;
      let branch = year.branches.find((b) => b.key === bkey);
      if (!branch) year.branches.push((branch = { key: bkey, name: e.branch_name ?? t('content.globalScope'), subjects: [] }));
      const skey = e.subject_id || NO_SUBJECT;
      let subject = branch.subjects.find((x) => x.key === skey);
      if (!subject) branch.subjects.push((subject = { key: skey, name: e.subject_name ?? t('content.noSubject'), items: [], surahs: [] }));
      if (e.surah_id === null) subject.items.push(e.item);
      else {
        let surah = subject.surahs.find((x) => x.id === e.surah_id);
        if (!surah) subject.surahs.push((surah = { id: e.surah_id, name: e.surah_name ?? String(e.surah_id), items: [] }));
        surah.items.push(e.item);
      }
    }
    const out = [...cats.values()].sort(
      (a, b) =>
        rankOf(ranking.category, a.id) - rankOf(ranking.category, b.id) ||
        a.name.localeCompare(b.name, 'ar'),
    );
    for (const cat of out) {
      cat.shelves.sort(
        (a, b) =>
          Number(b.kind === 'whole_category') - Number(a.kind === 'whole_category') ||
          rankOf(ranking.level, a.key) - rankOf(ranking.level, b.key) ||
          a.name.localeCompare(b.name, 'ar'),
      );
      for (const shelf of cat.shelves) {
        shelf.years.sort((a, b) => b.label.localeCompare(a.label));
        for (const year of shelf.years) {
          year.branches.sort(
            (a, b) =>
              Number(b.key === GLOBAL_BRANCH) - Number(a.key === GLOBAL_BRANCH) ||
              rankOf(ranking.branch, a.key) - rankOf(ranking.branch, b.key) ||
              a.name.localeCompare(b.name, 'ar'),
          );
          for (const branch of year.branches) {
            branch.subjects.sort(
              (a, b) => rankOf(ranking.subject, a.key) - rankOf(ranking.subject, b.key) || a.name.localeCompare(b.name, 'ar'),
            );
            for (const subject of branch.subjects) {
              subject.surahs.sort((a, b) => a.id - b.id);
              // R199 §3 — a Surah's items in their titles' order.
              for (const surah of subject.surahs) surah.items.sort(byTitle);
            }
          }
        }
      }
    }
    return out;
  }, [filtered, ranking]);

  const active = Object.entries(filter).some(([k, v]) => (k === 'query' ? v.trim() !== '' : v !== ''));
  const select = (id: keyof LibraryFilter, label: string, opts: [string, string][], allLabel = t('content.all')) => (
    <div className="cal-filter">
      <label className="cal-filter__label" htmlFor={`lib-${id}`}>
        {label}
      </label>
      <select
        id={`lib-${id}`}
        className="cal-filter__control"
        value={filter[id]}
        onChange={(e) => {
          const next = e.target.value;
          setFilter((f) => {
            const updated: LibraryFilter = { ...f, [id]: next };
            // R198 §3 — a Level sets its Category; clearing or changing the
            // Category retracts a Level of another one.
            if (id === 'shelfKey' && next !== '') {
              const shelf = entries.find((entry) => entry.shelf_key === next);
              if (shelf) updated.categoryId = shelf.category_id;
            }
            if (id === 'categoryId' && f.shelfKey !== '') {
              const shelf = entries.find((entry) => entry.shelf_key === f.shelfKey);
              if (next === '' || shelf?.category_id !== next) updated.shelfKey = '';
            }
            return updated;
          });
        }}
      >
        <option value="">{allLabel}</option>
        {opts.map(([value, name]) => (
          <option key={value} value={value}>
            {name}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <Shell title={t('content.title')} lede={t('content.lede')} tabs={tabs}>
      <div className="cal-toolbar" role="group" aria-label={t('content.filtersLabel')}>
        <div className="cal-filter cal-filter--search">
          <label className="cal-filter__label" htmlFor="lib-query">
            {t('content.searchLabel')}
          </label>
          <input
            id="lib-query"
            type="search"
            className="cal-filter__control"
            value={filter.query}
            placeholder={t('content.searchPlaceholder')}
            onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))}
          />
        </div>
        {select('categoryId', t('content.categoryLabel'), options.categories)}
        {select('shelfKey', t('content.levelFilterLabel'), options.shelves.map(([k, v]) => [k, v.label] as [string, string]))}
        {select('yearId', t('content.yearLabel'), options.years)}
        {select('branchId', t('content.branchLabel'), options.branches)}
        {select('subjectId', t('content.subjectLabel'), options.subjects)}
        {select('surahId', t('content.upload.surah'), options.surahs)}
        {select(
          'kind',
          t('content.typeLabel'),
          (['pdf', 'video', 'audio', 'image', 'document'] as const)
            .filter((k) => options.kinds.has(k) || filter.kind === k)
            .map((k) => [k, t(`content.kind.${k}`)] as [string, string]),
        )}
      </div>
      {load.kind === 'loading' ? <YearSkeletons /> : null}
      {load.kind === 'error' ? <ErrorState /> : null}
      {load.kind === 'ready' && entries.length === 0 ? <EmptyState /> : null}
      {load.kind === 'ready' && entries.length > 0 && tree.length === 0 ? (
        <NoResultsState onClear={() => setFilter(NO_FILTER)} />
      ) : null}
      {tree.map((cat) => (
        <section key={cat.id} className="content-group" aria-labelledby={`cat-${cat.id}`}>
          <h2 id={`cat-${cat.id}`} className="content-group__title">
            {cat.name}
          </h2>
          {cat.shelves.map((shelf) => (
            <section key={shelf.key} className="content-shelf" aria-labelledby={`shelf-${shelf.key}`}>
              <h3 id={`shelf-${shelf.key}`} className="content-shelf__title">
                {shelf.kind === 'whole_category' ? t('content.wholeCategory.title') : shelf.name}
                <span className="content-year__badge">{counted('content.itemCount', shelf.count)}</span>
              </h3>
              {shelf.years.map((year) => (
                <section key={year.id} className="content-year" aria-labelledby={`year-${shelf.key}-${year.id}`}>
                  <h4 id={`year-${shelf.key}-${year.id}`} className="content-year__title">
                    {year.label}
                  </h4>
                  {year.branches.map((branch) => (
                    <section key={branch.key} className="content-branch">
                      <h5 className="content-branch__title">
                        <Icon name={branch.key === GLOBAL_BRANCH ? 'shield' : 'book'} size={16} />
                        {branch.name}
                      </h5>
                      {branch.subjects.map((subject) => (
                        <div key={subject.key} className="content-subject">
                          <p className="content-subject__title">{t('content.subjectGroupLabel').replace('{subject}', subject.name)}</p>
                          {subject.items.length > 0 ? (
                            <ul className="content-list">
                              {subject.items.map((item) => (
                                <ContentCard key={item.id} item={item} onOpen={setOpen} />
                              ))}
                            </ul>
                          ) : null}
                          {/* R177 §7 — the items about one Surah, under its name. */}
                          {subject.surahs.map((surah) => (
                            <div key={surah.id} className="content-surah">
                              <p className="content-surah__title">
                                {t('content.surahGroupLabel').replace('{surah}', surah.name)}
                              </p>
                              <ul className="content-list">
                                {surah.items.map((item) => (
                                  <ContentCard key={item.id} item={item} onOpen={setOpen} />
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      ))}
                    </section>
                  ))}
                </section>
              ))}
            </section>
          ))}
        </section>
      ))}
      {active && tree.length > 0 ? (
        <p className="field__hint">
          <button type="button" className="link-button" onClick={() => setFilter(NO_FILTER)}>
            {t('states.clearFilters')}
          </button>
        </p>
      ) : null}
      <ContentPreviewDialog item={open} onClose={() => setOpen(null)} accessToken={accessToken} activeChildId={activeChildId} />
    </Shell>
  );
}

/* ── Page 2 — one level ──────────────────────────────────────────────────── */

function LevelView({
  shelf,
}: {
  shelf: { kind: 'level' | 'whole_category'; id: string };
}): ReactNode {
  // Anonymous and authenticated readers share this surface. Both metadata and
  // bytes are server-scoped; the mint additionally verifies live child context.
  const { accessToken, status: sessionStatus } = useSession();
  const { activeChildId } = useActiveChild();
  const [load, setLoad] = useState<Load<LevelContent | null>>({ kind: 'loading' });
  const [filters, setFilters] = useState<ContentFilterState>(EMPTY_FILTERS);
  const [open, setOpen] = useState<ContentItem | null>(null);

  /**
   * **`?content=` opens one item on arrival** (2026-08-17).
   *
   * A session's materials link here — *"clicking a content opens it in the
   * library"* — and until now the parameter they carried (`?content_id=`) was
   * consumed by nothing at all: the link landed on the Category index, and the
   * item was neither opened nor on the page.
   *
   * It is **focus, never a gate** (rule A): the Level's shelf renders in full
   * whether or not the parameter is present, and an id that matches nothing here
   * simply opens nothing rather than emptying the page. The effect runs once the
   * content has loaded, because the item it opens is one of the loaded rows —
   * the dialog renders the item, not an id.
   */
  const focusId = useMemo(
    () => new URLSearchParams(window.location.search).get('content'),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    setLoad({ kind: 'loading' });
    void (async () => {
      try {
        const data =
          shelf.kind === 'level'
            ? await fetchLevelContent(shelf.id, accessToken)
            : await fetchCategoryWideContent(shelf.id, accessToken);
        if (!cancelled) setLoad({ kind: 'ready', data });
      } catch {
        if (!cancelled) setLoad({ kind: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shelf.kind, shelf.id, accessToken]);

  const content = load.kind === 'ready' ? load.data : null;

  // Opened once, when the shelf it belongs to has loaded. `focusId` is read at
  // mount and never changes, so this cannot reopen a dialog the reader has shut.
  const [focusHandled, setFocusHandled] = useState(false);
  useEffect(() => {
    if (focusHandled || focusId === null || content === null || sessionStatus === 'loading') return;
    // §5.2 groups a Level's shelf by academic year and then by branch, so the
    // item is two levels down — searched rather than assumed to be anywhere in
    // particular.
    for (const year of content.years) {
      for (const branch of year.branches) {
        for (const item of branch.items) {
          if (item.id === focusId) {
            setFocusHandled(true);
            setOpen(item);
            return;
          }
        }
      }
    }
  }, [focusHandled, focusId, content, sessionStatus]);
  const filtered = useMemo(
    () => (content ? applyFilters(content, filters) : null),
    [content, filters],
  );

  /**
   * Academic years **newest first**.
   *
   * Sorted on the `YYYY-YYYY` label, which is safe to compare as a string
   * because TD-6 constrains the format — so `2026-2027 > 2025-2026`
   * lexicographically as well as chronologically, with no date parsing.
   *
   * §5.2 pins the `is_current` year at top; newest-first and current-first
   * coincide for every ordinary year, and where they would not — a year recorded
   * ahead of the current one — this shows the newest. That divergence is reported,
   * not resolved here.
   */
  const years = useMemo(
    () => (filtered ? [...filtered.years].sort((a, b) => b.label.localeCompare(a.label)) : []),
    [filtered],
  );

  return (
    <Shell
      title={
        shelf.kind === 'whole_category'
          ? t('content.wholeCategory.title')
          : (content?.level_name ?? t('content.title'))
      }
      lede={content?.description ?? null}
      eyebrow={content?.category_name ?? null}
      back
    >
      {load.kind === 'loading' ? <YearSkeletons /> : null}
      {load.kind === 'error' ? <ErrorState /> : null}

      {/* A level id that resolves to nothing — a stale link, or content removed
          since it was shared. Distinct from "this level is empty". */}
      {load.kind === 'ready' && content === null ? <EmptyState /> : null}

      {content ? (
        <>
          <ContentFilters content={content} value={filters} onChange={setFilters} />

          {years.length === 0 ? (
            hasActiveFilters(filters) ? (
              // "Nothing matches your filters" is a different answer from
              // "nothing here yet" (§14.4), and it offers the way out.
              <NoResultsState onClear={() => setFilters(EMPTY_FILTERS)} />
            ) : (
              <EmptyState />
            )
          ) : null}

          {years.map((year) => (
            <section
              key={year.academic_year_id}
              className="content-year"
              aria-labelledby={`year-${year.academic_year_id}`}
            >
              <h2 id={`year-${year.academic_year_id}`} className="content-year__title">
                {year.label}
                {year.is_current ? (
                  <span className="content-year__badge">{t('content.currentYear')}</span>
                ) : null}
              </h2>

              {year.branches.map((branch) => (
                <section
                  key={branch.branch_id ?? 'global'}
                  className="content-branch"
                  aria-labelledby={`br-${year.academic_year_id}-${branch.branch_id ?? 'global'}`}
                >
                  <h3
                    id={`br-${year.academic_year_id}-${branch.branch_id ?? 'global'}`}
                    className="content-branch__title"
                  >
                    <Icon name={branch.branch_id ? 'book' : 'shield'} size={16} />
                    {/* The Global / بدون فرع container, which §5.2 places at the
                        top of the branch tier — content belonging to no single
                        branch has to surface somewhere (BR-20). */}
                    {branch.branch_name ?? t('content.globalScope')}
                  </h3>
                  <ul className="content-list">
                    {branch.items.map((item) => (
                      <ContentCard key={item.id} item={item} onOpen={setOpen} />
                    ))}
                  </ul>
                </section>
              ))}
            </section>
          ))}
        </>
      ) : null}

      <ContentPreviewDialog
        item={open}
        onClose={() => setOpen(null)}
        accessToken={accessToken}
        activeChildId={activeChildId}
      />
    </Shell>
  );
}

/* ── Shared chrome ───────────────────────────────────────────────────────── */

/**
 * The page frame both views share, so the header, footer, heading structure and
 * width are defined once. Reuses `Container` rather than inventing a gutter
 * (§14.3).
 */
function Shell({
  title,
  lede,
  eyebrow = null,
  back = false,
  tabs = null,
  children,
}: {
  title: string;
  lede: string | null;
  eyebrow?: string | null;
  back?: boolean;
  /** R196 — «حسب السورة | حسب المستوى», under the heading. */
  tabs?: ReactNode;
  children: ReactNode;
}): ReactNode {
  return (
    <>
      <ApplicationHeader />
      <main id="main">
        <section className="section content-page" aria-labelledby="content-title">
          <Container>
            <div className="content-page__head">
              {back ? (
                <a className="content-page__back" href="/resources">
                  <Icon name="chevron" size={16} />
                  {t('content.backToLibrary')}
                </a>
              ) : null}
              {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
              <h1 id="content-title" className="content-page__title">
                {title}
              </h1>
              {/* R197 — under the tabs the lede says what the chosen TAB does. */}
              {tabs}
              {lede ? <p className="lede">{lede}</p> : null}
            </div>
            {children}
          </Container>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

/** Skeletons shaped like the cards they replace, so the page does not reflow when
 *  the data lands (§14.4 — a skeleton, not a spinner). */

function YearSkeletons(): ReactNode {
  return (
    <div role="status" aria-live="polite">
      <span className="skeleton skeleton--title" />
      <div className="content-list">
        {[0, 1, 2].map((n) => (
          <div key={n} className="content-card content-card--skeleton">
            <span className="skeleton skeleton--wide" />
            <span className="skeleton skeleton--narrow" />
          </div>
        ))}
      </div>
      <span className="visually-hidden">{t('states.loading')}</span>
    </div>
  );
}
