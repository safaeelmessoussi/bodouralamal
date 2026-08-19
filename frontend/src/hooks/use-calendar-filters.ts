import { useCallback, useMemo, useState } from 'react';

/**
 * **One filter state per calendar surface, shared by both of its views.**
 *
 * The defect this exists for (2026-08-19): the back office applied its filters
 * to قائمة and **not** to تقويم — the list queried with branch, subject, year and
 * type while the grid called `GET /calendar` with a date range and nothing else.
 * Switching view silently changed the dataset, which is the one thing a view
 * switch must never do.
 *
 * The cause was structural rather than a missed argument: each view owned its
 * own state, so *the filters* were two things that happened to look alike. Here
 * they are one, held above both views — the switch then changes **presentation
 * only**, and the same filtered set is rendered as a list or as a month.
 *
 * ## The URL is the state
 *
 * `?view=` already survives a reload and a shared link (§20 rule 16, `ViewSwitch`).
 * The filters join it for the same reason and by the same mechanism, which is
 * also what makes *switching view must not reset the filters* true **by
 * construction**: the switch writes one parameter and leaves the others alone,
 * so there is no state to lose in the first place.
 *
 * ## What it does NOT decide
 *
 * **Which filters a surface offers is the caller's**, because that is a question
 * about authorization and about what the surface is for — a beneficiary has no
 * business filtering by branch when her calendar is her own. The hook holds
 * whatever fields it is given and nothing more; `CalendarFilters` renders them.
 * Deriving the set here would put a permission decision inside a state
 * container, which is rule O exactly.
 */

/** Every field any calendar surface filters by. A surface names its own subset. */
export type CalendarFilterField = 'branchId' | 'categoryId' | 'levelId' | 'subjectId' | 'type';

export type CalendarFilterValues = Partial<Record<CalendarFilterField, string>>;

/** The query-parameter name for each field — the contract's own spelling. */
const PARAM: Record<CalendarFilterField, string> = {
  branchId: 'branch_id',
  categoryId: 'category_id',
  levelId: 'level_id',
  subjectId: 'subject_id',
  type: 'type',
};

function readFromUrl(fields: readonly CalendarFilterField[]): CalendarFilterValues {
  const params = new URLSearchParams(window.location.search);
  const out: CalendarFilterValues = {};
  for (const field of fields) {
    const raw = params.get(PARAM[field]);
    if (raw !== null && raw !== '') out[field] = raw;
  }
  return out;
}

export interface CalendarFilters {
  /** The current values — the ONE set both views read. */
  value: CalendarFilterValues;
  /** The fields this surface offers, in the order it offers them. */
  fields: readonly CalendarFilterField[];
  set: (field: CalendarFilterField, value: string | null) => void;
  clear: () => void;
  /** Whether anything is narrowing — for the empty state's *clear filters*. */
  active: boolean;
}

export function useCalendarFilters(fields: readonly CalendarFilterField[]): CalendarFilters {
  // Read once at mount: a deep link arrives with its filters already chosen, and
  // re-reading on every render would fight the state it is meant to seed.
  const [value, setValue] = useState<CalendarFilterValues>(() => readFromUrl(fields));

  const write = useCallback((next: CalendarFilterValues) => {
    const params = new URLSearchParams(window.location.search);
    for (const [field, param] of Object.entries(PARAM) as [CalendarFilterField, string][]) {
      const v = next[field];
      if (v === undefined || v === '') params.delete(param);
      else params.set(param, v);
    }
    // `replaceState`, not `pushState`: narrowing a list is not a place in the
    // history somebody wants to walk back through one selection at a time.
    const query = params.toString();
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${query ? `?${query}` : ''}`,
    );
  }, []);

  const set = useCallback(
    (field: CalendarFilterField, next: string | null) => {
      setValue((current) => {
        const updated = { ...current };
        if (next === null || next === '') delete updated[field];
        else updated[field] = next;

        /**
         * **A Level belongs to a Category** (§4.4b), so changing the Category
         * cannot leave a Level from the previous one selected — the pair would
         * name a combination that does not exist and the screen would go empty
         * with no way to see why. The dependency is the platform's existing
         * selector rule, applied here once rather than per surface.
         */
        if (field === 'categoryId') delete updated.levelId;

        write(updated);
        return updated;
      });
    },
    [write],
  );

  const clear = useCallback(() => {
    setValue({});
    write({});
  }, [write]);

  const active = useMemo(() => Object.values(value).some((v) => v !== undefined && v !== ''), [value]);

  return { value, fields, set, clear, active };
}
