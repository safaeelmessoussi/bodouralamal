import { useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  fetchLibraryEntries,
  fetchCategoryWideContent,
  fetchLevelContent,
  type ContentItem,
  type LevelContent,
} from '../adapters/content.js';
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
import { useActiveChild } from '../contexts/active-child.js';
import { useSession } from '../contexts/session.js';
import { ApplicationHeader } from '../components/header/application-header.js';
import { SiteFooter } from '../components/site-footer.js';
import { EmptyState, ErrorState, NoResultsState } from '../components/states.js';
import { Container } from '../components/ui/container.js';
import { Icon } from '../components/ui/icon.js';
import { levelLabel } from '../components/scope/level-select.js';
import { t } from '../i18n/index.js';

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
  return <LibraryView initialLevel={levelId} initialCategory={categoryId} />;
}

/* ── Page 1 — the library index ──────────────────────────────────────────── */

/**
 * Categories always appear in this order, and it is **not** alphabetical or
 * `display_order`: it is the association's own progression, adult → teen →
 * child. Anything unrecognised sorts last rather than being dropped — a
 * category added later must still appear.
 *
 * **The names are the association's own** (Owner clarification, 2026-09-02;
 * SRS R121). This list read `الكبار / اليافعون / الطفل`, the sex-neutral forms
 * R27's migration introduced while moving the sex restriction into
 * `Level.gender_restriction`. Those are not what the association calls its
 * stages, so **not one of the three matched a real row** and every category
 * ranked equal-last — the progression this constant exists to impose was
 * silently absent.
 */
const CATEGORY_ORDER = ['المرأة', 'اليافعات', 'الطفل'];

function categoryRank(name: string): number {
  const index = CATEGORY_ORDER.indexOf(name);
  return index === -1 ? CATEGORY_ORDER.length : index;
}

/** The whole library, filtered on every axis (the Owner, 2026-09-25). */
interface LibraryFilter {
  categoryId: string;
  shelfKey: string;
  yearId: string;
  branchId: string;
  subjectId: string;
  kind: string;
  query: string;
}
const NO_FILTER: LibraryFilter = { categoryId: '', shelfKey: '', yearId: '', branchId: '', subjectId: '', kind: '', query: '' };
const GLOBAL_BRANCH = '__global__';
const NO_SUBJECT = '__none__';

function LibraryView({
  initialLevel,
  initialCategory,
}: {
  initialLevel: string | null;
  initialCategory: string | null;
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

  // The options are what EXISTS, so no filter offers an empty answer.
  const options = useMemo(() => {
    const cats = new Map<string, string>();
    const shelves = new Map<string, { label: string; categoryId: string }>();
    const years = new Map<string, string>();
    const branches = new Map<string, string>();
    const subjects = new Map<string, string>();
    for (const e of entries) {
      cats.set(e.category_id, e.category_name);
      shelves.set(e.shelf_key, {
        // The shared label owns the «{Category} — {Level}» format (rule D).
        label: levelLabel({
          id: e.shelf_key,
          name: e.shelf_kind === 'whole_category' ? t('content.wholeCategory.title') : e.level_name,
          category_name: e.category_name,
        }),
        categoryId: e.category_id,
      });
      years.set(e.academic_year_id, e.academic_year_label);
      branches.set(e.branch_id ?? GLOBAL_BRANCH, e.branch_name ?? t('content.globalScope'));
      subjects.set(e.subject_id || NO_SUBJECT, e.subject_name ?? t('content.noSubject'));
    }
    const byName = (a: [string, string], b: [string, string]) => a[1].localeCompare(b[1], 'ar');
    return {
      categories: [...cats].sort((a, b) => categoryRank(a[1]) - categoryRank(b[1])),
      shelves: [...shelves].filter(([, v]) => filter.categoryId === '' || v.categoryId === filter.categoryId),
      years: [...years].sort((a, b) => b[1].localeCompare(a[1])),
      branches: [...branches].sort(byName),
      subjects: [...subjects].sort(byName),
    };
  }, [entries, filter.categoryId]);

  const filtered = useMemo(() => {
    const q = normalizeArabic(filter.query.trim());
    return entries.filter(
      (e) =>
        (filter.categoryId === '' || e.category_id === filter.categoryId) &&
        (filter.shelfKey === '' || e.shelf_key === filter.shelfKey) &&
        (filter.yearId === '' || e.academic_year_id === filter.yearId) &&
        (filter.branchId === '' || (e.branch_id ?? GLOBAL_BRANCH) === filter.branchId) &&
        (filter.subjectId === '' || (e.subject_id || NO_SUBJECT) === filter.subjectId) &&
        (filter.kind === '' || e.item.kind === filter.kind) &&
        (q === '' || normalizeArabic(e.item.title).includes(q) || normalizeArabic(e.item.description ?? '').includes(q)),
    );
  }, [entries, filter]);

  // Category → shelf (the Category's own shelf first) → year (newest first)
  // → branch (بدون فرع first) → subject → items.
  const tree = useMemo(() => {
    type SubjectG = { key: string; name: string; items: ContentItem[] };
    type BranchG = { key: string; name: string; subjects: SubjectG[] };
    type YearG = { id: string; label: string; branches: BranchG[] };
    type ShelfG = { key: string; kind: 'level' | 'whole_category'; name: string; years: YearG[]; count: number };
    type CatG = { id: string; name: string; shelves: ShelfG[] };
    const cats = new Map<string, CatG>();
    const seen = new Set<string>();
    for (const e of filtered) {
      const dedupe = `${e.shelf_key}|${e.item.id}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      let cat = cats.get(e.category_id);
      if (!cat) cats.set(e.category_id, (cat = { id: e.category_id, name: e.category_name, shelves: [] }));
      let shelf = cat.shelves.find((x) => x.key === e.shelf_key);
      if (!shelf) cat.shelves.push((shelf = { key: e.shelf_key, kind: e.shelf_kind, name: e.level_name, years: [], count: 0 }));
      shelf.count += 1;
      let year = shelf.years.find((y) => y.id === e.academic_year_id);
      if (!year) shelf.years.push((year = { id: e.academic_year_id, label: e.academic_year_label, branches: [] }));
      const bkey = e.branch_id ?? GLOBAL_BRANCH;
      let branch = year.branches.find((b) => b.key === bkey);
      if (!branch) year.branches.push((branch = { key: bkey, name: e.branch_name ?? t('content.globalScope'), subjects: [] }));
      const skey = e.subject_id || NO_SUBJECT;
      let subject = branch.subjects.find((x) => x.key === skey);
      if (!subject) branch.subjects.push((subject = { key: skey, name: e.subject_name ?? t('content.noSubject'), items: [] }));
      subject.items.push(e.item);
    }
    const out = [...cats.values()].sort((a, b) => categoryRank(a.name) - categoryRank(b.name));
    for (const cat of out) {
      cat.shelves.sort((a, b) => Number(b.kind === 'whole_category') - Number(a.kind === 'whole_category') || a.name.localeCompare(b.name, 'ar'));
      for (const shelf of cat.shelves) {
        shelf.years.sort((a, b) => b.label.localeCompare(a.label));
        for (const year of shelf.years) {
          year.branches.sort((a, b) => Number(b.key === GLOBAL_BRANCH) - Number(a.key === GLOBAL_BRANCH) || a.name.localeCompare(b.name, 'ar'));
          for (const branch of year.branches) branch.subjects.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
        }
      }
    }
    return out;
  }, [filtered]);

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
        onChange={(e) => setFilter((f) => ({ ...f, [id]: e.target.value, ...(id === 'categoryId' ? { shelfKey: '' } : {}) }))}
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
    <Shell title={t('content.title')} lede={t('content.lede')}>
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
        {select(
          'kind',
          t('content.typeLabel'),
          (['pdf', 'video', 'audio', 'image', 'document'] as const).map((k) => [k, t(`content.kind.${k}`)] as [string, string]),
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
                <span className="content-year__badge">{t('content.itemCount').replace('{n}', String(shelf.count))}</span>
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
                          <ul className="content-list">
                            {subject.items.map((item) => (
                              <ContentCard key={item.id} item={item} onOpen={setOpen} />
                            ))}
                          </ul>
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
  children,
}: {
  title: string;
  lede: string | null;
  eyebrow?: string | null;
  back?: boolean;
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
