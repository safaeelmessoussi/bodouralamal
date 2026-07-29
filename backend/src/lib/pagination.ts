/**
 * TD-10 pagination — the single implementation.
 *
 * TD-10 is unambiguous: *"Every list endpoint is paginated: `?page=1&page_size=25`;
 * **default 25, max 100**; response envelope `{ data: […], meta: { page,
 * page_size, total } }`."* §2.4 restates it as binding guidance — every list is
 * paginated, and no endpoint performs an unbounded scan.
 *
 * The rule lived in two byte-identical copies (`approval.service`,
 * `user.service`) while five other list endpoints implemented none of it. Both
 * halves of that are the same hazard: a normative constant with more than one
 * home drifts, and the surface that drifts still passes its own tests.
 */

/** TD-10 response envelope. */
export interface Page<T> {
  data: T[];
  meta: { page: number; page_size: number; total: number };
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export interface PageParams {
  page?: number | undefined;
  pageSize?: number | undefined;
}

export interface PageWindow {
  skip: number;
  take: number;
  page: number;
  pageSize: number;
}

/**
 * Clamps rather than rejects. A caller asking for 5,000 rows is asking for
 * something TD-10 does not offer, but refusing the request would turn a
 * cosmetic client bug into an outage; capping serves the first 100 and keeps
 * the contract honest by reporting `page_size` back.
 */
export function pageWindow(params: PageParams = {}): PageWindow {
  // Absent means "use the default"; present-but-nonsensical means "clamp".
  // Collapsing the two — `Math.trunc(x) || DEFAULT` — silently turned
  // `page_size=0` into 25 while the `Math.max(…, 1)` beside it claimed to floor
  // at 1. Two mechanisms disagreeing about the same value is the bug, not the
  // value either produced.
  const size = clamp(params.pageSize ?? DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE);
  const current = clamp(params.page ?? 1, 1, Number.MAX_SAFE_INTEGER, 1);
  return { skip: (current - 1) * size, take: size, page: current, pageSize: size };
}

/** Truncates, clamps to `[min, max]`, and falls back only for non-finite input. */
function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

/** Builds the TD-10 envelope from a window and the unpaginated total. */
export function page<T>(rows: T[], window: PageWindow, total: number): Page<T> {
  return { data: rows, meta: { page: window.page, page_size: window.pageSize, total } };
}

/**
 * Reads TD-10's `?page=` / `?page_size=` from a query object.
 *
 * Non-numeric input yields `undefined` so `pageWindow` applies its defaults —
 * `?page=abc` is a malformed client, not a reason to fail a read.
 */
export function pageParamsFrom(query: Record<string, unknown>): PageParams {
  const num = (v: unknown): number | undefined => {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  return { page: num(query['page']), pageSize: num(query['page_size']) };
}
