import { useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  fetchContentLevels,
  fetchLevelContent,
  type ContentItem,
  type LevelContent,
  type LevelSummary,
} from '../adapters/content.js';
import { ContentCard } from '../components/content/content-card.js';
import {
  applyFilters,
  ContentFilters,
  EMPTY_FILTERS,
  hasActiveFilters,
  type ContentFilterState,
} from '../components/content/content-filters.js';
import { ContentPreviewDialog } from '../components/content/content-preview-dialog.js';
import { LevelCard } from '../components/content/level-card.js';
import { ApplicationHeader } from '../components/header/application-header.js';
import { SiteFooter } from '../components/site-footer.js';
import { EmptyState, ErrorState, NoResultsState } from '../components/states.js';
import { Container } from '../components/ui/container.js';
import { Icon } from '../components/ui/icon.js';
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
 * **Real data since TD-3.13 landed.** `GET /library` backs the level view; the
 * index reads the public calendar bootstrap for the Level list. Two consequences
 * are visible on screen and are deliberate, both explained in
 * `adapters/content.ts`: **the index shows no per-level counts**, because the
 * endpoint publishes no aggregate and a count derived from page one would be a
 * claim rather than a placeholder; and **no item names a teacher**, because
 * `EducationalContent` records no uploader at all.
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
  return levelId ? <LevelView levelId={levelId} /> : <LibraryView />;
}

/* ── Page 1 — the library index ──────────────────────────────────────────── */

/**
 * Categories always appear in this order, and it is **not** alphabetical or
 * `display_order`: it is the association's own progression, adult → teen →
 * child. Matching on the seeded Revision-27 stage names, with anything
 * unrecognised sorted last rather than dropped — a category added later must
 * still appear.
 */
const CATEGORY_ORDER = ['الكبار', 'اليافعون', 'الطفل'];

function categoryRank(name: string): number {
  const index = CATEGORY_ORDER.indexOf(name);
  return index === -1 ? CATEGORY_ORDER.length : index;
}

function LibraryView(): ReactNode {
  const [load, setLoad] = useState<Load<LevelSummary[]>>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await fetchContentLevels();
        if (!cancelled) setLoad({ kind: 'ready', data: rows });
      } catch {
        if (!cancelled) setLoad({ kind: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Grouped by category, categories in the fixed order, levels in the order the
   *  server returned them (it owns `display_order`). */
  const groups = useMemo(() => {
    if (load.kind !== 'ready') return [];
    const byCategory = new Map<string, { name: string; levels: LevelSummary[] }>();
    for (const level of load.data) {
      const group = byCategory.get(level.category_id);
      if (group) group.levels.push(level);
      else byCategory.set(level.category_id, { name: level.category_name, levels: [level] });
    }
    return [...byCategory.values()].sort((a, b) => categoryRank(a.name) - categoryRank(b.name));
  }, [load]);

  return (
    <Shell title={t('content.title')} lede={t('content.lede')}>
      {load.kind === 'loading' ? <LevelSkeletons /> : null}
      {load.kind === 'error' ? <ErrorState /> : null}

      {load.kind === 'ready' && groups.length === 0 ? (
        // A library with nothing in it yet — informative, never a blank page
        // (§14.4).
        <EmptyState />
      ) : null}

      {groups.map((group) => (
        <section
          key={group.name}
          className="content-group"
          aria-labelledby={`cat-${group.name}`}
        >
          <h2 id={`cat-${group.name}`} className="content-group__title">
            {group.name}
          </h2>
          <ul className="level-grid">
            {group.levels.map((level) => (
              <LevelCard key={level.level_id} level={level} />
            ))}
          </ul>
        </section>
      ))}
    </Shell>
  );
}

/* ── Page 2 — one level ──────────────────────────────────────────────────── */

function LevelView({ levelId }: { levelId: string }): ReactNode {
  const [load, setLoad] = useState<Load<LevelContent | null>>({ kind: 'loading' });
  const [filters, setFilters] = useState<ContentFilterState>(EMPTY_FILTERS);
  const [open, setOpen] = useState<ContentItem | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoad({ kind: 'loading' });
    void (async () => {
      try {
        const data = await fetchLevelContent(levelId);
        if (!cancelled) setLoad({ kind: 'ready', data });
      } catch {
        if (!cancelled) setLoad({ kind: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [levelId]);

  const content = load.kind === 'ready' ? load.data : null;
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
      title={content?.level_name ?? t('content.title')}
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

      <ContentPreviewDialog item={open} onClose={() => setOpen(null)} />
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
function LevelSkeletons(): ReactNode {
  return (
    <div className="level-grid" role="status" aria-live="polite">
      {[0, 1, 2, 3].map((n) => (
        <div key={n} className="level-card level-card--skeleton">
          <span className="skeleton skeleton--title" />
          <span className="skeleton skeleton--wide" />
          <span className="skeleton skeleton--narrow" />
        </div>
      ))}
      <span className="visually-hidden">{t('states.loading')}</span>
    </div>
  );
}

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
