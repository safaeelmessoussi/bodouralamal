import type { ReactNode } from 'react';

import type { ContentKind, LevelContent } from '../../adapters/content.js';
import { t } from '../../i18n/index.js';

/**
 * Filters for one level's library: academic year, branch, type, and title search.
 *
 * **Every option is derived from the content actually present**, so the controls
 * can never offer a year or a branch that yields nothing. That is the same
 * principle the calendar's category→level dependency follows, reached here by
 * construction rather than by a request: this page already holds the whole level
 * in memory, so narrowing it is a local operation and a round trip would be
 * waste.
 *
 * **Why filtering locally is correct here and would be wrong on the calendar.**
 * The calendar's level list is *reference data* the server owns and §4.4
 * explicitly requires it to narrow server-side. This filters *the response the
 * page already received* — a different act. When the real endpoint arrives it may
 * accept these as query parameters, and moving them is then a change to the
 * page's data flow, not to this component.
 *
 * The controls reuse the calendar's `.cal-filter` shape deliberately: one filter
 * appearance across the platform, and no second design language.
 */
export interface ContentFilterState {
  yearId: string | null;
  branchId: string | null;
  /** `'global'` is a real choice — the بدون فرع scope, not "no filter". */
  kind: ContentKind | null;
  query: string;
}

export const EMPTY_FILTERS: ContentFilterState = {
  yearId: null,
  branchId: null,
  kind: null,
  query: '',
};

export function hasActiveFilters(f: ContentFilterState): boolean {
  return f.yearId !== null || f.branchId !== null || f.kind !== null || f.query.trim() !== '';
}

const KINDS: ContentKind[] = ['pdf', 'video', 'audio', 'image', 'document'];

export function ContentFilters({
  content,
  value,
  onChange,
}: {
  content: LevelContent;
  value: ContentFilterState;
  onChange: (next: ContentFilterState) => void;
}): ReactNode {
  const years = content.years.map((y) => ({ id: y.academic_year_id, label: y.label }));

  // Branches present anywhere in this level, de-duplicated across years. The
  // Global scope is represented by the sentinel `''` value, which the option
  // list distinguishes from "all branches" by label.
  const branches = new Map<string, string>();
  for (const year of content.years) {
    for (const branch of year.branches) {
      branches.set(branch.branch_id ?? GLOBAL, branch.branch_name ?? t('content.globalScope'));
    }
  }

  // Only offer a type that exists here — a filter that can only ever return
  // nothing is worse than no filter.
  const presentKinds = new Set<ContentKind>();
  for (const year of content.years) {
    for (const branch of year.branches) {
      for (const item of branch.items) presentKinds.add(item.kind);
    }
  }

  return (
    <div className="cal-toolbar" role="group" aria-label={t('content.filtersLabel')}>
      <div className="cal-filter cal-filter--search">
        <label className="cal-filter__label" htmlFor="content-search">
          {t('content.searchLabel')}
        </label>
        <input
          id="content-search"
          type="search"
          className="cal-filter__control"
          value={value.query}
          placeholder={t('content.searchPlaceholder')}
          onChange={(event) => onChange({ ...value, query: event.target.value })}
        />
      </div>

      {years.length > 1 ? (
        <div className="cal-filter">
          <label className="cal-filter__label" htmlFor="content-year">
            {t('content.yearLabel')}
          </label>
          <select
            id="content-year"
            className="cal-filter__control"
            value={value.yearId ?? ''}
            onChange={(e) => onChange({ ...value, yearId: e.target.value || null })}
          >
            <option value="">{t('content.allYears')}</option>
            {years.map((y) => (
              <option key={y.id} value={y.id}>
                {y.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {branches.size > 1 ? (
        <div className="cal-filter">
          <label className="cal-filter__label" htmlFor="content-branch">
            {t('content.branchLabel')}
          </label>
          <select
            id="content-branch"
            className="cal-filter__control"
            value={value.branchId ?? ''}
            onChange={(e) => onChange({ ...value, branchId: e.target.value || null })}
          >
            <option value="">{t('content.allBranches')}</option>
            {[...branches].map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {presentKinds.size > 1 ? (
        <div className="cal-filter">
          <label className="cal-filter__label" htmlFor="content-kind">
            {t('content.typeLabel')}
          </label>
          <select
            id="content-kind"
            className="cal-filter__control"
            value={value.kind ?? ''}
            onChange={(e) => onChange({ ...value, kind: (e.target.value || null) as ContentKind | null })}
          >
            <option value="">{t('content.allTypes')}</option>
            {KINDS.filter((k) => presentKinds.has(k)).map((k) => (
              <option key={k} value={k}>
                {t(`content.kind.${k}`)}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </div>
  );
}

/** The sentinel for the Global / بدون فرع scope in a `<select>`, whose values are
 *  strings and cannot carry `null`. */
export const GLOBAL = '__global__';

/**
 * Applies the filters, returning the same year→branch shape so the page's
 * rendering does not branch on whether filtering is active.
 *
 * **Empty groups are dropped**, not rendered empty: a year heading above no
 * content, or a branch subsection with nothing in it, states that the group
 * exists and is empty — which is not what a filter means.
 *
 * Search normalises Arabic the same way the backend's search does (§TD-10 —
 * diacritics, tatweel, alef and ya variants), so a visitor typing `احكام` finds
 * `أَحْكام`. It is a deliberately small subset: this filters a page's own data,
 * not the database, and the shadow-column machinery does not apply.
 */
export function applyFilters(content: LevelContent, f: ContentFilterState): LevelContent {
  const needle = normalizeArabic(f.query.trim());

  const years = content.years
    .filter((year) => (f.yearId ? year.academic_year_id === f.yearId : true))
    .map((year) => ({
      ...year,
      branches: year.branches
        .filter((branch) =>
          f.branchId ? (branch.branch_id ?? GLOBAL) === f.branchId : true,
        )
        .map((branch) => ({
          ...branch,
          items: branch.items.filter((item) => {
            if (f.kind && item.kind !== f.kind) return false;
            if (!needle) return true;
            const haystack = normalizeArabic(`${item.title} ${item.description ?? ''}`);
            return haystack.includes(needle);
          }),
        }))
        .filter((branch) => branch.items.length > 0),
    }))
    .filter((year) => year.branches.length > 0);

  return { ...content, years };
}

/** Fold the variant classes that actually collide in Moroccan Arabic input
 *  (TD-10's normalisation rules, minus the Latin and phone cases this page has
 *  no use for). */
function normalizeArabic(value: string): string {
  return value
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, '') // tashkeel + tatweel
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي');
}
